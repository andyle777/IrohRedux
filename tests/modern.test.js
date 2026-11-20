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

test("new on a non-constructor throws exactly like untraced code (OP_NEW parity)", () => {
  // Same family as the DEBUG_FUNCTION_CALL fix: DEBUG_OP_NEW read
  // ctor.name before checking the constructor was a function, so
  // `new null()` threw an Iroh-internal "Cannot read properties of
  // null (reading 'name')" and `new 5()` threw "event.ctor is not a
  // constructor" instead of the engine's "<callee> is not a
  // constructor". No OP_NEW event fires for a construction that
  // cannot happen.
  for (let code of ["new null()", "new 5()", "new undefined()", "new (1)()"]) {
    let untraced;
    try { eval(code); } catch (e) { untraced = e.constructor.name + ": " + e.message; }
    let traced;
    try { Iroh.trace(code); } catch (e) { traced = e.constructor.name + ": " + e.message; }
    assert.equal(traced, untraced, code);
  }
});

test("ES2026: the three features Node 24 already has trace correctly", async () => {
  // Array.fromAsync (Node 22+): async iterable -> array.
  assert.deepEqual(
    await runAsync("async function* gen() { yield 1; yield 2; yield 3; } Array.fromAsync(gen());"),
    [1, 2, 3]
  );
  // JSON.rawJSON (Node 21+): a 2^53+1 integer survives stringify only
  // as raw JSON, and the JSON.parse reviver sees the source text.
  assert.equal(run("JSON.stringify(JSON.rawJSON('9007199254740993'));"), "9007199254740993");
  assert.deepEqual(
    run("JSON.parse('{\"n\": 9007199254740993}', (key, value, context) => key === 'n' ? context.source : value);"),
    { n: "9007199254740993" }
  );
  // Error.isError (Node 24.3+).
  assert.deepEqual(
    run("[Error.isError(new Error('x')), Error.isError(new TypeError()), Error.isError({}), Error.isError('boom')];"),
    [true, true, false, false]
  );
});

test("ES2026: calls to methods the runtime lacks throw the natural TypeError", () => {
  // Four of the seven ES2026 features are plain library calls that
  // Node 24.22.1 does not have yet: Uint8Array base64/hex needs
  // Node 25, Map upserts and Iterator.concat need Node 26, and
  // Math.sumPrecise is not in Node 24 at all. Before the fix, tracing
  // one masked the natural error with an Iroh-internal
  // "Cannot read properties of undefined (reading 'name')" (or, for a
  // non-function value, "before.call.apply is not a function").
  // Traced code must now fail exactly like untraced code. The
  // per-feature checks only run where the runtime still lacks the
  // method, so the test stays green on newer runtimes.
  const missing = [
    ["Uint8Array.fromBase64('aGk=');", typeof Uint8Array.fromBase64],
    ["let m = new Map(); m.getOrInsert('k', 1);", typeof Map.prototype.getOrInsert],
    ["Iterator.concat([1].values(), [2].values()).toArray();", typeof Iterator.concat],
    ["Math.sumPrecise([0.1, 0.2]);", typeof Math.sumPrecise],
  ];
  for (const [code, type] of missing) {
    if (type !== "undefined") continue;
    let plain = null;
    try { eval(code); } catch (e) { plain = e; }
    let traced = null;
    try { run(code); } catch (e) { traced = e; }
    assert.ok(plain instanceof TypeError, code);
    assert.ok(traced instanceof TypeError, code);
    assert.equal(traced.message, plain.message, code);
  }
  // The same parity for a method missing on any object, on any runtime.
  assert.throws(() => run("let o = {}; o.nope();"), /o\.nope is not a function/);
  assert.throws(() => run("(1)();"), /1 is not a function/);
});
