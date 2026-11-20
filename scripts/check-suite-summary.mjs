// Suite-summary gate (1.1.1 CI fix): validate the file `npm test`
// just wrote — test-results/suite-summary.json — right after the
// run, when the file is fresh. This is the check that belongs AFTER
// the write, not inside the suite: tests/suite-summary.test.js runs
// in the node leg, before tests/index.js writes the file, so it can
// only ever read the PREVIOUS run's file — on a fresh checkout there
// is no previous file at all, and a hardcoded count from the last
// run goes stale the moment a test is added (node ran 435, the test
// demanded 433, and CI went red on all 28 runs of 1.1.1 while the
// code itself passed 434 of 435). That test now checks shape only
// and skips when no previous file exists; this script is the gate
// that checks values: the file exists, has the four legs, every leg
// ran (or named why it did not run — never a silent pass), and
// nothing failed.
//
// Run: node scripts/check-suite-summary.mjs
// (Also run as `npm run check:summary`, right after `npm test` in CI.)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILE = path.join(ROOT, "test-results", "suite-summary.json");
const LEGS = ["node", "python", "irohscript", "cpp"];

let problems = [];

let report = null;
try {
  report = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (e) {
  console.error("suite-summary gate: cannot read " + FILE + " (" + e.message + ") — run `npm test` first.");
  process.exit(1);
}

if (report.type !== "suite-summary") problems.push("type is " + JSON.stringify(report.type) + ", not \"suite-summary\"");
if (!Array.isArray(report.legs) || report.legs.length !== 4) {
  problems.push("legs is not the 4 expected legs");
} else {
  let byLeg = {};
  for (let leg of report.legs) byLeg[leg.leg] = leg;
  for (let name of LEGS) {
    let leg = byLeg[name];
    if (!leg) {
      problems.push("leg " + name + " is missing");
      continue;
    }
    for (let field of ["ran", "failed", "skipped"]) {
      if (typeof leg[field] !== "number") problems.push("leg " + name + ": " + field + " is not a number");
    }
    if (!Array.isArray(leg.skips)) problems.push("leg " + name + ": skips is not an array");
    if (leg.failed > 0) problems.push("leg " + name + ": failed " + leg.failed);
    if (leg.ran === 0 && leg.skips.length === 0) {
      problems.push("leg " + name + ": ran 0 tests and named no reason (did-not-run must be named, never passed)");
    }
  }
}

if (problems.length > 0) {
  console.error("suite-summary gate: FAILED");
  for (let problem of problems) console.error("  - " + problem);
  process.exit(1);
}

let line = report.legs.map((leg) => leg.leg + " " + leg.ran + " ran / " + leg.failed + " failed").join(", ");
console.log("suite-summary gate: OK (" + line + ")");
