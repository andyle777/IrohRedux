"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
test("native runner has finite timeout and output bounds", () => {
  const source = fs.readFileSync(path.join(__dirname, "../cli/iroh.js"), "utf8");
  assert.match(source, /const MAX_BUFFER = 64 \* 1024 \* 1024/);
  assert.match(source, /const NATIVE_TIMEOUT_MS = 120000/);
  assert.equal((source.match(/timeout: NATIVE_TIMEOUT_MS/g) || []).length, 4);
  assert.equal((source.match(/killSignal: "SIGKILL"/g) || []).length, 4);
});
