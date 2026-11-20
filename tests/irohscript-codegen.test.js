// Tests for the IrohScript -> JavaScript code generator (part 3 of
// the 1.0.1 rework): src/irohscript-codegen.js, the compiled
// perceptron (irohscript/core/perceptron.iroh ->
// src/neurons-irohscript.js), and the wiring into src/neurons.js.
// The compiler either emits clean, runnable JavaScript or throws a
// clear error naming the construct — there is no report and no stub.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Iroh = require("../dist/iroh-node.js");

const ROOT = path.join(__dirname, "..");
const CORE_IROH = path.join(ROOT, "irohscript", "core", "perceptron.iroh");
const GENERATED_JS = path.join(ROOT, "src", "neurons-irohscript.js");

// Compile IrohScript source, write the JavaScript to a temp .mjs
// file, import it, and return the module namespace.
async function importCompiled(source) {
  let code = Iroh.compileIrohscript(source, { irohscriptHome: path.join(ROOT, "irohscript") });
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-codegen-"));
  try {
    let file = path.join(dir, "compiled.mjs");
    fs.writeFileSync(file, code);
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("compileIrohscript: Add(10, 20) compiles and runs to 30", async () => {
  let mod = await importCompiled(
    "FUNCTION Add(a, b)\n    RETURN a + b\nEND FUNCTION\n"
  );
  assert.equal(mod.Add(10, 20), 30);
});

test("compileIrohscript: the perceptron scores the probe vector 0.101335, label hot", async () => {
  let source = fs.readFileSync(CORE_IROH, "utf8");
  let mod = await importCompiled(source);
  let f = mod.Features();
  f.calls = 0.5; f.depth = 0.25; f.repeat = 0.8; f.imbalance = 0.1; f.mix = 0.6;
  let w = mod.Weights();
  w.w0 = 0.1218; w.w1 = 0.1037; w.w2 = 0.1217; w.w3 = -0.0253; w.w4 = 0.0328; w.bias = -0.1;
  assert.ok(Math.abs(mod.PredictScore(f, w) - 0.101335) < 1e-12);
  assert.equal(mod.PredictLabel(mod.PredictScore(f, w)), "hot");
  assert.equal(mod.PredictLabel(0), "hot");
  assert.equal(mod.PredictLabel(-0.00001), "normal");
  let r = mod.Predict(f, w);
  assert.ok(Math.abs(r.score - 0.101335) < 1e-12);
  assert.equal(r.label, "hot");
  // Struct factories carry the typed defaults.
  assert.deepEqual(mod.Features(), { calls: 0, depth: 0, repeat: 0, imbalance: 0, mix: 0 });
  assert.deepEqual(mod.Result(), { score: 0, label: "" });
});

test("compileIrohscript: nested struct assignment compiles and runs", async () => {
  // The bootstrap parser used to gate member assignment to one level
  // (`o.inner.x = 3` was a parse error), and the interpreter
  // defaulted a struct-typed field to None, so the assignment died
  // at runtime. Both are fixed; the compiler's MemberAccess emission
  // was already recursive.
  let mod = await importCompiled(
    "STRUCT Inner\n    x : Int\nEND STRUCT\n" +
    "STRUCT Outer\n    inner : Inner\n    n : Int\nEND STRUCT\n" +
    "FUNCTION Build()\n    LET o : Outer\n    o.n = 7\n    o.inner.x = 3\n    RETURN o.n + o.inner.x\nEND FUNCTION\n"
  );
  assert.equal(mod.Build(), 10);
});

test("compileIrohscript: the compiled perceptron agrees with the JavaScript one", async () => {
  let source = fs.readFileSync(CORE_IROH, "utf8");
  let mod = await importCompiled(source);
  let js = Iroh.createPerceptron();
  let vectors = [
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [0.5, 0.25, 0.8, 0.1, 0.6],
    [0.02, 0.05, 0.99, 0.9, 0.1],
    [0.9, 0.95, 0.05, 0, 0.85],
  ];
  for (let v of vectors) {
    let f = mod.Features();
    f.calls = v[0]; f.depth = v[1]; f.repeat = v[2]; f.imbalance = v[3]; f.mix = v[4];
    let w = mod.Weights();
    w.w0 = 0.1218; w.w1 = 0.1037; w.w2 = 0.1217; w.w3 = -0.0253; w.w4 = 0.0328; w.bias = -0.1;
    let expected = js.predict(v);
    let got = Math.round(mod.PredictScore(f, w) * 10000) / 10000;
    assert.equal(got, expected.score);
    assert.equal(mod.PredictLabel(got), expected.label);
  }
});

test("compileIrohscript: the wired-in neuron classifies a hot loop exactly as before", () => {
  let { analysis } = Iroh.analyzeTrace(
    "let s = 0;\nfor (let i = 0; i < 150; i++) { s += i; }\ns;"
  );
  let hot = analysis.findings.find((f) => f.code === "HOT_LOOP");
  assert.ok(hot);
  assert.equal(hot.neuron.label, "hot");
  assert.equal(hot.neuron.score, 0.0259);
});

test("compileIrohscript: modulo is floored (Python-style), division is float", async () => {
  let mod = await importCompiled(
    "FUNCTION Fmod(a, b)\n    RETURN a % b\nEND FUNCTION\n" +
    "FUNCTION Fdiv(a, b)\n    RETURN a / b\nEND FUNCTION\n"
  );
  assert.equal(mod.Fmod(-5, 3), 1);
  assert.equal(mod.Fmod(5, 3), 2);
  assert.equal(mod.Fdiv(7, 2), 3.5);
});

test("compileIrohscript: LOOP, ACTION, INTENT and IMPORT throw a clear error", () => {
  assert.throws(
    () => Iroh.compileIrohscript("LOOP\n    PRINT 1\nEND LOOP\n", { irohscriptHome: path.join(ROOT, "irohscript") }),
    /Iroh\.compileIrohscript: LOOP has no defined exit condition/
  );
  assert.throws(
    () => Iroh.compileIrohscript("ACTION defend\n", { irohscriptHome: path.join(ROOT, "irohscript") }),
    /Iroh\.compileIrohscript: ACTION is a program behaviour/
  );
  assert.throws(
    () => Iroh.compileIrohscript("INTENT \"watch\"\n", { irohscriptHome: path.join(ROOT, "irohscript") }),
    /Iroh\.compileIrohscript: INTENT is a program behaviour/
  );
  assert.throws(
    () => Iroh.compileIrohscript("IMPORT Math\n", { irohscriptHome: path.join(ROOT, "irohscript") }),
    /Iroh\.compileIrohscript: IMPORT/
  );
});

test("compileIrohscript: a compile error in the source is a compiler error, not a translator one", () => {
  assert.throws(
    () => Iroh.compileIrohscript("FUNCTION Add(a, b)\n    RETURN a + \nEND FUNCTION\n", { irohscriptHome: path.join(ROOT, "irohscript") }),
    /Iroh\.compileIrohscript: /
  );
});

test("compileIrohscriptAsync: the async path compiles the same code", async () => {
  let code = await Iroh.compileIrohscriptAsync(
    "FUNCTION Add(a, b)\n    RETURN a + b\nEND FUNCTION\n",
    { irohscriptHome: path.join(ROOT, "irohscript") }
  );
  assert.match(code, /export function Add\(a, b\)/);
  let sync = Iroh.compileIrohscript(
    "FUNCTION Add(a, b)\n    RETURN a + b\nEND FUNCTION\n",
    { irohscriptHome: path.join(ROOT, "irohscript") }
  );
  assert.equal(code, sync);
});

test("codegen drift: the checked-in src/neurons-irohscript.js matches a fresh compile", async () => {
  let source = fs.readFileSync(CORE_IROH, "utf8");
  let fresh = await Iroh.compileIrohscriptAsync(source, { irohscriptHome: path.join(ROOT, "irohscript") });
  let checkedIn = fs.readFileSync(GENERATED_JS, "utf8");
  let lines = checkedIn.split("\n");
  assert.ok(lines[0].startsWith("// GENERATED"));
  assert.ok(lines[1].startsWith("// Regenerate with: npm run codegen:irohscript"));
  assert.equal(lines[2], "// (IrohScript -> JavaScript, src/irohscript-codegen.js; division/modulo are Python-style.)");
  assert.equal(lines.slice(3).join("\n"), fresh);
});
