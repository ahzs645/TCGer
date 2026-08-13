import Foundation
import XCTest
@testable import TCGer

final class NotificationAPITests: XCTestCase {
    override func tearDown() {
        NotificationURLProtocol.handler = nil
        super.tearDown()
    }

    func testFetchDecodesActivityAndSendsAuthorization() async throws {
        NotificationURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/notifications")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            return try Self.response(
                request: request,
                status: 200,
                body: #"[{"id":"notification-1","userId":"user-1","type":"trade_request","title":"New Trade Request","body":"A collector proposed a trade.","read":false,"data":{"tradeId":"trade-1"},"createdAt":"2026-08-13T12:34:56.123Z"}]"#
            )
        }

        let notifications = try await makeService().getNotifications(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "test-token"
        )

        let notification = try XCTUnwrap(notifications.first)
        XCTAssertEqual(notification.category, .trade)
        XCTAssertFalse(notification.read)
        XCTAssertNotNil(notification.createdDate)
    }

    func testMarkReadUsesEscapedIdentifierAndPatch() async throws {
        NotificationURLProtocol.handler = { request in
            XCTAssertTrue(request.url?.absoluteString.hasSuffix("/notifications/notification%2F1/read") == true)
            XCTAssertEqual(request.httpMethod, "PATCH")
            return try Self.response(
                request: request,
                status: 200,
                body: #"{"id":"notification/1","userId":"user-1","type":"price_alert","title":"Price changed","body":"A card moved.","read":true,"data":null,"createdAt":"2026-08-13T12:34:56Z"}"#
            )
        }

        let notification = try await makeService().markNotificationRead(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "test-token",
            notificationID: "notification/1"
        )

        XCTAssertTrue(notification.read)
        XCTAssertEqual(notification.category, .price)
    }

    func testMarkAllReadPostsToBulkEndpoint() async throws {
        NotificationURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/notifications/read-all")
            XCTAssertEqual(request.httpMethod, "POST")
            return try Self.response(request: request, status: 200, body: #"{"success":true}"#)
        }

        try await makeService().markAllNotificationsRead(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "test-token"
        )
    }

    func testServerFailureSurfacesMessage() async throws {
        NotificationURLProtocol.handler = { request in
            try Self.response(
                request: request,
                status: 503,
                body: #"{"error":"Notifications are unavailable"}"#
            )
        }

        do {
            _ = try await makeService().getNotifications(
                config: ServerConfiguration(baseURL: "https://example.test"),
                token: "test-token"
            )
            XCTFail("Expected a server error")
        } catch APIService.APIError.serverError(let status, let message) {
            XCTAssertEqual(status, 503)
            XCTAssertEqual(message, "Notifications are unavailable")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeService() -> APIService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NotificationURLProtocol.self]
        return APIService(session: URLSession(configuration: configuration))
    }

    private static func response(
        request: URLRequest,
        status: Int,
        body: String
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )
        )
        return (response, Data(body.utf8))
    }
}

private final class NotificationURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
