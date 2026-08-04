import Foundation
import XCTest
@testable import TCGer

final class RemoteImageDecoderTests: XCTestCase {
    func testRecognizesSVGFromContentType() throws {
        let url = try XCTUnwrap(URL(string: "https://example.test/symbol"))
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "image/svg+xml; charset=utf-8"]
            )
        )

        XCTAssertTrue(
            RemoteImageDecoder.isSVG(
                data: Data("<not-used />".utf8),
                response: response,
                url: url
            )
        )
    }

    func testRecognizesSVGFromExtensionAndPayload() throws {
        let svgURL = try XCTUnwrap(URL(string: "https://example.test/symbol.svg"))
        let extensionResponse = try XCTUnwrap(
            HTTPURLResponse(url: svgURL, statusCode: 200, httpVersion: nil, headerFields: nil)
        )
        XCTAssertTrue(
            RemoteImageDecoder.isSVG(
                data: Data(),
                response: extensionResponse,
                url: svgURL
            )
        )

        let extensionlessURL = try XCTUnwrap(URL(string: "https://example.test/symbol"))
        let payloadResponse = try XCTUnwrap(
            HTTPURLResponse(
                url: extensionlessURL,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/octet-stream"]
            )
        )
        XCTAssertTrue(
            RemoteImageDecoder.isSVG(
                data: Data("<?xml version=\"1.0\"?><svg viewBox=\"0 0 1 1\"></svg>".utf8),
                response: payloadResponse,
                url: extensionlessURL
            )
        )
    }

    func testDoesNotTreatBitmapAsSVG() throws {
        let url = try XCTUnwrap(URL(string: "https://example.test/symbol.webp"))
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "image/webp"]
            )
        )

        XCTAssertFalse(
            RemoteImageDecoder.isSVG(
                data: Data([0x52, 0x49, 0x46, 0x46]),
                response: response,
                url: url
            )
        )
    }
}
