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
