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

test("traceAsync() rethrows a primitive rejection unchanged", async () => {
  let caught = "not caught";
  try {
    await Iroh.traceAsync(
      "async function f() { await Promise.resolve(); throw 'async-oops'; } f();"
    );
  } catch (e) {
    caught = e;
  }
  assert.equal(caught, "async-oops");
});

test("trace() with an empty events list collects nothing but still runs", () => {
  let { events, result } = Iroh.trace("let x = 1 + 1; x;", { events: [] });
  assert.deepEqual(events, []);
  assert.equal(result, 2);
});

test("trace() returns the completion value of a trailing bare block", () => {
  // Was undefined before the patcher learned to look inside blocks.
  assert.equal(Iroh.trace("{ 1; }").result, 1);
  assert.equal(Iroh.trace("{ { 2; } }").result, 2);
  assert.equal(Iroh.trace("let x = 1; { x + 1; }").result, 2);
  assert.equal(Iroh.trace("{ let y = 1; }").result, undefined);
  // Pre-existing looseness, kept: the last expression statement wins
  // even when a declaration follows it.
  assert.equal(Iroh.trace("let a = 5; a; let b = 1;").result, 5);
});

test("trace() lets a program declare its own top-level Iroh", () => {
  // The Function parameter is named Iroh, so a program declaring its
  // own Iroh used to fail with "Identifier 'Iroh' has already been
  // declared". The fallback retries with the instance under $$Iroh.
  let { result } = Iroh.trace("const Iroh = 5; Iroh;");
  assert.equal(result, 5);
});

test("trace() rethrows primitive values unchanged", () => {
  assert.throws(() => Iroh.trace("throw 'oops';"), (e) => e === "oops");
  assert.throws(() => Iroh.trace("throw 42;"), (e) => e === 42);
  assert.throws(() => Iroh.trace("throw null;"), (e) => e === null);
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

test("traceAsync() accepts top-level await in scripts", async () => {
  // The whole program is one awaited expression.
  let { events, result } = await Iroh.traceAsync("await Promise.resolve(42);", {
    events: ["AWAIT"],
  });
  assert.equal(result, 42);
  assert.equal(events.filter((e) => e.event === "AWAIT").length, 1);
});

test("traceAsync() awaits top-level values before using them", async () => {
  let { result } = await Iroh.traceAsync(
    "let x = await Promise.resolve(40); let y = await Promise.resolve(2); x + y;"
  );
  assert.equal(result, 42);
});

test("trace() rejects top-level await with a pointer at traceAsync()", () => {
  assert.throws(
    () => Iroh.trace("await Promise.resolve(42);"),
    /traceAsync/
  );
});

test("traceAsync() lets a top-level-await program declare its own Iroh", async () => {
  // Both retries at once: async wrapper + $$Iroh fallback.
  let { result } = await Iroh.traceAsync("const Iroh = 5; await Promise.resolve(Iroh);");
  assert.equal(result, 5);
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

test("trace() with maxEvents stops a runaway and attaches the partial events", () => {
  let err = null;
  try {
    Iroh.trace("let i = 0; while (true) { i++; } i;", { maxEvents: 100 });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, "the run stops with an error");
  assert.match(err.message, /maxEvents \(100\)/);
  assert.ok(Array.isArray(err.events), "the partial events ride on the error");
  assert.ok(err.events.length > 100, "the event that tripped the cap is recorded");
  assert.ok(err.events.length < 200, "the run stops promptly, it does not run on");
});

test("trace() with maxEvents not reached returns normally", () => {
  let { events, result } = Iroh.trace("let x = 1; x;", { maxEvents: 1000 });
  assert.equal(result, 1);
  assert.ok(events.length > 0 && events.length <= 1000);
});

test("trace() with a bad maxEvents throws a clear error before running", () => {
  assert.throws(() => Iroh.trace("let x = 1; x;", { maxEvents: 0 }), /positive integer/);
  assert.throws(() => Iroh.trace("let x = 1; x;", { maxEvents: -5 }), /positive integer/);
  assert.throws(() => Iroh.trace("let x = 1; x;", { maxEvents: 1.5 }), /positive integer/);
  assert.throws(() => Iroh.trace("let x = 1; x;", { maxEvents: "100" }), /positive integer/);
});
