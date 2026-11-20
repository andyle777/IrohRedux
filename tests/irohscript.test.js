// Tests for the 1.0.1-rework tracers through the CLI: --lang
// irohscript|basic (and extension inference), with Iroh.analyze()
// proving the cross-language claim — an IrohScript one-sided branch
// analyzes to ONE_SIDED_BRANCH, a BASIC hot loop to HOT_LOOP.
// Requires the built dist and python3.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

function runCliFile(file, args, input) {
  let proc = spawnSync(process.execPath, [CLI, file, ...(args || [])], {
    encoding: "utf8",
    input: input,
    maxBuffer: 512 * 1024 * 1024,
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

function writeTemp(dir, name, code) {
  let file = path.join(dir, name);
  fs.writeFileSync(file, code, "utf8");
  return file;
}

function analysisOf(lines) {
  return lines.find((l) => l.type === "analysis");
}

const IROH_ADD =
  "FUNCTION Add(a, b)\n" +
  " RETURN a + b\n" +
  "END FUNCTION\n" +
  "LET result = Add(10, 20)\n" +
  "PRINT result\n";

const IROH_ONE_SIDED =
  "FUNCTION Check(x)\n" +
  " IF x > 10\n" +
  "  RETURN \"big\"\n" +
  " END IF\n" +
  " RETURN \"small\"\n" +
  "END FUNCTION\n" +
  "LET a = Check(11)\n" +
  "LET b = Check(12)\n";

const IROH_DEEP =
  "FUNCTION Down(n)\n" +
  " IF n <= 0\n" +
  "  RETURN 0\n" +
  " END IF\n" +
  " RETURN Down(n - 1) + 1\n" +
  "END FUNCTION\n" +
  "LET r = Down(25)\n" +
  "PRINT r\n";

const BASIC_HOT_LOOP =
  "10 LET S = 0\n" +
  "20 FOR I = 1 TO 150\n" +
  "30 S = S + I\n" +
  "40 NEXT I\n" +
  "50 PRINT S\n";

const BASIC_GOSUB =
  "10 GOSUB 100\n" +
  "20 PRINT \"back\"\n" +
  "30 END\n" +
  "100 PRINT \"sub\"\n" +
  "110 RETURN\n";

const BASIC_ZERO_LOOP =
  "10 FOR I = 5 TO 1\n" +
  "20 PRINT I\n" +
  "30 NEXT I\n" +
  "40 PRINT \"done\"\n";

// ---------------------------------------------------------------- IrohScript

test("CLI --lang irohscript traces Add: calls, returns, assign", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "add.iroh", IROH_ADD);
    let { proc, lines } = runCliFile(file, ["--lang", "irohscript"]);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.deepEqual(calls.map((c) => [c.name, c.arguments]), [["Add", [10, 20]]]);
    assert.deepEqual(calls.map((c) => c.indent), [0]);
    let returns = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL_END");
    assert.deepEqual(returns.map((r) => r.return), [30]);
    let assigns = lines.filter((l) => l.event === "ASSIGN");
    assert.deepEqual(assigns.map((a) => [a.name, a.value, a.op]), [["result", 30, "="]]);
    let result = lines.find((l) => l.type === "result");
    assert.equal(result.value, null); // IrohScript has no completion value
    assert.match(proc.stderr, /30/); // the program's own output, on stderr
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI infers irohscript from a .iroh file without --lang", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "add.iroh", IROH_ADD);
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript one-sided branch analyzes to ONE_SIDED_BRANCH", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "one.iroh", IROH_ONE_SIDED);
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis, "expected an analysis line");
    assert.ok(analysis.findings.find((f) => f.code === "ONE_SIDED_BRANCH"),
      "expected ONE_SIDED_BRANCH, got " + JSON.stringify(analysis.findings.map((f) => f.code)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript deep recursion analyzes to DEEP_RECURSION", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "deep.iroh", IROH_DEEP);
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis, "expected an analysis line");
    let deep = analysis.findings.find((f) => f.code === "DEEP_RECURSION");
    assert.ok(deep, "expected DEEP_RECURSION, got " + JSON.stringify(analysis.findings.map((f) => f.code)));
    assert.equal(deep.evidence.maxDepth, 25);
    assert.equal(deep.evidence.name, "Down");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript --scan produces a scan doc with the finding", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "one.iroh", IROH_ONE_SIDED);
    let { proc, lines } = runCliFile(file, ["--scan"]);
    assert.equal(proc.status, 0, proc.stderr);
    let scan = lines.find((l) => l.type === "scan");
    assert.ok(scan, "expected a scan line");
    assert.equal(scan.summary.language, "irohscript");
    assert.ok(scan.findings.find((f) => f.code === "ONE_SIDED_BRANCH"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript --live streams the live summary", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "one.iroh", IROH_ONE_SIDED);
    let { proc, lines } = runCliFile(file, ["--live"]);
    assert.equal(proc.status, 0, proc.stderr);
    let summary = lines.find((l) => l.type === "live-summary");
    assert.ok(summary, "expected a live-summary line");
    assert.ok(summary.findings.find((f) => f.code === "ONE_SIDED_BRANCH"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript LOOP is an error line naming the open question, exit 1", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "loop.iroh", "LOOP\n PRINT \"x\"\nEND LOOP\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 1);
    let err = lines.find((l) => l.type === "error");
    assert.ok(err, "expected an error line");
    assert.equal(err.name, "IrohRuntimeError");
    assert.match(err.message, /open design question/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript compile error is an error line, exit 1", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "bad.iroh", "LET X : Int = \"hello\"\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 1);
    let err = lines.find((l) => l.type === "error");
    assert.ok(err, "expected an error line");
    assert.equal(err.name, "TypeCheckError");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript --events filter keeps only the requested categories", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "add.iroh", IROH_ADD);
    let { proc, lines } = runCliFile(file, ["--events", "CALL"]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.ok(lines.every((l) => l.type !== "event" || l.category === "CALL"));
    assert.ok(lines.some((l) => l.event === "FUNCTION_CALL"));
    assert.ok(!lines.some((l) => l.event === "FUNCTION_ENTER"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IrohScript rejects --direct, exit 2, but --translate now works", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-irohscript-"));
  try {
    let file = writeTemp(dir, "add.iroh", IROH_ADD);
    let direct = runCliFile(file, ["--direct"]);
    assert.equal(direct.proc.status, 2);
    // --translate was rejected in part 1; part 2 (the translator upgrade)
    // supports it, so it now exits 0 and prints the translated code.
    let translated = runCliFile(file, ["--translate", "python"]);
    assert.equal(translated.proc.status, 0, translated.proc.stderr);
    assert.match(translated.proc.stdout, /def Add/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------- BASIC

test("CLI --lang basic traces the hot loop: tests, entry, assign", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "hot.bas", BASIC_HOT_LOOP);
    let { proc, lines } = runCliFile(file, ["--lang", "basic"]);
    assert.equal(proc.status, 0, proc.stderr);
    let tests = lines.filter((l) => l.type === "event" && l.event === "LOOP_TEST");
    assert.equal(tests.length, 151);
    assert.equal(tests.filter((t) => t.value === true).length, 150);
    let enters = lines.filter((l) => l.event === "LOOP_ENTER");
    assert.equal(enters.length, 1);
    assert.equal(enters[0].hash, tests[0].hash);
    let result = lines.find((l) => l.type === "result");
    assert.equal(result.value, null); // BASIC has no completion value
    assert.match(proc.stderr, /11325/); // the program's own output, on stderr
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI infers basic from a .bas file without --lang", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "hot.bas", BASIC_HOT_LOOP);
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let tests = lines.filter((l) => l.type === "event" && l.event === "LOOP_TEST");
    assert.equal(tests.length, 151);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC hot loop analyzes to HOT_LOOP through --analyze", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "hot.bas", BASIC_HOT_LOOP);
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis, "expected an analysis line");
    let hot = analysis.findings.find((f) => f.code === "HOT_LOOP");
    assert.ok(hot, "expected HOT_LOOP, got " + JSON.stringify(analysis.findings.map((f) => f.code)));
    assert.equal(hot.evidence.iterations, 150);
    assert.equal(hot.evidence.tests, 151);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC zero-iteration loop analyzes to ZERO_ITERATION_LOOP", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "zero.bas", BASIC_ZERO_LOOP);
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis.findings.find((f) => f.code === "ZERO_ITERATION_LOOP"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC GOSUB traces as a call named gosub@<line>", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "sub.bas", BASIC_GOSUB);
    let { proc, lines } = runCliFile(file, ["--lang", "basic"]);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.deepEqual(calls.map((c) => c.name), ["gosub@100"]);
    assert.deepEqual(calls.map((c) => c.indent), [0]);
    let ends = lines.filter((l) => l.event === "FUNCTION_CALL_END");
    assert.equal(ends.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC --live streams HOT_LOOP as it trips", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "hot.bas", BASIC_HOT_LOOP);
    let { proc, lines } = runCliFile(file, ["--live"]);
    assert.equal(proc.status, 0, proc.stderr);
    let fired = lines.filter((l) => l.type === "live-finding");
    assert.ok(fired.some((f) => f.code === "HOT_LOOP"),
      "expected a live HOT_LOOP, got " + JSON.stringify(fired.map((f) => f.code)));
    let summary = lines.find((l) => l.type === "live-summary");
    assert.ok(summary, "expected a live-summary line");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC --scan produces a scan doc with the finding", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "hot.bas", BASIC_HOT_LOOP);
    let { proc, lines } = runCliFile(file, ["--scan"]);
    assert.equal(proc.status, 0, proc.stderr);
    let scan = lines.find((l) => l.type === "scan");
    assert.ok(scan, "expected a scan line");
    assert.equal(scan.summary.language, "basic");
    assert.ok(scan.findings.find((f) => f.code === "HOT_LOOP"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC program reading stdin gets it", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "inp.bas",
      "10 INPUT X\n20 PRINT X * 2\n");
    let { proc, lines } = runCliFile(file, ["--lang", "basic"], "21\n");
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stderr, /42/);
    assert.ok(lines.some((l) => l.type === "result" && l.value === null));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC GOTO to an undefined line is an error line, exit 1", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "bad.bas", "10 GOTO 99\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 1);
    let err = lines.find((l) => l.type === "error");
    assert.ok(err, "expected an error line");
    assert.equal(err.name, "BasicError");
    assert.match(err.message, /undefined line 99/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASIC rejects --direct, exit 2", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-basic-"));
  try {
    let file = writeTemp(dir, "hot.bas", BASIC_HOT_LOOP);
    let { proc } = runCliFile(file, ["--direct"]);
    assert.equal(proc.status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
