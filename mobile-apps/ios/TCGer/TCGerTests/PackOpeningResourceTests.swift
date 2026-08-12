import XCTest
@testable import TCGer

final class PackOpeningResourceTests: XCTestCase {
    func testMIMETypesNeededByTheEmbeddedExperience() {
        XCTAssertEqual(PackOpeningResource.mimeType(for: "html"), "text/html")
        XCTAssertEqual(PackOpeningResource.mimeType(for: "JS"), "text/javascript")
        XCTAssertEqual(PackOpeningResource.mimeType(for: "webp"), "image/webp")
        XCTAssertEqual(PackOpeningResource.mimeType(for: "obj"), "text/plain")
    }

    func testResourceResolutionStaysInsideBundleRoot() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("ok".utf8).write(to: root.appendingPathComponent("index.html"))

        XCTAssertEqual(
            PackOpeningResource.fileURL(for: PackOpeningResource.entryURL, root: root)?.lastPathComponent,
            "index.html"
        )
        XCTAssertNil(PackOpeningResource.fileURL(
            for: URL(string: "tcger-pack://bundle/../outside.txt")!,
            root: root
        ))
        XCTAssertNil(PackOpeningResource.fileURL(
            for: URL(string: "https://bundle/index.html")!,
            root: root
        ))
    }

    func testSharedAssetRequestsMapToTheR2Origin() {
        let request = URL(string: "tcger-pack://assets/pack/manifest.json")!
        XCTAssertEqual(
            PackOpeningResource.remoteURL(
                for: request,
                baseURL: URL(string: "https://assets.example.com")!
            )?.absoluteString,
            "https://assets.example.com/pack/manifest.json"
        )
        XCTAssertNil(PackOpeningResource.remoteURL(
            for: URL(string: "tcger-pack://bundle/index.html")!,
            baseURL: URL(string: "https://assets.example.com")!
        ))
        XCTAssertNil(PackOpeningResource.remoteURL(
            for: URL(string: "tcger-pack://assets/catalogs/manifest.json")!,
            baseURL: URL(string: "https://assets.example.com")!
        ))
    }

    func testSharedAssetRequestsCanFallBackToTheEmbeddedPackDirectory() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let pack = root.appendingPathComponent("pack", isDirectory: true)
        try FileManager.default.createDirectory(at: pack, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("{}".utf8).write(to: pack.appendingPathComponent("manifest.json"))

        XCTAssertEqual(
            PackOpeningResource.fileURL(
                for: URL(string: "tcger-pack://assets/pack/manifest.json")!,
                root: root
            )?.lastPathComponent,
            "manifest.json"
        )
    }

    func testCompletedPullSessionDecodesFromTheJavaScriptBridge() {
        let body: [String: Any] = [
            "type": "saveRequested",
            "session": [
                "id": "opening-1",
                "packLabel": "Aurora",
                "openedAt": "2026-08-12T15:49:00.000Z",
                "packs": [[[
                    "cardId": "swsh7-44",
                    "name": "Bergmite",
                    "rarity": "Common",
                    "tier": "common",
                    "collectorNumber": "44",
                    "tcg": "pokemon",
                    "setCode": "swsh7",
                    "setName": "Evolving Skies",
                    "imageUrl": "https://example.com/high.webp",
                    "imageUrlSmall": "https://example.com/low.webp"
                ]]]
            ]
        ]

        let session = PackOpeningBridgeDecoder.pullSession(from: body)
        XCTAssertEqual(session?.id, "opening-1")
        XCTAssertEqual(session?.packs.count, 1)
        XCTAssertEqual(session?.pulls.first?.card.id, "swsh7-44")
        XCTAssertEqual(session?.setCode, "swsh7")
    }
}
