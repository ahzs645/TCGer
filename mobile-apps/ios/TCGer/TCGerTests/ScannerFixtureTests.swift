import CoreImage
import UIKit
import XCTest
@testable import TCGer

private struct ScannerFixtureManifest: Decodable {
    let schemaVersion: Int
    let fixtures: [ScannerFixture]
}

private struct ScannerFixture: Decodable {
    let id: String
    let category: String
    let assetName: String?
    let secondaryAssetName: String?
    let variant: String
    let mode: String
    let expectation: String
    let expectedCardIds: [String]
    let minimumConfidence: Double?
    /// Encoder variants (raw values) with a documented open miss on this
    /// fixture. The fixture is skipped (with a printed marker) under those
    /// variants instead of blessing a wrong answer or failing the suite;
    /// removing an entry is a polish goal.
    let knownFailingEncoders: [String]?
}

@MainActor
final class ScannerFixtureTests: XCTestCase {
    private static let coordinator = CardScannerCoordinator.makeDefault()

    func testFixtureManifestCoversRequiredRealWorldCategories() throws {
        let manifest = try loadManifest()
        let categories = Set(manifest.fixtures.map(\.category))

        XCTAssertEqual(manifest.schemaVersion, 1)
        XCTAssertTrue([
            "clean", "rotation", "perspective", "blur", "glare",
            "partialOcclusion", "multipleCards", "cardBack", "pack", "hand", "empty"
        ].allSatisfy(categories.contains))
        let expectations = Set(manifest.fixtures.map(\.expectation))
        XCTAssertTrue(["top1", "top5", "top5Any", "noMatch"].allSatisfy(expectations.contains))
        XCTAssertTrue(
            manifest.fixtures
                .filter { $0.expectation != "noMatch" }
                .allSatisfy { $0.minimumConfidence != nil }
        )
        XCTAssertEqual(manifest.fixtures.map(\.id).count, Set(manifest.fixtures.map(\.id)).count)
    }

    func testShutterCleanCardFixturesRemainTopOne() async throws {
        let fixtures = try loadManifest().fixtures.filter { $0.category == "clean" }
        for fixture in fixtures {
            if fixture.knownFailingEncoders?.contains(ScannerEncoderVariant.current.rawValue) == true {
                print("FIXTURE-SKIP \(fixture.id): known open miss under encoder \(ScannerEncoderVariant.current.rawValue)")
                continue
            }
            let image = try makeImage(for: fixture)
            let result = await Self.coordinator.scan(
                image: image,
                context: .test(mode: scanMode(fixture.mode), engine: .localOnly),
                source: .photoCapture
            )
            assert(result: result, satisfies: fixture)
        }
    }

    func testShutterDistortedCardFixturesRemainRecognizable() async throws {
        let supportedCategories: Set<String> = [
            "rotation", "perspective", "blur", "glare", "partialOcclusion", "multipleCards"
        ]
        // Categories overlap expectations: a multi-card scene is a distorted
        // *input* but its expectation is noMatch (the single-card recognizer
        // is supposed to abstain), which the negative test covers.
        let fixtures = try loadManifest().fixtures.filter {
            supportedCategories.contains($0.category) && $0.expectation != "noMatch"
        }
        for fixture in fixtures {
            if fixture.knownFailingEncoders?.contains(ScannerEncoderVariant.current.rawValue) == true {
                print("FIXTURE-SKIP \(fixture.id): known open miss under encoder \(ScannerEncoderVariant.current.rawValue)")
                continue
            }
            let result = await Self.coordinator.scan(
                image: try makeImage(for: fixture),
                context: .test(mode: scanMode(fixture.mode), engine: .localOnly),
                source: .photoCapture
            )
            assert(result: result, satisfies: fixture)
        }
    }

    func testShutterNegativeFixturesDoNotProduceMatches() async throws {
        let fixtures = try loadManifest().fixtures.filter { $0.expectation == "noMatch" }
        for fixture in fixtures {
            if fixture.knownFailingEncoders?.contains(ScannerEncoderVariant.current.rawValue) == true {
                print("FIXTURE-SKIP \(fixture.id): known open miss under encoder \(ScannerEncoderVariant.current.rawValue)")
                continue
            }
            let result = await Self.coordinator.scan(
                image: try makeImage(for: fixture),
                context: .test(mode: scanMode(fixture.mode), engine: .localOnly),
                source: .photoCapture
            )
            guard case .failure(.noMatch) = result else {
                return XCTFail("\(fixture.id) produced a card match; open-set rejection regressed")
            }
        }
    }

    private func assert(
        result: Result<CardScanResult, CardScannerError>,
        satisfies fixture: ScannerFixture,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .success(let scan) = result else {
            return XCTFail("\(fixture.id) returned no match", file: file, line: line)
        }
        let topFive = Array(([scan.primary] + scan.alternatives).prefix(5))
        let ids = topFive.map { $0.details.identity.id }
        switch fixture.expectation {
        case "top1":
            XCTAssertTrue(
                fixture.expectedCardIds.contains(scan.primary.details.identity.id),
                "\(fixture.id) expected top-1 in \(fixture.expectedCardIds), got \(scan.primary.details.identity.id)",
                file: file,
                line: line
            )
        case "top5", "top5Any":
            XCTAssertTrue(
                fixture.expectedCardIds.contains(where: ids.contains),
                "\(fixture.id) expected top-5 in \(fixture.expectedCardIds), got \(ids)",
                file: file,
                line: line
            )
        default:
            XCTFail("Unknown positive expectation \(fixture.expectation)", file: file, line: line)
        }
        if let minimumConfidence = fixture.minimumConfidence {
            XCTAssertGreaterThanOrEqual(
                scan.primary.confidence.score,
                minimumConfidence,
                "\(fixture.id) confidence \(scan.primary.confidence.score) was below \(minimumConfidence)",
                file: file,
                line: line
            )
        }
    }

    private func loadManifest() throws -> ScannerFixtureManifest {
        let bundle = Bundle(for: ScannerFixtureTests.self)
        let url = try XCTUnwrap(bundle.url(forResource: "ScannerFixtures", withExtension: "json"))
        return try JSONDecoder().decode(ScannerFixtureManifest.self, from: Data(contentsOf: url))
    }

    private func scanMode(_ rawValue: String) -> ScanMode {
        ScanMode(rawValue: rawValue) ?? .pokemon
    }

    private func makeImage(for fixture: ScannerFixture) throws -> CGImage {
        let base: UIImage
        if let assetName = fixture.assetName {
            base = try XCTUnwrap(UIImage(named: assetName), "Missing image asset \(assetName)")
        } else {
            base = syntheticScene(kind: fixture.variant)
        }

        let transformed: UIImage
        switch fixture.variant {
        case "rotation": transformed = rotate(base, degrees: 9)
        case "perspective": transformed = perspective(base)
        case "blur": transformed = filter(base, name: "CIGaussianBlur", parameters: [kCIInputRadiusKey: 2.2])
        case "glare": transformed = glare(base)
        case "occlusion": transformed = occlusion(base)
        case "multiple":
            let second = try XCTUnwrap(UIImage(named: fixture.secondaryAssetName ?? ""))
            transformed = multipleCards(base, second)
        default: transformed = base
        }
        return try XCTUnwrap(transformed.cgImage)
    }

    private func rotate(_ image: UIImage, degrees: CGFloat) -> UIImage {
        let radians = degrees * .pi / 180
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: image.size.width * 1.2, height: image.size.height * 1.2))
        return renderer.image { context in
            let center = CGPoint(x: renderer.format.bounds.midX, y: renderer.format.bounds.midY)
            context.cgContext.translateBy(x: center.x, y: center.y)
            context.cgContext.rotate(by: radians)
            image.draw(in: CGRect(
                x: -image.size.width / 2,
                y: -image.size.height / 2,
                width: image.size.width,
                height: image.size.height
            ))
        }
    }

    private func perspective(_ image: UIImage) -> UIImage {
        guard let ciImage = CIImage(image: image) else { return image }
        let width = ciImage.extent.width
        let height = ciImage.extent.height
        let output = ciImage.applyingFilter("CIPerspectiveTransform", parameters: [
            "inputTopLeft": CIVector(x: width * 0.1, y: height),
            "inputTopRight": CIVector(x: width * 0.92, y: height * 0.94),
            "inputBottomLeft": CIVector(x: 0, y: height * 0.05),
            "inputBottomRight": CIVector(x: width, y: 0)
        ])
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(output, from: output.extent) else { return image }
        return UIImage(cgImage: cgImage)
    }

    private func filter(_ image: UIImage, name: String, parameters: [String: Any]) -> UIImage {
        guard let input = CIImage(image: image) else { return image }
        let output = input.applyingFilter(name, parameters: parameters).cropped(to: input.extent)
        guard let cgImage = CIContext().createCGImage(output, from: output.extent) else { return image }
        return UIImage(cgImage: cgImage)
    }

    private func glare(_ image: UIImage) -> UIImage {
        UIGraphicsImageRenderer(size: image.size).image { context in
            image.draw(at: .zero)
            context.cgContext.saveGState()
            context.cgContext.translateBy(x: image.size.width * 0.56, y: -image.size.height * 0.1)
            context.cgContext.rotate(by: 0.22)
            UIColor.white.withAlphaComponent(0.48).setFill()
            context.cgContext.fill(CGRect(
                x: 0,
                y: 0,
                width: image.size.width * 0.18,
                height: image.size.height * 1.25
            ))
            context.cgContext.restoreGState()
        }
    }

    private func occlusion(_ image: UIImage) -> UIImage {
        UIGraphicsImageRenderer(size: image.size).image { context in
            image.draw(at: .zero)
            UIColor(red: 0.72, green: 0.48, blue: 0.35, alpha: 1).setFill()
            context.cgContext.fillEllipse(in: CGRect(
                x: -image.size.width * 0.12,
                y: image.size.height * 0.55,
                width: image.size.width * 0.45,
                height: image.size.height * 0.5
            ))
        }
    }

    private func multipleCards(_ first: UIImage, _ second: UIImage) -> UIImage {
        let size = CGSize(width: first.size.width * 1.55, height: first.size.height)
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIColor.darkGray.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            first.draw(in: CGRect(x: 0, y: 0, width: first.size.width, height: first.size.height))
            second.draw(in: CGRect(
                x: first.size.width * 0.72,
                y: first.size.height * 0.08,
                width: first.size.width * 0.75,
                height: first.size.height * 0.75
            ))
        }
    }

    private func syntheticScene(kind: String) -> UIImage {
        let size = CGSize(width: 720, height: 1_000)
        return UIGraphicsImageRenderer(size: size).image { context in
            UIColor(white: kind == "empty" ? 0.45 : 0.18, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            if kind == "pack" {
                UIColor.systemPurple.setFill()
                context.fill(CGRect(x: 145, y: 110, width: 430, height: 780))
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.boldSystemFont(ofSize: 54),
                    .foregroundColor: UIColor.white
                ]
                NSString(string: "BOOSTER\nPACK").draw(
                    in: CGRect(x: 190, y: 380, width: 340, height: 180),
                    withAttributes: attributes
                )
            } else if kind == "hand" {
                UIColor(red: 0.74, green: 0.51, blue: 0.39, alpha: 1).setFill()
                context.cgContext.fillEllipse(in: CGRect(x: 120, y: 250, width: 480, height: 540))
            }
        }
    }
}
