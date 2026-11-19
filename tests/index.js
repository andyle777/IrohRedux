// Test entry point. The suite is two files on Node's built-in test runner
// (no extra dependencies):
//   tests/iroh.test.js      — behaviour tests (listeners, regressions, syntax)
//   tests/fixtures.test.js  — every file in tests/expressions/ and
//                             tests/other/, run through a Stage and checked
//                             against its own Iroh.assert() calls.
//   npm test
// (The old file was a stub that threw "Not implemented yet".)
require("node:child_process").execSync(
  "node --test tests/iroh.test.js tests/fixtures.test.js",
  { stdio: "inherit" }
);
