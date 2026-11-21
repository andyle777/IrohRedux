// Tests for the 0.9.0 live wire AI analysis mode (src/live.js, CLI
// --live): findings fire as events arrive, not after the fact. The
// contract: the codes of the fired findings (after finish()) equal the
// codes of batch analyze() on the same complete trace, and finish()
// findings are deep-equal to the batch findings. Live evidence is the
// counts as of the trip; the summary is the final tally.
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

// g++-dependent tests skip (with a reason on boxes without
// g++ — skipped, not failed, the same honest rule the leg
// runner applies to the cpp leg itself.
const cppOnBox = hasCommand("g++");

function runCli(code, args) {
  let proc = spawnSync(process.execPath, [CLI, ...(args || [])], {
    input: code,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
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
    maxBuffer: 512 * 1024 * 1024,
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

// Feed every event to a fresh live analyzer; return { live, fired }.
function feedAll(events) {
  let live = Iroh.liveAnalyzer({});
  let fired = [];
  for (let ii = 0; ii < events.length; ++ii) {
    let f = live.feed(events[ii]);
    for (let jj = 0; jj < f.length; ++jj) fired.push(f[jj]);
  }
  return { live: live, fired: fired };
}

function sortedCodes(findings) {
  return findings.map((f) => f.code).sort();
}

test("HOT_LOOP fires mid-stream, before the trace ends", () => {
  let out = Iroh.trace("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  let live = Iroh.liveAnalyzer({});
  let hot = null;
  for (let ii = 0; ii < out.events.length; ++ii) {
    let f = live.feed(out.events[ii]);
    if (f.length > 0 && hot === null) hot = f[0];
  }
  assert.ok(hot, "expected a finding to fire mid-stream");
  assert.equal(hot.code, "HOT_LOOP");
  // It fired at the threshold, not at the end: 100 iterations of 150,
  // and the event index is well before the last event.
  assert.equal(hot.evidence.iterations, 100);
  assert.equal(hot.evidence.threshold, 100);
  assert.ok(hot.firedAt < out.events.length - 1,
    "firedAt " + hot.firedAt + " is not before the last event " + (out.events.length - 1));
  assert.equal(typeof hot.firedAt, "number");
  // The final summary carries the final tally (150), not the trip count.
  let fin = live.finish();
  assert.equal(fin.findings[0].evidence.iterations, 150);
});

test("live vs batch agreement across every finding code", () => {
  let cases = {
    "deep recursion": "function f(n){ if (n === 0) return 0; return f(n-1); } f(30);",
    "repeated sequence": "function a(){ return 1; } function b(){ return 2; } function c(){ return 3; } a(); b(); c(); a(); b(); c(); a(); b(); c(); a(); b(); c();",
    "one-sided branch": "function f(x){ if (x > 0) return 1; return 0; } for (let i = 0; i < 5; i++) f(i + 1);",
    "zero-iteration loop": "for (let i = 0; i < 0; i++) {} let x = 1; x;",
    "throwing path": "function f(){ try { throw new Error(\"x\"); } catch (e) { return 1; } } f(); f();",
    "combined": "function f(n){ if (n === 0) return 0; return f(n-1); } f(25); let s = 0; for (let i = 0; i < 150; i++) { s += i; } for (let j = 0; j < 0; j++) {} s;",
    "quiet program": "let x = 1 + 2; x;",
  };
  let names = Object.keys(cases);
  for (let ii = 0; ii < names.length; ++ii) {
    let out = Iroh.trace(cases[names[ii]]);
    let { live } = feedAll(out.events);
    let fin = live.finish();
    let batch = Iroh.analyze(out.events);
    assert.deepEqual(sortedCodes(live.findings()), sortedCodes(batch.findings),
      names[ii] + ": live codes differ from batch codes");
    assert.deepEqual(fin.findings, batch.findings,
      names[ii] + ": finish() findings are not the batch findings");
    assert.deepEqual(fin.scores, batch.scores, names[ii] + ": scores differ");
    assert.equal(fin.finished, true);
    assert.ok(fin.vectors && Array.isArray(fin.vectors.vector));
  }
});

test("live is deterministic: same events twice, same findings in the same order", () => {
  let out = Iroh.trace("function f(n){ if (n === 0) return 0; return f(n-1); } f(25); let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  let first = feedAll(out.events);
  let firstFin = first.live.finish();
  let second = feedAll(out.events);
  let secondFin = second.live.finish();
  assert.equal(JSON.stringify(first.live.findings()), JSON.stringify(second.live.findings()));
  assert.equal(JSON.stringify(firstFin), JSON.stringify(secondFin));
});

test("stream-end findings fire only at finish(), with a note saying so", () => {
  // f is called exactly twice: the if is tested twice (one-sided), but
  // the call sequence [f, f] occurs once, so nothing can fire mid-stream.
  let out = Iroh.trace("for (let i = 0; i < 0; i++) {} function f(x){ if (x > 0) return 1; return 0; } f(1); f(2);");
  let { live, fired } = feedAll(out.events);
  // Neither finding can be decided mid-stream: no live firing yet.
  assert.deepEqual(fired, []);
  assert.deepEqual(live.findings(), []);
  let fin = live.finish();
  let ended = live.findings();
  assert.equal(ended.length, 2);
  for (let f of ended) {
    assert.ok(typeof f.note === "string" && f.note.indexOf("stream end") !== -1,
      "expected a stream-end note on " + f.code);
    assert.equal(f.firedAt, out.events.length - 1);
  }
  assert.deepEqual(sortedCodes(ended), ["ONE_SIDED_BRANCH", "ZERO_ITERATION_LOOP"]);
  assert.deepEqual(sortedCodes(fin.findings), sortedCodes(ended));
});

test("snapshot reports progress without scores; feed after finish throws", () => {
  let out = Iroh.trace("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;");
  let live = Iroh.liveAnalyzer({});
  for (let ii = 0; ii < 600; ++ii) live.feed(out.events[ii]);
  let snap = live.snapshot();
  assert.equal(snap.finished, false);
  assert.equal(snap.events, 600);
  assert.equal(snap.findings.length, 1);
  assert.equal(snap.findings[0].code, "HOT_LOOP");
  assert.equal(typeof snap.neuron.label, "string");
  assert.ok(Array.isArray(snap.vectors.vector));
  assert.equal(snap.scores, undefined); // scores are final-only
  live.finish();
  assert.equal(live.snapshot().finished, true);
  assert.throws(() => live.feed(out.events[0]), /finished/);
  // finish() is idempotent: the same summary object comes back.
  assert.equal(live.finish(), live.snapshot());
});

test("live works on a Python trace (same event shape)", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-live-"));
  try {
    let file = path.join(dir, "hot.py");
    fs.writeFileSync(file, "total = 0\nfor i in range(150):\n    total += i\n", "utf8");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let events = lines.filter((l) => l.type === "event");
    assert.ok(events.length > 0);
    let { live } = feedAll(events);
    let fin = live.finish();
    let batch = Iroh.analyze(events);
    assert.deepEqual(sortedCodes(live.findings()), sortedCodes(batch.findings));
    assert.ok(live.findings().some((f) => f.code === "HOT_LOOP"));
    assert.equal(fin.summary.language, "javascript"); // library default; the CLI sets it
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("live works on a C++ trace (same event shape)", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-live-"));
  try {
    let file = path.join(dir, "deep.cpp");
    fs.writeFileSync(file,
      "int countdown(int n) {\n" +
      "  if (n == 0) return 0;\n" +
      "  return countdown(n - 1) + 1;\n" +
      "}\n" +
      "int main() { return countdown(30); }\n", "utf8");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let events = lines.filter((l) => l.type === "event");
    assert.ok(events.length > 0);
    let { live } = feedAll(events);
    let fin = live.finish();
    let batch = Iroh.analyze(events);
    assert.deepEqual(sortedCodes(live.findings()), sortedCodes(batch.findings));
    assert.ok(live.findings().some((f) => f.code === "DEEP_RECURSION"));
    assert.ok(live.findings().some((f) => f.code === "REPEATED_SEQUENCE"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --live end-to-end on a JS program", () => {
  let { proc, lines } = runCli(
    "let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;", ["--live"]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.ok(!lines.some((l) => l.type === "event"), "live mode must not print the event flood");
  let found = lines.filter((l) => l.type === "live-finding");
  assert.equal(found.length, 1);
  assert.equal(found[0].code, "HOT_LOOP");
  assert.equal(found[0].evidence.iterations, 100);
  let summary = lines.find((l) => l.type === "live-summary");
  assert.ok(summary, "expected a live-summary line");
  assert.ok(found[0].firedAt < summary.summary.events - 1);
  assert.ok(lines.some((l) => l.type === "result"), "the result line still precedes the summary");
  assert.equal(summary.finished, true);
  assert.equal(summary.findings[0].code, "HOT_LOOP");
  assert.equal(summary.findings[0].evidence.iterations, 150);
  assert.ok(summary.scores && summary.scores.coverage);
  assert.ok(summary.vectors && Array.isArray(summary.vectors.vector));
  assert.equal(summary.summary.language, "javascript");
  // The summary findings are exactly the batch analysis — compared
  // against a plain CLI run of the same program, not a fresh in-process
  // trace: JS event hashes are allocated per process, so a second
  // Iroh.trace() in this process would hash the loop differently.
  let plain = runCli("let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;", []);
  let plainEvents = plain.lines.filter((l) => l.type === "event");
  assert.deepEqual(summary.findings, Iroh.analyze(plainEvents).findings);
});

test("CLI --live end-to-end on a Python program", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-live-"));
  try {
    let file = path.join(dir, "hot.py");
    fs.writeFileSync(file, "total = 0\nfor i in range(150):\n    total += i\n", "utf8");
    let { proc, lines } = runCliFile(file, ["--live"]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.ok(!lines.some((l) => l.type === "event"));
    let found = lines.filter((l) => l.type === "live-finding");
    assert.equal(found.length, 1);
    assert.equal(found[0].code, "HOT_LOOP");
    assert.equal(found[0].evidence.iterations, 100);
    // firedAt is the event count when HOT_LOOP trips: 1 initial
    // ASSIGN (total = 0) + 2 events per iteration (LOOP_TEST and the
    // ASSIGN for total += i) x 100 iterations. The per-iteration
    // ASSIGN is the 1.0.1 Python tracer's; before it, firedAt was
    // 100 (one event per iteration).
    assert.equal(found[0].firedAt, 200);
    let summary = lines.find((l) => l.type === "live-summary");
    assert.ok(summary, "expected a live-summary line");
    assert.equal(summary.findings[0].evidence.iterations, 150);
    assert.equal(summary.summary.language, "python");
    assert.ok(summary.scores && summary.vectors);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --live end-to-end on a C++ program", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-live-"));
  try {
    let file = path.join(dir, "deep.cpp");
    fs.writeFileSync(file,
      "int countdown(int n) {\n" +
      "  if (n == 0) return 0;\n" +
      "  return countdown(n - 1) + 1;\n" +
      "}\n" +
      "int main() { return countdown(30); }\n", "utf8");
    let { proc, lines } = runCliFile(file, ["--live"]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.ok(!lines.some((l) => l.type === "event"));
    let found = lines.filter((l) => l.type === "live-finding");
    assert.deepEqual(found.map((f) => f.code), ["REPEATED_SEQUENCE", "DEEP_RECURSION"]);
    let summary = lines.find((l) => l.type === "live-summary");
    assert.ok(summary, "expected a live-summary line");
    assert.equal(summary.summary.language, "cpp");
    assert.deepEqual(sortedCodes(summary.findings), ["DEEP_RECURSION", "REPEATED_SEQUENCE"]);
    assert.equal(summary.findings.find((f) => f.code === "DEEP_RECURSION").evidence.maxDepth, 31);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
