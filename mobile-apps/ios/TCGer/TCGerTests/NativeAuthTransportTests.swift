import Foundation
import XCTest
@testable import TCGer

@MainActor
final class NativeAuthTransportTests: XCTestCase {
    func testAuthenticationOriginUsesOnlyConfiguredSchemeHostAndPort() {
        XCTAssertEqual(ServerConfiguration(baseURL: "https://API.example.test:443/tcger/api/").authenticationOrigin, "https://api.example.test")
        XCTAssertEqual(ServerConfiguration(baseURL: "http://localhost:3004/api/").authenticationOrigin, "http://localhost:3004")
        XCTAssertEqual(ServerConfiguration(baseURL: "https://[2001:db8::1]:8443/api/").authenticationOrigin, "https://[2001:db8::1]:8443")
        XCTAssertEqual(ServerConfiguration(baseURL: "https://name:password@api.example.test/api?query=value#fragment").authenticationOrigin, "https://api.example.test")
        XCTAssertNil(ServerConfiguration.onDevice.authenticationOrigin)
    }

    func testSignInAndSignUpSendConfiguredApiOrigin() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeAuthURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); NativeAuthURLProtocol.handler = nil }
        var paths: [String] = []
        NativeAuthURLProtocol.handler = { request in
            let url = try XCTUnwrap(request.url)
            paths.append(url.path)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://api.example.test:8443")
            XCTAssertEqual(request.httpMethod, "POST")
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
            return (response, Data(#"{"token":"confirmed-token","user":{"id":"account","email":"collector@example.test","name":"Collector","username":"collector","isAdmin":false}}"#.utf8))
        }
        let api = APIService(session: session)
        let config = ServerConfiguration(baseURL: "https://api.example.test:8443/gateway/api/")
        let login = try await api.authenticate(config: config, credentials: LoginCredentials(username: "collector", password: "password"))
        let signup = try await api.signup(config: config, email: "collector@example.test", password: "password", username: "collector")
        XCTAssertEqual(login.token, "confirmed-token")
        XCTAssertEqual(signup.token, "confirmed-token")
        XCTAssertEqual(paths, ["/gateway/api/auth/sign-in/username", "/gateway/api/auth/sign-up/email"])
    }

    func testPasswordAndAccountAliasesSendOriginButProfilePatchDoesNot() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeAuthURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); NativeAuthURLProtocol.handler = nil }
        var paths: [String] = []
        NativeAuthURLProtocol.handler = { request in
            let url = try XCTUnwrap(request.url)
            paths.append("\(request.httpMethod ?? "") \(url.path)")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer account-token")
            if request.httpMethod == "PATCH" { XCTAssertNil(request.value(forHTTPHeaderField: "Origin")) }
            else { XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://api.example.test:8443") }
            return (try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"id":"account","email":"collector@example.test","username":"collector","isAdmin":false,"showCardNumbers":true,"showPricing":true}"#.utf8))
        }
        let api = APIService(session: session)
        let config = ServerConfiguration(baseURL: "https://api.example.test:8443/gateway/api/")
        try await api.changePassword(config: config, token: "account-token", currentPassword: "old", newPassword: "new")
        try await api.deleteServerAccount(config: config, token: "account-token", password: "new")
        _ = try await api.updateUserProfile(config: config, token: "account-token", username: "collector")
        XCTAssertEqual(paths, ["POST /gateway/api/users/me/change-password", "DELETE /gateway/api/users/me", "PATCH /gateway/api/users/me"])
    }

    func testNonAuthRequestsDoNotReceiveOriginAndAuthRejectionIsNotBypassed() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeAuthURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); NativeAuthURLProtocol.handler = nil }
        var authCalls = 0
        NativeAuthURLProtocol.handler = { request in
            let url = try XCTUnwrap(request.url)
            if url.path.hasSuffix("/health") {
                XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
                return (try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"status":"ok"}"#.utf8))
            }
            authCalls += 1
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://api.example.test")
            return (try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 403, httpVersion: nil, headerFields: nil)), Data(#"{"message":"Invalid origin"}"#.utf8))
        }
        let api = APIService(session: session)
        let config = ServerConfiguration(baseURL: "https://api.example.test/api")
        _ = try await api.getServerFeatures(config: config)
        do {
            _ = try await api.authenticate(config: config, credentials: LoginCredentials(username: "collector", password: "password"))
            XCTFail("Expected an origin rejection")
        } catch APIService.APIError.serverError(let status, _) { XCTAssertEqual(status, 403) }
        XCTAssertEqual(authCalls, 1)
    }
}

private final class NativeAuthURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
