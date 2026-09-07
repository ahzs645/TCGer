import XCTest
@testable import TCGer

@MainActor
final class LatestSearchRequestTests: XCTestCase {
    func testSupersededSuccessAndFailureCannotPublish() async {
        for fail in [false, true] {
            let requests = LatestSearchRequest()
            let started = expectation(description: "old request started")
            let latest = expectation(description: "latest result")
            let drained = expectation(description: "old request returned")
            var resume: CheckedContinuation<Void, Never>?
            var values: [Int] = []
            requests.run {
                await withCheckedContinuation { resume = $0; started.fulfill() }
                drained.fulfill()
                if fail { throw NSError(domain: "old", code: 1) }
                return 1
            } completion: { _ in XCTFail("Superseded request published") }
            await fulfillment(of: [started], timeout: 2)
            requests.run { 2 } completion: { result in
                if case .success(let value) = result { values.append(value) }
                latest.fulfill()
            }
            await fulfillment(of: [latest], timeout: 2)
            resume?.resume()
            await fulfillment(of: [drained], timeout: 2)
            await Task.yield()
            XCTAssertEqual(values, [2])
        }
    }

    func testCancelSuppressesPendingCompletionAndCurrentErrorIsReported() async {
        let requests = LatestSearchRequest()
        let reported = expectation(description: "current failure")
        requests.run { () -> Int in throw NSError(domain: "current", code: 42) } completion: { result in
            if case .failure(let error) = result { XCTAssertEqual((error as NSError).code, 42) }
            else { XCTFail("Expected current failure") }
            reported.fulfill()
        }
        await fulfillment(of: [reported], timeout: 2)
        requests.run { 1 } completion: { _ in XCTFail("Cancelled request published") }
        requests.cancel()
        await Task.yield()
    }
}
