# IrohRedux 1.2.1 — OmniBridge

Base: 78a5fc5065fbb5d733315c9defd9a4f25f5931b0 (PR #32). Maintenance sources:

- 1.0.1-patch: d39715df9c30b13d6aa3034c6050e4d87a74898d
- 1.1.0-patch: 0814ebecea47d15f505c51a5a5bd25e6c0d6bdae
- 1.1.1-patch: 20b5696619e70b94b28bdc84c9f2067898ba2ef4

Forward-port the shared native bounds from 1.0.1/1.1.0; retain newer engine and shared 1.1.1 hardening, Node capability tests, catalog and credential-free security. This is selective integration, not a literal merge or proof of every historical behavior. No historical artifacts overwritten. Full CI, provider tests and release validation remain required.
