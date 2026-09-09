# Grading workspace implementation report — September 7, 2026

Implemented matching grading workspaces in web, SwiftUI, and Jetpack Compose. The workspace includes card-name lookup, exact-product market data, grader and half-grade options, decision calculations, fee inputs with quote references, population, history, offline saved scenarios, and actual paid-cost receipts.

Read [the capability matrix and limitations](grading-workspace-plan.md) for the precise scope. This is grading-workspace parity; it does not assert parity for all unrelated app features.

## Entry points

- Web: Prices → Grading planner (`/prices/grading`), and Collection operations → Grading planner. The demo has `/demo/prices/grading` and a link from demo Prices.
- iOS: Prices toolbar; Settings → Library Operations; and the no-game-library installation screen.
- Android: Prices → Grading planner; Settings → Library operations, including disconnected mode.

## Passed checks

| Check | Result |
| --- | --- |
| Shared API package build | Passed |
| Backend TypeScript | Passed |
| Web TypeScript | Passed |
| Backend grading tests | 13 passed |
| Android debug APK build | Passed |
| Android grading JUnit | Passed; exercises all 7 shared economic scenarios |
| iOS simulator build | Passed, including the no-library entry-point fix |
| iOS grading XCTest | Passed; exercises all 7 shared economic scenarios |
| Web Playwright | Passed: economics, fees, changing graders, missing data, population/history, restoring a scenario, and creating/restoring/deleting a receipt |
| Parity contract validation | Passed: 92 features / 108 controls |
| Patch whitespace check | Passed |

Scoped web lint reported no errors and one warning about restoring local storage into React state from an effect. Restoration intentionally happens after hydration so the server and first client render agree.

## Device UI verification

The first shared native Maestro flow did not reach the planner. On iOS, a clean install with no game library stopped at Game Libraries; a planner entry point was added to that screen and its build passed. Android's emulator displayed a System UI ANR, and the subsequent Maestro driver startup timed out. A later iOS simulator boot failed while the host disk was full. Task-created temporary build intermediates were removed to recover space; source files and built apps were preserved. A final iOS Maestro startup remained stalled after space was recovered and was stopped. Native flow reruns are tracked separately from the passing build and arithmetic checks; this feature remains `track` in the parity manifest instead of being promoted to fully device-verified parity.

## Live service and persistence limits

Live provider calls were tested with fixtures, not a production paid account. Live data requires the existing server-held Pokémon Price Tracker key and licensing acknowledgment; population access also depends on the provider plan. No deployment or provider settings were changed.

Saved scenarios and expense receipts are local to the current device/browser. Receipts record actual grading costs but do not automatically change collection acquisition cost, portfolio cost basis, or insurance reports. Grading-company service prices are entered from a quote rather than maintained as a live fee directory.
