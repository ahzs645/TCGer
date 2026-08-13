import CoreGraphics
import CoreImage
import Foundation
@preconcurrency import Vision

/// Camera calibration scaled into the pixel coordinates of the image being
/// analyzed. It is optional throughout the scanner: imports and older devices
/// keep the existing geometric heuristics, while calibrated still captures can
/// recover the true card aspect under perspective.
nonisolated struct ScannerCameraIntrinsics: Equatable, Sendable {
    let fx: CGFloat
    let fy: CGFloat
    let cx: CGFloat
    let cy: CGFloat

    var isUsable: Bool {
        fx.isFinite && fy.isFinite && cx.isFinite && cy.isFinite && fx > 0 && fy > 0
    }
}

nonisolated enum ScannerCaptureQualityIssue: String, Codable, Sendable {
    case noCard
    case tooFar
    case tooClose
    case tooDark
    case tooBright
    case glare
    case angle
    case blur

    var hint: String {
        switch self {
        case .noCard: return "Center one card inside the guide"
        case .tooFar: return "Move closer so the card fills the guide"
        case .tooClose: return "Move back and leave the full border visible"
        case .tooDark: return "Find brighter, even light"
        case .tooBright: return "Reduce direct light on the card"
        case .glare: return "Tilt slightly away from glare"
        case .angle: return "Hold the phone flatter over the card"
        case .blur: return "Hold steady while the camera focuses"
        }
    }
}

/// Objective capture evidence shown in the live guide and persisted in dev
/// mode. Nil geometry means no plausible card boundary was found; the luma and
/// focus metrics still describe the framed image in that case.
nonisolated struct ScannerCaptureQualityReport: Codable, Equatable, Sendable {
    let sharpness: Double
    let meanLuma: Double
    let clippedHighlightFraction: Double
    let glareFraction: Double
    let fillRatio: Double?
    let angleDeviationDegrees: Double?
    let detectorConfidence: Double?

    static let minimumSharpness = 0.001
    static let minimumLuma = 0.18
    static let maximumLuma = 0.90
    static let maximumClippedFraction = 0.08
    static let maximumGlareFraction = 0.08
    static let minimumFillRatio = 0.30
    static let maximumFillRatio = 0.98
    static let maximumAngleDeviation = 12.0

    var focusPass: Bool { sharpness >= Self.minimumSharpness }
    var lightingPass: Bool {
        meanLuma >= Self.minimumLuma
            && meanLuma <= Self.maximumLuma
            && clippedHighlightFraction <= Self.maximumClippedFraction
    }
    var glarePass: Bool { glareFraction <= Self.maximumGlareFraction }
    var framingPass: Bool {
        guard let fillRatio else { return false }
        return fillRatio >= Self.minimumFillRatio && fillRatio <= Self.maximumFillRatio
    }
    var anglePass: Bool {
        guard let angleDeviationDegrees else { return false }
        return angleDeviationDegrees <= Self.maximumAngleDeviation
    }
    var allPass: Bool { focusPass && lightingPass && glarePass && framingPass && anglePass }

    var primaryIssue: ScannerCaptureQualityIssue? {
        guard let fillRatio else { return .noCard }
        if fillRatio < Self.minimumFillRatio { return .tooFar }
        if fillRatio > Self.maximumFillRatio { return .tooClose }
        if meanLuma < Self.minimumLuma { return .tooDark }
        if meanLuma > Self.maximumLuma || clippedHighlightFraction > Self.maximumClippedFraction {
            return .tooBright
        }
        if glareFraction > Self.maximumGlareFraction { return .glare }
        if !anglePass { return .angle }
        if !focusPass { return .blur }
        return nil
    }
}

nonisolated struct ScannerCaptureQualityAnalyzer {
    struct GrayStats: Equatable {
        let mean: Double
        let clippedFraction: Double
        let glareFraction: Double
        let laplacianVariance: Double
    }

    private static let context = CIContext(options: [.cacheIntermediates: false])
    private static let thumbnailWidth = 128

    static func analyze(
        image: CGImage,
        intrinsics: ScannerCameraIntrinsics? = nil
    ) -> ScannerCaptureQualityReport {
        let cropper = CardCropper(detector: nil)
        let observations = try? cropper.detectRectanglesDetailed(
            in: image,
            intrinsics: intrinsics
        ).observations
        let observation = observations.flatMap {
            CardCropper.preferredObservation(from: $0)
        }
        return analyze(image: image, observation: observation)
    }

    static func analyze(
        image: CGImage,
        observation: VNRectangleObservation?
    ) -> ScannerCaptureQualityReport {
        let region = observation?.boundingBox ?? CGRect(x: 0, y: 0, width: 1, height: 1)
        let stats = grayStats(image: image, region: region)
            ?? GrayStats(mean: 0, clippedFraction: 1, glareFraction: 1, laplacianVariance: 0)
        let imageSize = CGSize(width: image.width, height: image.height)
        return ScannerCaptureQualityReport(
            sharpness: stats.laplacianVariance,
            meanLuma: stats.mean,
            clippedHighlightFraction: stats.clippedFraction,
            glareFraction: stats.glareFraction,
            fillRatio: observation.map { Double(CardCropper.normalizedArea(of: $0)) },
            angleDeviationDegrees: observation.map {
                Double(maximumCornerAngleDeviation(of: $0, imageSize: imageSize))
            },
            detectorConfidence: observation.map { Double($0.confidence) }
        )
    }

    static func stats(gray: [UInt8], width: Int, height: Int) -> GrayStats? {
        guard width > 2, height > 2, gray.count >= width * height else { return nil }
        let values = gray.prefix(width * height)
        var sum = 0.0
        var clipped = 0
        var glare = 0
        for value in values {
            sum += Double(value)
            if value >= 250 { clipped += 1 }
            if value >= 238 { glare += 1 }
        }
        let count = Double(width * height)

        var laplacianSum = 0.0
        var laplacianSquareSum = 0.0
        var laplacianCount = 0.0
        for y in 1 ..< (height - 1) {
            let row = y * width
            for x in 1 ..< (width - 1) {
                let center = Double(gray[row + x])
                let laplacian = (4 * center
                    - Double(gray[row + x - 1])
                    - Double(gray[row + x + 1])
                    - Double(gray[row - width + x])
                    - Double(gray[row + width + x])) / 255.0
                laplacianSum += laplacian
                laplacianSquareSum += laplacian * laplacian
                laplacianCount += 1
            }
        }
        guard laplacianCount > 0 else { return nil }
        let laplacianMean = laplacianSum / laplacianCount
        return GrayStats(
            mean: (sum / count) / 255,
            clippedFraction: Double(clipped) / count,
            glareFraction: Double(glare) / count,
            laplacianVariance: max(
                0,
                laplacianSquareSum / laplacianCount - laplacianMean * laplacianMean
            )
        )
    }

    static func maximumCornerAngleDeviation(
        of observation: VNRectangleObservation,
        imageSize: CGSize
    ) -> CGFloat {
        let points = [
            observation.topLeft, observation.topRight,
            observation.bottomRight, observation.bottomLeft,
        ].map { CGPoint(x: $0.x * imageSize.width, y: $0.y * imageSize.height) }
        guard points.count == 4 else { return 90 }

        func deviation(at index: Int) -> CGFloat {
            let vertex = points[index]
            let before = points[(index + 3) % 4]
            let after = points[(index + 1) % 4]
            let first = CGVector(dx: before.x - vertex.x, dy: before.y - vertex.y)
            let second = CGVector(dx: after.x - vertex.x, dy: after.y - vertex.y)
            let product = first.dx * second.dx + first.dy * second.dy
            let lengths = hypot(first.dx, first.dy) * hypot(second.dx, second.dy)
            guard lengths > 0 else { return 90 }
            let cosine = max(-1, min(1, product / lengths))
            return abs(acos(cosine) * 180 / .pi - 90)
        }
        return (0 ..< 4).map(deviation(at:)).max() ?? 90
    }

    private static func grayStats(image: CGImage, region: CGRect) -> GrayStats? {
        let imageSize = CGSize(width: image.width, height: image.height)
        let clamped = region.standardized.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard clamped.width > 0.03, clamped.height > 0.03 else { return nil }
        let pixelRect = CGRect(
            x: clamped.minX * imageSize.width,
            y: clamped.minY * imageSize.height,
            width: clamped.width * imageSize.width,
            height: clamped.height * imageSize.height
        )
        let scale = CGFloat(thumbnailWidth) / pixelRect.width
        let outputWidth = thumbnailWidth
        let outputHeight = max(9, Int((pixelRect.height * scale).rounded()))
        var source = CIImage(cgImage: image).cropped(to: pixelRect)
        source = source.transformed(by: CGAffineTransform(
            translationX: -pixelRect.minX,
            y: -pixelRect.minY
        ))
        source = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        var pixels = [UInt8](repeating: 0, count: outputWidth * outputHeight)
        context.render(
            source,
            toBitmap: &pixels,
            rowBytes: outputWidth,
            bounds: CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight),
            format: .L8,
            colorSpace: CGColorSpaceCreateDeviceGray()
        )
        return stats(gray: pixels, width: outputWidth, height: outputHeight)
    }
}

/// Four user-adjustable corners in normalized top-left-origin image space.
nonisolated struct ScannerCropQuad: Equatable, Sendable {
    var topLeft: CGPoint
    var topRight: CGPoint
    var bottomRight: CGPoint
    var bottomLeft: CGPoint

    var corners: [CGPoint] { [topLeft, topRight, bottomRight, bottomLeft] }

    init(topLeft: CGPoint, topRight: CGPoint, bottomRight: CGPoint, bottomLeft: CGPoint) {
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomRight = bottomRight
        self.bottomLeft = bottomLeft
    }

    init(observation: VNRectangleObservation) {
        topLeft = CGPoint(x: observation.topLeft.x, y: 1 - observation.topLeft.y)
        topRight = CGPoint(x: observation.topRight.x, y: 1 - observation.topRight.y)
        bottomRight = CGPoint(x: observation.bottomRight.x, y: 1 - observation.bottomRight.y)
        bottomLeft = CGPoint(x: observation.bottomLeft.x, y: 1 - observation.bottomLeft.y)
    }

    static func centered(in imageSize: CGSize) -> ScannerCropQuad {
        let imageAspect = max(0.1, imageSize.width / max(1, imageSize.height))
        let cardAspect = CGFloat(63.0 / 88.0)
        var heightFraction: CGFloat = 0.82
        var widthFraction = heightFraction * cardAspect / imageAspect
        if widthFraction > 0.86 {
            widthFraction = 0.86
            heightFraction = widthFraction * imageAspect / cardAspect
        }
        let left = (1 - widthFraction) / 2
        let top = (1 - heightFraction) / 2
        return ScannerCropQuad(
            topLeft: CGPoint(x: left, y: top),
            topRight: CGPoint(x: left + widthFraction, y: top),
            bottomRight: CGPoint(x: left + widthFraction, y: top + heightFraction),
            bottomLeft: CGPoint(x: left, y: top + heightFraction)
        )
    }

    var isValid: Bool {
        guard corners.allSatisfy({
            $0.x.isFinite && $0.y.isFinite && (0 ... 1).contains($0.x) && (0 ... 1).contains($0.y)
        }) else { return false }
        guard area >= 0.04 else { return false }
        let crossProducts = corners.indices.map { index -> CGFloat in
            let first = corners[index]
            let second = corners[(index + 1) % 4]
            let third = corners[(index + 2) % 4]
            return (second.x - first.x) * (third.y - second.y)
                - (second.y - first.y) * (third.x - second.x)
        }
        return crossProducts.allSatisfy { $0 > 0.0001 }
            || crossProducts.allSatisfy { $0 < -0.0001 }
    }

    var area: CGFloat {
        var total: CGFloat = 0
        for index in corners.indices {
            let current = corners[index]
            let next = corners[(index + 1) % corners.count]
            total += current.x * next.y - next.x * current.y
        }
        return abs(total) / 2
    }

    func expandedOutward(by fraction: CGFloat) -> ScannerCropQuad {
        let center = CGPoint(
            x: corners.reduce(0) { $0 + $1.x } / 4,
            y: corners.reduce(0) { $0 + $1.y } / 4
        )
        func expand(_ point: CGPoint) -> CGPoint {
            CGPoint(
                x: min(0.995, max(0.005, center.x + (point.x - center.x) * (1 + fraction))),
                y: min(0.995, max(0.005, center.y + (point.y - center.y) * (1 + fraction)))
            )
        }
        return ScannerCropQuad(
            topLeft: expand(topLeft),
            topRight: expand(topRight),
            bottomRight: expand(bottomRight),
            bottomLeft: expand(bottomLeft)
        )
    }

    var visionObservation: VNRectangleObservation {
        VNRectangleObservation(
            requestRevision: VNDetectRectanglesRequestRevision1,
            topLeft: CGPoint(x: topLeft.x, y: 1 - topLeft.y),
            topRight: CGPoint(x: topRight.x, y: 1 - topRight.y),
            bottomRight: CGPoint(x: bottomRight.x, y: 1 - bottomRight.y),
            bottomLeft: CGPoint(x: bottomLeft.x, y: 1 - bottomLeft.y)
        )
    }

    var visionObservationCorners: [[Double]] {
        let observation = visionObservation
        return [
            observation.topLeft, observation.topRight,
            observation.bottomRight, observation.bottomLeft,
        ].map { [Double($0.x), Double($0.y)] }
    }
}

struct ScannerCropRescueRequest: Identifiable {
    let id = UUID()
    let image: CGImage
    let initialQuad: ScannerCropQuad
    let sourceResultID: CardScanResult.ID?
}

/// Metric aspect recovery for a planar rectangle. This is used conservatively:
/// only calibrated estimates that recover a standard trading-card aspect can
/// relax the older apparent-edge heuristic.
nonisolated enum ScannerCardAspectRecovery {
    static func recover(
        visionCorners: [CGPoint],
        imageSize: CGSize,
        intrinsics: ScannerCameraIntrinsics
    ) -> Double? {
        guard visionCorners.count == 4, intrinsics.isUsable else { return nil }
        let corners = visionCorners.map {
            CGPoint(x: $0.x * imageSize.width, y: (1 - $0.y) * imageSize.height)
        }
        return recover(corners: corners, intrinsics: intrinsics)
    }

    static func recover(
        corners c: [CGPoint],
        intrinsics k: ScannerCameraIntrinsics
    ) -> Double? {
        guard c.count == 4, k.isUsable else { return nil }
        let x0 = Double(c[0].x), y0 = Double(c[0].y)
        let x1 = Double(c[1].x), y1 = Double(c[1].y)
        let x2 = Double(c[2].x), y2 = Double(c[2].y)
        let x3 = Double(c[3].x), y3 = Double(c[3].y)
        let sx = x0 - x1 + x2 - x3
        let sy = y0 - y1 + y2 - y3

        let a, b, d, e, g, h: Double
        if abs(sx) < 1e-9, abs(sy) < 1e-9 {
            a = x1 - x0; b = x3 - x0
            d = y1 - y0; e = y3 - y0
            g = 0; h = 0
        } else {
            let dx1 = x1 - x2, dx2 = x3 - x2
            let dy1 = y1 - y2, dy2 = y3 - y2
            let denominator = dx1 * dy2 - dx2 * dy1
            guard abs(denominator) > 1e-12 else { return nil }
            g = (sx * dy2 - dx2 * sy) / denominator
            h = (dx1 * sy - sx * dy1) / denominator
            a = x1 - x0 + g * x1; b = x3 - x0 + h * x3
            d = y1 - y0 + g * y1; e = y3 - y0 + h * y3
        }

        let fx = Double(k.fx), fy = Double(k.fy)
        let cx = Double(k.cx), cy = Double(k.cy)
        func lengthSquared(_ x: Double, _ y: Double, _ z: Double) -> Double {
            let px = (x - cx * z) / fx
            let py = (y - cy * z) / fy
            return px * px + py * py + z * z
        }
        let widthSquared = lengthSquared(a, d, g)
        let heightSquared = lengthSquared(b, e, h)
        guard widthSquared > 0, heightSquared > 0 else { return nil }
        let ratio = sqrt(widthSquared / heightSquared)
        return ratio.isFinite && ratio > 0 ? ratio : nil
    }
}
