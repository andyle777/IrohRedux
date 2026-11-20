// Test entry point. The suite is three Node files on the built-in test
// runner (no extra dependencies), plus the Python and C++ clients when
// their toolchains are present (skipped, not failed, when absent):
//   tests/iroh.test.js      — behaviour tests (listeners, regressions, syntax)
//   tests/fixtures.test.js  — every file in tests/expressions/ and
//                             tests/other/, run through a Stage and checked
//                             against its own Iroh.assert() calls.
//   tests/cli.test.js       — the CLI: spawn it, feed it JavaScript, check
//                             the JSON lines it streams.
//   tests/modern.test.js    — 2026 syntax: hashbang, RegExp v flag and
//                             modifiers, `using` declarations, plus the
//                             runtime features that needed no syntax change.
//   tests/trace.test.js     — the modern one-shot SDK: Iroh.trace() /
//                             traceAsync(), including top-level await.
//   tests/modules.test.js    — ES modules: Iroh.traceModule().
//   tests/decorators.test.js — the TC39 decorators proposal.
//   tests/analyze.test.js    — the 0.8.0 AI analysis layer: findings,
//                             the toolkit scorecard, the perceptron,
//                             and the CLI --analyze flag.
//   tests/translate.test.js  — the 0.8.0 hybrid translation engine,
//                             both directions, with every translated
//                             program actually run in its target
//                             language.
//   tests/native.test.js     — the 0.9.0 native tracers: Python
//                             (sys.settrace + AST) and C++
//                             (-finstrument-functions) through the CLI,
//                             with Iroh.analyze() proving the
//                             cross-language findings.
//   tests/vectors.test.js    — the 0.9.0 vector refracting layer:
//                             deterministic feature vectors, cosine /
//                             Euclidean similarity, cross-language.
//   tests/scan.test.js       — the 0.9.0 AI-friendly scan mode: one
//                             compact { vectors, findings, scores,
//                             summary } document, bounded size,
//                             deterministic, same schema in JS/Python/C++.
//   tests/esm.test.mjs      — ESM import of the package itself, through
//                             the package.json "exports" map.
//   python/tests/           — the Python client (unittest), needs python3.
//   cpp/test_client.cpp     — the C++ client, needs g++.
//   npm test
// The TypeScript type test (tests/types.ts) is separate: `npm run test:types`.
// (The old file was a stub that threw "Not implemented yet".)
const { execSync } = require("node:child_process");

function has(cmd) {
  try {
    execSync("command -v " + cmd, { stdio: "ignore", shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

execSync(
  "node --test tests/iroh.test.js tests/fixtures.test.js tests/cli.test.js tests/modern.test.js tests/trace.test.js tests/modules.test.js tests/decorators.test.js tests/analyze.test.js tests/translate.test.js tests/native.test.js tests/vectors.test.js tests/scan.test.js tests/esm.test.mjs",
  { stdio: "inherit" }
);

if (has("python3")) {
  execSync("python3 -m unittest discover -s python/tests -v", { stdio: "inherit" });
} else {
  console.log("Skipping Python tests: python3 not found.");
}

if (has("g++")) {
  execSync("make -C cpp test", { stdio: "inherit" });
} else {
  console.log("Skipping C++ tests: g++ not found.");
}
