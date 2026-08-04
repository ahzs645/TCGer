import CoreGraphics
import XCTest
@testable import TCGer

final class ScannerGuideCropperTests: XCTestCase {
    func testMapsCenteredPortraitGuideThroughLandscapeAspectFillImage() throws {
        let cropper = ScannerGuideCropper()
        let geometry = ScannerGuideGeometry(
            previewFrame: CGRect(x: 10, y: 20, width: 390, height: 844),
            guideFrame: CGRect(x: 75, y: 142, width: 260, height: 364)
        )

        let rect = try XCTUnwrap(cropper.imageCropRect(
            imageSize: CGSize(width: 2_048, height: 1_536),
            geometry: geometry
        ))

        XCTAssertEqual(rect.width / rect.height, 260.0 / 364.0, accuracy: 0.01)
        XCTAssertGreaterThanOrEqual(rect.minX, 0)
        XCTAssertGreaterThanOrEqual(rect.minY, 0)
        XCTAssertLessThanOrEqual(rect.maxX, 2_048)
        XCTAssertLessThanOrEqual(rect.maxY, 1_536)
    }

    func testAccountsForPreviewOriginAndClampsGuideToPreview() throws {
        let cropper = ScannerGuideCropper()
        let geometry = ScannerGuideGeometry(
            previewFrame: CGRect(x: 100, y: 200, width: 300, height: 600),
            guideFrame: CGRect(x: 50, y: 250, width: 250, height: 400)
        )

        let rect = try XCTUnwrap(cropper.imageCropRect(
            imageSize: CGSize(width: 1_000, height: 2_000),
            geometry: geometry
        ))

        XCTAssertEqual(rect.minX, 0)
        XCTAssertEqual(rect.minY, 167, accuracy: 1)
        XCTAssertEqual(rect.width, 667, accuracy: 1)
        XCTAssertEqual(rect.height, 1_334, accuracy: 1)
    }

    func testRejectsGuideOutsidePreview() {
        let cropper = ScannerGuideCropper()
        let geometry = ScannerGuideGeometry(
            previewFrame: CGRect(x: 0, y: 0, width: 300, height: 600),
            guideFrame: CGRect(x: 400, y: 0, width: 100, height: 100)
        )

        XCTAssertNil(cropper.imageCropRect(
            imageSize: CGSize(width: 1_000, height: 2_000),
            geometry: geometry
        ))
    }
}
