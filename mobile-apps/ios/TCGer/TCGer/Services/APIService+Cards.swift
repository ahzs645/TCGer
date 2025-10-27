import Foundation

extension APIService {
    func searchCards(
        config: ServerConfiguration,
        token: String,
        query: String,
        game: TCGGame = .all
    ) async throws -> CardSearchResponse {
        var path = "cards/search?query=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)"
        if game != .all {
            path += "&tcg=\(game.rawValue)"
        }

        let (data, response) = try await makeRequest(config: config, path: path, token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        let decoder = JSONDecoder.tcgCardDecoder
        guard let searchResponse = try? decoder.decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return searchResponse
    }

    func getCardPrints(
        config: ServerConfiguration,
        token: String,
        tcg: String,
        cardId: String
    ) async throws -> [Card] {
        let path = "cards/\(tcg)/\(cardId)/prints"

        let (data, response) = try await makeRequest(config: config, path: path, token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        struct PrintsResponse: Decodable {
            let prints: [Card]
        }

        let decoder = JSONDecoder.tcgCardDecoder
        guard let printsResponse = try? decoder.decode(PrintsResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return printsResponse.prints
    }
}

private extension JSONDecoder {
    static var tcgCardDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            let iso8601Formatter = ISO8601DateFormatter()
            if let isoDate = iso8601Formatter.date(from: dateString) {
                return isoDate
            }

            let dateFormatter = DateFormatter()
            dateFormatter.dateFormat = "yyyy-MM-dd"
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)

            if let date = dateFormatter.date(from: dateString) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date string \(dateString)"
            )
        }
        return decoder
    }
}
