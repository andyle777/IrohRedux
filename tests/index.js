// Test entry point. The real suite lives in tests/iroh.test.js and runs on
// Node's built-in test runner (no extra dependencies).
//   npm test
// (The old file was a stub that threw "Not implemented yet".)
require("node:child_process").execSync("node --test tests/iroh.test.js", { stdio: "inherit" });
