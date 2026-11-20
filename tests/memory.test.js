// Tests for the 1.1.1 memory fix (M1): a finished trace releases its
// Stage — listeners detached, stage removed from Iroh.stages — so the
// recorded events are not retained after the caller drops them. Before
// the fix every Stage stayed registered forever (~137 bytes/event
// retained, unbounded in a long-lived process); the heap half of the
// guarantee lives in tests/memory-probe.cjs, run here as a child
// process with --expose-gc.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");

test("trace() releases its Stage: no stages remain after varied traces", () => {
  assert.equal(Object.keys(Iroh.stages).length, 0);
  let programs = [
    "let a = 1; a;",
    "function f(x) { return x * 2; } f(21);",
    "let s = 0; for (let i = 0; i < 10; i++) s += i; s;",
    "let o = { x: 1 }; o.x + 1;",
    "let arr = [1, 2, 3]; arr.map(v => v + 1);",
  ];
  for (let ii = 0; ii < programs.length; ++ii) {
    Iroh.trace(programs[ii]);
  }
  assert.equal(Object.keys(Iroh.stages).length, 0);
});

test("traceAsync() and direct() release their Stages too", async () => {
  await Iroh.traceAsync("let x = 1; x;");
  Iroh.direct("let y = 2; y;", () => []);
  assert.equal(Object.keys(Iroh.stages).length, 0);
});

test("a dropped 100k-event trace leaves almost no heap behind", () => {
  let probe = path.join(__dirname, "memory-probe.cjs");
  let out = execFileSync(process.execPath, ["--expose-gc", probe], { encoding: "utf8" });
  let result = JSON.parse(out.trim());
  assert.ok(result.events > 50000, "probe traced " + result.events + " events");
  assert.ok(
    result.residual < result.bound,
    "residual heap after drop+GC was " + result.residual + " bytes (bound " + result.bound + ")"
  );
});
