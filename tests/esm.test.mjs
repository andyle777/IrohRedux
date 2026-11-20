// ESM import of the package itself (self-reference through the
// package.json "exports" map). The ESM bundle is dist/iroh-node.es.mjs —
// a .js extension made Node warn that the file "does not parse as
// CommonJS" and reparse it as ESM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Iroh from "iroh";

// The expected version comes from package.json, not a hardcoded
// string — a version bump (1.1.0 -> 1.1.1) used to break this test.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("ESM import resolves to the same SDK", () => {
  const { events, result } = Iroh.trace(
    "function f(n) { if (n === 0) return 1; return n * f(n - 1); } f(4);",
    { events: ["CALL"] }
  );
  assert.equal(result, 24);
  assert.ok(events.length > 0);
  assert.equal(Iroh.VERSION, version);
});
