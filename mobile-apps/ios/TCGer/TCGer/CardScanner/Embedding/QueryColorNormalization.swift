// @tcger-feature {"id":"scanner.model.queryNormalization","platform":"ios","status":"partial","limitation":"Grey-world autocontrast runs for games whose policy declares it (Magic). The raw + normalized blend is implemented with unit tests but no built-in game declares it, and it has not yet been compiled or replayed on a simulator or device."}
import CoreGraphics
import Foundation

/// Query-side colour normalization applied to every crop before the
/// embedding encoder's resize/centre-crop contract.
///
/// The catalog gallery is embedded from clean, white-balanced, full-range
/// renders; hand-held phone crops arrive low-contrast under a room colour
/// cast. Measured offline on the 108 labeled Magic frames with the released
/// encoder and identical crops (2026-08-30): raw crops rank the correct
/// family first on 79 frames; grey-world white balance followed by a 1 %
/// per-channel autocontrast raises that to 104, turning every "camera-domain
/// model failure" in the notes — all eight Rage into the Valley frames, all
/// six Stone Quarry frames (rank ∞ → 0), Bilbo's Deadly Slice, Forsaken
/// Sanctuary ×5, Tranquil Cove — into a first-ranked match at 0.67–0.91,
/// with no new wrong accept. The Pokémon control set moves 27 → 31 would-be
/// accepts. Clean renders are near-invariant (self-similarity 0.94–0.997).
///
/// The arithmetic mirrors Pillow exactly (`ImageOps.autocontrast(cutoff=1)`
/// after a float grey-world gain with truncating conversion) so the offline
/// evaluator and the device agree pixel for pixel.
nonisolated enum QueryColorNormalization {
    /// The query renderings a game's declared normalization embeds, in order:
    /// `false` is the raw crop and `true` the normalized one. A single
    /// rendering is searched as is; two are combined by `blended`.
    /// `SCANNER_QUERY_NORMALIZATION=0` forces raw queries for every game,
    /// `=1` forces the normalization on and `=blend` forces the raw +
    /// normalized blend, for A/B replays; otherwise the per-game policy
    /// decides.
    static func renderings(_ declared: ScannerGameAcceptancePolicy.QueryNormalization) -> [Bool] {
        renderings(declared, override: environmentOverride)
    }

    static func renderings(
        _ declared: ScannerGameAcceptancePolicy.QueryNormalization,
        override: String?
    ) -> [Bool] {
        switch override {
        case "0", "false": return [false]
        case "1", "true": return [true]
        case "blend": return [false, true]
        default:
            switch declared {
            case .none: return [false]
            case .greyWorldAutocontrast: return [true]
            case .greyWorldAutocontrastBlend: return [false, true]
            }
        }
    }

    /// Combines the embeddings of one crop's renderings into the vector that
    /// is searched. One rendering passes through untouched, so the existing
    /// modes stay bit-identical. Several are each L2-normalized, averaged and
    /// L2-normalized again — the mean direction of the raw and the
    /// colour-normalized view. Measured offline with the released Pokémon
    /// encoder and identical crops (2026-11-10): on 106 hand-outlined cards of
    /// one warm-lit session the blend takes would-be accepts from 67 correct /
    /// 2 wrong to 93 / 0, and leaves the 51 older labeled frames at 33 correct
    /// while removing their one wrong accept — where normalization alone
    /// loses a frame. A missing or mismatched embedding yields an empty
    /// result, which callers already treat as a failed embedding.
    static func blended(_ embeddings: [[Float]]) -> [Float] {
        guard let first = embeddings.first else { return [] }
        guard embeddings.count > 1 else { return first }
        let dimension = first.count
        guard dimension > 0, embeddings.allSatisfy({ $0.count == dimension }) else { return [] }
        var sum = [Float](repeating: 0, count: dimension)
        for embedding in embeddings {
            let norm = embedding.reduce(Float(0)) { $0 + $1 * $1 }.squareRoot()
            guard norm > 0, norm.isFinite else { return [] }
            for index in 0..<dimension {
                sum[index] += embedding[index] / norm
            }
        }
        let norm = sum.reduce(Float(0)) { $0 + $1 * $1 }.squareRoot()
        guard norm > 0, norm.isFinite else { return [] }
        return sum.map { $0 / norm }
    }

    static let environmentOverride = ProcessInfo.processInfo.environment["SCANNER_QUERY_NORMALIZATION"]?.lowercased()

    static let autocontrastCutoffPercent = 1

    static func normalized(_ image: CGImage) -> CGImage? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { return nil }
        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }

        normalizeRGBA(&pixels, pixelCount: width * height)

        let data = Data(pixels)
        guard let provider = CGDataProvider(data: data as CFData) else { return nil }
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue
                | CGBitmapInfo.byteOrder32Big.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )
    }

    /// In-place grey-world white balance followed by per-channel autocontrast
    /// on interleaved RGBA8 pixels (alpha untouched).
    static func normalizeRGBA(_ pixels: inout [UInt8], pixelCount: Int) {
        guard pixelCount > 0 else { return }
        var sums = [Double](repeating: 0, count: 3)
        for index in 0..<pixelCount {
            let base = index * 4
            sums[0] += Double(pixels[base])
            sums[1] += Double(pixels[base + 1])
            sums[2] += Double(pixels[base + 2])
        }
        let means = sums.map { $0 / Double(pixelCount) }
        let gains = greyWorldGains(means: means)
        var histograms = [[Int]](repeating: [Int](repeating: 0, count: 256), count: 3)
        for index in 0..<pixelCount {
            let base = index * 4
            for channel in 0..<3 {
                // Pillow: clip to [0, 255] then truncate to uint8.
                let value = min(255.0, Double(pixels[base + channel]) * gains[channel])
                let byte = UInt8(value)
                pixels[base + channel] = byte
                histograms[channel][Int(byte)] += 1
            }
        }
        let tables = histograms.map { autocontrastTable(histogram: $0, cutoffPercent: autocontrastCutoffPercent) }
        for index in 0..<pixelCount {
            let base = index * 4
            for channel in 0..<3 {
                pixels[base + channel] = tables[channel][Int(pixels[base + channel])]
            }
        }
    }

    /// Per-channel multipliers that move the channel means onto their common
    /// mean. A channel with zero mean is left alone.
    static func greyWorldGains(means: [Double]) -> [Double] {
        let overall = means.reduce(0, +) / Double(means.count)
        return means.map { $0 > 0 ? overall / $0 : 1 }
    }

    /// Pillow's `ImageOps.autocontrast` lookup table for one channel: drop
    /// `cutoffPercent` of the pixels from each end of the histogram, then
    /// stretch what remains to the full range.
    static func autocontrastTable(histogram: [Int], cutoffPercent: Int) -> [UInt8] {
        var histogram = histogram
        let total = histogram.reduce(0, +)
        if cutoffPercent > 0, total > 0 {
            var cut = total * cutoffPercent / 100
            for low in 0..<256 {
                if cut > histogram[low] {
                    cut -= histogram[low]
                    histogram[low] = 0
                } else {
                    histogram[low] -= cut
                    cut = 0
                }
                if cut <= 0 { break }
            }
            cut = total * cutoffPercent / 100
            for high in stride(from: 255, through: 0, by: -1) {
                if cut > histogram[high] {
                    cut -= histogram[high]
                    histogram[high] = 0
                } else {
                    histogram[high] -= cut
                    cut = 0
                }
                if cut <= 0 { break }
            }
        }
        let low = histogram.firstIndex(where: { $0 > 0 }) ?? 0
        let high = histogram.lastIndex(where: { $0 > 0 }) ?? 255
        guard high > low else { return (0..<256).map { UInt8($0) } }
        let scale = 255.0 / Double(high - low)
        let offset = -Double(low) * scale
        return (0..<256).map { value in
            // Pillow truncates toward zero before clamping.
            let mapped = Int(Double(value) * scale + offset)
            return UInt8(min(255, max(0, mapped)))
        }
    }
}
