import CoreImage
import CryptoKit
import UIKit
import Vision
import XCTest
@testable import TCGer

/// Diagnostic exporter for the shared crop-parity experiment. Private source
/// frames are staged into `CropParityInputs.generated` and remain untracked.
@MainActor
final class CropParityExportTests: XCTestCase {
    private struct CasesDocument: Decodable {
        let cases: [CropCase]
    }

    private struct CropCase: Decodable {
        let caseId: String
        let sourcePath: String
        let sourceSha256: String
        let quad: [[Double]]
    }

    func testExportCurrentCoreImageCrops() throws {
        let bundledCasesURL = Bundle(for: Self.self).url(
            forResource: "cases",
            withExtension: "json",
            subdirectory: "CropParityInputs.generated"
        )
        let stagedCasesURL = ProcessInfo.processInfo.environment["CROP_PARITY_INPUT_ROOT"]
            .map { URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("cases.json") }
        guard let casesURL = bundledCasesURL ?? stagedCasesURL,
              FileManager.default.fileExists(atPath: casesURL.path) else {
            throw XCTSkip("stage crop-parity inputs into CropParityInputs.generated")
        }
        let document = try JSONDecoder().decode(
            CasesDocument.self,
            from: Data(contentsOf: casesURL)
        )
        let cropper = CardCropper(detector: nil)
        for fixture in document.cases {
            let sourceURL = casesURL.deletingLastPathComponent()
                .appendingPathComponent(fixture.sourcePath)
            guard let image = UIImage(contentsOfFile: sourceURL.path)?.cgImage else {
                XCTFail("could not decode \(fixture.caseId)")
                continue
            }
            XCTAssertEqual(
                Self.sha256(try Data(contentsOf: sourceURL)),
                fixture.sourceSha256
            )
            let points = try fixture.quad.map { pair -> CGPoint in
                guard pair.count == 2 else {
                    throw NSError(domain: "CropParity", code: 1)
                }
                return CGPoint(x: pair[0], y: 1 - pair[1])
            }
            let observation = VNRectangleObservation(
                requestRevision: VNDetectRectanglesRequestRevision1,
                topLeft: points[0],
                topRight: points[1],
                bottomRight: points[2],
                bottomLeft: points[3]
            )
            let crop = try XCTUnwrap(
                cropper.makeNormalizedCrop(from: image, observation: observation),
                fixture.caseId
            )
            let attachment = XCTAttachment(image: UIImage(cgImage: crop))
            attachment.name = "\(fixture.caseId).png"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
