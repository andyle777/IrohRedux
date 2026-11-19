// ESM import of the package itself (self-reference through the
// package.json "exports" map). The ESM bundle is dist/iroh-node.es.mjs —
// a .js extension made Node warn that the file "does not parse as
// CommonJS" and reparse it as ESM.
import { test } from "node:test";
import assert from "node:assert/strict";
import Iroh from "iroh";

test("ESM import resolves to the same SDK", () => {
  const { events, result } = Iroh.trace(
    "function f(n) { if (n === 0) return 1; return n * f(n - 1); } f(4);",
    { events: ["CALL"] }
  );
  assert.equal(result, 24);
  assert.ok(events.length > 0);
  assert.equal(Iroh.VERSION, "0.7.0");
});
