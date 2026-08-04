import Foundation
import UIKit
import XCTest
@testable import TCGer

final class RemoteImageDecoderTests: XCTestCase {
    /// Set symbols ship as `viewBox`-only SVGs with no `width`/`height` (the Pokémon
    /// ones declare `viewBox="0 0 2000 2000"`). Rasterising those must scale the whole
    /// drawing into the render box — rendering at the intrinsic viewBox size and
    /// snapshotting the top-left corner is what made symbols look cropped in the UI.
    @MainActor
    func testRasterizesViewBoxOnlySVGToFitInsteadOfCropping() async throws {
        // Four quadrants, so a top-left crop is indistinguishable from nothing else:
        // a correct fit shows all four colours, a crop shows only red.
        let svg = """
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000">
          <rect x="0" y="0" width="1000" height="1000" fill="#ff0000"/>
          <rect x="1000" y="0" width="1000" height="1000" fill="#00ff00"/>
          <rect x="0" y="1000" width="1000" height="1000" fill="#0000ff"/>
          <rect x="1000" y="1000" width="1000" height="1000" fill="#ffff00"/>
        </svg>
        """
        let url = try XCTUnwrap(URL(string: "https://example.test/quadrants.svg"))
        let response = try XCTUnwrap(
            HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)
        )

        let result = await RemoteImageDecoder.decode(data: Data(svg.utf8), response: response, url: url)
        let decoded = try XCTUnwrap(result, "decoder returned no image for a viewBox-only SVG")

        let quadrants = try Self.quadrantColors(of: decoded.image)
        XCTAssertEqual(quadrants.topLeft, "ff0000")
        XCTAssertEqual(quadrants.topRight, "00ff00", "right half is missing — SVG was rendered oversized and cropped")
        XCTAssertEqual(quadrants.bottomLeft, "0000ff", "bottom half is missing — SVG was rendered oversized and cropped")
        XCTAssertEqual(quadrants.bottomRight, "ffff00")
    }

    private static func quadrantColors(
        of image: UIImage
    ) throws -> (topLeft: String, topRight: String, bottomLeft: String, bottomRight: String) {
        let cgImage = try XCTUnwrap(image.cgImage)
        let width = cgImage.width
        let height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = try XCTUnwrap(
            CGContext(
                data: &pixels,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        )
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        func hex(atX xFraction: Double, y yFraction: Double) -> String {
            let x = min(width - 1, Int(Double(width) * xFraction))
            let y = min(height - 1, Int(Double(height) * yFraction))
            let offset = (y * width + x) * 4
            return String(format: "%02x%02x%02x", pixels[offset], pixels[offset + 1], pixels[offset + 2])
        }

        return (
            topLeft: hex(atX: 0.25, y: 0.25),
            topRight: hex(atX: 0.75, y: 0.25),
            bottomLeft: hex(atX: 0.25, y: 0.75),
            bottomRight: hex(atX: 0.75, y: 0.75)
        )
    }

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
