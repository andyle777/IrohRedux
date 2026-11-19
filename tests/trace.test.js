// Tests for the modern one-shot SDK: Iroh.trace() / Iroh.traceAsync().
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Iroh = require("../dist/iroh-node.js");

test("trace() returns events and the live result", () => {
  let { events, result } = Iroh.trace(
    `function factorial(n) {
       if (n === 0) return 1;
       return n * factorial(n - 1);
     };
     factorial(3);`,
    { events: ["CALL", "IF"] }
  );
  assert.equal(result, 6);
  let calls = events.filter((e) => e.event === "FUNCTION_CALL");
  assert.deepEqual(calls.map((c) => c.arguments), [[3], [2], [1], [0]]);
  let ends = events.filter((e) => e.event === "FUNCTION_CALL_END");
  assert.deepEqual(ends.map((e) => e.return), [1, 1, 2, 6]);
  assert.ok(events.every((e) => e.type === "event" && typeof e.hash === "number"));
});

test("trace() defaults to all categories", () => {
  let { events, result } = Iroh.trace("let x = 1; x;");
  assert.equal(result, 1);
  let categories = new Set(events.map((e) => e.category));
  assert.ok(categories.has("VAR"));
});

test("trace() accepts a comma string for events", () => {
  let { events } = Iroh.trace("let x = 1; x;", { events: "VAR" });
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.category === "VAR"));
});

test("trace() calls onEvent for every event", () => {
  let seen = [];
  let { result } = Iroh.trace("let x = [1,2,3].map(v => v * 2); x;", {
    events: ["VAR"],
    onEvent: (e) => seen.push(e),
  });
  assert.deepEqual(result, [2, 4, 6]);
  assert.ok(seen.some((e) => e.event === "VAR_INIT" && e.name === "x"));
});

test("trace() rejects an unknown category", () => {
  assert.throws(() => Iroh.trace("1;", { events: ["NOPE"] }), /Unknown event category: NOPE/);
});

test("trace() throws a parse error before running", () => {
  assert.throws(() => Iroh.trace("let x = ;"), { name: "SyntaxError" });
});

test("trace() attaches the events that fired before a runtime error", () => {
  let caught = null;
  try {
    Iroh.trace("let a = 1; throw new Error('boom');");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.equal(caught.message, "boom");
  assert.ok(Array.isArray(caught.events) && caught.events.length > 0);
});

test("traceAsync() awaits the program and includes async events", async () => {
  let { events, result } = await Iroh.traceAsync(
    "async function f() { return await Promise.resolve(42); } f();",
    { events: ["AWAIT"] }
  );
  assert.equal(result, 42);
  assert.equal(events.filter((e) => e.event === "AWAIT").length, 1);
});

test("traceAsync() attaches events to an async rejection", async () => {
  let caught = null;
  try {
    await Iroh.traceAsync(
      "async function f() { await Promise.resolve(); throw new Error('async-boom'); } f();",
      { events: ["AWAIT"] }
    );
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.equal(caught.message, "async-boom");
  assert.ok(Array.isArray(caught.events));
  assert.equal(caught.events.filter((e) => e.event === "AWAIT").length, 1);
});

test("trace() with an empty events list collects nothing but still runs", () => {
  let { events, result } = Iroh.trace("let x = 1 + 1; x;", { events: [] });
  assert.deepEqual(events, []);
  assert.equal(result, 2);
});

test("trace() passes stageOptions to the Stage", () => {
  // `using` needs the latest parser: with ecmaVersion 2022 it is a
  // parse error, with the default it traces.
  let code = "function f() { using x = { [Symbol.dispose]() {} }; return 1; } f();";
  assert.throws(
    () => Iroh.trace(code, { stageOptions: { ecmaVersion: 2022 } }),
    { name: "SyntaxError" }
  );
  let { result } = Iroh.trace(code);
  assert.equal(result, 1);
});

test("eventToJSON matches the shape trace() returns", () => {
  let stage = new Iroh.Stage("let x = 1;");
  let line = null;
  stage.addListener(Iroh.VAR).on("before", (e) => {
    line = Iroh.eventToJSON(e, "before");
  });
  eval(stage.script);
  assert.equal(line.type, "event");
  assert.equal(line.category, "VAR");
  assert.equal(line.trigger, "before");
  assert.equal(typeof line.hash, "number");
});
