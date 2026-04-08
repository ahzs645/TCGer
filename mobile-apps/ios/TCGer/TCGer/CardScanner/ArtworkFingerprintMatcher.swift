import Accelerate
import CoreGraphics
import Foundation

/// Artwork fingerprint matching for card identification.
/// Ported from the browser `artwork-fingerprint.ts` module.
///
/// Algorithm:
///   1. Crop artwork region (excludes card border, name, text)
///   2. Histogram-equalise per RGB channel for lighting invariance
///   3. Resize to 8×8 grid → 192-dimensional fingerprint
///   4. Compute HSV histogram (30×32 bins) for color distribution
///   5. Combined score: 85% artwork cosine similarity + 15% HSV cosine similarity
struct ArtworkFingerprintMatcher {

    // MARK: - Configuration

    private static let gridSize = 8
    private static let eqSize = 64
    private static let fingerprintDim = gridSize * gridSize * 3  // 192
    private static let hsvHBins = 30
    private static let hsvSBins = 32
    private static let hsvHistDim = hsvHBins * hsvSBins  // 960
    /// Sweep tested 0-100% in 5% steps across 77 video frames.
    /// Peak: art 5% + HSV 95% = 69% confident (vs 23% art-only).
    private static let artworkWeight: Float = 0.05
    private static let hsvWeight: Float = 0.95

    /// TCG-specific artwork crop regions (fraction of card dimensions).
    static let artworkRegions: [String: (top: Float, bottom: Float, left: Float, right: Float)] = [
        "pokemon": (0.08, 0.55, 0.05, 0.95),
        "magic":   (0.12, 0.55, 0.07, 0.93),
        "yugioh":  (0.20, 0.60, 0.10, 0.90),
    ]

    // MARK: - Database Entry

    struct Entry: Sendable {
        let externalId: String
        let name: String
        let setCode: String?
        let fingerprint: [Float]  // 192 elements
        let fpNorm: Float
        let hsvHist: [Float]?     // 960 elements
        let hsvNorm: Float
    }

    struct Match: Sendable {
        let externalId: String
        let name: String
        let setCode: String?
        let similarity: Float
    }

    // MARK: - Fingerprint Computation

    /// Compute artwork fingerprint from a CGImage (de-warped card crop).
    static func computeFingerprint(from image: CGImage, tcg: String = "pokemon") -> [Float] {
        guard let region = artworkRegions[tcg] else { return Array(repeating: 0, count: fingerprintDim) }

        let w = image.width
        let h = image.height
        let cropLeft = Int(Float(w) * region.left)
        let cropTop = Int(Float(h) * region.top)
        let cropWidth = Int(Float(w) * (region.right - region.left))
        let cropHeight = Int(Float(h) * (region.bottom - region.top))

        guard cropWidth > 0, cropHeight > 0 else { return Array(repeating: 0, count: fingerprintDim) }

        // Extract artwork region
        guard let artworkCG = image.cropping(to: CGRect(x: cropLeft, y: cropTop, width: cropWidth, height: cropHeight)) else {
            return Array(repeating: 0, count: fingerprintDim)
        }

        // Render to RGBA buffer at equalization size
        guard let pixels = renderToRGBA(artworkCG, width: eqSize, height: eqSize) else {
            return Array(repeating: 0, count: fingerprintDim)
        }

        // Per-channel histogram equalization
        var equalized = pixels
        for ch in 0..<3 {
            equalizeChannel(&equalized, channelOffset: ch, pixelCount: eqSize * eqSize)
        }

        // Resize to grid by block averaging
        let blockW = eqSize / gridSize
        let blockH = eqSize / gridSize
        var fp = [Float](repeating: 0, count: fingerprintDim)
        let cells = gridSize * gridSize

        for by in 0..<gridSize {
            for bx in 0..<gridSize {
                var rSum: Float = 0, gSum: Float = 0, bSum: Float = 0
                var count: Float = 0
                for y in (by * blockH)..<min((by + 1) * blockH, eqSize) {
                    for x in (bx * blockW)..<min((bx + 1) * blockW, eqSize) {
                        let idx = (y * eqSize + x) * 4
                        rSum += Float(equalized[idx])
                        gSum += Float(equalized[idx + 1])
                        bSum += Float(equalized[idx + 2])
                        count += 1
                    }
                }
                let i = by * gridSize + bx
                if count > 0 {
                    fp[i] = rSum / count / 255.0
                    fp[cells + i] = gSum / count / 255.0
                    fp[2 * cells + i] = bSum / count / 255.0
                }
            }
        }

        return fp
    }

    /// Compute HSV histogram from a card image's artwork region.
    static func computeHSVHistogram(from image: CGImage, tcg: String = "pokemon") -> [Float] {
        guard let region = artworkRegions[tcg] else { return Array(repeating: 0, count: hsvHistDim) }

        let w = image.width, h = image.height
        let cropLeft = Int(Float(w) * region.left)
        let cropTop = Int(Float(h) * region.top)
        let cropWidth = Int(Float(w) * (region.right - region.left))
        let cropHeight = Int(Float(h) * (region.bottom - region.top))

        guard cropWidth > 0, cropHeight > 0,
              let artworkCG = image.cropping(to: CGRect(x: cropLeft, y: cropTop, width: cropWidth, height: cropHeight)),
              let pixels = renderToRGBA(artworkCG, width: cropWidth, height: cropHeight)
        else { return Array(repeating: 0, count: hsvHistDim) }

        var hist = [Float](repeating: 0, count: hsvHistDim)
        let px = cropWidth * cropHeight

        for i in 0..<px {
            let r = Float(pixels[i * 4]) / 255.0
            let g = Float(pixels[i * 4 + 1]) / 255.0
            let b = Float(pixels[i * 4 + 2]) / 255.0
            let mx = max(r, g, b), mn = min(r, g, b), d = mx - mn

            var hue: Float = 0
            if d > 0 {
                if mx == r { hue = 60 * fmod((g - b) / d, 6) }
                else if mx == g { hue = 60 * ((b - r) / d + 2) }
                else { hue = 60 * ((r - g) / d + 4) }
            }
            if hue < 0 { hue += 360 }
            let sat = mx > 0 ? d / mx : 0

            let hBin = min(hsvHBins - 1, Int(hue / 360.0 * Float(hsvHBins)))
            let sBin = min(hsvSBins - 1, Int(sat * Float(hsvSBins)))
            hist[hBin * hsvSBins + sBin] += 1
        }

        // Normalize
        var sum: Float = 0
        for v in hist { sum += v }
        if sum > 0 { for i in 0..<hist.count { hist[i] /= sum } }

        return hist
    }

    // MARK: - Matching

    /// Match a query fingerprint + HSV against the database.
    /// Returns top-N results sorted by combined score (85% artwork + 15% HSV).
    static func match(
        queryFp: [Float],
        queryHSV: [Float]?,
        database: [Entry],
        topN: Int = 5
    ) -> [Match] {
        let queryNorm = l2Norm(queryFp)
        guard queryNorm > 1e-8 else { return [] }

        let queryHSVNorm = queryHSV.map { l2Norm($0) } ?? 0
        let hasHSV = queryHSV != nil && queryHSVNorm > 1e-8

        var results: [(Match, Float)] = []  // (match, score) for sorting

        for entry in database {
            guard entry.fpNorm > 1e-8 else { continue }

            let artDot = vDSP_dotProduct(queryFp, entry.fingerprint)
            let artSim = artDot / (queryNorm * entry.fpNorm)

            var similarity = artSim
            if hasHSV, let entryHSV = entry.hsvHist, entry.hsvNorm > 1e-8, let qHSV = queryHSV {
                let hsvDot = vDSP_dotProduct(qHSV, entryHSV)
                let hsvSim = hsvDot / (queryHSVNorm * entry.hsvNorm)
                similarity = artworkWeight * artSim + hsvWeight * hsvSim
            }

            results.append((Match(
                externalId: entry.externalId,
                name: entry.name,
                setCode: entry.setCode,
                similarity: similarity
            ), similarity))
        }

        results.sort { $0.1 > $1.1 }
        return Array(results.prefix(topN).map(\.0))
    }

    // MARK: - Helpers

    private static func renderToRGBA(_ image: CGImage, width: Int, height: Int) -> [UInt8]? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return pixels
    }

    private static func equalizeChannel(_ data: inout [UInt8], channelOffset: Int, pixelCount: Int) {
        var hist = [UInt32](repeating: 0, count: 256)
        for i in 0..<pixelCount {
            hist[Int(data[i * 4 + channelOffset])] += 1
        }
        var cdf = [UInt32](repeating: 0, count: 256)
        cdf[0] = hist[0]
        for i in 1..<256 { cdf[i] = cdf[i - 1] + hist[i] }

        var cdfMin: UInt32 = 0
        for i in 0..<256 {
            if cdf[i] > 0 { cdfMin = cdf[i]; break }
        }

        let denom = UInt32(pixelCount) - cdfMin
        guard denom > 0 else { return }

        for i in 0..<pixelCount {
            let idx = i * 4 + channelOffset
            let val = Int(data[idx])
            data[idx] = UInt8((Float(cdf[val] - cdfMin) * 255.0) / Float(denom))
        }
    }

    private static func l2Norm(_ v: [Float]) -> Float {
        var sumSq: Float = 0
        vDSP_dotpr(v, 1, v, 1, &sumSq, vDSP_Length(v.count))
        return sqrt(sumSq)
    }

    private static func vDSP_dotProduct(_ a: [Float], _ b: [Float]) -> Float {
        let len = min(a.count, b.count)
        var result: Float = 0
        vDSP_dotpr(a, 1, b, 1, &result, vDSP_Length(len))
        return result
    }
}
