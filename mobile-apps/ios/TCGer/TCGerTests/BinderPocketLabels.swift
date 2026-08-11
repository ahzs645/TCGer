import CoreGraphics
import CryptoKit
import Foundation
@testable import TCGer

/// Human ground truth for one pocket of a recorded binder page.
///
/// The archive format has no binder label field: a correction made in the
/// binder review sheet is written as its OWN top-level frame (outcome
/// `manualCorrection: <cardID>`, with `expectedCardId` in `results.json`)
/// whose image is the detection crop, and nothing points back to the page it
/// came from. That is why every binder harness so far has had to fall back to
/// candidate counts or `similarity >= 0.82` pseudo-labels.
///
/// The link is recoverable: `ScannerDevModeStore` writes the correction frame
/// from the same `CGImage` it wrote into the page's `attemptImageFiles`, so
/// the two files are byte-for-byte identical and hashing both sides
/// re-establishes (page frame, attempt index). Measured on the reference
/// library 2026-08-11: 26 of 26 corrections across two binder sessions join
/// to exactly one pocket, no collisions.
///
/// These labels are the hard cases by construction — a pocket only earns one
/// because the pipeline's own answer was absent or wrong.
struct BinderPocketLabel {
    let pageImageFile: String
    let attemptIndex: Int
    /// Nil means the human reviewed this pocket and declared no match.
    let cardID: String?
    /// Recorded detection quad in the page image's Vision-normalized space,
    /// used to align a replay detection with the labeled pocket.
    let quad: [[Double]]?
    /// What the recording pipeline answered here, if anything — the label
    /// exists because the human disagreed with (or lacked) this.
    let recordedTopCandidateID: String?
    /// Source frame of the correction, for log lines that need to be traced
    /// back to a file on disk.
    let correctionImageFile: String

    var key: String { "\(pageImageFile)#\(attemptIndex)" }
}

enum BinderPocketLabelLoader {
    private struct EvidenceRecord: Decodable {
        let imageFile: String
        let outcome: String
        let attempts: [ScanDiagnostics.Attempt]?
        let attemptImageFiles: [String]?
    }

    /// Every pocket label recoverable from one `scan-session-*` directory.
    /// Returns empty (never throws) for sessions with no binder pages, no
    /// corrections, or an unreadable manifest — callers replay those normally.
    static func labels(in session: URL) -> [BinderPocketLabel] {
        guard let evidenceData = try? Data(
            contentsOf: session.appendingPathComponent("evidence.json")
        ),
            let records = try? JSONDecoder().decode([EvidenceRecord].self, from: evidenceData)
        else { return [] }

        let expectations = frameExpectations(in: session)

        // Index every binder pocket crop by content hash. A hash that appears
        // in more than one pocket is ambiguous (identical crops on two pages)
        // and is dropped rather than guessed at.
        var pocketsByDigest: [String: [(String, Int, [[Double]]?, String?)]] = [:]
        for record in records where record.outcome.hasPrefix("binderPage") {
            guard let files = record.attemptImageFiles else { continue }
            for (offset, file) in files.enumerated() {
                guard let digest = digest(of: session.appendingPathComponent(file)) else { continue }
                let attempt = record.attempts?.first { $0.imageIndex == offset }
                pocketsByDigest[digest, default: []].append((
                    record.imageFile,
                    offset,
                    attempt?.quad,
                    attempt?.topCandidates.first?.cardID
                ))
            }
        }

        // A pocket re-edited in the review sheet writes one correction frame
        // per edit, all sharing the crop bytes and contradicting each other
        // (measured: `211223/frame-0018.jpg#4` carries ecard1-1, noMatch, and
        // ecard1-33). The last edit is the human's final answer — same
        // collapse `ScannerCorrectionReplayTests` applies.
        var latestCorrection: [String: (frameIndex: Int, record: EvidenceRecord)] = [:]
        for record in records where record.outcome.hasPrefix("manualCorrection") {
            guard let expectation = expectations[record.imageFile],
                  let digest = digest(of: session.appendingPathComponent(record.imageFile))
            else { continue }
            if let existing = latestCorrection[digest],
               existing.frameIndex >= expectation.frameIndex { continue }
            latestCorrection[digest] = (expectation.frameIndex, record)
        }

        var labels: [BinderPocketLabel] = []
        for (digest, correction) in latestCorrection {
            let record = correction.record
            guard let expectation = expectations[record.imageFile] else { continue }
            guard let pockets = pocketsByDigest[digest],
                  pockets.count == 1,
                  let pocket = pockets.first
            else { continue }
            labels.append(BinderPocketLabel(
                pageImageFile: pocket.0,
                attemptIndex: pocket.1,
                cardID: expectation.isNoMatch ? nil : expectation.cardID,
                quad: pocket.2,
                recordedTopCandidateID: pocket.3,
                correctionImageFile: record.imageFile
            ))
        }
        return labels.sorted {
            ($0.pageImageFile, $0.attemptIndex) < ($1.pageImageFile, $1.attemptIndex)
        }
    }

    /// Labels grouped by the page frame they belong to.
    static func labelsByPage(in session: URL) -> [String: [BinderPocketLabel]] {
        Dictionary(grouping: labels(in: session), by: \.pageImageFile)
    }

    // MARK: Alignment

    /// Axis-aligned IoU between a recorded quad and a replay detection, both in
    /// the page image's Vision-normalized space. Bounding boxes rather than
    /// exact polygons: the label only has to identify WHICH pocket a detection
    /// is, and pockets in a 3x3 page are far apart relative to any plausible
    /// corner-refinement difference.
    static func overlap(recorded quad: [[Double]], detection: BinderNormalizedQuad) -> CGFloat {
        let recordedPoints = quad.compactMap { pair -> CGPoint? in
            guard pair.count >= 2 else { return nil }
            return CGPoint(x: pair[0], y: pair[1])
        }
        guard recordedPoints.count == 4 else { return 0 }
        let detectionPoints = [
            detection.topLeft, detection.topRight, detection.bottomRight, detection.bottomLeft,
        ]
        return intersectionOverUnion(boundingBox(recordedPoints), boundingBox(detectionPoints))
    }

    private static func boundingBox(_ points: [CGPoint]) -> CGRect {
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(),
              let minY = ys.min(), let maxY = ys.max()
        else { return .null }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    private static func intersectionOverUnion(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, !intersection.isEmpty else { return 0 }
        let intersectionArea = intersection.width * intersection.height
        let unionArea = lhs.width * lhs.height + rhs.width * rhs.height - intersectionArea
        return unionArea > 0 ? intersectionArea / unionArea : 0
    }

    // MARK: Plumbing

    private struct FrameExpectation {
        let cardID: String?
        let isNoMatch: Bool
        /// Recording order, so repeated edits of one pocket can be collapsed
        /// to the human's final answer.
        let frameIndex: Int
    }

    private static func frameExpectations(in session: URL) -> [String: FrameExpectation] {
        guard let data = try? Data(contentsOf: session.appendingPathComponent("results.json")),
              let bundle = try? JSONDecoder().decode(RecordedScanBundle.self, from: data)
        else { return [:] }
        var expectations: [String: FrameExpectation] = [:]
        for frame in bundle.frames {
            let isNoMatch = frame.expectedNoMatch == true
            guard isNoMatch || frame.expectedCardId != nil else { continue }
            expectations[frame.imageFile] = FrameExpectation(
                cardID: frame.expectedCardId,
                isNoMatch: isNoMatch,
                frameIndex: frame.index
            )
        }
        return expectations
    }

    private static func digest(of url: URL) -> String? {
        SessionImageDigest.of(url)
    }
}

/// Content hash of a recorded session image. The recorder writes the same
/// `CGImage` to every place it appears (a review correction and the page
/// attempt crop it came from; a pocket re-edited three times), so identical
/// bytes are the only reliable way to tell that two frames are the same
/// physical capture.
enum SessionImageDigest {
    static func of(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
