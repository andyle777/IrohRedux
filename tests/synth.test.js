// Tests for the input synthesiser (src/synth.js, CLI --synthesize):
// generate concrete inputs that drive a program down each branch,
// on the live wire — the live analyzer's ONE_SIDED_BRANCH findings
// are the synthesiser's target list, and progress streams the way
// --live streams findings. Every number carries its denominator.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

function runCliFile(file, args) {
  let proc = spawnSync(process.execPath, [CLI, file, ...(args || [])], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc: proc, lines: lines };
}

function writeTempProgram(code) {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-synth-"));
  let file = path.join(dir, "prog.js");
  fs.writeFileSync(file, code, "utf8");
  return file;
}

test("if/else on x > 10: both arms covered, boundary input synthesized", () => {
  let code = "function classify(x) { if (x > 10) { return \"big\"; } return \"small\"; }";
  let out = Iroh.synthesize(code, { entry: "classify", seeds: [[5]] });
  assert.equal(out.coverage.covered, 2, "both arms");
  assert.equal(out.coverage.total, 2, "two arms, one if");
  assert.equal(out.coverage.value, 1);
  assert.equal(out.uncovered.length, 0);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === 5), "seed kept: " + JSON.stringify(argLists));
  assert.ok(argLists.some((a) => a[0] === 11), "boundary 11 synthesized: " + JSON.stringify(argLists));
  // The synthesized input really drives the true arm: its run returned "big".
  let big = out.inputs.find((i) => i.args[0] === 11);
  assert.equal(big.result, "big");
  let small = out.inputs.find((i) => i.args[0] === 5);
  assert.equal(small.result, "small");
});

test("string equality: the exact string is synthesized", () => {
  let code = "function gate(s) { if (s === \"admin\") { return \"in\"; } return \"out\"; }";
  let out = Iroh.synthesize(code, { entry: "gate", seeds: [["guest"]] });
  assert.equal(out.coverage.covered, 2);
  assert.equal(out.coverage.total, 2);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === "admin"), "admin synthesized: " + JSON.stringify(argLists));
  let admin = out.inputs.find((i) => i.args[0] === "admin");
  assert.equal(admin.result, "in");
});

test("loop condition (while, param vs literal): both arms covered", () => {
  let code = "function countdown(n) { let s = 0; while (n > 0) { s += n; n--; } return s; }";
  let out = Iroh.synthesize(code, { entry: "countdown", seeds: [[0]] });
  assert.equal(out.coverage.covered, 2);
  assert.equal(out.coverage.total, 2);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === 1), "n=1 synthesized for the enter arm: " + JSON.stringify(argLists));
  let one = out.inputs.find((i) => i.args[0] === 1);
  assert.equal(one.result, 1);
});

test("loop condition (for, counter vs param): both arms covered", () => {
  let code = "function sum(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }";
  let out = Iroh.synthesize(code, { entry: "sum", seeds: [[0]] });
  assert.equal(out.coverage.covered, 2);
  assert.equal(out.coverage.total, 2);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === 1), "n=1 synthesized for the enter arm: " + JSON.stringify(argLists));
});

test("ternary: both arms covered", () => {
  let code = "function label(x) { return x > 10 ? \"big\" : \"small\"; }";
  let out = Iroh.synthesize(code, { entry: "label", seeds: [[5]] });
  assert.equal(out.coverage.covered, 2);
  assert.equal(out.coverage.total, 2);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === 11), "boundary 11 synthesized: " + JSON.stringify(argLists));
});

test("boolean combo (&&): both arms covered", () => {
  let code = "function both(x, y) { if (x > 5 && y < 3) { return \"yes\"; } return \"no\"; }";
  let out = Iroh.synthesize(code, { entry: "both", seeds: [[0, 0]] });
  assert.equal(out.coverage.covered, 2);
  assert.equal(out.coverage.total, 2);
  let yes = out.inputs.find((i) => i.result === "yes");
  assert.ok(yes, "an input reaching the true arm exists: " + JSON.stringify(out.inputs.map((i) => i.args)));
  assert.ok(yes.args[0] > 5 && yes.args[1] < 3, "the yes input satisfies both sides");
});

test("compound condition the solver cannot invert is reported uncovered, not faked", () => {
  let code = "function scaled(x) { if (x * 2 > 10) { return \"big\"; } return \"small\"; }";
  let out = Iroh.synthesize(code, { entry: "scaled", seeds: [[1]] });
  assert.equal(out.coverage.covered, 1, "only the false arm");
  assert.equal(out.coverage.total, 2);
  assert.equal(out.coverage.value, 0.5);
  assert.equal(out.uncovered.length, 1);
  assert.equal(out.uncovered[0].arm, "true");
  assert.match(out.uncovered[0].reason, /compound|direct comparison/i);
  // The live wire saw it too: the aggregate analyzer's ONE_SIDED_BRANCH
  // is the target list, so it names the same branch.
  let oneSided = out.findings.filter((f) => f.code === "ONE_SIDED_BRANCH");
  assert.equal(oneSided.length, 1, "one one-sided branch in the findings");
  assert.equal(oneSided[0].branch, out.uncovered[0].id);
});

test("nondeterministic condition (new Date) is reported uncovered with its reason", () => {
  // Deterministic outcome (the year is never > 3000), nondeterministic
  // source: no input can steer it, so the true arm stays uncovered.
  let code = "function future(x) { if (new Date().getFullYear() > 3000) { return \"future\"; } return \"now\"; }";
  let out = Iroh.synthesize(code, { entry: "future", seeds: [[1]] });
  assert.equal(out.uncovered.length, 1);
  assert.match(out.uncovered[0].reason, /Date|nondeterministic/i);
  assert.ok(out.coverage.value < 1, "coverage is never claimed above what ran");
});

test("progress streams runs and newly covered branches; live findings fire on the wire", () => {
  let code = "function hot(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }";
  let progress = [];
  let out = Iroh.synthesize(code, {
    entry: "hot",
    seeds: [[150]],
    onProgress: (e) => progress.push(e),
  });
  assert.equal(out.coverage.covered, 2);
  assert.ok(progress.some((e) => e.type === "run"), "run events streamed");
  assert.ok(
    progress.some((e) => e.type === "branch-covered"),
    "branch-covered events streamed: " + JSON.stringify(progress.map((e) => e.type))
  );
  // The 150-iteration seed run trips HOT_LOOP live, mid-run — the
  // synthesiser is on the live wire, not analyzing after the fact.
  let hotFinding = progress.filter((e) => e.type === "live-finding" && e.finding.code === "HOT_LOOP");
  assert.equal(hotFinding.length, 1, "HOT_LOOP fired live once");
  assert.equal(hotFinding[0].run, 0, "it fired during the seed run");
});

test("a synthesized input that never terminates is capped, not a hang", () => {
  let dist = require.resolve("../dist/iroh-node.js");
  let prog =
    "const Iroh = require(" + JSON.stringify(dist) + ");\n" +
    "let out = Iroh.synthesize(\"function f(x) { let i = 0; while (x > 0) { i++; } return i; }\", " +
    "{ entry: \"f\", seeds: [[1]], loopCap: 500 });\n" +
    "console.log(JSON.stringify({ runs: out.runs.used, capped: out.inputs.some((i) => i.capped), " +
    "covered: out.coverage.covered, total: out.coverage.total }));\n";
  let proc = spawnSync(process.execPath, ["-e", prog], {
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(proc.status, 0, "synthesize must return, not hang; stderr: " + proc.stderr);
  let res = JSON.parse(proc.stdout.trim());
  assert.equal(res.capped, true, "the seed run hit the loop cap");
  assert.equal(res.covered, 2, "the false arm was still covered honestly, by x=0");
  assert.equal(res.total, 2);
});

test("switch: each case is a branch, the discriminant value is synthesized", () => {
  let code = "function grade(n) { switch (n) { case 1: return \"one\"; case 2: return \"two\"; default: return \"other\"; } }";
  let out = Iroh.synthesize(code, { entry: "grade", seeds: [[0]] });
  assert.equal(out.coverage.covered, 3, "case 1, case 2 and default");
  assert.equal(out.coverage.total, 3);
  assert.equal(out.uncovered.length, 0);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === 0), "seed covered the default arm");
  assert.ok(argLists.some((a) => a[0] === 1), "case 1 synthesized: " + JSON.stringify(argLists));
  assert.ok(argLists.some((a) => a[0] === 2), "case 2 synthesized: " + JSON.stringify(argLists));
  assert.equal(out.inputs.find((i) => i.args[0] === 1).result, "one");
  assert.equal(out.inputs.find((i) => i.args[0] === 2).result, "two");
});

test("switch on strings: the exact case string is synthesized", () => {
  let code = "function role(s) { switch (s) { case \"admin\": return \"root\"; default: return \"user\"; } }";
  let out = Iroh.synthesize(code, { entry: "role", seeds: [["guest"]] });
  assert.equal(out.coverage.covered, 2);
  assert.equal(out.coverage.total, 2);
  let argLists = out.inputs.map((i) => i.args);
  assert.ok(argLists.some((a) => a[0] === "admin"), "admin synthesized: " + JSON.stringify(argLists));
});

test("findings dedupe: same loop never entered in two runs reports one ZERO_ITERATION_LOOP", () => {
  const code = "function f(x) { let r = 0; for (let i = 0; i < x; i++) { r += i; } return r; }";
  const result = Iroh.synthesize(code, { entry: "f", seeds: [[0], [-1]] });
  const zero = result.findings.filter((f) => f.code === "ZERO_ITERATION_LOOP");
  assert.equal(zero.length, 1, "one ZERO_ITERATION_LOOP for the same loop, not one per run");
  assert.equal(result.coverage.covered, 2, "loop both arms still covered (solver found x = 1)");
});

test("CLI --synthesize end-to-end: inputs and coverage report on stdout", () => {
  let file = writeTempProgram(
    "function classify(x) { if (x > 10) { return \"big\"; } return \"small\"; }"
  );
  let run = runCliFile(file, ["--synthesize", "--entry", "classify", "--seeds", "[[5]]"]);
  assert.equal(run.proc.status, 0, "exit 0; stderr: " + run.proc.stderr);
  let summary = run.lines.find((l) => l.type === "synth-summary");
  assert.ok(summary, "a synth-summary line is printed: " + JSON.stringify(run.lines.map((l) => l.type)));
  assert.equal(summary.coverage.covered, 2);
  assert.equal(summary.coverage.total, 2);
  assert.equal(summary.uncovered.length, 0);
  let runs = run.lines.filter((l) => l.type === "synth-run");
  assert.ok(runs.length >= 2, "one run per input tried");
  assert.ok(
    runs.some((r) => r.args[0] === 11),
    "the synthesized boundary input is printed: " + JSON.stringify(runs.map((r) => r.args))
  );
});

test("CLI --live --synthesize streams live findings as they fire", () => {
  let file = writeTempProgram(
    "function hot(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }"
  );
  let run = runCliFile(file, [
    "--synthesize",
    "--live",
    "--entry",
    "hot",
    "--seeds",
    "[[150]]",
  ]);
  assert.equal(run.proc.status, 0, "exit 0; stderr: " + run.proc.stderr);
  let live = run.lines.filter((l) => l.type === "live-finding" && l.code === "HOT_LOOP");
  assert.equal(live.length, 1, "HOT_LOOP streamed live once");
  let summary = run.lines.find((l) => l.type === "synth-summary");
  assert.ok(summary, "synth-summary still printed");
  assert.equal(summary.coverage.covered, 2);
});
