// Fuzz harness smoke test (1.1.1, B2): run scripts/fuzz.mjs with a
// tiny budget and assert it exits 0 (no crashes, no mismatches).
// The harness itself is the coverage; this test only pins it into
// the suite so a future engine change that breaks the harness (or
// that the harness catches) fails loudly here.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const FUZZ = path.join(__dirname, "..", "scripts", "fuzz.mjs");

test("fuzz harness exits 0 on a tiny budget", () => {
  let proc = spawnSync(process.execPath, [FUZZ, "--seed", "1", "--runs", "3"], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(proc.status, 0, proc.stdout + proc.stderr);
  assert.match(proc.stdout, /fuzz: 3 runs, \d+ ok, \d+ rejected, \d+ capped, \d+ program-errors, 0 crashes \(0 mismatches\)/);
});

test("fuzz harness rejects bad arguments", () => {
  let proc = spawnSync(process.execPath, [FUZZ, "--runs", "nope"], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(proc.status, 2);
});
