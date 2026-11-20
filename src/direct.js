// Live code engine + AI director for IrohRedux 1.0.0 — the original
// vision complete. The engine runs a program under trace and changes it
// mid-flight; the director sits on the live wire, reads findings as
// they fire, and calls the shots.
//
//   let out = Iroh.direct(code, Iroh.runawayGuard());
//   // out.result, out.stopped, out.stopReason, out.events,
//   // out.findings, out.directives, out.analysis
//
// How a directive takes effect — the tracer's DEBUG functions return
// the event's value AFTER triggering listeners (see src/stage/debug.js),
// so a listener that mutates the event changes the running program:
//   set  — VAR_INIT returns event.value (the initializer), and a plain
//          `x = v` is patched to `x = DEBUG_ASSIGN(...)`, which returns
//          event.result — so setting event.result on the next ASSIGN
//          event for that name writes the new value into the variable.
//          A loop counter advanced by `i++` has no assignment point,
//          so a set for it applies at the next LOOP_TEST for a loop
//          whose test compares that variable with a literal bound: the
//          comparison is evaluated with the set value, and the test is
//          flipped to false only when the set value makes it false.
//          Member assignments (`obj.prop = v`, including compound
//          `obj.prop += v`) are written before the event fires, so a
//          set for "obj.prop" overwrites the property on the live
//          object after the write — which runs a setter a second time
//          when the property is one, so use it on plain data
//          properties. A plain compound assignment (`x += v`) passes
//          only the right-hand value through event.result — it is not
//          a set point, and a set never applies there.
//          A set may carry `scope`: the name of the function it applies
//          in (the innermost function at the interception point, as the
//          stage tracks it; null means top level). An omitted scope
//          matches any scope — the 1.0.0 behaviour.
//   skip — FUNCTION_CALL fires "before" with event.call (the function)
//          and event.arguments, and only then applies the callee. A
//          listener that replaces event.call with a stub makes the call
//          expression evaluate to the stub's return, and the real
//          function never runs (no FUNCTION_ENTER, no side effects).
//   stop — the engine throws a sentinel from the listener. It
//          propagates out of the run like any listener throw. A program
//          inside try/catch may swallow one throw, so the engine
//          re-throws the sentinel at every following event until it
//          propagates out or the program ends; if the program ends
//          first, the stop is recorded as requested-but-swallowed and
//          the run completes normally.
//
// Ordering inside one event: pending directives apply first (so the
// live analyzer sees the directed value), then the event feeds the
// live analyzer, then — only when new findings fired — the director
// is consulted. A directive issued in response applies at the NEXT
// matching point, with one exception: a skip for the very call that
// tripped the finding applies to that call now, because the call has
// not run yet. A set issued on a HOT_LOOP trip does NOT flip the trip
// test itself: that iteration's body still runs, so the iterations
// the analysis counts are exactly the bodies that ran, and the loop
// exits at the next test. When a directive applies, the JSON line is
// mutated alongside the raw event, so the recorded trace shows what
// the program actually ran with — a flipped loop test reads false in
// the events, and a directed assignment reads the directed value.
// The director is also called once before the run starts (findings
// [], event null), so it can issue initial directives — e.g. skip a
// call from the outset.
//
// Each directive applies once, at the first matching point, then it is
// consumed. A directive that never matches is recorded with
// applied: false and a reason — the audit log never pretends a
// directive took effect. Matching is by name, and by scope when the
// directive carries one: a set for "i" in scope "inner" applies only
// to the `i` in that function, not to an outer or top-level `i`.
//
// The director receives { findings, allFindings, snapshot, event,
// eventIndex, directives } and returns a directive, an array of
// directives, or null. The loop closes: trace -> analyze live ->
// direct -> change -> trace again, and the record (findings,
// directives, analysis) makes the run auditable, not a black box.
//
// Limits (also in CHANGELOG.md): direct() runs scripts synchronously
// (like trace()) — top-level await is rejected with the same pointer
// trace() gives; use directAsync() for that. Modules are directed by
// directModule(). Python/C++ traces cannot be directed —
// their events arrive buffered after the run, so there is nothing
// live to direct; the CLI --direct flag is JavaScript-only.

import { liveAnalyzer } from "./live";
import { evalBinaryExpression } from "./eval";
import { INSTR, OP } from "./labels";
import { runInternals } from "./setup";

// The sentinel thrown to stop a run. It is one object, compared by
// identity — a program that throws its own value can never be mistaken
// for a directed stop, and a directed stop can never be mistaken for a
// program error.
let DIRECTOR_STOP = { __irohDirectorStop: true };

// Flip a comparison operator for the counter-on-the-other-side form:
// `10000 > i` reads, from the counter's side, as `i < 10000`.
function flipOperator(op) {
  if (op === "<") return ">";
  if (op === ">") return "<";
  if (op === "<=") return ">=";
  if (op === ">=") return "<=";
  if (op === "==" || op === "===" || op === "!=" || op === "!==") return op;
  return null;
}

// The counter value that makes `counter <op> bound` false — the value
// a throttle sets the counter to. == / === cannot be falsified by
// setting the counter to one value without knowing what it is not, so
// they have no exit value and the guard falls back to stopping.
function exitValueFor(operator, bound) {
  if (operator === "<") return bound;
  if (operator === "<=") return bound + 1;
  if (operator === ">") return bound;
  if (operator === ">=") return bound - 1;
  if (operator === "!=" || operator === "!==") return bound;
  return null;
}

// Resolve a loop's test from its LOOP_TEST hash: the stage's node map
// holds the loop statement clone with the ORIGINAL test expression
// (the DEBUG_LOOP_TEST call wraps it at patch time). Returns
// { hash, kind, counter, bound, operator, counterOnLeft, value } —
// operator normalized to the counter-on-the-left form — or null when
// the test is not a simple counter comparison against a numeric
// literal (`while (true)`, `i < n`, `i + 1 < 10`, compound tests).
function resolveLoopTest(stage, hash) {
  if (!stage || !stage.nodes || !stage.nodes[hash]) return null;
  let node = stage.nodes[hash].node;
  if (!node || !node.test || node.test.type !== "BinaryExpression") return null;
  let test = node.test;
  let counter = null;
  let bound = null;
  let operator = test.operator;
  let counterOnLeft = true;
  if (
    test.left.type === "Identifier" &&
    test.right.type === "Literal" &&
    typeof test.right.value === "number"
  ) {
    counter = test.left.name;
    bound = test.right.value;
    counterOnLeft = true;
  } else if (
    test.right.type === "Identifier" &&
    test.left.type === "Literal" &&
    typeof test.left.value === "number"
  ) {
    counter = test.right.name;
    bound = test.left.value;
    counterOnLeft = false;
    operator = flipOperator(operator);
    if (operator === null) return null;
  } else {
    return null;
  }
  return {
    hash: hash,
    kind: node.type,
    counter: counter,
    bound: bound,
    operator: operator,
    counterOnLeft: counterOnLeft,
    value: exitValueFor(operator, bound),
  };
}

// Evaluate the normalized comparison `counterValue <operator> bound`.
// Returns true/false, or null for an operator the evaluator cannot
// run (only comparisons reach here).
function compareWith(operator, counterValue, bound) {
  let op = OP[operator];
  if (op === void 0) return null;
  return evalBinaryExpression(op, counterValue, bound);
}

function normalizeDirectives(answer) {
  if (answer === null || answer === void 0) return [];
  if (Array.isArray(answer)) return answer;
  return [answer];
}

// A director bug fails loudly: an unknown directive type, or a set/skip
// without a name or a value, throws instead of being silently ignored.
// The returned object keeps only the known fields, so the audit log
// never carries a director's stray properties. A set's `scope`, when
// given, must be a string (the function name) or null (top level); a
// dotted set name must be exactly "object.property" (one level) —
// deeper paths are not a set point.
function validateDirective(d) {
  if (!d || typeof d !== "object") {
    throw new Error(
      "A director must return a directive object, an array of directive objects, or null — got: " + String(d)
    );
  }
  if (d.type === "set") {
    if (typeof d.name !== "string" || d.name === "") {
      throw new Error("A \"set\" directive needs a non-empty string `name`.");
    }
    if (d.name.indexOf(".") !== -1) {
      let parts = d.name.split(".");
      let ident = /^[$A-Za-z_][$\w]*$/;
      if (
        parts.length !== 2 ||
        !ident.test(parts[0]) ||
        !ident.test(parts[1])
      ) {
        throw new Error(
          "A \"set\" directive name with a dot must be exactly \"object.property\" (one level) — got: " + d.name
        );
      }
    }
    if (!Object.prototype.hasOwnProperty.call(d, "value")) {
      throw new Error("A \"set\" directive needs a `value`.");
    }
    let out = { type: "set", name: d.name, value: d.value };
    if (Object.prototype.hasOwnProperty.call(d, "scope")) {
      if (d.scope !== null && typeof d.scope !== "string") {
        throw new Error(
          "A \"set\" directive `scope` must be a string (the function name) or null (top level) — got: " + String(d.scope)
        );
      }
      out.scope = d.scope;
    }
    return out;
  }
  if (d.type === "skip") {
    if (typeof d.name !== "string" || d.name === "") {
      throw new Error("A \"skip\" directive needs a non-empty string `name` (the function to skip).");
    }
    if (!Object.prototype.hasOwnProperty.call(d, "value")) {
      throw new Error("A \"skip\" directive needs a `value` (the result the skipped call evaluates to).");
    }
    return { type: "skip", name: d.name, value: d.value };
  }
  if (d.type === "stop") {
    return {
      type: "stop",
      reason:
        typeof d.reason === "string" && d.reason !== ""
          ? d.reason
          : "Director stopped the run.",
    };
  }
  throw new Error(
    "Unknown directive type: " + String(d.type) + " (want \"set\", \"skip\" or \"stop\")."
  );
}

// The live code engine. Runs `code` under trace with `director`
// (a function, or null for an undirected run — the record then has no
// directives, and the run is trace() with a direction audit). Options:
//   events: ignored — the director and the live analyzer need the full
//           stream, so direct() always traces ALL categories.
//   stageOptions: passed to the Stage (ecmaVersion, allowHashBang).
//   onEvent(line): called for every JSON event line as it fires.
//   onDirective(entry): called when a directive is applied (or when a
//           stop is issued).
//   onFinding(findings): called with the findings that just fired
//           (HOT_LOOP carries its loop info), for a caller that wants
//           to print them live without being the director.
//   hotLoopThreshold, deepRecursionThreshold,
//   repeatSequenceMinOccurrences, oneSidedMinTests: live analyzer
//           thresholds, as for liveAnalyzer().
//   source, language: passed to the live analyzer (source defaults to
//           the code, so the fidelity score can count its blind spots).
// Returns { result, stopped, stopReason, events, findings, directives,
// analysis } — the analysis is the live finish() summary (findings,
// scores, summary, neuron, vectors), so live vs batch agreement holds
// by construction. A runtime error throws with the events that fired
// before it attached as error.events (like trace()) and the direction
// record so far as error.direct. A directed stop is not an error: it
// returns normally with stopped: true.
//
// directInternal is the shared core of direct() (sync), directAsync()
// and directModule(): the same setup, the same director calls, the
// same completion handling — only the runner differs (compileRunner's
// sync form, its async wrapper, or the temp-file import for modules).
// Written with Promise chains, not async/await, because the browser
// bundle is transpiled by buble.
function directInternal(iroh, code, director, options, mode) {
  options = options || {};
  let allowAsync = mode === "async";
  let isModule = mode === "module";
  if (
    director !== null &&
    director !== void 0 &&
    typeof director !== "function"
  ) {
    throw new Error("Iroh.direct() needs a director function (or null for an undirected run).");
  }
  let live = iroh.liveAnalyzer(
    Object.assign({}, options, {
      source: options.source || code,
      language: options.language || "javascript",
    })
  );
  let onEvent = options.onEvent;
  let onDirective = options.onDirective;
  let pending = []; // issued set/skip entries not yet applied
  let log = []; // the audit log: every directive, with its outcome
  let stopped = false;
  let stopReason = null;
  let stopPending = false; // a stop was issued; re-thrown at every event until it lands
  let stopEntry = null;
  let stage = null;
  let run = null;

  function recordDirective(directive, issuedAtEvent) {
    let entry = {
      directive: directive,
      issuedAtEvent: issuedAtEvent,
      applied: false,
      appliedAtEvent: null,
      appliedVia: null,
      note: null,
    };
    log.push(entry);
    return entry;
  }

  // Whether this directive's scope matches the current point: an
  // omitted scope matches anywhere; a string matches only that
  // function (the innermost, as the stage tracks it); null matches
  // only top level. Without a stage the scope cannot be checked, so
  // a scoped directive does not apply.
  function scopeMatches(d) {
    if (!Object.prototype.hasOwnProperty.call(d, "scope")) return true;
    if (stage === null) return false;
    if (d.scope === null) return stage.currentScope === null;
    return stage.currentScope === d.scope;
  }

  // Try to apply one pending set/skip entry at this raw event. Returns
  // true when it applied (the entry is then consumed). The raw event is
  // the live object the DEBUG function is about to use, so mutating it
  // changes the running program — and the JSON line is mutated alongside
  // it, so the recorded trace shows what the program actually ran with,
  // not the value before direction (otherwise the final analysis would
  // count a flipped loop test as an iteration whose body never ran).
  function applyEntry(entry, raw, trigger, line) {
    let d = entry.directive;
    if (d.type === "set") {
      // Declaration: the initializer flows through event.value.
      if (
        raw.type === INSTR.VAR_INIT &&
        trigger === "after" &&
        raw.name === d.name &&
        scopeMatches(d)
      ) {
        raw.value = d.value;
        // The line carries the safe projection of the value (like
        // eventToJSON), so a circular or deep director value cannot
        // break a later JSON.stringify of the recorded events; the
        // program itself gets the live value through raw.value.
        line.value = iroh.safeValue(d.value, 3, new Set());
        entry.applied = true;
        entry.appliedVia = "init";
        return true;
      }
      // Plain assignment `x = v`: the patched code is
      // `x = DEBUG_ASSIGN(...)`, so event.result IS the new value of x.
      // Compound assignments (`x += v`) pass only the right-hand value
      // through event.result, and member assignments are already
      // written before the event fires — neither is a set point.
      if (
        raw.type === INSTR.ASSIGN &&
        trigger === "fire" &&
        raw.object === d.name &&
        raw.property === null &&
        scopeMatches(d)
      ) {
        let node = null;
        try {
          node = raw.getASTNode();
        } catch (e) {
          node = null;
        }
        if (node !== null && node.operator === "=") {
          raw.result = d.value;
          line.result = iroh.safeValue(d.value, 3, new Set());
          entry.applied = true;
          entry.appliedVia = "assign";
          return true;
        }
      }
      // Member assignment `obj.prop = v` (or `obj.prop += v`): the
      // write already happened before the event fires, so a set for
      // "obj.prop" overwrites the property on the live object. The
      // object variable name comes from the AST — the event carries
      // the object itself, not its name. A setter property runs twice
      // (once for the original write, once for the overwrite), so use
      // this on plain data properties. The recorded line is updated
      // alongside (result and the object projection) so the trace
      // shows the directed value.
      if (
        raw.type === INSTR.ASSIGN &&
        trigger === "fire" &&
        raw.property !== null &&
        d.name.indexOf(".") !== -1 &&
        scopeMatches(d)
      ) {
        let parts = d.name.split(".");
        let node = null;
        try {
          node = raw.getASTNode();
        } catch (e) {
          node = null;
        }
        if (
          node !== null &&
          node.left &&
          node.left.type === "MemberExpression" &&
          node.left.object &&
          node.left.object.type === "Identifier" &&
          node.left.object.name === parts[0]
        ) {
          let propName = null;
          if (!node.left.computed && node.left.property) {
            propName = node.left.property.name;
          } else if (
            node.left.computed &&
            node.left.property &&
            node.left.property.type === "Literal"
          ) {
            propName = String(node.left.property.value);
          }
          if (
            propName === parts[1] &&
            raw.property === parts[1] &&
            raw.object !== null &&
            typeof raw.object === "object"
          ) {
            try {
              raw.object[raw.property] = d.value;
            } catch (e) {
              return false;
            }
            line.result = iroh.safeValue(d.value, 3, new Set());
            line.object = iroh.safeValue(raw.object, 3, new Set());
            entry.applied = true;
            entry.appliedVia = "member";
            entry.note =
              "Member assignment: the write had already happened when the event fired, so the property was overwritten on the live object" +
              (node.operator === "=" ? "" : " (compound " + node.operator + " — the overwrite replaces the computed result)") +
              "; a setter property would run twice.";
            return true;
          }
        }
      }
      // Loop test: the loop compares this variable with a literal
      // bound. Flip the test to false only when the set value makes
      // the comparison false — a set that keeps the test true is not
      // applied here (it may still apply at a later assignment).
      if (
        raw.type === INSTR.LOOP_TEST &&
        trigger === "test" &&
        raw.value === true &&
        scopeMatches(d)
      ) {
        let info = resolveLoopTest(stage, raw.hash);
        if (info !== null && info.counter === d.name) {
          let testValue = compareWith(info.operator, d.value, info.bound);
          if (testValue === false) {
            raw.value = false;
            line.value = false;
            entry.applied = true;
            entry.appliedVia = "loop-test";
            entry.note =
              "Counter advances by ++, so no assignment point exists; the loop test was flipped to false, which is equivalent to the counter having passed its limit (" +
              d.value +
              " " +
              info.operator +
              " " +
              info.bound +
              " is false).";
            return true;
          }
        }
      }
    } else if (d.type === "skip") {
      // The call has not run yet: replace the callee with a stub
      // returning the director's value. The real function never
      // executes — no FUNCTION_ENTER, no side effects — and the call
      // expression evaluates to the stub's return.
      if (
        raw.type === INSTR.FUNCTION_CALL &&
        trigger === "before" &&
        raw.name === d.name
      ) {
        let value = d.value;
        raw.call = function () {
          return value;
        };
        entry.applied = true;
        entry.appliedVia = "call";
        return true;
      }
    }
    return false;
  }

  // Issue the director's answer: validate each directive, record it,
  // queue set/skip as pending, and stop immediately on a stop. A skip
  // issued in response to the current event applies to that very call
  // when it matches — the call has not run yet. A set does not apply
  // to the current event (see the header comment).
  function issueDirectives(answer, issuedAtEvent, raw, trigger, line) {
    let list = normalizeDirectives(answer);
    for (let ii = 0; ii < list.length; ++ii) {
      let d = validateDirective(list[ii]);
      let entry = recordDirective(d, issuedAtEvent);
      if (d.type === "stop") {
        stopped = true;
        stopReason = d.reason;
        stopPending = true;
        stopEntry = entry;
        if (onDirective) onDirective(entry);
        throw DIRECTOR_STOP;
      }
      pending.push(entry);
      if (raw !== null && d.type === "skip" && applyEntry(entry, raw, trigger, line)) {
        entry.appliedAtEvent = issuedAtEvent;
        let at = pending.indexOf(entry);
        if (at !== -1) pending.splice(at, 1);
        if (onDirective) onDirective(entry);
      }
    }
  }

  // Enrich a HOT_LOOP finding with its loop info (a copy — the live
  // analyzer's own finding objects stay clean). The guard uses it to
  // decide whether the loop can be throttled by setting its counter.
  function enrichFindings(fired) {
    let out = [];
    for (let ii = 0; ii < fired.length; ++ii) {
      let f = fired[ii];
      if (
        f.code === "HOT_LOOP" &&
        f.evidence &&
        typeof f.evidence.hash === "number"
      ) {
        let info = resolveLoopTest(stage, f.evidence.hash);
        if (info !== null) {
          out.push(Object.assign({}, f, { loop: info }));
          continue;
        }
      }
      out.push(f);
    }
    return out;
  }

  // The raw-event hook: pending directives first, then the live
  // analyzer, then the director on new findings. Runs synchronously
  // inside the DEBUG call, so every mutation here takes effect in the
  // running program.
  function handleRaw(raw, trigger, line) {
    // A stop that was swallowed (a program inside try/catch can catch
    // the sentinel once) is re-thrown at every following event until
    // it propagates out or the program ends.
    if (stopPending) throw DIRECTOR_STOP;
    let eventIndex = run.events.length - 1;
    for (let ii = pending.length - 1; ii >= 0; --ii) {
      let entry = pending[ii];
      if (applyEntry(entry, raw, trigger, line)) {
        entry.appliedAtEvent = eventIndex;
        pending.splice(ii, 1);
        if (onDirective) onDirective(entry);
      }
    }
    let fired = live.feed(line);
    if (fired.length > 0) {
      let enriched = enrichFindings(fired);
      if (director) {
        let answer = director({
          findings: enriched,
          allFindings: live.findings(),
          snapshot: live.snapshot(),
          event: line,
          eventIndex: eventIndex,
          directives: log.slice(),
        });
        issueDirectives(answer, eventIndex, raw, trigger, line);
      }
      // Live findings as they fire, for a caller that wants to print
      // them (the CLI --live flag) without being the director.
      if (options.onFinding) options.onFinding(enriched);
    }
  }

  // Parse errors reject/throw before anything runs; the two errors
  // users hit most often get a pointer at the right entry point
  // (directAsync / directModule) instead of createTraceRun's
  // traceAsync / traceModule pointers.
  let runOptions = Object.assign({}, options, { events: "ALL", rawOnEvent: handleRaw });
  if (allowAsync) {
    runOptions.stageOptions = Object.assign({}, options.stageOptions, {
      allowAwaitOutsideFunction: true,
    });
  }
  if (isModule) {
    runOptions.stageOptions = Object.assign({}, options.stageOptions, {
      sourceType: "module",
    });
  }
  try {
    run = runInternals.createTraceRun(iroh, code, runOptions);
  } catch (e) {
    if (e instanceof Error && typeof e.message === "string" && !isModule) {
      if (e.message.indexOf("This program uses top-level await") === 0) {
        throw new Error(
          "This program uses top-level await — run it with Iroh.directAsync() (or Iroh.directModule() for modules); Iroh.direct() runs synchronously"
        );
      }
      if (e.message.indexOf("This program uses import/export") === 0) {
        throw new Error(
          "This program uses import/export (or import.meta) — direct it with Iroh.directModule(); Iroh.direct() and Iroh.directAsync() run scripts only"
        );
      }
    }
    throw e;
  }
  stage = run.stage;
  let runner = isModule ? null : runInternals.compileRunner(iroh, run.stage, allowAsync);

  // The run completed normally: directives that never matched stay in
  // the audit log as unapplied, with the reason — the log never
  // pretends one took effect. A stop that was swallowed the same way:
  // the run completed, so the stop did not take effect.
  function finishSuccess(result) {
    for (let ii = 0; ii < pending.length; ++ii) {
      pending[ii].note =
        "Never applied: no matching interception point was reached before the run ended.";
    }
    if (stopPending && stopEntry !== null) {
      stopEntry.applied = false;
      stopEntry.note =
        "Stop requested but the program caught the director's stop signal and ran to completion — a program that swallows every thrown value defeats a stop.";
    }
    let summary = live.finish();
    // The record is built: the director has read the events, and the
    // returned record holds the same events array. Release the Stage
    // (1.1.1) — the module path already released in
    // importTracedModule's cleanup; the release is idempotent.
    runInternals.releaseTraceRun(iroh, run);
    return {
      result: result,
      stopped: false,
      stopReason: null,
      events: run.events,
      findings: summary.findings,
      directives: log,
      analysis: summary,
    };
  }

  // The run ended by a directed stop or an error. A directed stop is
  // a normal outcome, not an error: the analysis is the live finish()
  // over the trace as it stands — a loop the run never reached counts
  // as zero-iteration in the recorded trace. A runtime error (or a
  // director bug) throws with the trace so far attached, like trace(),
  // plus the direction record so far.
  function finishError(e) {
    if (e === DIRECTOR_STOP) {
      if (stopEntry !== null) {
        stopEntry.applied = true;
        stopEntry.appliedAtEvent = run.events.length - 1;
        stopEntry.appliedVia = "stop";
      }
      let summary = live.finish();
      runInternals.releaseTraceRun(iroh, run);
      return {
        result: void 0,
        stopped: true,
        stopReason: stopReason,
        events: run.events,
        findings: summary.findings,
        directives: log,
        analysis: summary,
      };
    }
    runInternals.attachTraceEvents(e, run.events);
    e.direct = {
      result: void 0,
      stopped: false,
      stopReason: null,
      events: run.events,
      findings: live.findings(),
      directives: log,
      analysis: live.snapshot(),
    };
    runInternals.releaseTraceRun(iroh, run);
    throw e;
  }

  let result;
  try {
    // Start call: the director may issue initial directives (e.g. skip
    // a call from the outset) before the first event fires.
    if (director) {
      let answer = director({
        findings: [],
        allFindings: [],
        snapshot: live.snapshot(),
        event: null,
        eventIndex: -1,
        directives: [],
      });
      issueDirectives(answer, -1, null, null, null);
    }
    if (isModule) {
      // The module runs through the temp-file import; its result is
      // the namespace (like traceModule()), and a directed stop thrown
      // from a listener rejects the import with the sentinel, which
      // finishError turns into the stopped record.
      return runInternals.importTracedModule(iroh, run, options).then(
        function(out) { return finishSuccess(out.result); },
        finishError
      );
    }
    if (allowAsync) {
      return runner(iroh).then(finishSuccess, finishError);
    }
    result = runner(iroh);
  } catch (e) {
    return finishError(e);
  }
  return finishSuccess(result);
}

// Synchronous directed run: direct() in the 1.0.0 sense.
export function direct(code, director, options) {
  return directInternal(this, code, director, options, "sync");
}

// Async directed run: the same engine, but the program runs through
// compileRunner's async wrapper, so top-level await works and async
// continuations are included. Returns a Promise of the directed
// record. A parse error or module code rejects (never throws
// synchronously) — like traceAsync() — and a runtime error rejects
// with the events that fired before it attached as error.events and
// the direction record so far as error.direct.
export function directAsync(code, director, options) {
  let out;
  try {
    out = directInternal(this, code, director, options, "async");
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(out);
}

// Module directed run: the same engine, but the program runs as an ES
// module through the temp-file import, so import/export and top-level
// await both work. Returns a Promise of the directed record; the
// record's result is the module namespace (like traceModule()).
// Options.filename bases relative imports, as in traceModule(). A
// parse error rejects before running; a runtime error rejects with the
// events that fired before it attached as error.events and the
// direction record so far as error.direct. Requires Node.js.
export function directModule(code, director, options) {
  let out;
  try {
    out = directInternal(this, code, director, options, "module");
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(out);
}

// The built-in director: a runaway-loop guard. When HOT_LOOP fires it
// throttles by default — it sets the loop's counter to the value that
// makes its test false, so the loop exits at the next test — or, with
// { action: "stop" }, it stops the run with a reason. A loop whose
// counter cannot be resolved (while(true), a non-literal bound, a
// compound test, == / ===) cannot be throttled, so the guard stops
// the run instead and says so. The guard is a factory: it returns the
// director function, so one guard instance directs one run.
export function runawayGuard(options) {
  options = options || {};
  let action = options.action || "throttle";
  if (action !== "throttle" && action !== "stop") {
    throw new Error(
      "runawayGuard action must be \"throttle\" or \"stop\", got: " + action
    );
  }
  return function guard(ctx) {
    let out = [];
    for (let ii = 0; ii < ctx.findings.length; ++ii) {
      let f = ctx.findings[ii];
      if (f.code !== "HOT_LOOP") continue;
      let hash =
        f.evidence && f.evidence.hash !== void 0 ? "#" + f.evidence.hash : "";
      let count =
        f.evidence && f.evidence.iterations !== void 0
          ? f.evidence.iterations
          : "?";
      let threshold =
        f.evidence && f.evidence.threshold !== void 0
          ? f.evidence.threshold
          : "?";
      if (action === "stop" || !f.loop || f.loop.value === null) {
        let why =
          action === "stop"
            ? "stopping the run by policy"
            : "its counter could not be resolved (the test is not a simple counter comparison against a numeric limit), so the run stops instead of throttling";
        out.push({
          type: "stop",
          reason:
            "Runaway loop guard: loop " +
            hash +
            " entered " +
            count +
            " times (threshold " +
            threshold +
            "); " +
            why +
            ".",
        });
      } else {
        out.push({ type: "set", name: f.loop.counter, value: f.loop.value });
      }
    }
    if (out.length === 0) return null;
    if (out.length === 1) return out[0];
    return out;
  };
}
