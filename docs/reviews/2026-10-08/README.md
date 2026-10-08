# TCGer review reports — October 8, 2026

This archive records the interface review, resulting fixes, stack upgrade and
dependency advisory follow-up. Checks were performed locally before the changes
were committed. The interface screenshots capture the earlier review; the stack
and advisory reports describe the subsequent fixes.

- [Mobile and desktop interface review (Word)](TCGer-Mobile-and-Desktop-Interface-Review.docx)
- [Mobile and desktop interface review (PDF)](TCGer-Mobile-and-Desktop-Interface-Review.pdf)
- [Stack upgrade and fixes (Word)](TCGer-Stack-Upgrade-and-Fixes.docx)
- [Dependency advisory review (Word)](TCGer-Dependency-Advisory-Review.docx)
- [Web performance and stack review (text)](Web-Performance-and-Stack-Review.txt)
- [Full dependency audit snapshot](dependency-audit-current.json)
- [Production omission audit snapshot](dependency-audit-production-current.json)
- [Resolved replacement versions](Dependency-Resolved-Versions.txt)

The final audit records 11 affected package entries from two underlying
advisories; the production omission audit records three moderate entries. See
the [dependency security review](../../dependency-security-review-2026-10-08.md)
for paths, exposure, replacements and follow-up options.

Production-host verification, full backend/Compose container qualification,
native Android UI, local Mac iOS execution and physical-device/model evidence
retain the gaps documented in the reports. These reports do not establish
release readiness or full cross-platform parity. Raw logs, session credentials,
private environment files, signing keys and generated application builds are
outside this archive.

The final static demo export was also rechecked with the local fonts and patched
dependencies before pushing to main. The deployed Pages host remains subject to
the workflow result and hosted checks.
