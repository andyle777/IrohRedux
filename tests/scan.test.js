// Tests for the 0.9.0 AI-friendly scan mode (src/scan.js, CLI --scan):
// one compact JSON document { vectors, findings, scores, summary },
// bounded size, deterministic output, same schema across JS, Python
// and C++ traces.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { hasCommand } = require("../lib/capabilities");
const Iroh = require("../dist/iroh-node.js");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

// g++-dependent tests skip (with a reason naming g++) on boxes
// without g++ — skipped, not failed, the same honest rule the
// leg runner applies to the python and cpp legs themselves.
const cppOnBox = hasCommand("g++");

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

function runCliFile(file, args) {
  let proc = spawnSync(process.execPath, [CLI, file, ...(args || [])], {
    encoding: "utf8",
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

test("scanTrace returns the scan document shape", () => {
  let doc = Iroh.scanTrace("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  assert.deepEqual(Object.keys(doc).sort(), ["findings", "scores", "summary", "vectors"]);
  assert.equal(doc.summary.language, "javascript");
  assert.equal(doc.summary.findingsTruncated, 0);
  assert.equal(doc.summary.neuron.label, "hot");
  assert.equal(doc.findings[0].code, "HOT_LOOP");
  assert.equal(doc.vectors.names.length, 6);
  assert.equal(typeof doc.vectors.features.coverage, "number");
  assert.equal(doc.scores.coverage.total, 30); // denominator present
});

test("scan is deterministic: same program scanned twice is identical", () => {
  let code = "function f(n) { if (n === 0) return 1; return n * f(n - 1); } f(5);";
  let a = JSON.stringify(Iroh.scanTrace(code));
  let b = JSON.stringify(Iroh.scanTrace(code));
  assert.equal(a, b);
});

test("scan output is far smaller than the raw event stream (bounded)", () => {
  // 20,000 loop iterations: ~100k raw events.
  let code = "let s = 0; for (let i = 0; i < 20000; i++) { s += i; } s;";
  let out = Iroh.trace(code);
  let rawBytes = Buffer.byteLength(JSON.stringify(out.events), "utf8");
  assert.ok(out.events.length > 50000, "expected a large trace, got " + out.events.length);
  let doc = Iroh.scan(out.events, { source: code });
  let scanBytes = Buffer.byteLength(JSON.stringify(doc), "utf8");
  // The scan must be a small fraction of the flood it replaces.
  assert.ok(scanBytes < rawBytes * 0.02,
    "scan " + scanBytes + " bytes is not < 2% of raw " + rawBytes + " bytes");
  assert.ok(scanBytes < 65536, "scan exceeds the 64 KiB sanity bound: " + scanBytes);
});

test("scan caps findings and reports the truncation, never hides it", () => {
  // 250 distinct hot loops, built as synthetic events: 150 true tests
  // + 1 false test per loop hash.
  let events = [];
  for (let h = 0; h < 250; ++h) {
    for (let ii = 0; ii < 150; ++ii) {
      events.push({ event: "LOOP_TEST", category: "LOOP", trigger: "test", hash: h, value: true });
    }
    events.push({ event: "LOOP_TEST", category: "LOOP", trigger: "test", hash: h, value: false });
    events.push({ event: "LOOP_ENTER", category: "LOOP", trigger: "enter", hash: h });
  }
  let doc = Iroh.scan(events, {});
  assert.equal(doc.summary.findings, 250);
  assert.equal(doc.findings.length, 200); // SCAN_DEFAULTS.maxFindings
  assert.equal(doc.summary.findingsTruncated, 50);
  assert.ok(doc.findings.every((f) => f.code === "HOT_LOOP"));
  // A caller that needs them all can raise the cap.
  let uncapped = Iroh.scan(events, { maxFindings: 1000 });
  assert.equal(uncapped.findings.length, 250);
  assert.equal(uncapped.summary.findingsTruncated, 0);
});

test("scan clamps a negative maxFindings to zero instead of slicing", () => {
  // slice(0, -5) returns all but the last five findings, and the
  // truncation count goes negative — a negative cap is nonsense, not
  // a request for "all but N".
  let events = [];
  for (let h = 0; h < 250; ++h) {
    for (let ii = 0; ii < 150; ++ii) {
      events.push({ event: "LOOP_TEST", category: "LOOP", trigger: "test", hash: h, value: true });
    }
    events.push({ event: "LOOP_TEST", category: "LOOP", trigger: "test", hash: h, value: false });
    events.push({ event: "LOOP_ENTER", category: "LOOP", trigger: "enter", hash: h });
  }
  let doc = Iroh.scan(events, { maxFindings: -5 });
  assert.equal(doc.summary.findings, 250);
  assert.equal(doc.findings.length, 0);
  assert.equal(doc.summary.findingsTruncated, 250);
  let zero = Iroh.scan(events, { maxFindings: 0 });
  assert.equal(zero.findings.length, 0);
  assert.equal(zero.summary.findingsTruncated, 250);
});

test("scanTrace does not mutate the caller's options", () => {
  // scanTrace/scanTraceAsync/scanModule default source/language onto
  // options.analyze — aliasing it mutated the caller's object.
  let opts = { analyze: { hotLoopThreshold: 5 } };
  Iroh.scanTrace("for (let i = 0; i < 10; i++) {}", opts);
  assert.deepEqual(opts, { analyze: { hotLoopThreshold: 5 } });
});

test("scanTraceAsync and scanModule do not mutate the caller's options", async () => {
  let asyncOpts = { analyze: {} };
  await Iroh.scanTraceAsync("let x = 1;", asyncOpts);
  assert.deepEqual(asyncOpts, { analyze: {} });
  let modOpts = { analyze: {} };
  await Iroh.scanModule("export const x = 1;", modOpts);
  assert.deepEqual(modOpts, { analyze: {} });
});

test("scanTraceAsync and scanModule mirror analyzeTrace's variants", async () => {
  let asyncDoc = await Iroh.scanTraceAsync("let x = await Promise.resolve(42); x;");
  assert.equal(asyncDoc.summary.language, "javascript");
  assert.equal(asyncDoc.summary.findings, 0);
  let modDoc = await Iroh.scanModule("export const x = 1 + 2;");
  assert.equal(modDoc.summary.language, "javascript");
  assert.equal(modDoc.summary.findings, 0);
});

test("CLI --scan emits one scan line and no event flood", () => {
  let { proc, lines } = runCli("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;", ["--scan"]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.ok(!lines.some((l) => l.type === "event"), "scan mode must not print events");
  let scan = lines.find((l) => l.type === "scan");
  assert.ok(scan, "expected a scan line");
  assert.deepEqual(Object.keys(scan).sort(), ["findings", "scores", "summary", "type", "vectors"]);
  assert.equal(scan.summary.language, "javascript");
  assert.equal(scan.findings[0].code, "HOT_LOOP");
  // The result line still precedes it, as with --analyze.
  assert.ok(lines.find((l) => l.type === "result"));
});

test("CLI --scan --include-events embeds the raw events on request", () => {
  let { proc, lines } = runCli("let x = 1; x;", ["--scan", "--include-events"]);
  assert.equal(proc.status, 0, proc.stderr);
  let scan = lines.find((l) => l.type === "scan");
  assert.ok(Array.isArray(scan.events));
  assert.ok(scan.events.length > 0);
});

test("CLI --scan is deterministic across runs", () => {
  let code = "function f(n) { if (n === 0) return 1; return n * f(n - 1); } f(5);";
  let first = runCli(code, ["--scan"]);
  let second = runCli(code, ["--scan"]);
  assert.equal(JSON.stringify(first.lines), JSON.stringify(second.lines));
});

test("CLI --scan works on a Python trace, same schema", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-scan-"));
  try {
    let file = path.join(dir, "hot.py");
    fs.writeFileSync(file, "total = 0\nfor i in range(150):\n    total += i\n", "utf8");
    let { proc, lines } = runCliFile(file, ["--scan"]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.ok(!lines.some((l) => l.type === "event"));
    let scan = lines.find((l) => l.type === "scan");
    assert.ok(scan, "expected a scan line");
    assert.equal(scan.summary.language, "python");
    assert.equal(scan.findings[0].code, "HOT_LOOP");
    assert.equal(scan.findings[0].evidence.iterations, 150);
    assert.deepEqual(Object.keys(scan).sort(), ["findings", "scores", "summary", "type", "vectors"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --scan works on a C++ trace, same schema", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-scan-"));
  try {
    let file = path.join(dir, "deep.cpp");
    fs.writeFileSync(file,
      "int countdown(int n) {\n" +
      "  if (n == 0) return 0;\n" +
      "  return countdown(n - 1) + 1;\n" +
      "}\n" +
      "int main() { return countdown(30); }\n", "utf8");
    let { proc, lines } = runCliFile(file, ["--scan"]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.ok(!lines.some((l) => l.type === "event"));
    let scan = lines.find((l) => l.type === "scan");
    assert.ok(scan, "expected a scan line");
    assert.equal(scan.summary.language, "cpp");
    assert.equal(scan.findings[0].code, "DEEP_RECURSION");
    assert.equal(scan.findings[0].evidence.maxDepth, 31);
    assert.deepEqual(Object.keys(scan).sort(), ["findings", "scores", "summary", "type", "vectors"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scan() carries the unclosed-frames note in its summary", () => {
  let { events } = Iroh.trace("function* gen() { yield 1; yield 2; } let g = gen(); g.next(); g.return();");
  let doc = Iroh.scan(events);
  assert.equal(doc.summary.unclosedFrames.count, 1);
  assert.deepEqual(doc.summary.unclosedFrames.frames, ["gen"]);
  let clean = Iroh.trace("function f(x) { return x * 2; } f(21);");
  assert.equal(Iroh.scan(clean.events).summary.unclosedFrames, null);
});
