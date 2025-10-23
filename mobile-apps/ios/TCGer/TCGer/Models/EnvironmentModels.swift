import Foundation

struct ServerConfiguration: Codable, Equatable {
    var scheme: String = "http"
    var host: String = ""
    var port: String = ""

    var baseURLString: String {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host.isEmpty ? nil : host
        components.port = Int(port)
        return components.string ?? ""
    }

    var isValid: Bool {
        !host.isEmpty && Int(port) != nil && URL(string: baseURLString) != nil
    }

    static let empty = ServerConfiguration()
}

struct LoginCredentials: Codable, Equatable {
    var email: String = ""
    var password: String = ""

    var isComplete: Bool {
        !email.isEmpty && !password.isEmpty
    }

    static let empty = LoginCredentials()
}
