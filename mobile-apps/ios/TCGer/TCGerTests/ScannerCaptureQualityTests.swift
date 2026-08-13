import CoreGraphics
@testable import TCGer
import XCTest

final class ScannerCaptureQualityTests: XCTestCase {
    func testUniformFrameIsCorrectlyMarkedBlurry() throws {
        let pixels = [UInt8](repeating: 128, count: 32 * 32)
        let stats = try XCTUnwrap(
            ScannerCaptureQualityAnalyzer.stats(gray: pixels, width: 32, height: 32)
        )
        XCTAssertEqual(stats.mean, 128.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(stats.clippedFraction, 0, accuracy: 0.0001)
        XCTAssertEqual(stats.laplacianVariance, 0, accuracy: 0.000001)
    }

    func testHighlightsAndGlareAreCounted() throws {
        var pixels = [UInt8](repeating: 100, count: 16 * 16)
        for index in 0 ..< 64 { pixels[index] = 255 }
        let stats = try XCTUnwrap(
            ScannerCaptureQualityAnalyzer.stats(gray: pixels, width: 16, height: 16)
        )
        XCTAssertEqual(stats.clippedFraction, 0.25, accuracy: 0.001)
        XCTAssertEqual(stats.glareFraction, 0.25, accuracy: 0.001)
    }

    func testQualityHintUsesActionablePriority() {
        let missingCard = ScannerCaptureQualityReport(
            sharpness: 0.01,
            meanLuma: 0.5,
            clippedHighlightFraction: 0,
            glareFraction: 0,
            fillRatio: nil,
            angleDeviationDegrees: nil,
            detectorConfidence: nil
        )
        XCTAssertEqual(missingCard.primaryIssue, .noCard)

        let glare = ScannerCaptureQualityReport(
            sharpness: 0.01,
            meanLuma: 0.5,
            clippedHighlightFraction: 0,
            glareFraction: 0.15,
            fillRatio: 0.6,
            angleDeviationDegrees: 3,
            detectorConfidence: 0.9
        )
        XCTAssertEqual(glare.primaryIssue, .glare)
    }

    func testCropQuadRejectsCrossedCorners() {
        XCTAssertTrue(ScannerCropQuad.centered(in: CGSize(width: 900, height: 1_200)).isValid)
        let crossed = ScannerCropQuad(
            topLeft: CGPoint(x: 0.1, y: 0.1),
            topRight: CGPoint(x: 0.9, y: 0.9),
            bottomRight: CGPoint(x: 0.9, y: 0.1),
            bottomLeft: CGPoint(x: 0.1, y: 0.9)
        )
        XCTAssertFalse(crossed.isValid)
    }

    func testCalibratedAspectRecoveryAtSteepPose() throws {
        let focalLength = 2_000.0
        let centerX = 1_500.0
        let centerY = 2_000.0
        let corners = projectCard(
            width: 63,
            height: 88,
            yaw: 35 * .pi / 180,
            pitch: 30 * .pi / 180,
            distance: 300,
            focalLength: focalLength,
            centerX: centerX,
            centerY: centerY
        )
        let intrinsics = ScannerCameraIntrinsics(
            fx: CGFloat(focalLength),
            fy: CGFloat(focalLength),
            cx: CGFloat(centerX),
            cy: CGFloat(centerY)
        )
        let recovered = try XCTUnwrap(
            ScannerCardAspectRecovery.recover(corners: corners, intrinsics: intrinsics)
        )
        XCTAssertEqual(recovered, 63.0 / 88.0, accuracy: 0.01)
    }

    private func projectCard(
        width: Double,
        height: Double,
        yaw: Double,
        pitch: Double,
        distance: Double,
        focalLength: Double,
        centerX: Double,
        centerY: Double
    ) -> [CGPoint] {
        let local = [
            (-width / 2, -height / 2),
            (width / 2, -height / 2),
            (width / 2, height / 2),
            (-width / 2, height / 2),
        ]
        return local.map { x, y in
            let yawX = cos(yaw) * x
            let yawZ = -sin(yaw) * x
            let rotatedY = cos(pitch) * y - sin(pitch) * yawZ
            let rotatedZ = sin(pitch) * y + cos(pitch) * yawZ
            let depth = rotatedZ + distance
            return CGPoint(
                x: focalLength * yawX / depth + centerX,
                y: focalLength * rotatedY / depth + centerY
            )
        }
    }
}
