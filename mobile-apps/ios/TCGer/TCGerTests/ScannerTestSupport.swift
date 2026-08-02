import CoreGraphics
import XCTest
@testable import TCGer

@MainActor
final class ScanInvocationRecorder {
    private(set) var kinds: [ScanStrategyKind] = []

    func record(_ kind: ScanStrategyKind) {
        kinds.append(kind)
    }
}

@MainActor
final class StubScanStrategy: ScanStrategy {
    enum Behavior {
        case noMatch
        case failure(CardScannerError)
        case match(cardID: String, setCode: String? = nil, confidence: Double = 0.9)
    }

    let kind: ScanStrategyKind
    let supportsLiveScanning: Bool
    private let supportedModes: Set<ScanMode>
    private let behavior: Behavior
    private let recorder: ScanInvocationRecorder

    init(
        kind: ScanStrategyKind,
        supportsLiveScanning: Bool = false,
        supportedModes: Set<ScanMode> = [.pokemon],
        behavior: Behavior,
        recorder: ScanInvocationRecorder
    ) {
        self.kind = kind
        self.supportsLiveScanning = supportsLiveScanning
        self.supportedModes = supportedModes
        self.behavior = behavior
        self.recorder = recorder
    }

    func supports(_ mode: ScanMode) -> Bool {
        supportedModes.contains(mode)
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        source: ScanInvocationKind,
        apiService: APIService
    ) async throws -> CardScanResult? {
        recorder.record(kind)
        switch behavior {
        case .noMatch:
            return nil
        case .failure(let error):
            throw error
        case .match(let cardID, let setCode, let confidence):
            let candidate = CardScanCandidate(
                details: CardDetails(
                    identity: CardIdentity(
                        id: cardID,
                        name: cardID,
                        game: context.mode.tcgGame,
                        setCode: setCode,
                        setName: nil
                    ),
                    rarity: nil,
                    imageURL: nil,
                    price: nil
                ),
                confidence: CardScanConfidence(score: confidence, reason: "stub"),
                originatingStrategy: kind
            )
            return CardScanResult(
                mode: context.mode,
                capturedImage: image,
                primary: candidate,
                alternatives: [],
                elapsed: 0
            )
        }
    }
}

enum ScannerTestImage {
    static func solid(
        width: Int = 8,
        height: Int = 8,
        red: UInt8 = 32,
        green: UInt8 = 64,
        blue: UInt8 = 128
    ) -> CGImage {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 255, count: width * height * 4)
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            pixels[offset] = red
            pixels[offset + 1] = green
            pixels[offset + 2] = blue
        }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        )!
    }
}

extension CardScannerContext {
    static func test(
        mode: ScanMode = .pokemon,
        engine: ScanEnginePreference = .automatic,
        setCode: String? = nil
    ) -> CardScannerContext {
        CardScannerContext(
            mode: mode,
            enginePreference: engine,
            serverConfiguration: .onDevice,
            authToken: nil,
            showPricing: false,
            saveDebugCapture: false,
            captureNotes: nil,
            setCode: setCode
        )
    }
}
