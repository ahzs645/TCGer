import Foundation

#if DEBUG
struct CardPriceQuote: Equatable, Sendable {
    let source: String
    let price: Double
    let currency: String
}

protocol CardPriceProviding: Sendable {
    var name: String { get }

    func fetchPrice(tcg: String, externalID: String) async throws -> CardPriceQuote?
}

/// Parses captured or otherwise authorized Collectr-compatible product data.
///
/// The payload loader is injected deliberately. Collectr's catalog endpoint is
/// private and uses app/session-specific authentication, so TCGer does not
/// reproduce those headers or call it as a production dependency.
struct CollectrTestPriceProvider: CardPriceProviding {
    typealias PayloadLoader = @Sendable (_ tcg: String, _ externalID: String) async throws -> Data

    let name = "collectr-test"
    private let loadPayload: PayloadLoader

    init(loadPayload: @escaping PayloadLoader) {
        self.loadPayload = loadPayload
    }

    func fetchPrice(tcg: String, externalID: String) async throws -> CardPriceQuote? {
        let data = try await loadPayload(tcg, externalID)
        let payload = try JSONDecoder().decode(CollectrTestJSONValue.self, from: data)
        guard let product = payload.collectrProduct,
              let price = product["market_price"]?.positiveDouble else {
            return nil
        }

        let responseCurrency = product["currency"]?.stringValue?
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            .uppercased()
        let currency = responseCurrency.flatMap { $0.isEmpty ? nil : $0 } ?? "USD"

        return CardPriceQuote(
            source: name,
            price: price,
            currency: currency
        )
    }
}

private indirect enum CollectrTestJSONValue: Decodable, Sendable {
    case object([String: CollectrTestJSONValue])
    case array([CollectrTestJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode([String: CollectrTestJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([CollectrTestJSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    var objectValue: [String: CollectrTestJSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var positiveDouble: Double? {
        let value: Double?
        switch self {
        case .number(let number):
            value = number
        case .string(let string):
            value = Double(string.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines))
        default:
            value = nil
        }
        guard let value, value.isFinite, value > 0 else { return nil }
        return value
    }

    var collectrProduct: [String: CollectrTestJSONValue]? {
        guard var product = objectValue else { return nil }
        let wrapperKeys = ["data", "product", "product_details", "productDetails"]

        for _ in 0..<wrapperKeys.count {
            if product["market_price"] != nil {
                break
            }
            guard let nested = wrapperKeys.lazy.compactMap({ product[$0]?.objectValue }).first else {
                break
            }
            product = nested
        }
        return product
    }
}
#endif
