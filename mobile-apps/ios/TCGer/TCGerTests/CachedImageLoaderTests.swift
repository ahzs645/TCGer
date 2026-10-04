import XCTest
import SwiftUI
@testable import TCGer

@MainActor
final class CachedImageLoaderTests: XCTestCase {
    private var root: URL!
    private var cache: ImageCache!
    private let a = URL(string: "https://example.test/a.png")!
    private let b = URL(string: "https://example.test/b.png")!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        cache = ImageCache(directory: root)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testDelayedFailureCannotReplaceNewURLSuccess() async throws {
        let probe = ImageFetchProbe()
        let loader = CachedImageLoader(cache: cache, fetch: probe.fetch)
        let first = Task { await loader.load(for: a) }
        await probe.waitFor(a)
        let second = Task { await loader.load(for: b) }
        await probe.waitFor(b)
        probe.finish(b, .success(Self.image()))
        await second.value
        probe.finish(a, .failure(URLError(.timedOut)))
        await first.value
        guard case .success = loader.phase else { return XCTFail("Old failure replaced the new image") }
        XCTAssertNotNil(cache.image(for: b))
        XCTAssertNil(cache.image(for: a))
    }

    func testDelayedSuccessCannotReplaceNewURLFailureAndRetryWorks() async {
        let probe = ImageFetchProbe()
        let loader = CachedImageLoader(cache: cache, fetch: probe.fetch)
        let first = Task { await loader.load(for: a) }
        await probe.waitFor(a)
        let second = Task { await loader.load(for: b) }
        await probe.waitFor(b)
        probe.finish(b, .failure(URLError(.badServerResponse)))
        await second.value
        probe.finish(a, .success(Self.image()))
        await first.value
        guard case .failure(let error) = loader.phase else { return XCTFail("Old success replaced current failure") }
        XCTAssertEqual((error as? URLError)?.code, .badServerResponse)
        let retry = Task { await loader.load(for: b) }
        await probe.waitFor(b)
        probe.finish(b, .success(Self.image()))
        await retry.value
        guard case .success = loader.phase else { return XCTFail("Retry stayed stuck") }
    }

    func testCancellationAndNilURLRejectLateResponse() async {
        let probe = ImageFetchProbe()
        let loader = CachedImageLoader(cache: cache, fetch: probe.fetch)
        let task = Task { await loader.load(for: a) }
        await probe.waitFor(a)
        task.cancel()
        await loader.load(for: nil)
        probe.finish(a, .success(Self.image()))
        await task.value
        guard case .empty = loader.phase else { return XCTFail("Cancelled image was published") }
        XCTAssertNil(cache.image(for: a))
    }

    func testCachedReplacementSupersedesPendingURL() async throws {
        let probe = ImageFetchProbe()
        let loader = CachedImageLoader(cache: cache, fetch: probe.fetch)
        let task = Task { await loader.load(for: a) }
        await probe.waitFor(a)
        let decoded = Self.image()
        try cache.storeForOffline(decoded.image, data: decoded.cacheData, for: b)
        await loader.load(for: b)
        probe.finish(a, .failure(URLError(.timedOut)))
        await task.value
        guard case .success = loader.phase else { return XCTFail("Cached replacement was lost") }
    }

    static func image() -> DecodedRemoteImage {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }
        return DecodedRemoteImage(image: image, cacheData: image.pngData()!)
    }
}

@MainActor
private final class ImageFetchProbe {
    private var continuations: [URL: CheckedContinuation<DecodedRemoteImage, Error>] = [:]
    private var started: [URL: XCTestExpectation] = [:]
    func fetch(_ url: URL) async throws -> DecodedRemoteImage {
        try await withCheckedThrowingContinuation { continuation in
            continuations[url] = continuation
            started[url]?.fulfill()
        }
    }
    func waitFor(_ url: URL) async {
        if continuations[url] != nil { return }
        let expectation = XCTestExpectation(description: "Fetch \(url)")
        started[url] = expectation
        await XCTWaiter.fulfillment(of: [expectation], timeout: 3)
        started[url] = nil
    }
    func finish(_ url: URL, _ result: Result<DecodedRemoteImage, Error>) {
        continuations.removeValue(forKey: url)?.resume(with: result)
    }
}
