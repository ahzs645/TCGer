# Cross-platform parity framework decision

TCGer keeps three native presentation stacks: Next.js/React for web, SwiftUI for
iOS, and Jetpack Compose for Android. Parity is therefore defined as a product
contract and verified at public UI boundaries; it is not inferred from shared
source code.

## Decision

Use a small declarative contract plus the strongest existing black-box runner
for each surface:

- [`features.definitions.json`](features.definitions.json) owns capability policy
  and source/test bindings. Platform implementation files own support status,
  operating modes, requirements, limitations, and waivers through checked source
  registrations. The compiler joins these into [`features.json`](features.json).
- The generator emits typed feature and control IDs for TypeScript, Swift, and
  Kotlin, preventing test selectors and application identifiers from drifting.
- [Maestro](https://docs.maestro.dev/) runs the same declarative YAML flows on
  iOS and Android.
- [Playwright](https://playwright.dev/docs/test-annotations) runs focused web
  behavior checks whose titles carry the same feature IDs.
- All runners emit JUnit. The parity reporter joins results by feature ID and
  only marks a parity-required feature `Verified` when every platform passes.
- CI validates the manifest, generated files, all three suites, and publishes
  one matrix in the GitHub job summary.

This approach lets each app remain idiomatic while giving the repository one
machine-readable answer to “does this feature exist, and was its behavior
actually exercised?”

## Frameworks considered

### Maestro for all three surfaces

Maestro now supports desktop web with the same YAML syntax as mobile, which is
attractive for a single runner. Its [web support is still Beta and currently
Chromium-only](https://docs.maestro.dev/platform-support/web-desktop-browser),
so it is retained for the two native apps while the mature existing Playwright
suite remains authoritative for web.

### Appium

[Appium](https://appium.io/docs/en/3.0/intro/) provides a common WebDriver-style
automation API across mobile, web, and desktop. It is a viable alternative for
teams already invested in WebDriver, but it would replace the simpler native
Maestro flows and still would not provide the feature inventory, source
evidence, waiver policy, or generated IDs needed here.

### Cucumber/Gherkin

[Cucumber](https://cucumber.io/docs/gherkin/reference/) provides readable,
executable specifications. It could sit above platform-specific step
definitions, but maintaining three glue layers would add indirection without
solving implementation discovery. The concise Maestro flows already serve as
the shared native behavioral specification.

### Pact

[Pact](https://docs.pact.io/) is valuable for consumer/provider API contracts.
It should be added if API compatibility becomes a parity risk, but it cannot
verify that a screen, camera workflow, model selector, pack mode, or debug
control exists and behaves consistently.

### FeatureIDE

[FeatureIDE](https://featureide.github.io/) models and analyses software product
lines and feature combinations. TCGer has three clients of one product rather
than a generated family of configurable products, so its Eclipse/product-line
workflow is substantially heavier than the JSON contract needed for this
repository.

## Rules for future changes

1. Add the source registration, product definition, and real source/test
   evidence in the same change as the implementation. Run `parity:generate`
   and `parity:check`; generated contracts and application metadata are checked
   for drift. Use `parity:impact` to review affected features and uncovered paths.
2. Use `track` while a capability is intentionally incomplete; use `parity`
   only after all three declarations are implemented and automated behavior is
   available.
3. Waivers require a reason, owner, and expiry date. They are temporary debt,
   not a way to claim implementation.
4. Add web Playwright evidence and a shared native Maestro flow for every new
   parity-required behavior.
5. Never regenerate or approve visual snapshots merely to make parity green;
   functional parity and visual regression remain separate signals.

## Comparable approaches in other projects

Reviewed on 2026-10-03 using the projects' own source and documentation. These
examples address different layers of compatibility; the TCGer recommendations
below are our interpretation of how their patterns fit this repository.

| Project | What it does | Application to TCGer |
| --- | --- | --- |
| [Rust compiler feature declarations](https://github.com/rust-lang/rust/blob/main/compiler/rustc_feature/src/accepted.rs) | Source declarations carry feature names, stabilization versions, and optional tracking issue numbers; a macro builds the compiler's accepted-feature table. | Keep stable capability identities and implementation metadata in checked source. Our declarations generate typed tables across three languages; they do not control compiler gates. |
| [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/schemas/compat-data-schema.md) | Structured per-browser records include support versions, flags, implementation issue links, and explanatory notes. Partial implementations require a note describing the divergence. | Record the precise missing behavior and prerequisites for each surface. Our required limitations follow this pattern. Release-version history and structured issue links are possible extensions, not current fields. |
| [Flutter federated plugins](https://docs.flutter.dev/packages-and-plugins/developing-packages#federated-plugins) | A common platform interface connects independently registered platform implementations to the app-facing API. | Define the capability contract once while letting platform implementations remain idiomatic. TCGer's metadata contract describes support; it does not enforce a shared runtime API or require a Flutter migration. |
| [Pact consumer/provider contracts](https://docs.pact.io/getting_started/how_pact_works) | Consumer tests write interaction contracts; provider verification checks the API's responses against those contracts. | Add executable API compatibility coverage if web and native clients drift in their requests or response expectations. Keep UI parity assertions alongside it, since API compatibility alone cannot verify the user workflow. |

### What to keep and what to extend

Keep the current combination: source-owned support declarations, one product
inventory, generated IDs/metadata, and behavior evidence linked by feature ID.
It applies the useful patterns above without replacing the three app stacks.
The root [agent instructions](../AGENTS.md) make maintaining these records part
of every capability change.

Shared [API interactions and consumer/provider tests](api-contracts/README.md)
now cover binder browsing, binder creation, and exhaustive card search through
the real client APIs. Express routes and Convex HTTP actions verify the same
fixtures, within their documented isolation boundaries. This uses the existing
Vitest, XCTest, and JUnit tooling; Pact and a contract broker have not been added.

If release support needs to be tracked, add explicit version and issue-link
fields to the schemas, source compiler, generators, and checks in one change.
Release-version history is still a future extension.

Declarations still require review: path coverage cannot automatically discover
every missing capability, and generated tables do not prove behavior. Passing
equivalent tests on each required surface remains the basis for verification.
