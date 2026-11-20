// Property-based tests (1.1.1, B1): fast-check properties over the
// engine. Generators are small and deterministic — fixed seeds, so a
// failure reproduces — and run counts are small (the suite must stay
// fast: each run traces one or two small programs).
//
// 1. Trace determinism over randomly generated small programs.
// 2. Scan/analyze agreement: scan findings are a subset of analyze
//    findings, and the scan event count equals the event count.
// 3. Translate round-trip: a generated pure arithmetic function
//    JS -> Python -> JS returns the same value as the original on
//    sampled inputs (skipped when python3 is unavailable).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const fc = require("fast-check");
const Iroh = require("../dist/iroh-node.js");

function has(cmd) {
  try {
    execSync("command -v " + cmd, { stdio: "ignore", shell: true });
    return true;
  } catch (e) {
    return false;
  }
}
const HAS_PYTHON = has("python3");

// --- Generators -------------------------------------------------------
// Expressions over s, t and small literals. No division by a variable
// (a zero divisor is NaN/Infinity, not an error, but it makes the
// round-trip property vacuous), no property access, no calls —
// everything generated here terminates and never throws.
const intLit = fc.integer({ min: 0, max: 9 });
const varName = fc.constantFrom("s", "t");
const binOp = fc.constantFrom("+", "-", "*");

function exprArb(depth) {
  if (depth <= 0) {
    return fc.oneof(intLit.map(String), varName);
  }
  return fc.oneof(
    intLit.map(String),
    varName,
    fc
      .tuple(exprArb(depth - 1), binOp, exprArb(depth - 1))
      .map(([l, op, r]) => "(" + l + " " + op + " " + r + ")")
  );
}

function stmtArb() {
  return fc.oneof(
    // Accumulate into s or t.
    fc
      .tuple(fc.constantFrom("s", "t"), exprArb(1))
      .map(([v, e]) => v + " = " + v + " + (" + e + ");"),
    // One-sided if/else.
    fc
      .tuple(exprArb(1), fc.constantFrom("<", ">", "===", "!=="), exprArb(1))
      .map(
        ([l, op, r]) =>
          "if (" + l + " " + op + " " + r + ") { s = s + 1; } else { s = s - 1; }"
      ),
    // Bounded for loop.
    fc.integer({ min: 0, max: 5 }).map((n) => "for (let i = 0; i < " + n + "; i++) { s = s + i; }")
  );
}

const programArb = fc
  .tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }), fc.array(stmtArb(), { minLength: 1, maxLength: 4 }))
  .map(
    ([s0, t0, stmts]) =>
      "let s = " + s0 + ";\nlet t = " + t0 + ";\n" + stmts.join("\n") + "\ns;"
  );

// --- Property 1: determinism -------------------------------------------
test("property: tracing a generated program twice gives identical events and result", () => {
  fc.assert(
    fc.property(programArb, (prog) => {
      let first = Iroh.trace(prog);
      let second = Iroh.trace(prog);
      assert.equal(JSON.stringify(second), JSON.stringify(first));
    }),
    { numRuns: 50, seed: 20261120 }
  );
});

// --- Property 2: scan/analyze agreement --------------------------------
test("property: scan findings are a subset of analyze findings, and scan counts the events", () => {
  fc.assert(
    fc.property(programArb, (prog) => {
      let out = Iroh.trace(prog);
      let analysis = Iroh.analyze(out.events);
      let doc = Iroh.scan(out.events);
      let analyzeCodes = new Set(analysis.findings.map((f) => f.code));
      for (let ii = 0; ii < doc.findings.length; ++ii) {
        assert.ok(
          analyzeCodes.has(doc.findings[ii].code),
          "scan finding " + doc.findings[ii].code + " is not in the analysis"
        );
      }
      assert.equal(doc.summary.events, out.events.length);
    }),
    { numRuns: 50, seed: 20261121 }
  );
});

// --- Property 3: translate round-trip ----------------------------------
// Pure arithmetic over the parameters, with division only by a
// non-zero literal (both languages true-divide) and no modulo (JS %
// and Python % differ for negative operands). Sampled inputs include
// negatives, so the property is a real check, not a vacuous one.
function fnExprArb(depth) {
  const leaf = fc.oneof(fc.constantFrom("a", "b"), fc.integer({ min: 0, max: 9 }).map(String));
  if (depth <= 0) return leaf;
  return fc.oneof(
    leaf,
    fc
      .tuple(fnExprArb(depth - 1), fc.constantFrom("+", "-", "*"), fnExprArb(depth - 1))
      .map(([l, op, r]) => "(" + l + " " + op + " " + r + ")"),
    fc
      .tuple(fnExprArb(depth - 1), fc.integer({ min: 1, max: 5 }))
      .map(([l, d]) => "(" + l + " / " + d + ")")
  );
}

const SAMPLES = [
  [2, 3],
  [-1, 4],
  [0, 5],
];

test("property: JS -> Python -> JS round-trip preserves the value", { skip: !HAS_PYTHON }, () => {
  fc.assert(
    fc.property(fnExprArb(2), (body) => {
      let fnSrc = "function f(a, b) { return " + body + "; }";
      let py = Iroh.translate(fnSrc, { to: "python" });
      assert.equal(py.report.ok, true, JSON.stringify(py.report.unsupported));
      let back = Iroh.translate(py.code, { from: "python", to: "javascript" });
      assert.equal(back.report.ok, true, JSON.stringify(back.report.unsupported));
      for (let ii = 0; ii < SAMPLES.length; ++ii) {
        let [a, b] = SAMPLES[ii];
        let call = " f(" + a + ", " + b + ");";
        let orig = Iroh.trace(fnSrc + call);
        let rt = Iroh.trace(back.code + call);
        assert.equal(rt.result, orig.result, "round-trip differs on f(" + a + ", " + b + ") for " + body);
      }
    }),
    { numRuns: 10, seed: 20261122 }
  );
});

// Sanity: the round-trip property above runs at all (guards against
// the skip hiding a broken leg in environments without python3).
test("property: translate round-trip helper is exercised or python3 is absent", () => {
  if (!HAS_PYTHON) {
    assert.ok(true, "python3 absent — round-trip property skipped by design");
    return;
  }
  let fnSrc = "function f(a, b) { return a * 2 + b; }";
  let py = Iroh.translate(fnSrc, { to: "python" });
  assert.equal(py.report.ok, true);
  let back = Iroh.translate(py.code, { from: "python", to: "javascript" });
  assert.equal(Iroh.trace(back.code + " f(3, 4);").result, 10);
});
