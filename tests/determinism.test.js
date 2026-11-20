// Determinism: the same program traced twice in one process must
// produce byte-identical events and analysis. The patch counters
// (branch hashes, temp-variable names, $$ANON_ names) are
// module-level, so before the reset in Stage.patch the second trace
// of a program got different event hashes than the first — and
// analyze() embeds those hashes in its findings, so its output was
// not stable across calls in one process.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Iroh = require("../dist/iroh-node.js");

const PROG = "let s = 0;\nfor (let i = 0; i < 150; i++) { s += i; }\ns;";

test("trace events are identical across two traces in one process", () => {
  let first = Iroh.trace(PROG);
  let second = Iroh.trace(PROG);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test("trace events are identical even after tracing another program in between", () => {
  let first = Iroh.trace(PROG);
  Iroh.trace("function f(x) { if (x) { return 1; } return 0; } f(2);");
  Iroh.trace("let a = [1, 2, 3].map((x) => x * 2); a;");
  let again = Iroh.trace(PROG);
  assert.equal(JSON.stringify(again), JSON.stringify(first));
});

test("analyzeTrace output is identical across two calls in one process", () => {
  let first = Iroh.analyzeTrace(PROG);
  let second = Iroh.analyzeTrace(PROG);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  let hot = first.analysis.findings.find((f) => f.code === "HOT_LOOP");
  assert.ok(hot);
  assert.equal(hot.neuron.score, 0.0259);
});
