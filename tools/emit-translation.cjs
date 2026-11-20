// Driver for the translate execution-matrix gate: emits Python for one
// JavaScript program through a given dist build, so the gate can test
// the exact artifact that ships (not src/).
//
// Usage: node tools/emit-translation.js <dist-path> <js-file>
// Prints the emitted Python to stdout. If the translation report is
// not ok, or translate() throws, exits non-zero with the report on
// stderr — a gate that cannot emit is a gate failure, not a skip.
"use strict";

const path = require("node:path");
const fs = require("node:fs");

let distPath = process.argv[2];
const jsFile = process.argv[3];
if (!distPath || !jsFile) {
  process.stderr.write("usage: emit-translation.js <dist-path> <js-file>\n");
  process.exit(2);
}

let Iroh;
try {
  Iroh = require(path.resolve(distPath));
} catch (e) {
  process.stderr.write("cannot load dist " + distPath + ": " + (e.message || e) + "\n");
  process.exit(2);
}

const code = fs.readFileSync(jsFile, "utf8");
let out;
try {
  out = Iroh.translate(code, { to: "python" });
} catch (e) {
  process.stderr.write("translate() threw: " + (e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
}
if (!out || !out.report || !out.report.ok) {
  process.stderr.write("translate report not ok: " + JSON.stringify(out && out.report) + "\n");
  process.exit(1);
}
process.stdout.write(out.code);
