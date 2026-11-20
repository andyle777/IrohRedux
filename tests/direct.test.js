// Tests for the 1.0.0 AI director + live code engine (src/direct.js,
// CLI --direct): directives take effect mid-run — set a variable live,
// skip a call, stop the run — the runaway-loop guard throttles or
// stops, and the record (findings, directives, analysis) makes the run
// auditable. The contract: every directive is recorded with whether it
// applied and how; live vs batch agreement still holds on directed
// runs (the analysis is the live finish() over the recorded events).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");
const RUNAWAY = "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;";

function runCli(code, args) {
  let proc = spawnSync(process.execPath, [CLI, ...(args || [])], {
    input: code,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

function runCliFile(file, args) {
  let proc = spawnSync(process.execPath, [CLI, file, ...(args || [])], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

function hotLoop(findings) {
  return findings.find((f) => f.code === "HOT_LOOP");
}

test("runaway demo: the guard throttles a 10,000-iteration loop live", () => {
  let out = Iroh.direct(RUNAWAY, Iroh.runawayGuard());
  assert.equal(out.result, 4950, "the loop ran 100 iterations (0..99), then the director cut it");
  assert.equal(out.stopped, false);
  assert.equal(out.stopReason, null);
  let hot = hotLoop(out.findings);
  assert.ok(hot, "HOT_LOOP fired");
  assert.equal(hot.evidence.iterations, 100, "the analysis counts exactly the bodies that ran");
  assert.equal(hot.evidence.threshold, 100);
  assert.equal(out.directives.length, 1);
  let entry = out.directives[0];
  assert.deepEqual(entry.directive, { type: "set", name: "i", value: 10000 });
  assert.equal(entry.applied, true);
  assert.equal(entry.appliedVia, "loop-test");
  assert.ok(entry.appliedAtEvent > entry.issuedAtEvent,
    "the set applied at the NEXT loop test, not the trip test — the trip iteration's body still ran");
  assert.equal(typeof entry.note, "string");
  // The record is auditable: the analysis is the live finish() over the
  // recorded events, and it agrees with a fresh batch analysis.
  let batch = Iroh.analyze(out.events);
  assert.deepEqual(
    out.findings.map((f) => f.code),
    batch.findings.map((f) => f.code)
  );
  assert.deepEqual(out.findings, batch.findings);
  assert.equal(out.analysis.finished, true);
});

test("runaway guard in stop mode stops the run with a reason", () => {
  let out = Iroh.direct(RUNAWAY, Iroh.runawayGuard({ action: "stop" }));
  assert.equal(out.stopped, true);
  assert.equal(out.result, void 0);
  assert.match(out.stopReason, /Runaway loop guard/);
  assert.match(out.stopReason, /stopping the run by policy/);
  assert.ok(hotLoop(out.findings), "HOT_LOOP fired before the stop");
  assert.ok(out.events.length < 1000, "the run ended at the finding, not after 10,000 iterations");
  assert.equal(out.directives.length, 1);
  assert.equal(out.directives[0].directive.type, "stop");
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "stop");
});

test("runaway guard on while(true) cannot resolve a counter, so it stops", () => {
  let out = Iroh.direct("let i = 0; while (true) { i++; } i;", Iroh.runawayGuard());
  assert.equal(out.stopped, true);
  assert.match(out.stopReason, /could not be resolved/);
  assert.match(out.stopReason, /stops instead of throttling/);
});

test("runaway guard throttles a for loop and a counting-down loop", () => {
  let forOut = Iroh.direct(
    "let total = 0; for (let i = 0; i < 10000; i++) { total += i; } total;",
    Iroh.runawayGuard()
  );
  assert.equal(forOut.result, 4950);
  assert.equal(forOut.stopped, false);
  assert.deepEqual(forOut.directives[0].directive, { type: "set", name: "i", value: 10000 });

  let down = Iroh.direct(
    "let i = 10000; let total = 0; while (i > 0) { total += i; i--; } total;",
    Iroh.runawayGuard()
  );
  assert.equal(down.result, 995050, "bodies ran with i = 10000..9901");
  assert.equal(down.stopped, false);
  assert.deepEqual(down.directives[0].directive, { type: "set", name: "i", value: 0 });
});

test("runaway guard throttles a <= loop at bound + 1", () => {
  let out = Iroh.direct(
    "let i = 0; let total = 0; while (i <= 9999) { total += i; i++; } total;",
    Iroh.runawayGuard()
  );
  assert.equal(out.result, 4950);
  assert.deepEqual(out.directives[0].directive, { type: "set", name: "i", value: 10000 });
});

test("set resets a loop counter mid-run through the next assignment", () => {
  let out = Iroh.direct(
    "let i = 0; let total = 0; while (i < 10) { total += i; i = i + 1; } total;",
    (ctx) => {
      if (ctx.findings.some((f) => f.code === "HOT_LOOP")) {
        return { type: "set", name: "i", value: 8 };
      }
      return null;
    },
    { hotLoopThreshold: 3 }
  );
  // Bodies: i = 0, 1, 2, then the set lands on the next assignment
  // (i = 8), then i = 8, 9. Undirected the total would be 45.
  assert.equal(out.result, 20);
  assert.equal(out.directives.length, 1);
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "assign");
});

test("set applies at a declaration through VAR_INIT", () => {
  let out = Iroh.direct("let x = 1; x + 1;", () => ({ type: "set", name: "x", value: 42 }));
  assert.equal(out.result, 43);
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "init");
});

test("set for a variable that is never assigned stays unapplied, and says so", () => {
  let out = Iroh.direct("let x = 1; x;", () => ({ type: "set", name: "y", value: 5 }));
  assert.equal(out.result, 1);
  assert.equal(out.directives.length, 1);
  assert.equal(out.directives[0].applied, false);
  assert.match(out.directives[0].note, /Never applied/);
});

test("skip replaces a call: the real function never runs", () => {
  let out = Iroh.direct(
    "let hits = 0; function fetchData() { hits += 1; return 'real'; } let v = fetchData(); [v, hits];",
    () => ({ type: "skip", name: "fetchData", value: "cached" })
  );
  assert.deepEqual(out.result, ["cached", 0]);
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "call");
  // The skipped function's body never fired a FUNCTION_ENTER.
  assert.equal(
    out.events.filter((e) => e.event === "FUNCTION_ENTER").length,
    0
  );
});

test("skip applies to the very call that trips REPEATED_SEQUENCE", () => {
  let out = Iroh.direct(
    "function ping() { return 'pong'; } let out = []; for (let k = 0; k < 5; k++) { out.push(ping()); } out;",
    (ctx) => {
      if (ctx.findings.some((f) => f.code === "REPEATED_SEQUENCE")) {
        return { type: "skip", name: "ping", value: "skipped" };
      }
      return null;
    }
  );
  assert.deepEqual(out.result, ["pong", "pong", "pong", "skipped", "pong"]);
  assert.equal(out.directives.length, 1);
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "call");
});

test("stop from a custom director ends the run with the reason", () => {
  let out = Iroh.direct(
    "let i = 0; while (i < 10000) { i++; } i;",
    (ctx) => {
      if (ctx.findings.some((f) => f.code === "HOT_LOOP")) {
        return { type: "stop", reason: "test director: loop is too hot" };
      }
      return null;
    }
  );
  assert.equal(out.stopped, true);
  assert.equal(out.stopReason, "test director: loop is too hot");
  assert.equal(out.result, void 0);
});

test("a stop inside try/catch still ends the run (re-thrown at the next event)", () => {
  let out = Iroh.direct(
    "let i = 0; try { while (i < 10000) { i++; } } catch (e) { i = -1; } i;",
    (ctx) => {
      if (ctx.findings.some((f) => f.code === "HOT_LOOP")) {
        return { type: "stop", reason: "test director: stop in try" };
      }
      return null;
    }
  );
  assert.equal(out.stopped, true);
  assert.equal(out.stopReason, "test director: stop in try");
  assert.equal(out.result, void 0);
});

test("a director that does nothing leaves the run untouched", () => {
  let out = Iroh.direct(
    "let s = 0; for (let i = 0; i < 150; i++) { s += i; } s;",
    () => null
  );
  assert.equal(out.result, 11175);
  assert.equal(out.stopped, false);
  assert.deepEqual(out.directives, []);
  assert.ok(hotLoop(out.findings), "the finding still fires — the director just does nothing about it");
  let plain = Iroh.direct("1 + 2;", null);
  assert.equal(plain.result, 3);
  assert.deepEqual(plain.directives, []);
  assert.deepEqual(plain.findings, []);
});

test("a runtime error throws with the events and the direction record attached", () => {
  let threw = null;
  try {
    Iroh.direct(
      "let i = 0; while (i < 150) { i++; } throw new Error('boom');",
      // Issue the set once, at the start call — the director is also
      // consulted when HOT_LOOP fires, and must not re-issue it there.
      (ctx) => (ctx.eventIndex === -1 ? { type: "set", name: "never", value: 1 } : null)
    );
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "expected the program error to throw");
  assert.equal(threw.message, "boom");
  assert.ok(Array.isArray(threw.events) && threw.events.length > 0);
  assert.ok(threw.direct, "the direction record rides on the error");
  assert.equal(threw.direct.stopped, false);
  assert.equal(threw.direct.directives.length, 1);
  assert.equal(threw.direct.directives[0].applied, false);
});

test("director bugs fail loudly, not silently", () => {
  assert.throws(
    () => Iroh.direct("1;", () => ({ type: "explode" })),
    /Unknown directive type: explode/
  );
  assert.throws(
    () => Iroh.direct("1;", () => "stop"),
    /must return a directive object/
  );
  assert.throws(
    () => Iroh.direct("1;", () => ({ type: "set", name: "x" })),
    /needs a `value`/
  );
  assert.throws(() => Iroh.direct("1;", "not a function"), /needs a director function/);
  assert.throws(() => Iroh.runawayGuard({ action: "explode" }), /action must be "throttle" or "stop"/);
});

test("onEvent and onDirective callbacks fire as the run proceeds", () => {
  let seenEvents = 0;
  let seenDirectives = 0;
  let out = Iroh.direct(RUNAWAY, Iroh.runawayGuard(), {
    onEvent: () => {
      seenEvents += 1;
    },
    onDirective: () => {
      seenDirectives += 1;
    },
  });
  assert.equal(seenEvents, out.events.length);
  assert.equal(seenDirectives, 1);
});

test("direct() rejects modules and top-level await with the direct() pointers", () => {
  // 1.0.1: the pointers name the direct() family now (directModule /
  // directAsync), not the trace() family — direct() itself cannot run
  // them, but its siblings can.
  assert.throws(
    () => Iroh.direct("import x from './x.js'; x;", () => null),
    /directModule/
  );
  assert.throws(
    () => Iroh.direct("await Promise.resolve(1);", () => null),
    /directAsync/
  );
});

function writeRunaway() {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-direct-"));
  let file = path.join(dir, "runaway.js");
  fs.writeFileSync(file, RUNAWAY);
  return { dir, file };
}

test("CLI --direct throttles the runaway loop end to end", () => {
  let { dir, file } = writeRunaway();
  try {
    let { proc, lines } = runCliFile(file, ["--direct"]);
    assert.equal(proc.status, 0);
    let directive = lines.find((l) => l.type === "directive");
    assert.ok(directive, "a directive line streamed");
    assert.deepEqual(directive.directive, { type: "set", name: "i", value: 10000 });
    assert.equal(directive.applied, true);
    assert.equal(directive.appliedVia, "loop-test");
    let result = lines.find((l) => l.type === "result");
    assert.equal(result.value, 4950);
    let summary = lines.find((l) => l.type === "direct-summary");
    assert.ok(summary, "a direct-summary line closed the run");
    assert.equal(summary.stopped, false);
    assert.equal(hotLoop(summary.findings).evidence.iterations, 100);
    assert.equal(summary.directives.length, 1);
    assert.equal(summary.analysis.finished, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --direct=stop stops the run", () => {
  let { dir, file } = writeRunaway();
  try {
    let { proc, lines } = runCliFile(file, ["--direct=stop"]);
    assert.equal(proc.status, 0);
    let summary = lines.find((l) => l.type === "direct-summary");
    assert.equal(summary.stopped, true);
    assert.match(summary.stopReason, /Runaway loop guard/);
    let result = lines.find((l) => l.type === "result");
    // JSON has no undefined: a stopped run's result line reads null.
    assert.equal(result.value, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --direct rejects Python and bad modes, and runs modules", () => {
  let { dir, file } = writeRunaway();
  try {
    let py = path.join(dir, "prog.py");
    fs.writeFileSync(py, "x = 1\n");
    let bad = runCliFile(py, ["--direct"]);
    assert.equal(bad.proc.status, 2);
    assert.match(bad.proc.stderr, /JavaScript-only/);
    let badMode = runCliFile(file, ["--direct=explode"]);
    assert.equal(badMode.proc.status, 2);
    assert.match(badMode.proc.stderr, /Unknown --direct mode/);
    // 1.0.1: --direct --module no longer rejects — it runs the module
    // under Iroh.directModule() and throttles the runaway the same
    // way a script is throttled. (A module's result line is its
    // namespace object, not the completion value — traceModule
    // semantics — so the throttle is proven by the directive, not
    // by the result.)
    let mod = runCliFile(file, ["--direct", "--module"]);
    assert.equal(mod.proc.status, 0);
    let directive = mod.lines.find((l) => l.type === "directive");
    assert.ok(directive, "a directive line streamed for the module run");
    assert.equal(directive.applied, true);
    assert.equal(directive.appliedVia, "loop-test");
    let summary = mod.lines.find((l) => l.type === "direct-summary");
    assert.ok(summary, "a direct-summary line closed the module run");
    assert.equal(summary.stopped, false);
    assert.equal(summary.directives.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("set applies to a member assignment through appliedVia member", () => {
  let out = Iroh.direct(
    "let o = { a: 7 }; o.a = 7; o.a;",
    () => ({ type: "set", name: "o.a", value: 42 })
  );
  assert.equal(out.result, 42);
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "member");
});

test("set applies to a compound member assignment", () => {
  let out = Iroh.direct(
    "let o = { a: 10 }; o.a += 5; o.a;",
    () => ({ type: "set", name: "o.a", value: 99 })
  );
  assert.equal(out.result, 99);
  assert.equal(out.directives[0].appliedVia, "member");
});

test("set with a dotted name deeper than one level is a clear error", () => {
  assert.throws(
    () => Iroh.direct("let o = { a: { b: 1 } }; o.a.b;", () => ({ type: "set", name: "o.a.b", value: 2 })),
    /one level/
  );
});

test("set with scope hits only the named function", () => {
  let out = Iroh.direct(
    "let i = 0; function inner() { let i = 1; return i; } inner(); i;",
    () => ({ type: "set", name: "i", value: 77, scope: "inner" })
  );
  assert.equal(out.result, 0, "the top-level i is untouched");
  assert.equal(out.directives[0].applied, true);
});

test("set with scope null hits only the top level", () => {
  let out = Iroh.direct(
    "let i = 0; function inner() { let i = 1; return i; } inner(); i;",
    () => ({ type: "set", name: "i", value: 55, scope: null })
  );
  assert.equal(out.result, 55);
  assert.equal(out.directives[0].applied, true);
});

test("set with a wrong scope stays unapplied", () => {
  let out = Iroh.direct(
    "let i = 0; function inner() { let i = 1; return i; } inner(); i;",
    () => ({ type: "set", name: "i", value: 55, scope: "nope" })
  );
  assert.equal(out.result, 0);
  assert.equal(out.directives[0].applied, false);
});

test("directAsync runs top-level await and the runaway guard", async () => {
  let out = await Iroh.directAsync(
    "await Promise.resolve(1); let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
    Iroh.runawayGuard()
  );
  assert.equal(out.result, 4950);
  assert.equal(out.directives.length, 1);
  assert.equal(out.directives[0].appliedVia, "loop-test");
});

test("directAsync rejects module code with the directModule pointer", async () => {
  await assert.rejects(
    Iroh.directAsync("import x from './x.js'; x;", () => null),
    /directModule/
  );
});

test("directModule throttles a runaway loop in a module", async () => {
  let out = await Iroh.directModule(
    "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
    Iroh.runawayGuard()
  );
  // A module's result is its namespace object, not the completion
  // value — the throttle is proven by the directive, not the result.
  assert.equal(typeof out.result, "object");
  assert.equal(out.directives.length, 1);
  assert.equal(out.directives[0].applied, true);
  assert.equal(out.directives[0].appliedVia, "loop-test");
});

test("directModule runs top-level await and skip", async () => {
  let out = await Iroh.directModule(
    "await Promise.resolve(1); function f() { return 'real'; } export const got = f();",
    () => ({ type: "skip", name: "f", value: "skipped" })
  );
  assert.equal(out.result.got, "skipped");
  assert.equal(out.directives[0].appliedVia, "call");
});

test("onFinding fires with live findings without being the director", () => {
  let seen = [];
  let out = Iroh.direct(
    "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
    Iroh.runawayGuard(),
    { onFinding: (findings) => { seen.push(findings.map((f) => f.code)); } }
  );
  assert.equal(out.result, 4950);
  assert.ok(seen.length > 0, "onFinding fired at least once");
  assert.ok(seen.some((codes) => codes.includes("HOT_LOOP")), "HOT_LOOP was reported live");
});
