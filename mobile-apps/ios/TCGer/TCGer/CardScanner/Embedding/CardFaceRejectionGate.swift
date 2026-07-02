import Foundation

/// Open-set rejection gate: a logistic head trained on the same L2-normalized
/// DINOv2 embedding the CoreML encoder produces (backend
/// `train-rejection-gate.ts`, artifact bundled as `CardFaceGate.json`).
///
/// Crops that score below the threshold are packs / card backs / hands / bad
/// crops; matching them against the index would just return the nearest wrong
/// card. Runtime cost: one dot product over the embedding.
struct CardFaceRejectionGate {
    private struct Artifact: Decodable {
        let model: String?
        let dimension: Int?
        let weights: [Double]
        let bias: Double
        let recommendedThreshold: Double?
    }

    let weights: [Double]
    let bias: Double
    let threshold: Double

    /// Loads the bundled gate artifact. Returns nil when the artifact is
    /// missing or malformed — callers must treat that as "gate disabled",
    /// never as rejection.
    static func loadBundled(
        resource: String = "CardFaceGate",
        bundle: Bundle = .main
    ) -> CardFaceRejectionGate? {
        guard let url = bundle.url(forResource: resource, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let artifact = try? JSONDecoder().decode(Artifact.self, from: data),
              !artifact.weights.isEmpty
        else {
            return nil
        }
        return CardFaceRejectionGate(
            weights: artifact.weights,
            bias: artifact.bias,
            threshold: artifact.recommendedThreshold ?? 0.5
        )
    }

    /// Card-face probability (sigmoid of w·e + b) for an L2-normalized
    /// embedding. Returns nil on dimension mismatch (stale gate vs a swapped
    /// encoder) so callers skip gating instead of rejecting arbitrarily.
    func cardFaceScore(for embedding: [Float]) -> Double? {
        guard embedding.count == weights.count else { return nil }
        var z = bias
        for index in 0..<weights.count {
            z += weights[index] * Double(embedding[index])
        }
        return 1 / (1 + exp(-z))
    }

    /// True when the embedding should be rejected as a non-card-face crop.
    func rejects(_ embedding: [Float]) -> Bool {
        guard let score = cardFaceScore(for: embedding) else { return false }
        return score < threshold
    }
}
