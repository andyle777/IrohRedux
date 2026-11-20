// AI analysis layer for IrohRedux 0.8.0 — deterministic rules over a
// trace's events, plus a toolkit scorecard. No LLM, no network, no
// randomness: the same events always give the same analysis.
//
//   Iroh.analyze(events, options)          -> { findings, scores, summary, neuron }
//   Iroh.analyzeTrace(code, options)       -> { events, result, analysis }
//   Iroh.analyzeTraceAsync(code, options)  -> Promise of the same
//   Iroh.analyzeModule(code, options)      -> Promise of the same
//
// Findings are { code, severity, message, evidence, neuron } — every
// finding cites its evidence (counts, names, hashes); no finding
// without evidence. Severities: "warning" (likely a real problem) and
// "info" (worth knowing). Thresholds live in `options` with the
// defaults documented below.
//
// The neuron field is the trace-window classification from
// src/neurons.js (hot vs normal) on the findings the perceptron
// applies to — HOT_LOOP, DEEP_RECURSION, REPEATED_SEQUENCE. The
// perceptron classifies hotness only, so ONE_SIDED_BRANCH,
// ZERO_ITERATION_LOOP and THROWING_PATH get neuron: null with a note
// saying so, rather than a forced label.
//
// Scores (every number carries its denominator, per Andy's rule):
//   coverage — event categories fired vs total categories in CATEGORY.
//     Note: this assumes an unfiltered trace (events: "ALL"). A trace
//     collected with an events filter scores the filter, not the
//     toolkit — analyzeTrace() traces with ALL categories by default.
//   fidelity — instrumented regions observed vs all regions:
//     observed = distinct event hashes; missing = regions the trace
//     shows were never entered (loop bodies never entered, one-sided
//     if arms); blind spots = private-field and destructuring
//     assignments found in the source (only when options.source is
//     given — analyzeTrace() passes it; without source they are
//     listed as known blind spots with a null count, never hidden).
//   overhead — events per statement (when source is given) and
//     events per region (always). `value` is the per-statement ratio
//     when available, else per-region, and `denominator` says which.

import { CATEGORY, reachableCategories } from "./labels";
import { parse } from "./utils";
import { classifyWindow } from "./neurons";

export const ANALYZE_DEFAULTS = {
  hotLoopThreshold: 100,
  deepRecursionThreshold: 20,
  repeatSequenceMinOccurrences: 3,
  oneSidedMinTests: 2,
};

// Constructs the instrumenter never reports as events. Listed in
// every scorecard, whether or not the trace's source was available
// to count them — a blind spot that is counted as zero is still a
// blind spot, and one that cannot be counted is not hidden.
const KNOWN_BLIND_SPOTS = [
  {
    kind: "private-field-assignment",
    note: "Assignments to private fields (this.#x = ...) are left native and produce no ASSIGN event (0.4.0).",
  },
  {
    kind: "destructuring-assignment",
    note: "Pattern assignments ([a, b] = ... / ({a} = ...)) are left native and produce no ASSIGN event (0.4.0).",
  },
];

// Walk an AST counting statements and the known blind-spot
// constructs. A statement is a node whose type ends in "Statement"
// or is a VariableDeclaration / FunctionDeclaration. Blind spots are
// AssignmentExpressions whose left side is a MemberExpression with a
// PrivateIdentifier property, or an ArrayPattern / ObjectPattern.
function inspectSource(code) {
  let ast;
  try {
    ast = parse(code);
  } catch (e) {
    return null;
  }
  let statements = 0;
  let blindSpots = 0;
  function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let ii = 0; ii < node.length; ++ii) walk(node[ii]);
      return;
    }
    if (typeof node.type === "string") {
      if (
        node.type.slice(-"Statement".length) === "Statement" ||
        node.type === "VariableDeclaration" ||
        node.type === "FunctionDeclaration"
      ) {
        statements += 1;
      }
      if (node.type === "AssignmentExpression") {
        let left = node.left;
        if (left) {
          if (
            left.type === "MemberExpression" &&
            left.property &&
            left.property.type === "PrivateIdentifier"
          ) {
            blindSpots += 1;
          } else if (
            left.type === "ArrayPattern" ||
            left.type === "ObjectPattern"
          ) {
            blindSpots += 1;
          }
        }
      }
    }
    let keys = Object.keys(node);
    for (let ii = 0; ii < keys.length; ++ii) {
      let key = keys[ii];
      if (key === "loc" || key === "range" || key === "start" || key === "end") {
        continue;
      }
      walk(node[key]);
    }
  }
  walk(ast);
  return { statements: statements, blindSpots: blindSpots };
}

function groupByHash(events, eventName, trigger) {
  let groups = {};
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event !== eventName) continue;
    if (trigger !== void 0 && e.trigger !== trigger) continue;
    let key = String(e.hash);
    if (!groups[key]) {
      groups[key] = { hash: e.hash, events: [], kind: e.kind, name: e.name };
    }
    groups[key].events.push(e);
  }
  return groups;
}

export function analyze(events, options) {
  options = options || {};
  let thresholds = {
    hotLoopThreshold: options.hotLoopThreshold === void 0
      ? ANALYZE_DEFAULTS.hotLoopThreshold : options.hotLoopThreshold,
    deepRecursionThreshold: options.deepRecursionThreshold === void 0
      ? ANALYZE_DEFAULTS.deepRecursionThreshold : options.deepRecursionThreshold,
    repeatSequenceMinOccurrences: options.repeatSequenceMinOccurrences === void 0
      ? ANALYZE_DEFAULTS.repeatSequenceMinOccurrences : options.repeatSequenceMinOccurrences,
    oneSidedMinTests: options.oneSidedMinTests === void 0
      ? ANALYZE_DEFAULTS.oneSidedMinTests : options.oneSidedMinTests,
  };
  events = Array.isArray(events) ? events : [];
  let totalEvents = events.length;

  // --- Window classification (the neuron) -------------------------
  let neuron = classifyWindow(events);

  // --- Per-hash groups ---------------------------------------------
  let loopEnters = groupByHash(events, "LOOP_ENTER", "enter");
  let loopTests = groupByHash(events, "LOOP_TEST", "test");
  let ifTests = groupByHash(events, "IF_TEST", "test");
  let catches = groupByHash(events, "CATCH_ENTER", "enter");

  // --- Findings ------------------------------------------------------
  let findings = [];
  function neuronForHotness() {
    return { label: neuron.label, score: neuron.score };
  }
  let neuronNote =
    "The perceptron classifies hot vs normal only; this finding is not a hotness phenomenon, so it carries no neuron label.";

  // HOT_LOOP: a loop body entered at or above the threshold.
  // LOOP_ENTER fires once per loop entry, not per iteration, so
  // iterations are counted from LOOP_TEST events with value true
  // (one true test per iteration, plus one final false test).
  let loopHashes = Object.keys(loopTests);
  for (let ii = 0; ii < loopHashes.length; ++ii) {
    let g = loopTests[loopHashes[ii]];
    let iterations = 0;
    for (let jj = 0; jj < g.events.length; ++jj) {
      if (g.events[jj].value === true) iterations += 1;
    }
    if (iterations >= thresholds.hotLoopThreshold) {
      findings.push({
        code: "HOT_LOOP",
        severity: "warning",
        message:
          "Loop entered " + iterations + " times (threshold " +
          thresholds.hotLoopThreshold + ").",
        evidence: {
          hash: g.hash,
          kind: g.kind || null,
          iterations: iterations,
          tests: g.events.length,
          threshold: thresholds.hotLoopThreshold,
        },
        neuron: neuronForHotness(),
      });
    }
  }

  // ZERO_ITERATION_LOOP: a loop tested but never entered.
  let testHashes = Object.keys(loopTests);
  for (let ii = 0; ii < testHashes.length; ++ii) {
    let g = loopTests[testHashes[ii]];
    if (!loopEnters[String(g.hash)] && g.events.length > 0) {
      findings.push({
        code: "ZERO_ITERATION_LOOP",
        severity: "info",
        message:
          "Loop tested " + g.events.length + " time(s) but its body never ran.",
        evidence: {
          hash: g.hash,
          kind: g.kind || null,
          tests: g.events.length,
          iterations: 0,
        },
        neuron: null,
        neuronNote: neuronNote,
      });
    }
  }

  // DEEP_RECURSION: the deepest function entry at or above the threshold.
  let maxDepth = 0;
  let deepestName = null;
  let deepestCalls = 0;
  let callsByName = {};
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "FUNCTION_ENTER") {
      if (typeof e.indent === "number" && e.indent > maxDepth) {
        maxDepth = e.indent;
        deepestName = e.name || null;
      }
    }
    if (e.event === "FUNCTION_CALL" && e.trigger === "before" && e.name) {
      callsByName[e.name] = (callsByName[e.name] || 0) + 1;
    }
  }
  if (deepestName !== null) deepestCalls = callsByName[deepestName] || 0;
  if (maxDepth >= thresholds.deepRecursionThreshold) {
    findings.push({
      code: "DEEP_RECURSION",
      severity: "warning",
      message:
        "Call depth reached " + maxDepth + " (threshold " +
        thresholds.deepRecursionThreshold + "), deepest in '" +
        deepestName + "'.",
      evidence: {
        name: deepestName,
        maxDepth: maxDepth,
        threshold: thresholds.deepRecursionThreshold,
        calls: deepestCalls,
      },
      neuron: neuronForHotness(),
    });
  }

  // REPEATED_SEQUENCE: the same call sequence (names, in order)
  // repeating. N-grams of length 2..4 over FUNCTION_CALL names;
  // the most frequent sequence at or above the occurrence threshold
  // wins (ties go to the longest, then the first seen).
  let callNames = [];
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "FUNCTION_CALL" && e.trigger === "before" && e.name) {
      callNames.push(e.name);
    }
  }
  let bestSequence = null;
  let bestOccurrences = 0;
  let bestLength = 0;
  for (let n = 2; n <= 4; ++n) {
    let counts = {};
    let firstSeen = {};
    for (let ii = 0; ii + n <= callNames.length; ++ii) {
      let seq = callNames.slice(ii, ii + n).join("\n");
      if (counts[seq] === void 0) {
        counts[seq] = 0;
        firstSeen[seq] = ii;
      }
      counts[seq] += 1;
    }
    let keys = Object.keys(counts);
    for (let ii = 0; ii < keys.length; ++ii) {
      let seq = keys[ii];
      let occ = counts[seq];
      if (
        occ >= thresholds.repeatSequenceMinOccurrences &&
        (occ > bestOccurrences ||
          (occ === bestOccurrences && n > bestLength))
      ) {
        bestSequence = seq.split("\n");
        bestOccurrences = occ;
        bestLength = n;
      }
    }
  }
  if (bestSequence !== null) {
    findings.push({
      code: "REPEATED_SEQUENCE",
      severity: "info",
      message:
        "Call sequence [" + bestSequence.join(", ") + "] repeated " +
        bestOccurrences + " times.",
      evidence: {
        sequence: bestSequence,
        occurrences: bestOccurrences,
        length: bestLength,
        threshold: thresholds.repeatSequenceMinOccurrences,
      },
      neuron: neuronForHotness(),
    });
  }

  // ONE_SIDED_BRANCH: an if evaluated at least oneSidedMinTests
  // times whose outcome was always the same side.
  let ifHashes = Object.keys(ifTests);
  for (let ii = 0; ii < ifHashes.length; ++ii) {
    let g = ifTests[ifHashes[ii]];
    let trueCount = 0;
    let falseCount = 0;
    for (let jj = 0; jj < g.events.length; ++jj) {
      if (g.events[jj].value === true) trueCount += 1;
      else if (g.events[jj].value === false) falseCount += 1;
    }
    let total = trueCount + falseCount;
    if (total >= thresholds.oneSidedMinTests && (trueCount === 0 || falseCount === 0)) {
      findings.push({
        code: "ONE_SIDED_BRANCH",
        severity: "info",
        message:
          "If evaluated " + total + " time(s), always " +
          (trueCount > 0 ? "true" : "false") + " — the other arm never fired.",
        evidence: {
          hash: g.hash,
          trueCount: trueCount,
          falseCount: falseCount,
          tests: total,
        },
        neuron: null,
        neuronNote: neuronNote,
      });
    }
  }

  // THROWING_PATH: a catch block ran (caught exceptions). Uncaught
  // exceptions end the trace itself and are reported by the caller
  // (trace() throws with the events attached), not by the analyzer.
  let catchHashes = Object.keys(catches);
  if (catchHashes.length > 0) {
    let catchCount = 0;
    let hashes = [];
    for (let ii = 0; ii < catchHashes.length; ++ii) {
      let g = catches[catchHashes[ii]];
      catchCount += g.events.length;
      hashes.push(g.hash);
    }
    findings.push({
      code: "THROWING_PATH",
      severity: "warning",
      message:
        "Exceptions were caught " + catchCount + " time(s) during the trace.",
      evidence: { catches: catchCount, hashes: hashes },
      neuron: null,
      neuronNote: neuronNote,
    });
  }

  // Unclosed frames (1.1.1, M3): a generator closed early
  // (.return() / .close()) leaves a FUNCTION_ENTER with no matching
  // FUNCTION_LEAVE or FUNCTION_RETURN — the tracer cannot observe the
  // close, so the frame dangles. The call depth is still correct (the
  // yield already dropped it), and the analysis treats an ENTER still
  // open at the end of the trace as closed, with this note, rather
  // than silently dropping it. A plain function closes with
  // FUNCTION_RETURN; a generator run to completion closes with
  // FUNCTION_LEAVE.
  let openFrames = [];
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "FUNCTION_ENTER") {
      openFrames.push({
        name: e.name || null,
        indent: typeof e.indent === "number" ? e.indent : null,
      });
    } else if (e.event === "FUNCTION_LEAVE" || e.event === "FUNCTION_RETURN") {
      let popped = false;
      for (let jj = openFrames.length - 1; jj >= 0; --jj) {
        if (
          openFrames[jj].indent === e.indent ||
          openFrames[jj].indent === null ||
          typeof e.indent !== "number"
        ) {
          openFrames.splice(jj, 1);
          popped = true;
          break;
        }
      }
      if (!popped && openFrames.length > 0) openFrames.pop();
    }
  }
  let unclosedFrames = openFrames.length > 0
    ? {
        count: openFrames.length,
        frames: openFrames.map((f) => f.name),
        note: "Frames still open at the end of the trace (e.g. a generator closed early with .return()/.close()) — treated as closed. The call depth is unaffected: the yield already dropped the frame.",
      }
    : null;

  // --- Scorecard -------------------------------------------------------
  // Coverage: categories fired vs the categories this tracer can
  // reach (1.1.1, F4). The denominator is the reachable set for the
  // trace's language, not the whole model: a C++ trace firing CALL
  // and FUNCTION is 2 of 2 reachable, not 2 of 30. `missingCategories`
  // lists the reachable categories that did NOT fire — the ones a
  // reader could have seen but did not. A consumer must never treat
  // a missing `reachable` field as `total`: that would read a
  // non-JS trace as if it were JavaScript.
  let language = options.language || "javascript";
  let reachableList = reachableCategories(language);
  let reachableSet = {};
  for (let ii = 0; ii < reachableList.length; ++ii) reachableSet[reachableList[ii]] = true;
  let totalCategories = Object.keys(CATEGORY).length;
  let firedSet = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (events[ii].category) firedSet[events[ii].category] = true;
  }
  let firedCategories = Object.keys(firedSet).sort();
  let missingCategories = [];
  for (let ii = 0; ii < reachableList.length; ++ii) {
    if (!firedSet[reachableList[ii]]) missingCategories.push(reachableList[ii]);
  }
  let coverage = {
    fired: firedCategories.length,
    reachable: reachableList.length,
    total: totalCategories,
    value: reachableList.length > 0
      ? Math.round((firedCategories.length / reachableList.length) * 10000) / 10000
      : 0,
    firedCategories: firedCategories,
    missingCategories: missingCategories,
    note: firedCategories.length + " of " + reachableList.length + " reachable for a " + language +
      " trace (" + totalCategories + " exist in the model). Assumes an unfiltered trace (events: ALL). A trace collected with an events filter scores the filter, not the toolkit.",
  };

  // Fidelity: observed regions vs all regions. Observed = distinct
  // event hashes. Missing = regions the trace shows were never
  // entered (zero-iteration loop bodies, one-sided if arms). Blind
  // spots = known uninstrumented constructs found in the source, when
  // the source was given.
  let hashSet = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (typeof events[ii].hash === "number") hashSet[events[ii].hash] = true;
  }
  let observedRegions = Object.keys(hashSet).length;
  let missingRegions = 0;
  for (let ii = 0; ii < testHashes.length; ++ii) {
    if (!loopEnters[String(loopTests[testHashes[ii]].hash)]) missingRegions += 1;
  }
  for (let ii = 0; ii < ifHashes.length; ++ii) {
    let g = ifTests[ifHashes[ii]];
    let t = 0;
    let f = 0;
    for (let jj = 0; jj < g.events.length; ++jj) {
      if (g.events[jj].value === true) t += 1;
      else if (g.events[jj].value === false) f += 1;
    }
    if (t + f >= thresholds.oneSidedMinTests && (t === 0 || f === 0)) {
      missingRegions += 1;
    }
  }
  let sourceInfo = null;
  if (typeof options.source === "string") {
    sourceInfo = inspectSource(options.source);
  }
  let blindSpotStatements = sourceInfo ? sourceInfo.blindSpots : null;
  let blindSpotCount = blindSpotStatements === null ? 0 : blindSpotStatements;
  let totalRegions = observedRegions + missingRegions + blindSpotCount;
  let fidelity = {
    observedRegions: observedRegions,
    missingRegions: missingRegions,
    blindSpotStatements: blindSpotStatements,
    totalRegions: totalRegions,
    value: totalRegions > 0
      ? Math.round((observedRegions / totalRegions) * 10000) / 10000
      : 1,
    knownBlindSpots: KNOWN_BLIND_SPOTS,
  };

  // Overhead: events per statement (when the source was given) and
  // events per region (always). `value` is the per-statement ratio
  // when available, else per-region; `denominator` says which.
  let statements = sourceInfo ? sourceInfo.statements : null;
  let eventsPerRegion = observedRegions > 0
    ? Math.round((totalEvents / observedRegions) * 100) / 100
    : 0;
  let eventsPerStatement = statements !== null && statements > 0
    ? Math.round((totalEvents / statements) * 100) / 100
    : null;
  let overhead = {
    events: totalEvents,
    statements: statements,
    regions: observedRegions,
    eventsPerStatement: eventsPerStatement,
    eventsPerRegion: eventsPerRegion,
    value: eventsPerStatement !== null ? eventsPerStatement : eventsPerRegion,
    denominator: eventsPerStatement !== null ? "statements" : "regions",
  };

  let scores = { coverage: coverage, fidelity: fidelity, overhead: overhead };

  let warnings = 0;
  let infos = 0;
  for (let ii = 0; ii < findings.length; ++ii) {
    if (findings[ii].severity === "warning") warnings += 1;
    else infos += 1;
  }
  let summary = {
    events: totalEvents,
    findings: findings.length,
    warnings: warnings,
    infos: infos,
    maxCallDepth: maxDepth,
    distinctRegions: observedRegions,
    unclosedFrames: unclosedFrames,
  };

  return { findings: findings, scores: scores, summary: summary, neuron: neuron };
}

// Trace a script and analyze it in one call. Options are trace()'s,
// plus `analyze` (thresholds / source override — `source` defaults
// to the code being traced). Returns { events, result, analysis }.
export function analyzeTrace(code, options) {
  options = options || {};
  let out = this.trace(code, options);
  let analyzeOptions = options.analyze || {};
  if (analyzeOptions.source === void 0) analyzeOptions.source = code;
  return { events: out.events, result: out.result, analysis: analyze(out.events, analyzeOptions) };
}

// Async version of analyzeTrace(): scripts with top-level await, via
// traceAsync(). Returns a Promise of { events, result, analysis }.
export function analyzeTraceAsync(code, options) {
  options = options || {};
  let iroh = this;
  let analyzeOptions = options.analyze || {};
  if (analyzeOptions.source === void 0) analyzeOptions.source = code;
  return iroh.traceAsync(code, options).then(function(out) {
    return { events: out.events, result: out.result, analysis: analyze(out.events, analyzeOptions) };
  });
}

// Module version of analyzeTrace(), via traceModule(). Node only.
// Returns a Promise of { events, result, analysis }.
export function analyzeModule(code, options) {
  options = options || {};
  let iroh = this;
  let analyzeOptions = options.analyze || {};
  if (analyzeOptions.source === void 0) analyzeOptions.source = code;
  return iroh.traceModule(code, options).then(function(out) {
    return { events: out.events, result: out.result, analysis: analyze(out.events, analyzeOptions) };
  });
}
