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
      let target = path.join(dir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, files[name]);
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

test("traceModule() traces an anonymous default-exported function", async () => {
  // Self-scan finding (26 Nov 2026): STAGE1.FunctionDeclaration read
  // `node.id.name` with no guard, and `export default function() {}`
  // has id null — the whole trace threw. The engine's own
  // src/extend.js is exactly that shape. The anonymous export must be
  // in the traced module itself: an imported one loads natively and is
  // never patched, so it would not exercise the bug.
  let { events, result } = await Iroh.traceModule(
    `export default function(a, b) { return a + b; }\nexport const v = 1;`,
    { filename: path.join(os.tmpdir(), "iroh-anon-default.mjs") }
  );
  assert.equal(result.v, 1);
  assert.equal(typeof result.default, "function");
  assert.ok(events.length > 0);
});

test("traceModule() re-executes the same file on repeated traces", async () => {
  // Self-scan finding (26 Nov 2026): stage keys repeat across traces
  // in one process (resetPatchCounters), so the temp .mjs filename
  // repeated too — and Node's ESM loader caches modules by URL, so
  // the third and later traces of the same file returned the cached
  // module without executing it (0 events, stale result).
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-retrace-"));
  try {
    let file = path.join(dir, "main.mjs");
    let code = `globalThis.__retraceCount = (globalThis.__retraceCount || 0) + 1;\nexport const n = globalThis.__retraceCount;`;
    let start = globalThis.__retraceCount || 0;
    let seen = [];
    for (let ii = 0; ii < 4; ii++) {
      let { events, result } = await Iroh.traceModule(code, { filename: file });
      seen.push(result.n);
      assert.ok(events.length > 0, "trace " + (ii + 1) + " produced no events");
    }
    assert.deepEqual(seen, [start + 1, start + 2, start + 3, start + 4]);
  } finally {
    delete globalThis.__retraceCount;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// traceModule import-specifier rewriting (26 Nov 2026): Node's ESM
// loader rejects extensionless relative imports and JSON imports
// without `with { type: "json" }`, and a JSON module only provides a
// default export — so a traced module using those forms failed at link
// time. traceModule now rewrites the specifiers in the temp copy
// (the original files are never touched). Each test below fails on
// the old dist and passes on the fixed one.

test("traceModule() resolves extensionless relative imports", async () => {
  let { result } = await withModuleDir(
    { "helper.js": "export function add(a, b) { return a + b; }\n" },
    (dir) => Iroh.traceModule(
      `import { add } from "./helper";\nexport const total = add(2, 3);`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.total, 5);
});

test("traceModule() resolves extensionless directory imports", async () => {
  let { result } = await withModuleDir(
    { "sub/index.js": "export const v = 7;\n" },
    (dir) => Iroh.traceModule(
      `import { v } from "./sub";\nexport const w = v * 2;`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.w, 14);
});

test("traceModule() resolves extensionless imports transitively", async () => {
  // The rewrite has to cover the whole reachable graph, not just the
  // traced file: a.js is loaded by Node as-is, so its own
  // extensionless import of ./b must be rewritten too — otherwise the
  // trace dies at the second hop.
  let { result } = await withModuleDir(
    {
      "a.js": "import { y } from \"./b\";\nexport const x = y;\n",
      "b.js": "export const y = 41;\n",
    },
    (dir) => Iroh.traceModule(
      `import { x } from "./a";\nexport const v = x + 1;`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.v, 42);
});

test("traceModule() rewrites named JSON imports to a default import", async () => {
  let { result } = await withModuleDir(
    { "data.json": JSON.stringify({ n: 99, version: "1.2.3" }) },
    (dir) => Iroh.traceModule(
      `import { version as VV } from "./data.json";\nexport const v = VV;`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.v, "1.2.3");
});

test("traceModule() adds the JSON import attribute for default JSON imports", async () => {
  // A default JSON import with no attribute also fails on Node 24
  // (ERR_IMPORT_ATTRIBUTE_MISSING) — the attribute is part of the
  // rewrite, not just the named-import fix.
  let { result } = await withModuleDir(
    { "data.json": JSON.stringify({ n: 99 }) },
    (dir) => Iroh.traceModule(
      `import data from "./data.json";\nexport const n = data.n;`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.n, 99);
});

test("traceModule() traces the engine's own src/setup.js", async () => {
  // End-to-end proof: setup.js imports ./labels, ./cfg and ./helpers
  // extensionless, and cfg.js has a named JSON import — the whole
  // closure has to resolve for this to trace.
  let file = path.join(__dirname, "..", "src", "setup.js");
  let code = fs.readFileSync(file, "utf8");
  let { events, result } = await Iroh.traceModule(code, { filename: file });
  assert.ok(events.length > 0, "expected events from tracing setup.js");
  assert.equal(typeof result.trace, "function");
  assert.equal(typeof result.traceModule, "function");
});

test("traceModule() traces the engine's own src/index.js", async () => {
  // The full engine entry: index.js imports the whole src tree
  // extensionless. Tracing it executes the module (a second Iroh
  // singleton is built inside the traced module) and returns its
  // namespace — the default export is that singleton.
  let file = path.join(__dirname, "..", "src", "index.js");
  let code = fs.readFileSync(file, "utf8");
  let { events, result } = await Iroh.traceModule(code, { filename: file });
  assert.ok(events.length > 0, "expected events from tracing index.js");
  assert.equal(typeof result.default.trace, "function");
});

// Two caveats fixed (26 Nov 2026): a dynamic JSON import lost its
// DEBUG wrapper, and mirrored .js files printed Node's
// typeless-package warning. Each test below fails on the old dist
// and passes on the fixed one.

test("traceModule() keeps the DEBUG wrapper on a dynamic JSON import", async () => {
  // The rewrite used to replace the whole import() call with an
  // attributed one, dropping the DEBUG_LITERAL wrapper the patcher
  // puts around the specifier — so no LITERAL event fired for it,
  // even though the import itself still ran. The wrapper is kept
  // now and the attribute is added as the second import() argument.
  let { events, result } = await withModuleDir(
    { "data.json": JSON.stringify({ n: 99 }) },
    (dir) => Iroh.traceModule(
      `const m = await import("./data.json");\nexport const n = m.default.n;`,
      { filename: path.join(dir, "main.mjs") }
    )
  );
  assert.equal(result.n, 99);
  let literals = events.filter((e) => e.event === "LITERAL").map((e) => e.value);
  assert.ok(literals.indexOf("./data.json") !== -1,
    "expected a LITERAL event for ./data.json, got " + JSON.stringify(literals));
});

test("traceModule() mirror emits no typeless-package warning and traces mixed CJS/ESM graphs", async () => {
  // The temp mirror used to hold .js files with ESM syntax under a
  // typeless package.json (copied in through the JSON import), so
  // Node warned [MODULE_TYPELESS_PACKAGE_JSON] on stderr. ESM .js
  // files are now mirrored as .mjs — CJS files stay .js — so no
  // warning fires and mixed graphs still trace.
  let warnings = [];
  function onWarning(w) { warnings.push(w); }
  process.on("warning", onWarning);
  let v;
  try {
    let out = await withModuleDir(
      {
        "esm.js": "export const e = 3;\n",
        "cjs.js": "module.exports = { c: 4 };\n",
        "data.json": JSON.stringify({ n: 99 }),
        "package.json": JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      },
      (dir) => Iroh.traceModule(
        `import { e } from "./esm";\nimport cjs from "./cjs.js";\nimport data from "./data.json";\nimport pkg from "./package.json";\nexport const v = e + cjs.c + data.n;\nexport const pv = pkg.version;`,
        { filename: path.join(dir, "main.mjs") }
      )
    );
    v = out.result;
    // process.emitWarning delivers the 'warning' event on a later
    // tick (stderr prints immediately); let it land before the
    // listener is detached, or a real warning would be missed.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.removeListener("warning", onWarning);
  }
  assert.equal(v.v, 106);
  assert.equal(v.pv, "1.0.0");
  let typeless = warnings.filter((w) => w.code === "MODULE_TYPELESS_PACKAGE_JSON");
  assert.deepEqual(typeless, []);
});
