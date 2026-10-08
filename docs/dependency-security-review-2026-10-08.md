# Dependency security review — 2026-10-08

The previous **35 affected package entries** represented **five underlying
advisories**, including the packages inheriting warnings from their dependencies.
Targeted replacements reduce that to **11 affected entries from two advisories**.
The production omission audit falls from **7 to 3 entries**, with no remaining
critical or high-severity production entries. This is a dependency audit, not a
claim that all deployment or application security risks have been eliminated.

| Audit | Before this follow-up | After this follow-up |
| --- | --- | --- |
| Complete workspace tree | 35: 10 high, 24 moderate, 1 low | 11: 7 high, 4 moderate |
| `npm audit --omit=dev` | 7: 3 high, 3 moderate, 1 low | 3: 3 moderate |
| Unique advisory IDs | 5 | 2 |
| Critical entries | 0 | 0 |

## Changes

Root `package.json` overrides and the canonical workspace lock implement these
replacements. Main framework and database versions remain Next.js 16.4.0 and
Prisma 6.19.3.

| Underlying advisory / dependency | Replacement and qualification |
| --- | --- |
| [DeepmergeTS recursive-object stack exhaustion](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), high | Prisma config's `deepmerge-ts` 7.1.5 → 8.0.2. Prisma config loading, schema validation, client generation, backend compilation, and backend tests pass. No database migration or production database access was performed. |
| [PostCSS selector-parser quadratic parsing](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), moderate | `postcss-selector-parser` 6.1.4 → 7.1.6 for Tailwind and PostCSS Nested. The production web build passes. |
| [esbuild Windows development-server file access](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr), low | A version-scoped override replaces affected 0.27.3–0.28.0 releases with 0.28.2. Vite, pack-core, tsx and Wrangler resolve the patched version. Convex's 0.27.0 is outside this advisory's range and is retained. Convex tests and the actual pricing-worker bundle tests pass. |
| Legacy YAML → argparse → sprintf chain in Jest coverage tooling | NYC's old YAML dependency now resolves `js-yaml` 4.3.2. Its `load` API remains supported. YAML config loading with `extends` and the backend test suite pass. This removes the repeated Jest/coverage warnings arising from the sprintf advisory below. |

Use **npm 11.19.0**, as recorded in `packageManager`. npm 11.9 fails the frozen
installation check because it does not consistently apply workspace overrides.
Local instructions, all six root workspace installation steps in CI, and the
three application Docker recipes now select npm 11.19.0. No blanket lifecycle
script permission or forced audit downgrade was added.

## Remaining advisories

### braces — high, seven affected development package entries

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
describes stack exhaustion from deeply nested brace patterns. The current latest
release, **3.0.3**, is still affected; no upstream patched release was available
when checked.

The seven entries are `braces`, `micromatch`, `fast-glob`, `chokidar`,
`tailwindcss`, `@next/eslint-plugin-next`, and `eslint-config-next`. These paths
are used for building, watching and linting source. Tailwind content patterns in
this repository are fixed configuration. No application route accepting brace
patterns was identified. They disappear from the production omission audit,
but development and build tooling remains affected and should process trusted
source/configuration.

Follow up when braces publishes a patch, or when both Tailwind and Next's lint
tooling remove this dependency. A Tailwind 4 migration alone does not clear the
Next lint chain. npm's suggestion to downgrade Next's ESLint configuration was
not applied.

### sprintf-js — moderate, four affected entries; three in production audit

[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
describes denial of service through unbounded precision in format strings. The
installed legacy version is **1.0.3**; latest **1.1.3** is also affected and has
no upstream patch.

The remaining chain is `@tensorflow/tfjs` → `argparse` 1.0.10 → `sprintf-js`.
Development-only `@tensorflow/tfjs-node` is the fourth affected entry. The web
scanner needs TensorFlow; its native counterpart supports existing offline
tools. Removing TensorFlow to silence the warning would remove functionality.

Searching the installed TensorFlow package found no argparse import outside
package dependency metadata, and an actual tensor execution did not load
argparse or sprintf-js. No application import or request path exposing their
formatting functions was identified. This lowers the observed exposure; it
does not erase the installed dependency finding or establish scanner/model
accuracy. Do not feed untrusted format strings to these packages.

Follow up on a patched sprintf release or a TensorFlow release dropping the
obsolete CLI dependency. Replacing umbrella TensorFlow imports with modular
packages is another possible migration, but requires separate scanner
qualification. An argparse major override was not applied because its CLI API
changes and it would substitute an unsupported dependency solely to clear the
audit.

## Verification and limits

- Fresh scoped workspace `npm ci` using npm 11.19.0 passes with lifecycle scripts
  disabled for the disposable dependency-only fixture; resolved dependency
  inspection reports the four replacements without invalid versions. The full
  workspace frozen-install dry run also passes.
- Frontend: 184 unit checks. Backend: 270 checks across 51 suites. Convex: 135
  checks across 25 files. Pricing worker: 15 checks against its actual bundle.
- Frontend production build, backend generation/build and Convex type checking
  pass. Pack-core asset verification and type checking pass.
- JavaScript API/health checks: 94 pass. Convex API checks: 39 pass. Shared
  contracts remain valid for 44 interactions, 116 features and 115 controls.
- Prisma loads an explicit config and validates the existing schema without
  connecting to a database. NYC loads a YAML config and its extended YAML file.
- Native ONNX CPU inference, Sharp crop/resize, native TensorFlow tensor math
  with the offline tools' existing Node compatibility shim, and tar extraction
  pass. These are runtime smoke checks, not recognition-accuracy evidence.
- The two remaining advisories were checked against current npm release
  metadata. Audit totals can change as new advisories are published.
- The updated production frontend Docker image builds with npm 11.19.0 and
  passes all 42 desktop/mobile Chromium workflows. It runs as UID 1000, measures
  548,993,833 bytes, and contains no braces, argparse or sprintf-js package
  directories or dotenv files in its traced server filesystem. Health, the
  existing authenticated session and Android association JSON return 200. This does not
  change the complete dependency-tree audit totals above.
- The first Docker rebuild exhausted this environment's filesystem. Removing
  completed audit artifacts and selected, unused caches from earlier audit
  builds allowed a successful rebuild. As in the prior qualification, the
  temporary Dockerfile uses BuildKit's bundled frontend by removing only the
  optional syntax-image directive; recipe instructions are unchanged.

The final static demo export also passes with local fonts and the patched
dependencies in an isolated source snapshot, qualifying the export used by the
Pages workflow. This does not verify the deployed host.

Checks were executed against the local checkout before committing. Production
hosting, real-host backup/restore,
native Android UI and iOS execution retain the earlier verification gaps.
