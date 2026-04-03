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

    struct ScanMetaResponse: Decodable, Sendable {
        let quality: Double?
        let thresholdUsed: Int?
        let variantUsed: String?
        let variantsTried: [String]?
        let perspectiveCorrected: Bool?
        let contourAreaRatio: Double?
    }

    struct ScanImageResponse: Decodable, Sendable {
        let match: ScanMatchResponse?
        let candidates: [ScanMatchResponse]
        let meta: ScanMetaResponse?
    }

    func scanCardImage(
        config: ServerConfiguration,
        token: String,
        imageData: Data,
        tcg: TCGGame
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
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"scan.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
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
}
