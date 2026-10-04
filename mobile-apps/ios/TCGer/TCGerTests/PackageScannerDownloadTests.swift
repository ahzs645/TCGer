import CryptoKit
import Foundation
import XCTest
@testable import TCGer

private final class PackageScannerProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responses: [String: Data] = [:]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let data = Self.responses[url.path] else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class PackageScannerDownloadTests: XCTestCase {
    func testPublisherGameDownloadsAndRelaunchesOffline() async throws {
        let fixture = try makeFixture()
        defer { fixture.clean() }
        try await fixture.store.install("star-garden")
        XCTAssertEqual(fixture.store.installState(for: "star-garden"), .installed(version: 1))
        PackageScannerProtocol.responses = [:]
        let relaunched = ScannerAssetStore(baseURL: nil, defaults: fixture.defaults, rootDirectory: fixture.root, packageSources: { [fixture.source] }, refreshOnInit: false)
        let runtime = try XCTUnwrap(relaunched.runtime(for: "star-garden"))
        XCTAssertEqual(runtime.game, "star-garden")
        XCTAssertEqual(try Data(contentsOf: runtime.metadataURL), fixture.metadata)
        XCTAssertTrue(FileManager.default.fileExists(atPath: runtime.modelURL.path))
        relaunched.remove("star-garden")
        XCTAssertNil(relaunched.runtime(for: "star-garden"))
    }

    func testCorruptAssetNeverMarksCompletion() async throws {
        let fixture = try makeFixture()
        defer { fixture.clean() }
        PackageScannerProtocol.responses["/scanner/vectors.bin"] = Data([99])
        do { try await fixture.store.install("star-garden"); XCTFail("Corrupt asset accepted") }
        catch { XCTAssertTrue(error is ScannerAssetStore.StoreError) }
        XCTAssertEqual(fixture.store.installState(for: "star-garden"), .notInstalled)
        XCTAssertEqual(fixture.defaults.integer(forKey: "scannerAssetInstalledVersion.star-garden"), 0)
        XCTAssertNil(fixture.store.runtime(for: "star-garden"))
    }

    func testUnsafeGameIDIsRejectedBeforeNetworkOrFilesystemWork() async throws {
        let fixture = try makeFixture()
        defer { fixture.clean() }
        do { try await fixture.store.install("../escape"); XCTFail("Unsafe game ID accepted") }
        catch { XCTAssertTrue(error is ScannerAssetStore.StoreError) }
        XCTAssertTrue(fixture.store.installedVersionsByID.isEmpty)
    }

    private struct Fixture {
        let store: ScannerAssetStore
        let source: ScannerAssetStore.PackageSource
        let root: URL
        let defaults: UserDefaults
        let suite: String
        let metadata: Data
        func clean() {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
            PackageScannerProtocol.responses = [:]
        }
    }
    private func makeFixture() throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let metadata = Data("[{\"annIndex\":0,\"game\":\"star-garden\"}]".utf8)
        var vectors = Data()
        for var value in [Int32(1).littleEndian, Int32(1).littleEndian] { vectors.append(contentsOf: withUnsafeBytes(of: &value, Array.init)) }
        vectors.append(1) // Quantized vector format: one byte per dimension.
        let model = Data("fixture-model".utf8)
        func asset(_ file: String, _ data: Data) -> [String: Any] { ["file": file, "bytes": data.count, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()] }
        var modelAsset = asset("model.bin", model); modelAsset["relativePath"] = "model.bin"
        let manifest = try JSONSerialization.data(withJSONObject: ["formatVersion": 1, "game": "star-garden", "version": 1, "generatedAt": "2026-10-04", "encoder": "arcface", "modelName": "fixture", "cardCount": 1, "dimension": 1, "downloadBytes": model.count + vectors.count + metadata.count, "modelPackage": [modelAsset], "vectors": asset("vectors.bin", vectors), "metadata": asset("metadata.json", metadata)])
        let source = ScannerAssetStore.PackageSource(gameID: "star-garden", url: URL(string: "https://publisher.example/scanner/manifest.json")!, asset: GamePackageAsset(url: "scanner/manifest.json", bytes: manifest.count, sha256: SHA256.hash(data: manifest).map { String(format: "%02x", $0) }.joined(), mediaType: "application/json"))
        PackageScannerProtocol.responses = ["/scanner/manifest.json": manifest, "/scanner/model.bin": model, "/scanner/vectors.bin": vectors, "/scanner/metadata.json": metadata]
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PackageScannerProtocol.self]
        let store = ScannerAssetStore(baseURL: nil, session: URLSession(configuration: config), defaults: defaults, rootDirectory: root, packageSources: { [source] }, refreshOnInit: false, compileModel: { packageURL in
            let compiled = packageURL.deletingLastPathComponent().appendingPathComponent("fixture.mlmodelc")
            try FileManager.default.createDirectory(at: compiled, withIntermediateDirectories: true)
            try Data("compiled-fixture".utf8).write(to: compiled.appendingPathComponent("model"))
            return compiled
        })
        return Fixture(store: store, source: source, root: root, defaults: defaults, suite: suite, metadata: metadata)
    }
}
