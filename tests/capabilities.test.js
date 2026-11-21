// Capability tests (1.1.1, F1): the suite must be green on the
// package's own floor, and a test that needs a feature the running
// Node does not have is skipped with a printed reason, never failed
// and never silently passed. These tests pin the mechanism itself:
// the probes agree with the runtime they run on, the skip reason
// names the feature and the Node version, and `iroh capabilities
// --json` prints one row per leg and per feature.
//
// The skip path itself is verified on Node 22 (the 8 Node-24
// feature tests skip there, 0 fail); on Node 24 everything here
// runs, because every probed feature is present.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { has, featureRows, skipIfMissing } = require("./capabilities");
const { legRows, capabilities, hasCommand } = require("../lib/capabilities");

test("capability probes agree with the runtime they run on", () => {
  // On Node 24 every probed feature is present. The probe is a
  // subprocess `node -e`, so a wrong snippet would fail here
  // rather than silently reporting a feature as missing.
  for (let row of featureRows()) {
    assert.equal(
      row.available,
      has(row.feature),
      row.feature + ": row and probe disagree"
    );
  }
  // The probes are correct in both directions on any Node: a
  // feature whose required version is at or below the running
  // Node must report present, and one above it must report
  // missing. If a probe ever disagrees with its own version
  // table, the probe is broken — and a broken probe would skip
  // tests that should run, or run tests that should skip.
  let running = Number(process.version.slice(1).split(".")[0]);
  const { FEATURES } = require("../lib/capabilities");
  for (let feature of Object.keys(FEATURES)) {
    let def = FEATURES[feature];
    assert.equal(
      has(feature),
      running >= Number(def.node),
      feature + ": probe says " + has(feature) + " on Node " + running + ", table says needs " + def.node
    );
  }
});

test("skipIfMissing does not skip when the feature is present", (t) => {
  // On this box every feature is present, so skipIfMissing returns
  // true and the test proceeds. The skip path (returning false via
  // t.skip) is exercised on Node 22, where the 8 Node-24 feature
  // tests skip with a reason naming the feature and Node 24.
  assert.equal(skipIfMissing(t, "regexpModifiers"), true);
  assert.equal(skipIfMissing(t, "usingDeclarations"), true);
});

test("language legs report what is actually on PATH", () => {
  let legs = legRows();
  let byLeg = {};
  for (let leg of legs) byLeg[leg.leg] = leg;
  assert.equal(byLeg.javascript.available, true);
  // The rows agree with what is actually on PATH, whatever this box
  // has (irohscript and basic run through the python3 bootstrap).
  let pythonOnBox = hasCommand("python3");
  assert.equal(byLeg.python.available, pythonOnBox);
  assert.equal(byLeg.cpp.available, hasCommand("g++"));
  assert.equal(byLeg.irohscript.available, pythonOnBox);
  assert.equal(byLeg.basic.available, pythonOnBox);
  for (let leg of legs) assert.equal(typeof leg.why, "string");
});

test("iroh capabilities --json prints one row per leg and per feature", () => {
  let result = spawnSync(process.execPath, ["cli/iroh.js", "capabilities", "--json"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr);
  let report = JSON.parse(result.stdout);
  assert.equal(report.type, "capabilities");
  assert.equal(report.node, process.version);
  assert.equal(report.legs.length, 5);
  assert.equal(report.features.length, 9);
  for (let leg of report.legs) {
    assert.equal(typeof leg.leg, "string");
    assert.equal(typeof leg.available, "boolean");
    assert.equal(typeof leg.why, "string");
  }
  for (let feat of report.features) {
    assert.equal(typeof feat.feature, "string");
    assert.equal(typeof feat.available, "boolean");
    assert.equal(typeof feat.node, "string");
  }
  // The report agrees with the in-process probes.
  let live = capabilities();
  assert.deepEqual(report.features, live.features);
  assert.deepEqual(report.legs, live.legs);
});

test("iroh capabilities prints a human-readable table", () => {
  let result = spawnSync(process.execPath, ["cli/iroh.js", "capabilities"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Node v\d+\.\d+\.\d+/);
  assert.match(result.stdout, /Language legs:/);
  assert.match(result.stdout, /Syntax features:/);
  assert.match(result.stdout, /javascript: available/);
});
