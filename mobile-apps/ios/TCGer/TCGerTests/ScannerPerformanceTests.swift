import Darwin.Mach
import UIKit
import XCTest
@testable import TCGer

@MainActor
final class ScannerPerformanceTests: XCTestCase {
    private enum Budget {
        static let artworkDatabaseLoadSeconds = 8.0
        static let annColdRankSeconds = 10.0
        static let firstScanSeconds = 10.0
        static let sustainedMeanSeconds = 2.0
        static let scannerPayloadBytes: Int64 = 150 * 1_024 * 1_024
        static let artworkLoadMemoryGrowthBytes: UInt64 = 240 * 1_024 * 1_024
    }

    func testBundledScannerPayloadStaysWithinBudget() throws {
        let names = [
            ("artwork-fingerprints-pokemon-uint8", "json"),
            ("MagicCardHashes", "json"),
            ("CardsIndexVectors", "bin"),
            ("CardsIndexMetadata", "json"),
            ("CardFaceGate", "json"),
            ("CardEmbeddings", "mlmodelc")
        ]
        let total = try names.reduce(Int64(0)) { partial, item in
            let url = try XCTUnwrap(Bundle.main.url(forResource: item.0, withExtension: item.1))
            return partial + directorySize(url)
        }
        XCTAssertLessThanOrEqual(total, Budget.scannerPayloadBytes)
    }

    func testArtworkDatabaseColdLoadTimeAndMemoryStayWithinBudget() {
        let memoryBefore = residentMemoryBytes()
        let strategy = ArtworkFingerprintScannerStrategy(bundle: .main)
        // Databases now load lazily per game — time the actual load, not init.
        let started = Date()
        let entries = strategy.loadDatabaseIfNeeded(for: .pokemon)
        let elapsed = Date().timeIntervalSince(started)
        let memoryGrowth = residentMemoryBytes().saturatingSubtract(memoryBefore)

        XCTAssertFalse(entries.isEmpty)
        XCTAssertTrue(strategy.supports(.pokemon))
        XCTAssertLessThan(elapsed, Budget.artworkDatabaseLoadSeconds)
        XCTAssertLessThan(memoryGrowth, Budget.artworkLoadMemoryGrowthBytes)
    }

    func testArtworkDatabasePeakMemoryMetric() {
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
            ArtworkFingerprintScannerStrategy(bundle: .main)
                .loadDatabaseIfNeeded(for: .pokemon)
        }
    }

    func testBundledANNColdLoadAndRankStaysWithinBudget() async throws {
        let store = AnnoyIndexStore(bundle: .main)
        let vector = [Float](repeating: 0.01, count: 384)
        let started = Date()
        _ = try await store.nearestNeighbors(for: vector, limit: 1, allowedIndices: [0])
        XCTAssertLessThan(Date().timeIntervalSince(started), Budget.annColdRankSeconds)
    }

    func testFirstAndSustainedLocalScanLatencyStayWithinBudget() async throws {
        let image = try XCTUnwrap(UIImage(named: "BossOrders")?.cgImage)
        let coordinator = CardScannerCoordinator.makeDefault()

        // The bundled fixture is a borderless card crop, i.e. an import — as
        // .photoCapture the detector would fire on an interior panel and the
        // scan legitimately abstains. importedPhoto also exercises the
        // whole-frame retry, so the measured first-scan latency covers the
        // most expensive import path.
        let firstStarted = Date()
        let first = await coordinator.scan(
            image: image,
            context: .test(engine: .localOnly),
            source: .importedPhoto
        )
        XCTAssertLessThan(Date().timeIntervalSince(firstStarted), Budget.firstScanSeconds)
        guard case .success = first else { return XCTFail("Bundled clean fixture did not scan") }

        var durations: [TimeInterval] = []
        for _ in 0..<3 {
            let started = Date()
            _ = await coordinator.scan(
                image: image,
                context: .test(engine: .localOnly),
                source: .livePreview
            )
            durations.append(Date().timeIntervalSince(started))
        }
        XCTAssertLessThan(
            durations.reduce(0, +) / Double(durations.count),
            Budget.sustainedMeanSeconds
        )
    }

    private func directorySize(_ url: URL) -> Int64 {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { return 0 }
        guard isDirectory.boolValue else {
            return (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
        }
        let files = FileManager.default.enumerator(
            at: url,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        )?.allObjects as? [URL] ?? []
        return files.reduce(0) { total, file in
            total + ((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0)
        }
    }

    private func residentMemoryBytes() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? UInt64(info.resident_size) : 0
    }
}

private extension UInt64 {
    func saturatingSubtract(_ other: UInt64) -> UInt64 {
        self >= other ? self - other : 0
    }
}
