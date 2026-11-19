// Tests for the 0.8.0 AI analysis layer: Iroh.analyze(),
// analyzeTrace()/analyzeTraceAsync()/analyzeModule(), the toolkit
// scorecard, the perceptron in src/neurons.js, and the CLI --analyze
// flag. Every finding code has a trace that triggers it and one that
// does not.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

function codes(analysis) {
  return analysis.findings.map((f) => f.code);
}
function finding(analysis, code) {
  return analysis.findings.find((f) => f.code === code);
}
function analyzeCode(code, analyzeOptions) {
  return Iroh.analyzeTrace(code, { analyze: analyzeOptions || {} }).analysis;
}

test("HOT_LOOP fires at/above the threshold and not below it", () => {
  let hot = analyzeCode("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  let f = finding(hot, "HOT_LOOP");
  assert.ok(f, "expected a HOT_LOOP finding");
  assert.equal(f.severity, "warning");
  assert.equal(f.evidence.iterations, 150);
  assert.equal(f.evidence.threshold, 100);
  assert.equal(f.evidence.tests, 151); // 150 true tests + 1 final false
  assert.equal(typeof f.evidence.hash, "number");
  assert.ok(f.neuron, "hotness findings carry a neuron classification");
  assert.equal(f.neuron.label, "hot");

  let cold = analyzeCode("let s = 0; for (let i = 0; i < 5; i++) { s += i; } s;");
  assert.ok(!finding(cold, "HOT_LOOP"));

  // A while loop counts the same way, and the threshold is honored.
  let wh = analyzeCode("let i = 0; let s = 0; while (i < 120) { s += i; i++; } s;");
  assert.equal(finding(wh, "HOT_LOOP").evidence.iterations, 120);
  let raised = analyzeCode("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;", { hotLoopThreshold: 200 });
  assert.ok(!finding(raised, "HOT_LOOP"));
});

test("ZERO_ITERATION_LOOP fires only for a loop whose body never ran", () => {
  let zero = analyzeCode("for (let i = 0; i < 0; i++) { console.log(i); }");
  let f = finding(zero, "ZERO_ITERATION_LOOP");
  assert.ok(f, "expected a ZERO_ITERATION_LOOP finding");
  assert.equal(f.severity, "info");
  assert.equal(f.evidence.iterations, 0);
  assert.equal(f.neuron, null);
  assert.match(f.neuronNote, /hot vs normal only/);

  let normal = analyzeCode("for (let i = 0; i < 3; i++) { console.log(i); }");
  assert.ok(!finding(normal, "ZERO_ITERATION_LOOP"));
});

test("DEEP_RECURSION fires at/above the depth threshold and not below it", () => {
  let deep = analyzeCode(
    "function factorial(n) { if (n === 0) return 1; return n * factorial(n - 1); } factorial(25);"
  );
  let f = finding(deep, "DEEP_RECURSION");
  assert.ok(f, "expected a DEEP_RECURSION finding");
  assert.equal(f.severity, "warning");
  assert.equal(f.evidence.name, "factorial");
  assert.ok(f.evidence.maxDepth >= 20);
  assert.equal(f.evidence.threshold, 20);
  assert.ok(f.neuron, "hotness findings carry a neuron classification");

  let shallow = analyzeCode(
    "function factorial(n) { if (n === 0) return 1; return n * factorial(n - 1); } factorial(5);"
  );
  assert.ok(!finding(shallow, "DEEP_RECURSION"));

  let raised = analyzeCode(
    "function factorial(n) { if (n === 0) return 1; return n * factorial(n - 1); } factorial(25);",
    { deepRecursionThreshold: 30 }
  );
  assert.ok(!finding(raised, "DEEP_RECURSION"));
});

test("REPEATED_SEQUENCE fires for a repeating call sequence and not for a single call", () => {
  let rep = analyzeCode(
    "function a() { return 1; } function b() { return a(); } for (let i = 0; i < 5; i++) { b(); }"
  );
  let f = finding(rep, "REPEATED_SEQUENCE");
  assert.ok(f, "expected a REPEATED_SEQUENCE finding");
  assert.equal(f.severity, "info");
  assert.deepEqual(f.evidence.sequence, ["b", "a"]);
  assert.equal(f.evidence.occurrences, 5);
  assert.equal(f.evidence.threshold, 3);
  assert.ok(f.neuron);

  let once = analyzeCode("function a() { return 1; } a();");
  assert.ok(!finding(once, "REPEATED_SEQUENCE"));
});

test("ONE_SIDED_BRANCH fires when one arm never runs, not when both do", () => {
  let one = analyzeCode(
    "let s = 0; for (let i = 0; i < 3; i++) { if (i >= 0) { s += 1; } else { s -= 1; } } s;"
  );
  let f = finding(one, "ONE_SIDED_BRANCH");
  assert.ok(f, "expected a ONE_SIDED_BRANCH finding");
  assert.equal(f.severity, "info");
  assert.equal(f.evidence.trueCount, 3);
  assert.equal(f.evidence.falseCount, 0);
  assert.equal(f.evidence.tests, 3);
  assert.equal(f.neuron, null);

  // A single evaluation is below the default minimum (2 tests).
  let single = analyzeCode("let x = 1; if (x > 0) { x = 2; } else { x = 3; } x;");
  assert.ok(!finding(single, "ONE_SIDED_BRANCH"));

  let both = analyzeCode(
    "let s = 0; for (let i = 0; i < 4; i++) { if (i % 2 === 0) { s += 1; } else { s -= 1; } } s;"
  );
  assert.ok(!finding(both, "ONE_SIDED_BRANCH"));
});

test("THROWING_PATH fires for caught exceptions and not for clean runs", () => {
  let caught = analyzeCode('try { throw new Error("x"); } catch (e) { console.log("caught"); }');
  let f = finding(caught, "THROWING_PATH");
  assert.ok(f, "expected a THROWING_PATH finding");
  assert.equal(f.severity, "warning");
  assert.equal(f.evidence.catches, 1);
  assert.equal(f.evidence.hashes.length, 1);
  assert.equal(f.neuron, null);

  let clean = analyzeCode("let x = 1; x;");
  assert.ok(!finding(clean, "THROWING_PATH"));
});

test("every finding cites its evidence", () => {
  let analysis = analyzeCode(
    "function f(n) { if (n === 0) return 0; return f(n - 1); } " +
    "let s = 0; for (let i = 0; i < 150; i++) { s += i; } " +
    "try { f(25); throw new Error('x'); } catch (e) { console.log('caught'); } s;"
  );
  assert.ok(analysis.findings.length >= 4, "expected several findings, got " + codes(analysis).join(","));
  for (let f of analysis.findings) {
    assert.equal(typeof f.code, "string");
    assert.ok(f.severity === "warning" || f.severity === "info");
    assert.equal(typeof f.message, "string");
    assert.ok(f.message.length > 0);
    assert.equal(typeof f.evidence, "object");
    assert.ok(f.evidence !== null);
  }
  // The summary counts match the findings.
  assert.equal(analysis.summary.findings, analysis.findings.length);
  assert.equal(
    analysis.summary.warnings + analysis.summary.infos,
    analysis.findings.length
  );
  assert.equal(analysis.summary.events, analysis.scores.overhead.events);
});

test("coverage states fired/total and the value matches the ratio", () => {
  let analysis = analyzeCode("let x = 1; x;");
  let c = analysis.scores.coverage;
  assert.equal(c.fired + c.missingCategories.length, c.total);
  assert.equal(c.fired, c.firedCategories.length);
  assert.equal(c.value, Math.round((c.fired / c.total) * 10000) / 10000);
  assert.ok(c.firedCategories.includes("VAR"));
  assert.match(c.note, /unfiltered trace/);
});

test("fidelity counts blind spots from the source and never hides them", () => {
  let source =
    "class A { #x = 1; bump() { this.#x = 2; } }\n" +
    "let a = new A(); a.bump();\n" +
    "let p, q; [p, q] = [1, 2];";
  let withSource = Iroh.analyzeTrace(source, { analyze: { source: source } }).analysis;
  assert.equal(withSource.scores.fidelity.blindSpotStatements, 2);
  assert.equal(withSource.scores.fidelity.totalRegions,
    withSource.scores.fidelity.observedRegions +
    withSource.scores.fidelity.missingRegions + 2);
  assert.equal(withSource.scores.fidelity.value,
    Math.round((withSource.scores.fidelity.observedRegions / withSource.scores.fidelity.totalRegions) * 10000) / 10000);

  // Without a source the blind spots are uncounted (null), not zero —
  // and the known list is still stated. (analyzeTrace() defaults
  // `source` to the code, so the no-source case goes through
  // analyze() directly.)
  let noSource = Iroh.analyze(Iroh.trace("let x = 1; x;").events);
  assert.equal(noSource.scores.fidelity.blindSpotStatements, null);
  assert.deepEqual(
    noSource.scores.fidelity.knownBlindSpots.map((b) => b.kind),
    ["private-field-assignment", "destructuring-assignment"]
  );

  // A zero-iteration loop body and a one-sided arm count as missing regions.
  let missing = analyzeCode(
    "for (let i = 0; i < 0; i++) { console.log(i); } " +
    "if (1 > 0) { console.log('a'); } else { console.log('b'); } " +
    "if (1 > 0) { console.log('c'); } else { console.log('d'); }"
  );
  assert.ok(missing.scores.fidelity.missingRegions >= 1);
});

test("overhead states its denominator: statements with source, regions without", () => {
  let source = "let s = 0; for (let i = 0; i < 5; i++) { s += i; } s;";
  let withSource = Iroh.analyzeTrace(source, { analyze: { source: source } }).analysis;
  let o = withSource.scores.overhead;
  assert.equal(o.denominator, "statements");
  assert.equal(typeof o.statements, "number");
  assert.ok(o.statements > 0);
  assert.equal(o.eventsPerStatement, Math.round((o.events / o.statements) * 100) / 100);
  assert.equal(o.value, o.eventsPerStatement);

  let noSource = Iroh.analyze(Iroh.trace("let x = 1; x;").events);
  assert.equal(noSource.scores.overhead.denominator, "regions");
  assert.equal(noSource.scores.overhead.statements, null);
  assert.equal(noSource.scores.overhead.eventsPerStatement, null);
  assert.equal(noSource.scores.overhead.value, noSource.scores.overhead.eventsPerRegion);
});

test("analyze() handles an empty trace without crashing", () => {
  let analysis = Iroh.analyze([]);
  assert.deepEqual(analysis.findings, []);
  assert.equal(analysis.scores.coverage.fired, 0);
  assert.equal(analysis.scores.fidelity.value, 1);
  assert.equal(analysis.neuron.label, "normal");
  assert.deepEqual(analysis.neuron.features, { calls: 0, depth: 0, repeat: 0, imbalance: 0, mix: 0 });
});

// --- The neuron -------------------------------------------------------

test("classifyWindow is deterministic: same input, same output, twice", () => {
  let { events } = Iroh.trace("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  let first = Iroh.classifyWindow(events);
  let second = Iroh.classifyWindow(events);
  assert.deepEqual(first, second);
  assert.equal(first.label, "hot");
  // The features are visible, not a black box.
  assert.deepEqual(Object.keys(first.features).sort(), ["calls", "depth", "imbalance", "mix", "repeat"]);
  for (let k of Object.keys(first.features)) {
    assert.ok(first.features[k] >= 0 && first.features[k] <= 1, k + " out of [0,1]");
  }
  let normal = Iroh.classifyWindow(Iroh.trace("let x = 1; x;").events);
  assert.equal(normal.label, "normal");
});

test("extractFeatures measures call volume on a known trace", () => {
  let { events } = Iroh.trace("function f() { return 1; } f(); f();");
  let features = Iroh.extractFeatures(events);
  assert.equal(features.calls, 2 / 50);
  assert.equal(features.imbalance, 0);
  // A top-level call enters at indent 2 (the instrumenter's frame
  // indent), so depth is 2/20 — small, but not zero.
  assert.equal(features.depth, 0.1);
});

test("a fresh perceptron learns the synthetic hot/normal task", () => {
  // Label 1 (hot) when the call feature is high, else 0 — a
  // linearly separable task, so the perceptron must converge.
  let samples = [];
  for (let ii = 0; ii < 20; ++ii) {
    let calls = ii / 19; // 0, 0.055, ..., 1
    samples.push({ x: [calls, 0.1, 0.2, 0, 0.3], y: calls > 0.5 ? 1 : 0 });
  }
  let p = Iroh.createPerceptron([0, 0, 0, 0, 0], 0);
  let updates = p.train(samples, 100, 0.1);
  assert.ok(updates > 0, "expected the perceptron to update while learning");
  let correct = 0;
  for (let s of samples) {
    if ((p.predict(s.x).label === "hot" ? 1 : 0) === s.y) correct += 1;
  }
  assert.equal(correct, samples.length);
  // Converged: a second pass over the same data changes nothing.
  assert.equal(p.train(samples, 100, 0.1), 0);
  // And training is deterministic: same start, same data, same weights.
  let q = Iroh.createPerceptron([0, 0, 0, 0, 0], 0);
  q.train(samples, 100, 0.1);
  assert.deepEqual(q.weights, p.weights);
  assert.equal(q.bias, p.bias);
});

// --- Convenience wrappers ---------------------------------------------

test("analyzeTrace traces then analyzes in one call", () => {
  let out = Iroh.analyzeTrace("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  assert.equal(out.result, 11175);
  assert.ok(Array.isArray(out.events));
  assert.ok(out.events.length > 0);
  assert.equal(out.analysis.summary.events, out.events.length);
  assert.ok(finding(out.analysis, "HOT_LOOP"));
});

test("analyzeTraceAsync handles top-level await", async () => {
  let out = await Iroh.analyzeTraceAsync("let x = await Promise.resolve(42); x;");
  assert.equal(out.result, 42);
  assert.ok(out.analysis.scores.coverage.total > 0);
});

test("analyzeModule analyzes a module", async () => {
  let out = await Iroh.analyzeModule("export const x = 1; export function f() { return 2; }");
  assert.equal(out.result.x, 1);
  assert.ok(Array.isArray(out.events));
  assert.equal(out.analysis.summary.events, out.events.length);
});

// --- CLI --analyze ------------------------------------------------------

function runCli(code, args) {
  let proc = spawnSync(process.execPath, [CLI, ...(args || [])], {
    input: code,
    encoding: "utf8",
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

test("CLI --analyze appends an analysis line after the result line", () => {
  let { proc, lines } = runCli(
    "let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;",
    ["--analyze"]
  );
  assert.equal(proc.status, 0);
  let resultIdx = lines.findIndex((l) => l.type === "result");
  let analysisIdx = lines.findIndex((l) => l.type === "analysis");
  assert.ok(resultIdx >= 0, "expected a result line");
  assert.ok(analysisIdx > resultIdx, "analysis line must come after the result line");
  let analysis = lines[analysisIdx];
  assert.ok(codes(analysis).includes("HOT_LOOP"));
  assert.ok(analysis.scores.coverage.total > 0);
  assert.equal(analysis.neuron.label, "hot");
});
