// Suite-summary tests (1.1.1, F2): the summary line must name what
// ran, what failed, and what was skipped — per leg — so a skipped
// leg can never read like a passing one. These tests pin the
// parsers against sample output in both reporter formats (the Node
// 24 spec reporter and the Node 22 TAP reporter), because the
// reporter differs by Node version and a parser that only handles
// one of them would silently report 0/0/0 on the other.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseNodeOutput,
  parseUnittestOutput,
  parseCppOutput,
  skippedLeg,
  summary,
} = require("./suite-summary");

test("parseNodeOutput reads the Node 24 spec reporter", () => {
  let text =
    "✔ hashbang scripts trace (12.6ms)\n" +
    "﹣ RegExp modifiers trace (1.0ms) # RegExp modifiers (?i:...) needs Node 24 (running v22.23.2)\n" +
    "✔ await using traces (121.3ms)\n" +
    "ℹ tests 425\n" +
    "ℹ pass 416\n" +
    "ℹ fail 0\n" +
    "ℹ skipped 9\n";
  let row = parseNodeOutput(text);
  assert.equal(row.leg, "node");
  assert.equal(row.ran, 425);
  assert.equal(row.failed, 0);
  assert.equal(row.skipped, 9);
  assert.equal(row.skips.length, 1);
  assert.match(row.skips[0], /RegExp modifiers trace/);
  assert.match(row.skips[0], /needs Node 24/);
});

test("parseNodeOutput reads the Node 22 TAP reporter", () => {
  let text =
    "ok 1 - hashbang scripts trace\n" +
    "not ok 2 - RegExp modifiers trace # SKIP RegExp modifiers (?i:...) needs Node 24 (running v22.23.2)\n" +
    "ok 3 - await using traces\n" +
    "# tests 425\n" +
    "# suites 0\n" +
    "# pass 416\n" +
    "# fail 0\n" +
    "# cancelled 0\n" +
    "# skipped 9\n" +
    "# todo 0\n";
  let row = parseNodeOutput(text);
  assert.equal(row.leg, "node");
  assert.equal(row.ran, 425);
  assert.equal(row.failed, 0);
  assert.equal(row.skipped, 9);
  assert.equal(row.skips.length, 1);
  assert.match(row.skips[0], /RegExp modifiers trace/);
});

test("parseNodeOutput counts a real failure", () => {
  let text = "not ok 1 - something broke\n# tests 10\n# pass 9\n# fail 1\n# skipped 0\n";
  let row = parseNodeOutput(text);
  assert.equal(row.ran, 10);
  assert.equal(row.failed, 1);
  assert.equal(row.skipped, 0);
});

test("parseUnittestOutput reads a clean run and a run with skips", () => {
  let clean = ".....\n----------------------------------------------------------------------\nRan 25 tests in 1.497s\n\nOK\n";
  let row = parseUnittestOutput(clean, "python");
  assert.equal(row.leg, "python");
  assert.equal(row.ran, 25);
  assert.equal(row.failed, 0);
  assert.equal(row.skipped, 0);
  assert.deepEqual(row.skips, []);

  let withSkips =
    "test_one (mod.TestClass) ... ok\n" +
    "test_two (mod.TestClass) ... skipped 'needs python 3.11'\n" +
    "----------------------------------------------------------------------\n" +
    "Ran 2 tests in 0.01s\n" +
    "\n" +
    "OK (skipped=1)\n";
  row = parseUnittestOutput(withSkips, "python");
  assert.equal(row.ran, 2);
  assert.equal(row.skipped, 1);
  assert.equal(row.skips.length, 1);
  assert.match(row.skips[0], /test_two/);

  let failed = "Ran 3 tests in 0.02s\n\nFAILED (failures=1, errors=1, skipped=1)\n";
  row = parseUnittestOutput(failed, "irohscript");
  assert.equal(row.leg, "irohscript");
  assert.equal(row.ran, 3);
  assert.equal(row.failed, 2);
  assert.equal(row.skipped, 1);
});

test("parseCppOutput reports the documented 9 groups when all pass lines are present", () => {
  let text =
    "make: Entering directory 'cpp'\n" +
    "./test_client\n" +
    "All C++ client tests passed.\n" +
    "All C++ native tracer tests passed.\n" +
    "./test_filter\n" +
    "test_filter: all classify_mangled checks passed\n";
  let row = parseCppOutput(text);
  assert.equal(row.leg, "cpp");
  assert.equal(row.ran, 9);
  assert.equal(row.failed, 0);
  assert.deepEqual(row.skips, []);

  let broken = "make: Entering directory 'cpp'\n./test_client\nAll C++ client tests passed.\n";
  row = parseCppOutput(broken);
  assert.equal(row.ran, 0);
  assert.equal(row.failed, 1);
  assert.match(row.skips[0], /1 of 3 pass lines/);
});

test("skippedLeg names the reason a leg did not run", () => {
  let row = skippedLeg("python", "python3 not found");
  assert.equal(row.leg, "python");
  assert.equal(row.ran, 0);
  assert.equal(row.failed, 0);
  assert.equal(row.skipped, 0);
  assert.equal(row.skips.length, 1);
  assert.match(row.skips[0], /python3 not found/);
  assert.match(row.skips[0], /did not run/);
});

test("summary wraps the legs in the brief's shape", () => {
  let report = summary([{ leg: "node", ran: 425, failed: 0, skipped: 0, skips: [] }]);
  assert.equal(report.type, "suite-summary");
  assert.equal(report.legs.length, 1);
});

test("npm test wrote a suite-summary file, and it matches the last run", () => {
  let file = path.join(__dirname, "..", "test-results", "suite-summary.json");
  assert.ok(fs.existsSync(file), "test-results/suite-summary.json should exist after npm test");
  let report = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(report.type, "suite-summary");
  assert.equal(report.legs.length, 4);
  let byLeg = {};
  for (let leg of report.legs) byLeg[leg.leg] = leg;
  // On this box (Node 24, python3, g++) every leg runs. The ran
  // counts are the current suite sizes.
  assert.equal(byLeg.node.ran, 433);
  assert.equal(byLeg.python.ran, 25);
  assert.equal(byLeg.irohscript.ran, 230);
  assert.equal(byLeg.cpp.ran, 9);
  // Deliberately NOT asserting failed === 0 or skipped === 0 here:
  // the file records the PREVIOUS run, and this test's own failure
  // (if it ever failed) would be in that file — asserting the
  // previous run was clean would make one failure permanent. The
  // previous run's cleanliness is what `npm test`'s exit code
  // already proves.
  for (let leg of report.legs) {
    assert.equal(typeof leg.failed, "number");
    assert.equal(typeof leg.skipped, "number");
    assert.ok(Array.isArray(leg.skips));
  }
});
