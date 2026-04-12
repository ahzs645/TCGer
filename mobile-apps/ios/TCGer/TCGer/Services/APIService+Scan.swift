import Foundation

extension APIService {
    struct ScanMatchResponse: Decodable, Sendable {
        let externalId: String
        let tcg: TCGGame
        let name: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let imageUrl: String?
        let confidence: Double
        let distance: Int

        private enum CodingKeys: String, CodingKey {
            case externalId
            case tcg
            case name
            case setCode
            case setName
            case rarity
            case imageUrl
            case confidence
            case distance
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            externalId = try container.decode(String.self, forKey: .externalId)
            let tcgRawValue = try container.decode(String.self, forKey: .tcg)
            tcg = TCGGame(rawValue: tcgRawValue) ?? .all
            name = try container.decode(String.self, forKey: .name)
            setCode = try container.decodeIfPresent(String.self, forKey: .setCode)
            setName = try container.decodeIfPresent(String.self, forKey: .setName)
            rarity = try container.decodeIfPresent(String.self, forKey: .rarity)
            imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
            confidence = try container.decode(Double.self, forKey: .confidence)
            distance = try container.decode(Int.self, forKey: .distance)
        }
    }

    struct ScanQualityResponse: Decodable, Sendable {
        let score: Double?
        let focusVariance: Double?
        let edgeDensity: Double?
        let contrast: Double?
    }

    struct ScanPointResponse: Decodable, Sendable {
        let x: Double
        let y: Double
    }

    struct ScanTimingMetricsResponse: Decodable, Sendable {
        let preprocessMs: Double?
        let perspectiveCorrectionMs: Double?
        let qualityMs: Double?
        let hashMs: Double?
        let featureHashMs: Double?
        let rankingMs: Double?
        let artworkPrefilterMs: Double?
        let artworkRerankMs: Double?
        let ocrMs: Double?
        let totalMs: Double?
    }

    struct ScanMetaResponse: Decodable, Sendable {
        let engine: String?
        let quality: ScanQualityResponse?
        let thresholdUsed: Int?
        let variantUsed: String?
        let variantsTried: [String]?
        let perspectiveCorrected: Bool?
        let contourAreaRatio: Double?
        let contourConfidence: Double?
        let rotationAngle: Double?
        let cropAspectRatio: Double?
        let cropWidth: Double?
        let cropHeight: Double?
        let cropCandidateScore: Double?
        let contourPoints: [ScanPointResponse]?
        let maskVariant: String?
        let rerankUsed: Bool?
        let shortlistSize: Int?
        let timings: ScanTimingMetricsResponse?
    }

    struct ScanDiagnosticCandidateResponse: Decodable, Sendable {
        let externalId: String
        let tcg: String
        let name: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let imageUrl: String?
        let confidence: Double
        let distance: Int
        let scoreDistance: Double
        let passedThreshold: Bool
    }

    struct ScanArtworkDiagnosticResponse: Decodable, Sendable {
        let externalId: String
        let name: String
        let setCode: String?
        let similarity: Double
    }

    struct ScanAttemptDiagnosticResponse: Decodable, Sendable {
        let variant: String
        let threshold: Int
        let hashMs: Double
        let featureHashMs: Double
        let rankingMs: Double
        let rerankUsed: Bool
        let shortlistSize: Int
        let acceptedCandidates: [ScanDiagnosticCandidateResponse]
        let rejectedNearMisses: [ScanDiagnosticCandidateResponse]
    }

    struct ScanDatasetRevisionResponse: Decodable, Sendable {
        let path: String
        let version: Int?
        let total: Int?
        let sizeBytes: Int?
        let modifiedAt: String
        let revision: String
    }

    struct ScanPipelineSnapshotResponse: Decodable, Sendable {
        struct BuildResponse: Decodable, Sendable {
            let gitSha: String?
            let imageTag: String?
            let backendMode: String?
        }

        struct MatcherResponse: Decodable, Sendable {
            let phashVersion: String
            let artworkVersion: String
            let featureHashVersion: String
            let detectorModelVersion: String?
            let ocrModelVersion: String?
        }

        struct HashDatabaseResponse: Decodable, Sendable {
            let storeMode: String
            let dataset: ScanDatasetRevisionResponse?
        }

        struct ArtworkDatabaseResponse: Decodable, Sendable {
            let dataset: ScanDatasetRevisionResponse?
        }

        let build: BuildResponse
        let matcher: MatcherResponse
        let hashDatabase: HashDatabaseResponse
        let artworkDatabase: ArtworkDatabaseResponse
    }

    struct ScanArtifactImagesResponse: Decodable, Sendable {
        let correctedImagePath: String?
        let correctedImageUrl: String?
        let artworkImagePath: String?
        let artworkImageUrl: String?
        let titleImagePath: String?
        let titleImageUrl: String?
        let footerImagePath: String?
        let footerImageUrl: String?
    }

    struct ScanArtworkDiagnosticsResponse: Decodable, Sendable {
        let prefilterApplied: Bool
        let prefilterTopMatches: [ScanArtworkDiagnosticResponse]
        let rerankTopMatches: [ScanArtworkDiagnosticResponse]
    }

    struct ScanOCRCandidateResponse: Decodable, Sendable {
        let text: String
        let confidence: Double
    }

    struct ScanOCRDiagnosticsResponse: Decodable, Sendable {
        let attempted: Bool
        let durationMs: Double?
        let candidates: [ScanOCRCandidateResponse]
    }

    struct ScanGeometryResponse: Decodable, Sendable {
        let perspectiveCorrected: Bool?
        let contourAreaRatio: Double?
        let contourConfidence: Double?
        let rotationAngle: Double?
        let cropAspectRatio: Double?
        let cropWidth: Double?
        let cropHeight: Double?
        let cropCandidateScore: Double?
        let contourPoints: [ScanPointResponse]
        let maskVariant: String?
    }

    struct ScanDiagnosticsResponse: Decodable, Sendable {
        let timings: ScanTimingMetricsResponse?
        let attempts: [ScanAttemptDiagnosticResponse]
        let rejectedNearMisses: [ScanDiagnosticCandidateResponse]
        let artwork: ScanArtworkDiagnosticsResponse?
        let ocr: ScanOCRDiagnosticsResponse?
        let geometry: ScanGeometryResponse?
    }

    struct ScanDebugBestMatchResponse: Decodable, Sendable {
        let externalId: String
        let name: String?
        let tcg: String?
        let confidence: Double?
        let distance: Double?
    }

    struct ScanDebugCaptureResponse: Decodable, Sendable, Identifiable {
        let id: String
        let requestedTcg: String?
        let captureSource: String?
        let sourceImagePath: String
        let sourceImageUrl: String
        let feedbackStatus: CardScanDebugFeedbackStatus
        let reviewTags: [CardScanReviewTag]
        let notes: String?
        let expectedExternalId: String?
        let expectedName: String?
        let expectedTcg: String?
        let reviewedAt: String?
        let createdAt: String
        let updatedAt: String
        let artifactImages: ScanArtifactImagesResponse
        let pipeline: ScanPipelineSnapshotResponse?
        let diagnostics: ScanDiagnosticsResponse?
        let bestMatch: ScanDebugBestMatchResponse?

        private enum CodingKeys: String, CodingKey {
            case id
            case requestedTcg
            case captureSource
            case sourceImagePath
            case sourceImageUrl
            case feedbackStatus
            case reviewTags
            case notes
            case expectedExternalId
            case expectedName
            case expectedTcg
            case reviewedAt
            case createdAt
            case updatedAt
            case artifactImages
            case pipeline
            case diagnostics
            case bestMatch
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            requestedTcg = try container.decodeIfPresent(String.self, forKey: .requestedTcg)
            captureSource = try container.decodeIfPresent(String.self, forKey: .captureSource)
            sourceImagePath = try container.decode(String.self, forKey: .sourceImagePath)
            sourceImageUrl = try container.decode(String.self, forKey: .sourceImageUrl)

            let feedbackRaw = try container.decodeIfPresent(String.self, forKey: .feedbackStatus)
            feedbackStatus = feedbackRaw.flatMap(CardScanDebugFeedbackStatus.init(rawValue:)) ?? .unreviewed

            let rawTags = try container.decodeIfPresent([String].self, forKey: .reviewTags) ?? []
            reviewTags = rawTags.compactMap(CardScanReviewTag.init(rawValue:))

            notes = try container.decodeIfPresent(String.self, forKey: .notes)
            expectedExternalId = try container.decodeIfPresent(String.self, forKey: .expectedExternalId)
            expectedName = try container.decodeIfPresent(String.self, forKey: .expectedName)
            expectedTcg = try container.decodeIfPresent(String.self, forKey: .expectedTcg)
            reviewedAt = try container.decodeIfPresent(String.self, forKey: .reviewedAt)
            createdAt = try container.decode(String.self, forKey: .createdAt)
            updatedAt = try container.decode(String.self, forKey: .updatedAt)
            artifactImages = try container.decode(ScanArtifactImagesResponse.self, forKey: .artifactImages)
            pipeline = try container.decodeIfPresent(ScanPipelineSnapshotResponse.self, forKey: .pipeline)
            diagnostics = try container.decodeIfPresent(ScanDiagnosticsResponse.self, forKey: .diagnostics)
            bestMatch = try container.decodeIfPresent(ScanDebugBestMatchResponse.self, forKey: .bestMatch)
        }
    }

    struct ScanImageResponse: Decodable, Sendable {
        let match: ScanMatchResponse?
        let candidates: [ScanMatchResponse]
        let meta: ScanMetaResponse?
        let debugCapture: ScanDebugCaptureResponse?
        let debugCaptureError: String?
    }

    private struct ScanDebugCaptureEnvelope: Decodable, Sendable {
        let capture: ScanDebugCaptureResponse
    }

    private struct ScanDebugCaptureListEnvelope: Decodable, Sendable {
        let captures: [ScanDebugCaptureResponse]
    }

    private struct ScanDebugCaptureUpdateRequest: Encodable {
        let feedbackStatus: CardScanDebugFeedbackStatus?
        let reviewTags: [CardScanReviewTag]?
        let notes: String?
    }

    func scanCardImage(
        config: ServerConfiguration,
        token: String,
        imageData: Data,
        tcg: TCGGame,
        scanEngine: String? = nil,
        saveDebugCapture: Bool = false,
        captureSource: String? = nil,
        captureNotes: String? = nil
    ) async throws -> ScanImageResponse {
        var path = "cards/scan"
        if tcg != .all {
            path += "?tcg=\(tcg.rawValue)"
        }

        guard let url = config.endpoint(path: path) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.addValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        if saveDebugCapture {
            appendMultipartField(named: "saveDebugCapture", value: "1", to: &body, boundary: boundary)
        }
        if let scanEngine, !scanEngine.isEmpty {
            appendMultipartField(named: "scanEngine", value: scanEngine, to: &body, boundary: boundary)
        }
        if let captureSource, !captureSource.isEmpty {
            appendMultipartField(named: "captureSource", value: captureSource, to: &body, boundary: boundary)
        }
        if let captureNotes {
            let trimmedNotes = captureNotes.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedNotes.isEmpty {
                appendMultipartField(named: "captureNotes", value: trimmedNotes, to: &body, boundary: boundary)
            }
        }
        appendMultipartFile(
            named: "image",
            filename: "scan.jpg",
            mimeType: "image/jpeg",
            data: imageData,
            to: &body,
            boundary: boundary
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await execute(request)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let result = try? JSONDecoder().decode(ScanImageResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return result
    }

    func updateScanDebugCapture(
        config: ServerConfiguration,
        token: String,
        captureId: String,
        feedbackStatus: CardScanDebugFeedbackStatus? = nil,
        reviewTags: [CardScanReviewTag]? = nil,
        notes: String? = nil
    ) async throws -> ScanDebugCaptureResponse {
        let payload = ScanDebugCaptureUpdateRequest(
            feedbackStatus: feedbackStatus,
            reviewTags: reviewTags,
            notes: notes
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/scan/debug-captures/\(captureId)",
            method: "PATCH",
            token: token,
            body: payload
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let envelope = try? JSONDecoder().decode(ScanDebugCaptureEnvelope.self, from: data) else {
            throw APIError.decodingError
        }

        return envelope.capture
    }

    func listScanDebugCaptures(
        config: ServerConfiguration,
        token: String,
        limit: Int = 12
    ) async throws -> [ScanDebugCaptureResponse] {
        let cappedLimit = max(1, min(50, limit))
        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/scan/debug-captures?limit=\(cappedLimit)",
            method: "GET",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let envelope = try? JSONDecoder().decode(ScanDebugCaptureListEnvelope.self, from: data) else {
            throw APIError.decodingError
        }

        return envelope.captures
    }

    private func appendMultipartField(
        named name: String,
        value: String,
        to body: inout Data,
        boundary: String
    ) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(value)\r\n".data(using: .utf8)!)
    }

    private func appendMultipartFile(
        named name: String,
        filename: String,
        mimeType: String,
        data: Data,
        to body: inout Data,
        boundary: String
    ) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
    }
}
