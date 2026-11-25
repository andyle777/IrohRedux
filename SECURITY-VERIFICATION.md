# Security verification

The repository's automated security workflow uses the public npm vulnerability advisory service and local server regression tests. It requires no APIsec account, credentials or project configuration.

Run locally with Node 24, Python 3 and the supported native toolchain:

```sh
npm ci
npm audit --audit-level=high
node --test tests/server.test.js
npm test
```

The audit includes development dependencies and fails on high or critical advisories; lower severity findings are reported by npm. Network or audit-service errors are failures, not passes. The workflow does not certify absence of vulnerabilities and does not perform external API penetration testing.

The server executes trusted code only. OS isolation, complete process-tree containment, encrypted transport and independently verified release artifacts remain separate deployment requirements.
