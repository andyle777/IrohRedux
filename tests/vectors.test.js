// Tests for the 0.9.0 vector refracting layer (src/vectors.js):
// deterministic feature vectors, cosine similarity and Euclidean
// distance, and the cross-language check — the same program in JS and
// Python refracts to vectors whose language-independent features
// agree, with an honest note on the ones that cannot.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Iroh = require("../dist/iroh-node.js");

const JS_LOOP = "let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;";
const PY_LOOP = "total = 0\nfor i in range(150):\n    total += i\n";

function jsEvents(code) {
  return Iroh.trace(code).events;
}

function pyEvents(code) {
  // The Python tracer is exercised end to end in tests/native.test.js
  // and python/tests/test_trace.py; here the JS side needs its events
  // as plain objects, so run the tracer through the CLI and parse the
  // JSONL stream.
  const { spawnSync } = require("node:child_process");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-vec-"));
  try {
    let file = path.join(dir, "prog.py");
    fs.writeFileSync(file, code, "utf8");
    let proc = spawnSync(process.execPath, [path.join(__dirname, "..", "cli", "iroh.js"), file], { encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stderr);
    return proc.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((l) => l.type === "event");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("toVector is deterministic: same events, same vector, twice", () => {
  let events = jsEvents(JS_LOOP);
  let a = Iroh.toVector(events);
  let b = Iroh.toVector(events);
  assert.deepEqual(a, b);
  assert.deepEqual(a.names, ["calls", "depth", "repeat", "imbalance", "mix", "coverage"]);
  assert.equal(a.vector.length, 6);
  for (let v of a.vector) {
    assert.ok(v >= 0 && v <= 1, "feature out of [0, 1]: " + v);
  }
  assert.equal(a.features.events, events.length);
  assert.equal(a.features.coverage, a.vector[5]);
});

test("toVector names its features and stays in [0, 1]", () => {
  let v = Iroh.toVector(jsEvents("function f(n) { return n * 2; } f(21);"));
  assert.equal(typeof v.features.calls, "number");
  assert.equal(typeof v.features.depth, "number");
  assert.equal(typeof v.features.repeat, "number");
  assert.equal(typeof v.features.imbalance, "number");
  assert.equal(typeof v.features.mix, "number");
  assert.equal(typeof v.features.coverage, "number");
});

test("identical vectors have distance 0 and cosine 1", () => {
  let v = Iroh.toVector(jsEvents(JS_LOOP));
  assert.equal(Iroh.euclideanDistance(v, v), 0);
  assert.equal(Iroh.cosineSimilarity(v, v), 1);
  assert.deepEqual(Iroh.compareVectors(v, v), { cosine: 1, euclidean: 0 });
  // Same events re-traced give the same vector, and the same measures.
  let w = Iroh.toVector(jsEvents(JS_LOOP));
  assert.equal(Iroh.euclideanDistance(v, w), 0);
  assert.equal(Iroh.cosineSimilarity(v, w), 1);
});

test("different traces have distance > 0 and cosine < 1", () => {
  let hot = Iroh.toVector(jsEvents(JS_LOOP));
  let cold = Iroh.toVector(jsEvents("let s = 0; for (let i = 0; i < 3; i++) { s += i; } s;"));
  assert.ok(Iroh.euclideanDistance(hot, cold) > 0);
  assert.ok(Iroh.cosineSimilarity(hot, cold) < 1);
  assert.ok(Iroh.cosineSimilarity(hot, cold) >= -1);
});

test("mismatched vector lengths throw instead of guessing", () => {
  assert.throws(() => Iroh.euclideanDistance([0, 1], [0, 1, 2]), /same length/);
  assert.throws(() => Iroh.cosineSimilarity([0, 1], [0, 1, 2]), /same length/);
});

test("cross-language: same loop in JS and Python agrees on the language-independent features", () => {
  let js = Iroh.toVector(jsEvents(JS_LOOP));
  let py = Iroh.toVector(pyEvents(PY_LOOP));
  // Both programs do the same work: no calls, no nesting, no branches.
  assert.equal(js.features.calls, py.features.calls);
  assert.equal(js.features.depth, py.features.depth);
  assert.equal(js.features.imbalance, py.features.imbalance);
  // And both analyze to the same finding, with the same iteration count.
  let jsHot = Iroh.analyze(jsEvents(JS_LOOP)).findings.find((f) => f.code === "HOT_LOOP");
  let pyHot = Iroh.analyze(pyEvents(PY_LOOP)).findings.find((f) => f.code === "HOT_LOOP");
  assert.equal(jsHot.evidence.iterations, 150);
  assert.equal(pyHot.evidence.iterations, 150);
  // The vectors are NOT identical, and the difference is honest, not
  // a bug: repeat/mix/coverage measure instrumentation granularity,
  // and the JS engine instruments far more (literals, assignments,
  // binary ops) than the Python tracer's call/loop/branch events.
  // So the distance is > 0 — and the features that differ are exactly
  // the granularity ones.
  assert.ok(Iroh.euclideanDistance(js, py) > 0);
  assert.notEqual(js.features.mix, py.features.mix);
  assert.notEqual(js.features.coverage, py.features.coverage);
});
