// CLI tests — spawn `cli/iroh.js` as a child process, feed it JavaScript,
// and check the JSON lines it streams. Requires the built dist
// (`npm run build`), which the CLI loads.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

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

test("CLI streams CALL and IF events for factorial and returns 6", () => {
  let { proc, lines } = runCli(
    `function factorial(n) {
       if (n === 0) return 1;
       return n * factorial(n - 1);
     };
     factorial(3);`,
    ["--events", "CALL,IF"]
  );
  assert.equal(proc.status, 0);
  let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
  assert.deepEqual(calls.map((c) => c.arguments), [[3], [2], [1], [0]]);
  let results = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL_END");
  assert.deepEqual(results.map((r) => r.return), [1, 1, 2, 6]);
  let result = lines.find((l) => l.type === "result");
  assert.equal(result.value, 6);
});

test("CLI reads a program from stdin and filters to one category", () => {
  let { proc, lines } = runCli(`let x = [1,2,3].map(v => v * 2); x;`, ["--events", "VAR"]);
  assert.equal(proc.status, 0);
  assert.ok(lines.every((l) => l.type !== "event" || l.category === "VAR"));
  let init = lines.find((l) => l.event === "VAR_INIT");
  assert.deepEqual(init.value, [2, 4, 6]);
  assert.deepEqual(lines.find((l) => l.type === "result").value, [2, 4, 6]);
});

test("CLI awaits async programs and reports AWAIT events", () => {
  let { proc, lines } = runCli(
    `async function f() { return await Promise.resolve(42); } f();`,
    ["--events", "AWAIT"]
  );
  assert.equal(proc.status, 0);
  assert.equal(lines.filter((l) => l.event === "AWAIT").length, 1);
  assert.equal(lines.find((l) => l.type === "result").value, 42);
});

test("CLI reports a parse error as an error line and exits 1", () => {
  let { proc, lines } = runCli(`let x = ;`, []);
  assert.equal(proc.status, 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, "error");
  assert.equal(lines[0].name, "SyntaxError");
});

test("CLI reports a runtime error after the events leading up to it", () => {
  let { proc, lines } = runCli(`let a = 1; throw new Error("boom");`, []);
  assert.equal(proc.status, 1);
  assert.ok(lines.some((l) => l.type === "event"));
  let error = lines.find((l) => l.type === "error");
  assert.equal(error.message, "boom");
  assert.equal(lines.find((l) => l.type === "result"), undefined);
});

test("CLI reports a non-Error throw with its value", () => {
  let { proc, lines } = runCli(`throw "cli-boom";`, []);
  assert.equal(proc.status, 1);
  let error = lines.find((l) => l.type === "error");
  assert.equal(error.name, "Error");
  assert.equal(error.message, "cli-boom");
});

test("CLI rejects an unknown event category with exit code 2", () => {
  let { proc } = runCli(`1;`, ["--events", "NOPE"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /Unknown event category: NOPE/);
});

test("CLI reads a program from a --file path", () => {
  let fs = require("node:fs");
  let os = require("node:os");
  let tmp = path.join(os.tmpdir(), "iroh-cli-test-" + Date.now() + ".js");
  fs.writeFileSync(tmp, "function add(a, b) { return a + b; }; add(1, 2);");
  try {
    let proc = spawnSync(process.execPath, [CLI, "--file", tmp, "--events", "CALL"], {
      encoding: "utf8",
    });
    assert.equal(proc.status, 0);
    let lines = proc.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.find((l) => l.type === "result").value, 3);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("CLI --no-result omits the result line", () => {
  let { proc, lines } = runCli(`42;`, ["--events", "VAR", "--no-result"]);
  assert.equal(proc.status, 0);
  assert.equal(lines.find((l) => l.type === "result"), undefined);
});

test("CLI rejects conflicting modes before reading the file (exit 2)", () => {
  // --direct + --translate on a missing file: the mode error (exit 2)
  // must win over the file-read error (exit 1).
  let proc = spawnSync(process.execPath, [CLI, "/definitely/missing.js", "--direct", "--translate", "python"], { encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /--translate/);
  let live = runCli("1;", ["--translate", "python", "--live"]);
  assert.equal(live.proc.status, 2);
  assert.match(live.proc.stderr, /--translate/);
  let events = runCli("1;", ["--direct", "--events", "CALL"]);
  assert.equal(events.proc.status, 2);
  assert.match(events.proc.stderr, /--events/);
  let include = runCli("1;", ["--include-events", "CALL"]);
  assert.equal(include.proc.status, 2);
  assert.match(include.proc.stderr, /--include-events/);
});

test("CLI --direct honours --analyze, --scan and --live together", () => {
  let { proc, lines } = runCli(
    "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
    ["--direct", "--analyze", "--scan", "--live"]
  );
  assert.equal(proc.status, 0);
  assert.ok(lines.find((l) => l.type === "directive"), "a directive line streamed");
  assert.ok(lines.find((l) => l.type === "live-finding"), "a live-finding line streamed");
  assert.ok(lines.find((l) => l.type === "direct-summary"), "a direct-summary line closed the run");
  assert.ok(lines.find((l) => l.type === "analysis"), "an analysis line followed");
  assert.ok(lines.find((l) => l.type === "scan"), "a scan line followed");
  let summary = lines.find((l) => l.type === "direct-summary");
  assert.equal(summary.directives.length, 1);
});

test("CLI --direct runs top-level await from stdin", () => {
  let { proc, lines } = runCli(
    "await Promise.resolve(1); let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
    ["--direct"]
  );
  assert.equal(proc.status, 0);
  let summary = lines.find((l) => l.type === "direct-summary");
  assert.ok(summary, "a direct-summary line closed the run");
  assert.equal(summary.directives.length, 1);
  let result = lines.find((l) => l.type === "result");
  assert.equal(result.value, 4950);
});

test("CLI --direct runs a .mjs module file", () => {
  let fs = require("node:fs");
  let os = require("node:os");
  let tmp = path.join(os.tmpdir(), "iroh-cli-direct-" + Date.now() + ".mjs");
  fs.writeFileSync(tmp, "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;");
  try {
    let proc = spawnSync(process.execPath, [CLI, tmp, "--direct"], { encoding: "utf8" });
    assert.equal(proc.status, 0);
    let lines = proc.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    let summary = lines.find((l) => l.type === "direct-summary");
    assert.ok(summary, "a direct-summary line closed the module run");
    assert.equal(summary.directives.length, 1);
    assert.equal(summary.directives[0].appliedVia, "loop-test");
  } finally {
    fs.unlinkSync(tmp);
  }
});

// 1.0.1 patch: `iroh --version` prints the one-line self-report
// (Fix Spec 6.7) — engine version, the dist SHA actually in this
// build, and the runtime actually running it. In a pkg binary the
// runtime is the embedded Node 18.5.0; here it is the local node.
test("CLI --version prints version, dist SHA and runtime, exit 0", () => {
  let proc = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
  assert.equal(proc.status, 0);
  let pkg = require("../package.json");
  let crypto = require("node:crypto");
  let fs = require("node:fs");
  let distSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", "dist", "iroh-node.js"))).digest("hex").slice(0, 12);
  assert.equal(proc.stdout.trim(), "iroh " + pkg.version + " (engine dist iroh-node.js " + distSha + ", runtime node " + process.version + ")");
});
