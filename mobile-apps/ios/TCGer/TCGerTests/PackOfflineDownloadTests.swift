import XCTest
import UIKit
@testable import TCGer

@MainActor
final class PackOfflineDownloadTests: XCTestCase {
    private var root: URL!
    private var session: URLSession!
    private let base = URL(string: "https://pack.example.test")!
    private let card = URL(string: "https://pack.example.test/card.png")!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OfflineAssetURLProtocol.self]
        session = URLSession(configuration: config)
        let png = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2)).image { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }.pngData()!
        OfflineAssetURLProtocol.handler = { url in
            if url.path == "/pack/manifest.json" {
                return Data(#"{"mesh":"pack/mesh.obj","covers":{"base":{"packPool":"base1","plain":"pack/plain.png","decaled":"pack/decaled.png"}}}"#.utf8)
            }
            return url.pathExtension == "obj" ? Data("mesh bytes".utf8) : png
        }
    }
    override func tearDownWithError() throws {
        session.invalidateAndCancel()
        OfflineAssetURLProtocol.handler = nil
        try? FileManager.default.removeItem(at: root)
    }
    private func manager(assetDirectory: URL? = nil, imageDirectory: URL? = nil, connected: Bool = true) -> PackOfflineDownloadManager {
        PackOfflineDownloadManager(directory: root.appendingPathComponent("records"), session: session,
            assetCache: PackOpeningAssetCache(directory: assetDirectory ?? root.appendingPathComponent("assets")),
            imageCache: ImageCache(directory: imageDirectory ?? root.appendingPathComponent("images")),
            remoteBaseURL: base, isConnected: { connected }, artworkProvider: { [card] _ in ([card], 1) })
    }
    func testAssetWriteFailureCannotCommitCompletion() async throws {
        let blocked = root.appendingPathComponent("blocked-assets")
        try Data("not a directory".utf8).write(to: blocked)
        let download = manager(assetDirectory: blocked)
        do { try await download.performDownload(.available[0]); XCTFail("Expected durable write failure") } catch { }
        XCTAssertTrue(download.records.isEmpty)
        XCTAssertFalse(manager(assetDirectory: blocked, connected: false).canOpen(setID: "base1", isConnected: false))
    }
    func testNativeImageWriteFailureCannotCommitCompletion() async throws {
        let blocked = root.appendingPathComponent("blocked-images")
        try Data("not a directory".utf8).write(to: blocked)
        let download = manager(imageDirectory: blocked)
        do { try await download.performDownload(.available[0]); XCTFail("Expected native image write failure") } catch { }
        XCTAssertTrue(download.records.isEmpty)
        XCTAssertFalse(manager(imageDirectory: blocked, connected: false).canOpen(setID: "base1", isConnected: false))
    }
    func testSuccessfulDownloadSurvivesOfflineRelaunchAndMissingAssetInvalidatesIt() async throws {
        let download = manager()
        try await download.performDownload(.available[0])
        XCTAssertEqual(download.records["base1"]?.cardCount, 1)
        let relaunched = manager(connected: false)
        XCTAssertTrue(relaunched.canOpen(setID: "base1", isConnected: false))
        session.invalidateAndCancel()
        let cache = PackOpeningAssetCache(directory: root.appendingPathComponent("assets"))
        cache.remove(base.appendingPathComponent("pack/mesh.obj"))
        XCTAssertFalse(relaunched.canOpen(setID: "base1", isConnected: false))
        XCTAssertFalse(manager(connected: false).canOpen(setID: "base1", isConnected: false))
    }
    func testUndecodableCardArtCannotBecomeDownloaded() async {
        OfflineAssetURLProtocol.handler = { url in
            url.path == "/pack/manifest.json"
                ? Data(#"{"mesh":"pack/mesh.obj"}"#.utf8) : Data("invalid image".utf8)
        }
        let download = manager()
        do { try await download.performDownload(.available[0]); XCTFail("Expected image decode failure") } catch { }
        XCTAssertTrue(download.records.isEmpty)
    }
}

private final class OfflineAssetURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URL) -> Data)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let handler = Self.handler else { return }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: handler(url))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
