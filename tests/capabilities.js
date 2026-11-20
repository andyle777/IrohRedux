// Test-side capability helper (1.1.1, F1): turns a missing feature
// into a named skip. The feature definitions and the probing live in
// lib/capabilities.js (shared with the CLI's `iroh capabilities`
// command); this file only adds the test-runner glue.
//
// Usage in a test file:
//   const { skipIfMissing } = require("./capabilities");
//   test("RegExp modifiers trace", (t) => {
//     skipIfMissing(t, "regexpModifiers");
//     ...
//   });

const { FEATURES, has, featureRows } = require("../lib/capabilities");

// Skip the current test (via its context t) when the feature is
// missing, with a reason naming the feature and the Node version
// that has it. Returns true when the test should proceed, false
// when it was skipped (t.skip throws a skip, so in practice this
// either returns true or does not return at all).
function skipIfMissing(t, feature) {
  if (has(feature)) return true;
  let def = FEATURES[feature];
  t.skip(def.what + " needs Node " + def.node + " (running " + process.version + ")");
  return false;
}

module.exports = { FEATURES, has, featureRows, skipIfMissing };
