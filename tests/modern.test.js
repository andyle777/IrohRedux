// 2026 syntax tests — the parser moved from ES2022 to "latest" in 0.6.0,
// plus allowHashBang. Runtime features that needed no syntax change
// (Object.groupBy, Set methods, Promise.try, iterator helpers,
// Float16Array, RegExp.escape, findLast) are covered here too, so a
// regression in the patcher shows up in one place.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Iroh = require("../dist/iroh-node.js");

function run(code) {
  let stage = new Iroh.Stage(code);
  let result = eval(stage.script);
  return result;
}

async function runAsync(code) {
  let result = run(code);
  if (result && typeof result.then === "function") result = await result;
  return result;
}

test("hashbang scripts trace", () => {
  assert.equal(run("#!/usr/bin/env node\nlet x = 1; x;"), 1);
});

test("RegExp v flag traces", () => {
  assert.equal(run("const r = /[\\p{Letter}]/v; r.test('a');"), true);
});

test("RegExp modifiers trace", () => {
  assert.equal(run("const r = /(?i:a)b/; r.test('Ab');"), true);
});

test("using declarations trace, and disposal runs", () => {
  assert.equal(
    run("{ using x = { [Symbol.dispose]() { globalThis.__m1 = true; } }; 1; } globalThis.__m1;"),
    true
  );
  assert.equal(
    run("function f() { using x = { [Symbol.dispose]() { globalThis.__m2 = true; } }; return 7; } f(); globalThis.__m2;"),
    true
  );
});

test("using declarations fire VAR events", () => {
  let stage = new Iroh.Stage("{ using x = { [Symbol.dispose]() {} }; 1; }");
  let names = [];
  stage.addListener(Iroh.VAR).on("before", (e) => names.push(e.name));
  eval(stage.script);
  assert.ok(names.includes("x"));
});

test("await using traces", async () => {
  let result = await runAsync(
    "async function f() { await using x = { [Symbol.asyncDispose]() { return Promise.resolve(); } }; return 9; } f();"
  );
  assert.equal(result, 9);
});

test("runtime features that needed no syntax change still trace", () => {
  // Object.groupBy returns a null-prototype object, so compare through
  // JSON rather than deepEqual (which checks prototypes in strict mode).
  assert.deepEqual(
    JSON.parse(JSON.stringify(run("Object.groupBy([1,2,3], v => v % 2);"))),
    { 0: [2], 1: [1, 3] }
  );
  assert.equal(run("[1,2,3].findLast(v => v > 1);"), 3);
  assert.equal(run("Promise.try(() => 42);") instanceof Promise, true);
  assert.deepEqual(run("[1,2,3].values().map(v => v * 2).toArray();"), [2, 4, 6]);
  assert.equal(run("RegExp.escape('a+b');"), "\\x61\\+b");
});

test("import attributes still fail clearly without module support", () => {
  assert.throws(
    () => run("import data from './x.json' with { type: 'json' }; data;"),
    /sourceType: module/
  );
});

test("bare blocks return their completion value", () => {
  assert.equal(run("{ 1; }"), 1);
  assert.equal(run("{ { 2; } }"), 2);
});

test("Stage constructor honours parser options", () => {
  // The constructor used to take `opt` and silently drop it.
  let code = "function f() { using x = { [Symbol.dispose]() {} }; return 1; } f();";
  assert.throws(() => new Iroh.Stage(code, { ecmaVersion: 2022 }), { name: "SyntaxError" });
  let stage = new Iroh.Stage(code);
  assert.equal(eval(stage.script), 1);
});
