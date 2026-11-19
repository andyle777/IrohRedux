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
