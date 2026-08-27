# Cross-platform parity framework decision

TCGer keeps three native presentation stacks: Next.js/React for web, SwiftUI for
iOS, and Jetpack Compose for Android. Parity is therefore defined as a product
contract and verified at public UI boundaries; it is not inferred from shared
source code.

## Decision

Use a small declarative contract plus the strongest existing black-box runner
for each surface:

- [`features.json`](features.json) declares every capability, its policy,
  platform status, source evidence, test evidence, and temporary waivers.
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

1. Add the feature declaration and real source evidence in the same change as
   the implementation.
2. Use `track` while a capability is intentionally incomplete; use `parity`
   only after all three declarations are implemented and automated behavior is
   available.
3. Waivers require a reason, owner, and expiry date. They are temporary debt,
   not a way to claim implementation.
4. Add web Playwright evidence and a shared native Maestro flow for every new
   parity-required behavior.
5. Never regenerate or approve visual snapshots merely to make parity green;
   functional parity and visual regression remain separate signals.
