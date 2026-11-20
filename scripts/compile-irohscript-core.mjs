// Regenerate the IrohScript-compiled core files from their sources:
//   irohscript/core/perceptron.iroh -> src/neurons-irohscript.js
//
// Run: npm run codegen:irohscript
// (That builds the dist bundle first — the compiler lives in src/,
// and raw Node cannot import src/ files directly because the repo's
// imports are extensionless, which only the bundler resolves — then
// compiles through the built bundle, writes the generated file, and
// rebuilds so dist picks it up.)
// The generated files are checked in (the dist bundle is built from
// src/, and the library must work without python3 present), so run
// this after changing any irohscript/core/*.iroh source and commit the
// regenerated file with it. tests/irohscript-codegen.test.js fails if
// the checked-in file drifts from a fresh compile.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Iroh from "../dist/iroh-node.es.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = [
  "// GENERATED — do not edit by hand. Source: irohscript/core/perceptron.iroh",
  "// Regenerate with: npm run codegen:irohscript",
  "// (IrohScript -> JavaScript, src/irohscript-codegen.js; division/modulo are Python-style.)",
  "",
].join("\n");

const source = readFileSync(path.join(ROOT, "irohscript", "core", "perceptron.iroh"), "utf8");
const compiled = await Iroh.compileIrohscriptAsync(source, {
  irohscriptHome: path.join(ROOT, "irohscript"),
});
writeFileSync(path.join(ROOT, "src", "neurons-irohscript.js"), HEADER + compiled);
console.log("compiled irohscript/core/perceptron.iroh -> src/neurons-irohscript.js");
