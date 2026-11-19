// Tests for ES modules (0.7.0): Iroh.traceModule(), plus the error
// pointers trace()/traceAsync() give for module code.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Iroh = require("../dist/iroh-node.js");

// Run `fn(dir)` with a fresh temp directory holding `files`
// ({ name: content }), removed afterwards.
async function withModuleDir(files, fn) {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-modules-test-"));
  try {
    for (let name of Object.keys(files)) {
      fs.writeFileSync(path.join(dir, name), files[name]);
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("traceModule() traces import/export and returns the namespace", async () => {
  let { events, result } = await withModuleDir(
    { "helper.mjs": "export function add(a, b) { return a + b; }\n" },
    (dir) => Iroh.traceModule(
      `import { add } from "./helper.mjs";\nexport const total = add(2, 3);\nexport default total * 2;`,
      { events: ["CALL", "VAR"], filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.total, 5);
  assert.equal(result.default, 10);
  let calls = events.filter((e) => e.event === "FUNCTION_CALL");
  assert.deepEqual(calls.map((c) => c.name), ["add"]);
  assert.deepEqual(calls.map((c) => c.arguments), [[2, 3]]);
});

test("traceModule() supports import attributes (JSON)", async () => {
  let { result } = await withModuleDir(
    { "data.json": JSON.stringify({ n: 99 }) },
    (dir) => Iroh.traceModule(
      `import data from "./data.json" with { type: "json" };\nexport const n = data.n;`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.n, 99);
});

test("traceModule() exposes import.meta and top-level await", async () => {
  let { events, result } = await withModuleDir(
    { "helper.mjs": "export function add(a, b) { return a + b; }\n" },
    (dir) => Iroh.traceModule(
      `export const url = import.meta.url;\nconst mod = await import("./helper.mjs");\nexport const v = mod.add(10, 20);`,
      { events: ["AWAIT"], filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(typeof result.url, "string");
  assert.ok(result.url.endsWith(".mjs"));
  assert.equal(result.v, 30);
  assert.equal(events.filter((e) => e.event === "AWAIT").length, 1);
});

test("traceModule() rejects a runtime error with the events before it", async () => {
  let caught = null;
  try {
    await Iroh.traceModule(`let a = 1; throw new Error("mod-boom");`, {
      events: ["VAR"],
    });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.equal(caught.message, "mod-boom");
  assert.ok(Array.isArray(caught.events) && caught.events.length > 0);
});

test("traceModule() rejects a parse error before running", async () => {
  await assert.rejects(
    Iroh.traceModule(`export const x = ;`),
    { name: "SyntaxError" }
  );
});

test("traceModule() without filename cannot resolve relative imports", async () => {
  // Documented behaviour: with no filename the temp file lives under
  // os.tmpdir(), so a relative import has nothing to resolve against.
  await assert.rejects(
    Iroh.traceModule(`import { add } from "./helper.mjs";\nexport const v = add(1, 2);`),
    (e) => e.code === "ERR_MODULE_NOT_FOUND"
  );
});

test("trace() points module code at traceModule()", () => {
  assert.throws(
    () => Iroh.trace("import x from './x.js';"),
    /traceModule/
  );
  assert.throws(
    () => Iroh.trace("export const x = 1;"),
    /traceModule/
  );
});

test("traceAsync() points module code at traceModule()", async () => {
  await assert.rejects(
    Iroh.traceAsync("import x from './x.js';"),
    /traceModule/
  );
});

test("traceModule() cleans up its temp file and registry", async () => {
  // The temp directory is removed and globalThis.__irohStages is not
  // left behind after the import settles.
  let before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("iroh-trace-"));
  await Iroh.traceModule(`export const a = 1;`);
  let after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("iroh-trace-"));
  assert.deepEqual(after, before);
  assert.equal("__irohStages" in globalThis, false);
});

test("traceModule() handles concurrent traces", async () => {
  let [a, b] = await Promise.all([
    Iroh.traceModule(`export const a = 1;`),
    Iroh.traceModule(`export const b = 2;`),
  ]);
  assert.equal(a.result.a, 1);
  assert.equal(b.result.b, 2);
  assert.equal("__irohStages" in globalThis, false);
});

test("traceModule() traces a decorated exported class", async () => {
  let { result } = await Iroh.traceModule(
    `function tag(cls, ctx) { cls.tagged = true; return cls; }\n@tag export class Foo {}\nexport const tagged = Foo.tagged;`,
    { events: ["CALL"] }
  );
  assert.equal(result.tagged, true);
});
