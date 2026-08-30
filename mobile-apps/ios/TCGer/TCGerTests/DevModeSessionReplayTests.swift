import CoreGraphics
import Foundation
import ImageIO
import XCTest
@testable import TCGer

/// Replays exported dev-mode sessions through the full production coordinator
/// and compares each frame's new outcome against what the recording device
/// decided at capture time — the recorded results ARE the before-baseline, so
/// this measures pipeline changes directly against real user captures.
///
/// Point DEVMODE_SESSIONS_DIR at a folder of scan-session-* directories (the
/// unzipped "Export All Sessions" archive) via
/// `TEST_RUNNER_DEVMODE_SESSIONS_DIR=... xcodebuild test`. Skips when unset.
@MainActor
final class DevModeSessionReplayTests: XCTestCase {
    private struct EvidenceRecord: Decodable {
        let imageFile: String
        let outcome: String
    }

    /// Ground truth for frames whose card was verified by a flat-on scan of
    /// the same physical card in the same archive (2026-08-09 sessions).
    private static let expectedCards: [String: String] = [
        "scan-session-20260809-160556/frame-0001.jpg": "dpp-DP38",
        "scan-session-20260809-160556/frame-0007.jpg": "dp4-104",
        "scan-session-20260809-160556/frame-0009.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0010.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0011.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0012.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0014.jpg": "me05-016",
        // The 19:07 lighting/foil session deliberately repeats each physical
        // card across blur, glare, angle, and framing changes. Clear frames
        // and visible collector numbers identify every single-card shot.
        "scan-session-20260809-190752/frame-0000.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0001.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0002.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0003.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0004.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0005.jpg": "me04-051",
        "scan-session-20260809-190752/frame-0006.jpg": "me04-051",
        "scan-session-20260809-190752/frame-0007.jpg": "me05-040",
        "scan-session-20260809-190752/frame-0008.jpg": "me05-040",
        "scan-session-20260809-190752/frame-0009.jpg": "me05-040",
        "scan-session-20260809-190752/frame-0010.jpg": "swshp-SWSH204",
        "scan-session-20260809-190752/frame-0011.jpg": "dp4-104",
        "scan-session-20260809-190752/frame-0012.jpg": "pl4-AR3",
        "scan-session-20260809-190752/frame-0013.jpg": "pl4-AR3",
        "scan-session-20260809-190752/frame-0014.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0015.jpg": "dpp-DP38",
        "scan-session-20260809-190752/frame-0016.jpg": "dpp-DP38",
        "scan-session-20260809-190752/frame-0017.jpg": "dpp-DP38",
        "scan-session-20260809-190752/frame-0018.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0019.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0020.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0021.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0022.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0023.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0024.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0025.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0026.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0027.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0028.jpg": "dp4-103",
        // The 21:09 follow-up repeats known cards under glare, blur, overlap,
        // and clear framing. Visible titles/collector numbers plus the clear
        // shots establish the exact printing for every single-card frame.
        "scan-session-20260809-210958/frame-0000.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0001.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0002.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0003.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0004.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0005.jpg": "dp4-103",
        "scan-session-20260809-210958/frame-0006.jpg": "dp4-103",
        "scan-session-20260809-210958/frame-0007.jpg": "dp4-104",
        "scan-session-20260809-210958/frame-0008.jpg": "pl4-AR3",
        "scan-session-20260809-210958/frame-0009.jpg": "pl4-AR3",
        "scan-session-20260809-210958/frame-0010.jpg": "pl4-AR3",
        // Two stacked sleeved cards, Giratina LV.X in front. Labeled noMatch
        // while bad crops made the outcome arbitrary; the pixel-space corner
        // refinement (2026-08-10) deterministically isolates the front card,
        // and the user decided single-card mode should identify it.
        "scan-session-20260809-210958/frame-0011.jpg": "dpp-DP38",
        "scan-session-20260809-210958/frame-0012.jpg": "dpp-DP38",
        "scan-session-20260809-210958/frame-0013.jpg": "dpp-DP30",
        "scan-session-20260809-210958/frame-0014.jpg": "dpp-DP30",
        "scan-session-20260809-210958/frame-0015.jpg": "dpp-DP30",
        // August 27 MTG reference session, labeled directly from the readable
        // card title and HOB collector number in each saved frame. Repeated
        // captures intentionally cover distance, foil glare, and framing.
        "scan-session-20260827-223150/frame-0000.jpg": "3685c783-d837-4466-a960-ab3098db64c3",
        "scan-session-20260827-223150/frame-0001.jpg": "17892c93-b9b2-4720-933b-998ed0200492",
        "scan-session-20260827-223150/frame-0002.jpg": "17892c93-b9b2-4720-933b-998ed0200492",
        "scan-session-20260827-223150/frame-0003.jpg": "ea174cea-40e5-424e-9734-e39aae6c6b17",
        "scan-session-20260827-223150/frame-0004.jpg": "8d4f3eb5-fedf-45d6-8bd8-aacbe0ce33b2",
        "scan-session-20260827-223150/frame-0005.jpg": "8651958c-3b94-47a9-a751-faf8f6236a42",
        "scan-session-20260827-223150/frame-0006.jpg": "8651958c-3b94-47a9-a751-faf8f6236a42",
        "scan-session-20260827-223150/frame-0007.jpg": "8651958c-3b94-47a9-a751-faf8f6236a42",
        "scan-session-20260827-223150/frame-0008.jpg": "1f8403a2-849c-4a59-b0ed-c8803995028d",
        "scan-session-20260827-223150/frame-0009.jpg": "1f8403a2-849c-4a59-b0ed-c8803995028d",
        "scan-session-20260827-223150/frame-0010.jpg": "e4800508-8bb9-41bb-8712-b55fba7a80a5",
        "scan-session-20260827-223150/frame-0011.jpg": "3feca644-5f65-4477-bbc8-d505cec6f3a5",
        "scan-session-20260827-223150/frame-0012.jpg": "3feca644-5f65-4477-bbc8-d505cec6f3a5",
        "scan-session-20260827-223150/frame-0013.jpg": "ad0dba36-d056-4bc1-987a-391da26ad267",
        "scan-session-20260827-223150/frame-0014.jpg": "a2e4099e-86bd-461f-87fa-7f7850ae7eec",
        "scan-session-20260827-223150/frame-0015.jpg": "9984b9ef-e81c-48f4-aa33-0504171a2d3c",
        "scan-session-20260827-223150/frame-0016.jpg": "9984b9ef-e81c-48f4-aa33-0504171a2d3c",
        "scan-session-20260827-223150/frame-0017.jpg": "9984b9ef-e81c-48f4-aa33-0504171a2d3c",
        "scan-session-20260827-223150/frame-0018.jpg": "e4ded4c1-0e3e-47c5-8fdc-e7c187f68b12",
        "scan-session-20260827-223150/frame-0019.jpg": "e4ded4c1-0e3e-47c5-8fdc-e7c187f68b12",
        "scan-session-20260827-223150/frame-0020.jpg": "e4ded4c1-0e3e-47c5-8fdc-e7c187f68b12",
        "scan-session-20260827-223150/frame-0021.jpg": "1ccbf823-846f-4f09-9c67-1deebb5d1d92",
        // August 29 MTG session: reprint-heavy (lands, SNC charms, C13/C17/C19
        // commander cards), labeled from each frame's readable title and
        // NNN/NNN footer. Labels are EXACT printings; a same-family newest-
        // printing fallback scores as a family match, not a wrong accept.
        "scan-session-20260829-200235/frame-0000.jpg": "8651958c-3b94-47a9-a751-faf8f6236a42",
        "scan-session-20260829-200235/frame-0001.jpg": "8d4f3eb5-fedf-45d6-8bd8-aacbe0ce33b2",
        "scan-session-20260829-200235/frame-0002.jpg": "ea174cea-40e5-424e-9734-e39aae6c6b17",
        "scan-session-20260829-200235/frame-0003.jpg": "17892c93-b9b2-4720-933b-998ed0200492",
        "scan-session-20260829-200235/frame-0004.jpg": "17892c93-b9b2-4720-933b-998ed0200492",
        "scan-session-20260829-200235/frame-0005.jpg": "3685c783-d837-4466-a960-ab3098db64c3",
        "scan-session-20260829-200235/frame-0006.jpg": "92fb453e-6cbe-48c6-98ef-86069791c341",
        "scan-session-20260829-200235/frame-0007.jpg": "92fb453e-6cbe-48c6-98ef-86069791c341",
        "scan-session-20260829-200235/frame-0008.jpg": "3c64d130-2864-4e1e-9024-58821eec3be5",
        "scan-session-20260829-200235/frame-0009.jpg": "3c64d130-2864-4e1e-9024-58821eec3be5",
        "scan-session-20260829-200235/frame-0010.jpg": "80658042-3998-49ca-88ef-f87320a5bd43",
        "scan-session-20260829-200235/frame-0011.jpg": "540f84af-f247-42a2-a4d5-bf3dab4da647",
        "scan-session-20260829-200235/frame-0012.jpg": "0bd86cac-08c1-4db0-ab54-4bb65a771efe",
        "scan-session-20260829-200235/frame-0013.jpg": "ee198ea7-729a-47ce-89dd-43f77f60247b",
        "scan-session-20260829-200235/frame-0014.jpg": "baa5d34b-b052-47f4-95e1-42a9c2d21cdf",
        "scan-session-20260829-200235/frame-0015.jpg": "baa5d34b-b052-47f4-95e1-42a9c2d21cdf",
        "scan-session-20260829-200235/frame-0016.jpg": "74c9c315-1cf4-468e-a74a-b5f3be4a63a1",
        "scan-session-20260829-200235/frame-0017.jpg": "08f33c8a-8e93-4296-964b-da132a854b3b",
        "scan-session-20260829-200235/frame-0018.jpg": "9eb94908-4f4a-487e-87ac-8d5bdefe9983",
        "scan-session-20260829-200235/frame-0019.jpg": "d833fd8f-8d1f-4a4d-a42a-58af63c17186",
        "scan-session-20260829-200235/frame-0020.jpg": "99806615-2f4a-4fe4-82f8-83445ae93a97",
        "scan-session-20260829-200235/frame-0021.jpg": "3dcdedb6-3c24-4a29-b9b9-27cc47d8ee56",
        "scan-session-20260829-200235/frame-0022.jpg": "784a5915-bc42-49d6-8a1b-45da7749f03a",
        "scan-session-20260829-200235/frame-0023.jpg": "784a5915-bc42-49d6-8a1b-45da7749f03a",
        "scan-session-20260829-200235/frame-0024.jpg": "36c70a1d-c129-4c97-a190-6b3eaa83d48c",
        "scan-session-20260829-200235/frame-0025.jpg": "a586e329-b1e2-4b60-a914-7b9aa2c645c2",
        "scan-session-20260829-200235/frame-0026.jpg": "5fb4c2b7-8714-496e-a981-844e8e5b81ea",
    ]
    /// Frames that must NOT match anything (accidental shutter presses).
    private static let expectedNoMatch: Set<String> = [
        "scan-session-20260809-145850/frame-0000.jpg",
        "scan-session-20260809-145850/frame-0001.jpg",
        "scan-session-20260809-145947/frame-0000.jpg",
    ]
    /// Frames whose device decision does not reproduce in the Simulator even
    /// on unmodified code (Simulator Vision doc-seg/rectangles diverge from
    /// device Vision — a long-known trap). Excluded from the lost-frame
    /// regression assertion; still printed.
    private static let knownSimulatorDivergences: Set<String> = [
        "scan-session-20260809-160556/frame-0005.jpg",
        // Device Vision produced the recorded correct crops; Simulator Vision
        // chooses different quads on these same pixels. Their device attempts
        // clear 0.72 or carry exact collector-number confirmation.
        "scan-session-20260809-190752/frame-0004.jpg",
        "scan-session-20260809-190752/frame-0017.jpg",
        "scan-session-20260809-190752/frame-0022.jpg",
        "scan-session-20260809-190752/frame-0026.jpg",
        // Device accepted the correct Darkrai from its recorded crop; the
        // Simulator chooses lower-scoring whole-frame/detected quads.
        "scan-session-20260809-210958/frame-0007.jpg",
        // 2026-08-10: first full replay of the reorganized
        // TCGer-Session-Reference/sessions export. All 15 frames below lose
        // their device accepts identically on pre-fix (715fe9b2, isolated
        // worktree control) and post-fix code — the sessions were recorded on
        // device and never had Simulator floors established. Device attempts
        // accepted at 0.72+; Simulator Vision picks different quads.
        "scan-session-20260809-175313/frame-0000.jpg",
        "scan-session-20260809-175313/frame-0008.jpg",
        "scan-session-20260809-175313/frame-0015.jpg",
        "scan-session-20260809-175313/frame-0016.jpg",
        "scan-session-20260809-175313/frame-0017.jpg",
        "scan-session-20260809-175313/frame-0020.jpg",
        "scan-session-20260809-175313/frame-0021.jpg",
        "scan-session-20260809-175313/frame-0026.jpg",
        "scan-session-20260809-175313/frame-0029.jpg",
        "scan-session-20260809-183843/frame-0005.jpg",
        "scan-session-20260809-183843/frame-0008.jpg",
        "scan-session-20260809-183843/frame-0017.jpg",
        "scan-session-20260809-183843/frame-0020.jpg",
        "scan-session-20260809-211223/frame-0000.jpg",
        "scan-session-20260809-211223/frame-0015.jpg",
    ]

    /// Device-accepted frames the ArcFace encoder does not (yet) recover —
    /// its 2026-08-23 replay operating point trades these 9 for +15 labeled
    /// correct frames and zero wrong accepts vs DINOv2. Counted separately
    /// from Simulator divergences so a NEW ArcFace loss still fails the
    /// assertion. Shrinking this list is the goal of the real-crop fine-tune
    /// on the polish plan (4 of the 9 are the swshp-SWSH204 promo).
    private static let knownArcFaceEncoderLosses: Set<String> = [
        "scan-session-20260809-175313/frame-0003.jpg",
        "scan-session-20260809-190752/frame-0010.jpg",
        "scan-session-20260809-190752/frame-0011.jpg",
        "scan-session-20260809-210958/frame-0000.jpg",
        "scan-session-20260809-210958/frame-0004.jpg",
        "scan-session-20260817-214446/frame-0000.jpg",
        "scan-session-20260818-144857/frame-0010.jpg",
        "scan-session-20260821-211659/frame-0018.jpg",
        "scan-session-20260821-231419/frame-0034.jpg",
    ]

    /// Labeled frames the pipeline currently accepts as the wrong card. These
    /// are open defects, not accepted behavior — they are listed so that a NEW
    /// wrong accept still fails the assertion below. Removing an entry is the
    /// goal; adding one requires the same scrutiny as any precision regression.
    private static let knownWrongAccepts: Set<String> = [
        // Basic Energy: Water (dp1-125) retrieved as Grass (dp1-123) at 0.77.
        // The two printings differ only in the energy symbol, which the
        // center-crop preprocessing keeps but the global embedding averages
        // away. Binder review now leaves this uncertain result unselected,
        // though it remains a wrong single-card acceptance here.
        "scan-session-20260810-220315/frame-0009.jpg",
        // Absol (ex13-18) retrieved as Medicham (ex5-42) at 0.72. A separate
        // capture of the same card in the 21:12 session retrieves Shiftry
        // (ex2-22) — two different wrong Pokemon from two foil crops of one
        // card, so the neighborhood is unstable, not a near-twin printing
        // problem the OCR tiebreak could resolve.
        "scan-session-20260810-220315/frame-0012.jpg",
    ]

    func testReplayDevModeSessions() async throws {
        guard let dir = ProcessInfo.processInfo.environment["DEVMODE_SESSIONS_DIR"] else {
            throw XCTSkip("Set DEVMODE_SESSIONS_DIR to an unzipped Export All archive to run.")
        }
        let root = URL(fileURLWithPath: dir, isDirectory: true)
        let sessions = ((try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []).filter {
            FileManager.default.fileExists(atPath: $0.appendingPathComponent("results.json").path)
        }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertFalse(sessions.isEmpty, "no sessions found under \(dir)")

        let environment = ProcessInfo.processInfo.environment
        let productionStrategiesOnly = environment["DEVMODE_PRODUCTION_STRATEGIES_ONLY"] == "1"
        let replayMode = environment["DEVMODE_REPLAY_MODE"].flatMap(ScanMode.init(rawValue:))
        let coordinator: CardScannerCoordinator
        if let releaseDirectory = environment["DEVMODE_SCANNER_RELEASE_DIR"] {
            let releaseURL = URL(fileURLWithPath: releaseDirectory, isDirectory: true)
            let modelURL = releaseURL.appendingPathComponent(
                "CardEmbeddings-arcface.mlmodelc",
                isDirectory: true
            )
            let vectorsURL = releaseURL.appendingPathComponent("CardsIndexVectors-arcface.bin")
            let metadataURL = releaseURL.appendingPathComponent("CardsIndexMetadata.json")
            for requiredURL in [modelURL, vectorsURL, metadataURL] {
                XCTAssertTrue(
                    FileManager.default.fileExists(atPath: requiredURL.path),
                    "candidate scanner release is missing \(requiredURL.lastPathComponent)"
                )
            }
            coordinator = CardScannerCoordinator(
                strategies: [BoardCardEmbeddingScannerStrategy(
                    variant: .arcface,
                    encoder: CardEmbeddingEncoder(
                        modelLoader: FileCardEmbeddingModelLoader(modelURL: modelURL)
                    ),
                    indexStore: AnnoyIndexStore(fileURL: vectorsURL),
                    metadataStore: CardIndexMetadataStore(fileURL: metadataURL)
                )],
                apiService: APIService()
            )
        } else {
            coordinator = CardScannerCoordinator.makeDefault(
                includeBundledTestFallbacks: !productionStrategiesOnly
            )
        }
        var lostCount = 0
        var wrongAccepts: [String] = []
        var expectedHits = 0
        var expectedTotal = 0
        var familyFallbacks = 0

        for session in sessions {
            let bundle = try JSONDecoder().decode(
                RecordedScanBundle.self,
                from: Data(contentsOf: session.appendingPathComponent("results.json"))
            )
            let evidence = (try? JSONDecoder().decode(
                [EvidenceRecord].self,
                from: Data(contentsOf: session.appendingPathComponent("evidence.json"))
            )) ?? []
            let binderImages = Set(evidence.lazy.filter {
                $0.outcome.hasPrefix("binderPage")
            }.map(\.imageFile))
            // Re-editing one review pocket writes a fresh correction frame per
            // edit, all with identical crop bytes and superseded labels (the
            // 21:12 session labels one pocket ecard1-1, then noMatch, then
            // ecard1-33). Scoring the stale ones fails the pipeline for
            // answering what the human ultimately said. Last edit wins, same
            // collapse ScannerCorrectionReplayTests applies.
            var supersededFrames: Set<String> = []
            var latestLabelByDigest: [String: (index: Int, imageFile: String)] = [:]
            for frame in bundle.frames
            where frame.expectedCardId != nil || frame.expectedNoMatch != nil {
                guard let digest = SessionImageDigest.of(
                    session.appendingPathComponent(frame.imageFile)
                ) else { continue }
                guard let previous = latestLabelByDigest[digest] else {
                    latestLabelByDigest[digest] = (frame.index, frame.imageFile)
                    continue
                }
                if previous.index < frame.index {
                    supersededFrames.insert(previous.imageFile)
                    latestLabelByDigest[digest] = (frame.index, frame.imageFile)
                } else {
                    supersededFrames.insert(frame.imageFile)
                }
            }
            for frame in bundle.frames.sorted(by: { $0.index < $1.index }) {
                if let replayMode,
                   ScanMode(rawValue: frame.mode) != replayMode {
                    continue
                }
                // Binder pages have their own replay harness. Treating a full
                // 3x3 page as one card creates meaningless single-card hits.
                guard !binderImages.contains(frame.imageFile) else { continue }
                let imageURL = session.appendingPathComponent(frame.imageFile)
                guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
                else { continue }

                let key = "\(session.lastPathComponent)/\(frame.imageFile)"
                let diagnostics = ScanDiagnostics()
                var context = CardScannerContext.test(
                    mode: ScanMode(rawValue: frame.mode) ?? .pokemon,
                    engine: .localOnly
                )
                context.diagnostics = diagnostics
                let result = await coordinator.scan(
                    image: image,
                    context: context,
                    source: .photoCapture
                )

                var newCardID: String?
                var newScore: Double?
                var newFamilyPrintingIDs: Set<String> = []
                var newProvenance: CardPrintingResolutionProvenance?
                if case .success(let scan) = result {
                    newCardID = scan.primary.details.identity.id
                    newScore = scan.primary.confidence.score
                    newProvenance = scan.printingResolutionProvenance
                    newFamilyPrintingIDs = Set(
                        ([scan.primary.details] + scan.primary.printingAlternatives).map {
                            $0.identity.exactPrintingID ?? $0.identity.id
                        }
                    )
                }

                let baseline = frame.identified ? (frame.bestMatchCardId ?? "?") : "noMatch"
                let current = newCardID ?? "noMatch"
                var verdict = ""
                // Labels the recorder already wrote (a human correction in the
                // app writes `expectedCardId`/`expectedNoMatch` into
                // results.json) count as ground truth alongside the curated
                // table above, which stays authoritative where both exist.
                // Without this every corrected frame in an archive replays
                // completely unscored.
                let isSuperseded = supersededFrames.contains(frame.imageFile)
                let recordedExpectation = (frame.expectedNoMatch == true || isSuperseded)
                    ? nil
                    : frame.expectedCardId
                if let expected = Self.expectedCards[key] ?? recordedExpectation {
                    expectedTotal += 1
                    if newCardID == expected {
                        expectedHits += 1
                        verdict = " ✓ RECOVERED (expected \(expected))"
                    } else if newCardID != nil,
                              newProvenance != .verified,
                              newFamilyPrintingIDs.contains(expected) {
                        // Family-index runtimes deliberately answer a same-art
                        // reprint with the newest printing (Quick Scan) unless
                        // printed evidence pins the exact one. The card is
                        // right; only the printing choice is a fallback.
                        expectedHits += 1
                        familyFallbacks += 1
                        verdict = " ✓ FAMILY (printing fallback; expected \(expected))"
                    } else if let newCardID {
                        if !Self.knownWrongAccepts.contains(key) {
                            wrongAccepts.append("\(key) expected \(expected), got \(newCardID)")
                        }
                        verdict = " ✗ WRONG ACCEPT (expected \(expected))"
                    } else {
                        verdict = " • abstained (expected \(expected))"
                    }
                }
                if Self.expectedNoMatch.contains(key)
                    || (frame.expectedNoMatch == true && !isSuperseded) {
                    if newCardID != nil {
                        if !Self.knownWrongAccepts.contains(key) {
                            wrongAccepts.append("\(key) expected noMatch, got \(current)")
                        }
                        verdict = " ✗ FALSE ACCEPT"
                    } else {
                        verdict = " ✓ still declined"
                    }
                }
                if isSuperseded {
                    verdict += " (superseded label, not scored)"
                }
                // A manual correction records the REJECTED prediction as the
                // frame's baseline (`identified` / `bestMatchCardId` are the
                // human's "previous" values), so a frame the user overruled
                // must not anchor the lost-accept floor: abstaining instead of
                // repeating the wrong card is the fix working, not a
                // regression. Only accepts the human did not contradict count.
                let baselineWasRejected = frame.expectedNoMatch == true
                    || (frame.expectedCardId.map { $0 != frame.bestMatchCardId } ?? false)
                    || (Self.expectedCards[key].map { $0 != frame.bestMatchCardId } ?? false)
                if frame.identified, newCardID == nil, !baselineWasRejected {
                    if Self.knownSimulatorDivergences.contains(key) {
                        verdict += " (known Simulator divergence: was \(baseline))"
                    } else if ScannerEncoderVariant.current == .arcface,
                              Self.knownArcFaceEncoderLosses.contains(key) {
                        verdict += " (known ArcFace encoder loss: was \(baseline))"
                    } else {
                        lostCount += 1
                        verdict += " (LOST: was \(baseline))"
                    }
                }

                // Threshold-sweep evidence dump: full recorded attempts per
                // frame so acceptance policy can be swept offline without
                // re-running recognition (REPLAY_EVIDENCE_DIR env; see
                // scripts in the scanner README's recalibration notes).
                if let dumpDir = ProcessInfo.processInfo.environment["REPLAY_EVIDENCE_DIR"] {
                    struct FrameEvidence: Codable {
                        let key: String
                        let baseline: String
                        let current: String
                        let currentScore: Double?
                        let expected: String?
                        let expectedNoMatch: Bool
                        let attempts: [ScanDiagnostics.Attempt]
                    }
                    let record = FrameEvidence(
                        key: key,
                        baseline: baseline,
                        current: current,
                        currentScore: newScore,
                        expected: Self.expectedCards[key] ?? recordedExpectation,
                        expectedNoMatch: Self.expectedNoMatch.contains(key)
                            || (frame.expectedNoMatch == true && !isSuperseded),
                        attempts: diagnostics.attempts
                    )
                    let dir = URL(fileURLWithPath: dumpDir, isDirectory: true)
                    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let name = key.replacingOccurrences(of: "/", with: "__") + ".json"
                    if let data = try? JSONEncoder().encode(record) {
                        try? data.write(to: dir.appendingPathComponent(name))
                    }
                }
                let outcomes = diagnostics.attempts.map { "\($0.kind.rawValue):\($0.outcome.rawValue)" }
                    .joined(separator: ", ")
                print(
                    "DEVREPLAY \(key): \(baseline) -> \(current)"
                    + (newScore.map { String(format: " @%.2f", $0) } ?? "")
                    + verdict + "  [\(outcomes)]"
                )
            }
        }

        print("DEVREPLAY summary: labeled \(expectedHits)/\(expectedTotal) correct "
            + "(\(familyFallbacks) via same-family printing fallback), "
            + "\(lostCount) previously-accepted lost, \(wrongAccepts.count) wrong accepts")
        XCTAssertTrue(
            wrongAccepts.isEmpty,
            "ground-truth labels must never change to a wrong card: \(wrongAccepts)"
        )
        XCTAssertEqual(lostCount, 0, "previously accepted frames must not be lost")
    }
}
