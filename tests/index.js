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
//   tests/live.test.js       — the 0.9.0 live wire AI analysis mode:
//                             findings fire as events arrive, live vs
//                             batch agreement, determinism, and the
//                             CLI --live flag on JS/Python/C++.
//   tests/direct.test.js     — the 1.0.0 AI director + live code
//                             engine: set/skip/stop directives take
//                             effect mid-run, the runaway-loop guard
//                             throttles or stops, and the CLI --direct
//                             flag on JS (Python/C++ and modules are
//                             rejected).
//   tests/irohscript.test.js — the 1.0.1-rework tracers: IrohScript
//                             (IRX interpreter hooks) and BASIC (a
//                             small dedicated interpreter) through
//                             the CLI, with Iroh.analyze() proving
//                             the cross-language findings.
//   tests/synth.test.js      — the input synthesiser: concrete inputs
//                             that drive a program down each branch, on
//                             the live wire, and the CLI --synthesize
//                             flag (with --live streaming).
//   tests/memory-catalog.test.js — verifies the exported perceptron
//                             matrix and SQLite catalog.
//   tests/dist-drift.test.js  — the 1.1.1 dist drift gate (F3): rebuilds
//                             dist/ into a temp dir and byte-compares
//                             it against the checked-in dist/.
//   tests/capabilities.test.js — the 1.1.1 capability probes (F1): the
//                             probes agree with the runtime, the skip
//                             reason names the feature and the Node
//                             version, and `iroh capabilities --json`
//                             prints one row per leg and per feature.
//   tests/suite-summary.test.js — the 1.1.1 suite summary (F2): the
//                             parsers read both the Node 24 spec
//                             reporter and the Node 22 TAP reporter,
//                             the unittest and C++ shapes, and a leg
//                             that did not run is named, never passed.
//   tests/server.test.js     — the server/node architecture: the
//                             phone is the local server, the laptop
//                             is a local node. A server and a node run
//                             on loopback; a JS trace through the
//                             server matches the local engine, a
//                             Python leg delegated to a node matches
//                             a local run, and a leg no node can run
//                             returns an honest 503.
//   tests/esm.test.mjs      — ESM import of the package itself, through
//                             the package.json "exports" map.
//   python/tests/           — the Python client (unittest), needs python3.
//   irohscript/tests/       — the IrohScript bootstrap + the
//                             IrohScript/BASIC tracers (unittest),
//                             needs python3, run from irohscript/.
//   cpp/test_client.cpp     — the C++ client, needs g++.
//   npm test
// The TypeScript type test (tests/types.ts) is separate: `npm run test:types`.
// (The old file was a stub that threw "Not implemented yet".)
//
// 1.1.1 (F2): every leg is run with its output captured, then the
// captured output is printed (so a human sees exactly what they
// used to see) and parsed into one machine-readable summary line,
// {"type":"suite-summary","legs":[...]}, printed last and written
// to test-results/suite-summary.json. A leg whose toolchain is
// absent is reported as did-not-run, never as a pass: its skips
// array names the reason. The process exits non-zero when any leg
// failed, exactly as before.
const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseNodeOutput,
  parseUnittestOutput,
  parseCppOutput,
  skippedLeg,
  summary,
} = require("./suite-summary");

function has(cmd) {
  try {
    execSync("command -v " + cmd, { stdio: "ignore", shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

// Run one leg, print its output, and return its summary row. A
// non-zero exit does not throw here: the failure is recorded in the
// row, and the process exits non-zero at the end, after every leg
// has run and the summary is printed.
function runLeg(label, command, args, options, parse) {
  let result = spawnSync(command, args, options);
  let text = (result.stdout || "") + (result.stderr || "");
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
  if (result.error) {
    return {
      leg: label,
      ran: 0,
      failed: 1,
      skipped: 0,
      skips: ["could not run: " + result.error.message],
    };
  }
  let row = parse(text);
  // A leg that exits non-zero but whose parser found no failure
  // (e.g. an unfamiliar output shape) still fails: the exit code
  // is the arbiter, and a green row on a failed run would be the
  // exact bug F2 exists to prevent.
  if (result.status !== 0 && row.failed === 0) {
    row.failed = 1;
    row.skips.push("exit code " + result.status + " with no failure in the parsed output");
  }
  return row;
}

let legs = [];

legs.push(
  runLeg(
    "node",
    "node",
    [
      "--test",
      "tests/iroh.test.js",
      "tests/fixtures.test.js",
      "tests/cli.test.js",
      "tests/modern.test.js",
      "tests/trace.test.js",
      "tests/modules.test.js",
      "tests/decorators.test.js",
      "tests/analyze.test.js",
      "tests/translate.test.js",
      "tests/translate-irohscript.test.js",
      "tests/irohscript-codegen.test.js",
      "tests/native.test.js",
      "tests/vectors.test.js",
      "tests/scan.test.js",
      "tests/live.test.js",
      "tests/direct.test.js",
      "tests/irohscript.test.js",
      "tests/synth.test.js",
      "tests/determinism.test.js",
      "tests/memory.test.js",
      "tests/memory-catalog.test.js",
      "tests/properties.test.js",
      "tests/fuzz.test.js",
      "tests/dist-drift.test.js",
      "tests/capabilities.test.js",
      "tests/suite-summary.test.js",
      "tests/server.test.js",
      "tests/esm.test.mjs",
    ],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
    parseNodeOutput
  )
);

if (has("python3")) {
  legs.push(
    runLeg(
      "python",
      "python3",
      ["-m", "unittest", "discover", "-s", "python/tests", "-v"],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
      (text) => parseUnittestOutput(text, "python")
    )
  );
  // The IrohScript bootstrap and its tracers run from irohscript/
  // (their tests import the `src` package, like the standalone
  // language home does).
  legs.push(
    runLeg(
      "irohscript",
      "python3",
      ["-m", "unittest", "discover", "-s", "tests", "-v"],
      { encoding: "utf8", cwd: "irohscript", maxBuffer: 512 * 1024 * 1024 },
      (text) => parseUnittestOutput(text, "irohscript")
    )
  );
} else {
  console.log("Skipping Python tests: python3 not found.");
  legs.push(skippedLeg("python", "python3 not found"));
  legs.push(skippedLeg("irohscript", "python3 not found"));
}

if (has("g++")) {
  legs.push(
    runLeg(
      "cpp",
      "make",
      ["-C", "cpp", "test"],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
      parseCppOutput
    )
  );
} else {
  console.log("Skipping C++ tests: g++ not found.");
  legs.push(skippedLeg("cpp", "g++ not found"));
}

let report = summary(legs);
report.ranAt = new Date().toISOString();
report.node = process.version;
let line = JSON.stringify(report);
console.log(line);
let dir = path.join(__dirname, "..", "test-results");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "suite-summary.json"), line + "\n");

let failed = 0;
for (let leg of legs) failed += leg.failed;
if (failed > 0) {
  process.exit(1);
}
