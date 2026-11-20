// Live wire AI analysis mode for IrohRedux 0.9.0 — analysis that runs
// WHILE the program runs, streaming findings as events arrive, instead
// of analyze-after-the-fact:
//
//   let live = Iroh.liveAnalyzer(options);
//   live.feed(event);   // -> findings that fired on this event (usually [])
//   live.findings();    // all findings fired so far, in fire order
//   live.snapshot();    // progress so far (no scores — those are final)
//   live.finish();      // final summary: batch-equal findings + scores + vectors
//
// A finding fires the moment its threshold trips: HOT_LOOP when a
// loop's true-test count reaches hotLoopThreshold, DEEP_RECURSION when
// a FUNCTION_ENTER indent reaches deepRecursionThreshold,
// REPEATED_SEQUENCE when a call sequence reaches
// repeatSequenceMinOccurrences, THROWING_PATH on the first CATCH_ENTER.
// Each fired finding carries `firedAt` (the 0-based index of the event
// that tripped it) and the evidence as of the trip — the counts are the
// counts so far, not the final tally.
//
// Two findings cannot be decided incrementally, so they fire at stream
// end (finish()) with a `note` saying so, never a wrong early call:
// ZERO_ITERATION_LOOP (a loop could still be entered later) and
// ONE_SIDED_BRANCH (a later test could take the other arm). They are
// taken from the batch analysis at finish(), so they are batch-equal
// by construction.
//
// Consistency: the codes of the fired findings (after finish()) equal
// the codes of batch analyze() on the same complete trace — every batch
// finding either trips mid-stream or at stream end. The final summary
// IS the batch analysis (findings, scores, summary, neuron) plus the
// toVector() projection, so live vs batch agreement holds by
// construction, not by re-implementation. The fired findings' evidence
// may differ from the final tally (counts as of the trip vs final
// counts; the live REPEATED_SEQUENCE is the first sequence to reach
// the threshold, the final one is the batch-best) — the live finding
// is the early warning, the summary is the authoritative tally.
// Deterministic: the same events always give the same findings in the
// same order — no randomness, no wall-clock, no iteration over
// unordered state (per-hash state is only read at finish(), from the
// batch analysis, whose order is deterministic).

import { analyze, ANALYZE_DEFAULTS } from "./analyze";
import { classifyWindow } from "./neurons";
import { toVector } from "./vectors";

// Notes attached to the findings that can only be decided at stream end.
const STREAM_END_NOTES = {
  ZERO_ITERATION_LOOP:
    "Decided at stream end: a loop is only zero-iteration once the trace is complete — it could still be entered later.",
  ONE_SIDED_BRANCH:
    "Decided at stream end: a branch is only one-sided once the trace is complete — a later test could take the other arm.",
};

const NEURON_NOTE =
  "The perceptron classifies hot vs normal only; this finding is not a hotness phenomenon, so it carries no neuron label.";

export function liveAnalyzer(options) {
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
  let analyzer = {
    events: [],
    fired: [],
    finished: false,
    finalSummary: null,
    // Per-loop-hash state: { hash, kind, iterations, tests, entered }.
    loops: {},
    // Per-if-hash state: { hash, trueCount, falseCount }.
    ifs: {},
    // Call names in order (for REPEATED_SEQUENCE n-grams), and the
    // per-name call counts (for DEEP_RECURSION evidence).
    callNames: [],
    callsByName: {},
    // N-gram counts for lengths 2..4, keyed by the names joined with
    // "\n", plus the first-seen start index of each sequence.
    ngramCounts: [{}, {}, {}],
    ngramFirstSeen: [{}, {}, {}],
    hotLoopFired: {},
    deepFired: false,
    sequenceFired: false,
    throwingFired: false,
  };

  function neuronNow() {
    // The window classification over the events so far — the best
    // available estimate at the trip. The final summary carries the
    // whole-trace classification instead.
    return classifyWindow(analyzer.events);
  }

  function fire(finding, index) {
    finding.firedAt = index;
    analyzer.fired.push(finding);
    return finding;
  }

  function feed(event) {
    if (analyzer.finished) {
      throw new Error("live analyzer is finished; feed() after finish() is a programming error");
    }
    if (!event || typeof event !== "object") return [];
    analyzer.events.push(event);
    let index = analyzer.events.length - 1;
    let firedNow = [];

    if (event.event === "LOOP_TEST" && event.trigger === "test") {
      let key = String(event.hash);
      let loop = analyzer.loops[key];
      if (!loop) {
        loop = { hash: event.hash, kind: event.kind || null, iterations: 0, tests: 0, entered: false };
        analyzer.loops[key] = loop;
      }
      loop.tests += 1;
      if (event.value === true) {
        loop.iterations += 1;
        if (loop.iterations >= thresholds.hotLoopThreshold && !analyzer.hotLoopFired[key]) {
          analyzer.hotLoopFired[key] = true;
          firedNow.push(fire({
            code: "HOT_LOOP",
            severity: "warning",
            message:
              "Loop entered " + loop.iterations + " times (threshold " +
              thresholds.hotLoopThreshold + ").",
            evidence: {
              hash: loop.hash,
              kind: loop.kind,
              iterations: loop.iterations,
              tests: loop.tests,
              threshold: thresholds.hotLoopThreshold,
            },
            neuron: neuronNow(),
          }, index));
        }
      }
    } else if (event.event === "LOOP_ENTER" && event.trigger === "enter") {
      let key = String(event.hash);
      let loop = analyzer.loops[key];
      if (!loop) {
        loop = { hash: event.hash, kind: event.kind || null, iterations: 0, tests: 0, entered: false };
        analyzer.loops[key] = loop;
      }
      loop.entered = true;
    } else if (event.event === "FUNCTION_ENTER") {
      if (typeof event.indent === "number" &&
          event.indent >= thresholds.deepRecursionThreshold &&
          !analyzer.deepFired) {
        analyzer.deepFired = true;
        firedNow.push(fire({
          code: "DEEP_RECURSION",
          severity: "warning",
          message:
            "Call depth reached " + event.indent + " (threshold " +
            thresholds.deepRecursionThreshold + "), deepest in '" +
            (event.name || null) + "'.",
          evidence: {
            name: event.name || null,
            maxDepth: event.indent,
            threshold: thresholds.deepRecursionThreshold,
            calls: analyzer.callsByName[event.name] || 0,
          },
          neuron: neuronNow(),
        }, index));
      }
    } else if (event.event === "FUNCTION_CALL" && event.trigger === "before" && event.name) {
      analyzer.callsByName[event.name] = (analyzer.callsByName[event.name] || 0) + 1;
      analyzer.callNames.push(event.name);
      if (!analyzer.sequenceFired) {
        // N-grams ending at this call, lengths 2..4. A sequence's
        // count grows only here, so every trip is observed.
        let best = null;
        let bestOccurrences = 0;
        let bestLength = 0;
        let bestFirstSeen = 0;
        for (let n = 2; n <= 4; ++n) {
          if (analyzer.callNames.length < n) continue;
          let start = analyzer.callNames.length - n;
          let seq = analyzer.callNames.slice(start).join("\n");
          let counts = analyzer.ngramCounts[n - 2];
          let firstSeen = analyzer.ngramFirstSeen[n - 2];
          if (counts[seq] === void 0) {
            counts[seq] = 0;
            firstSeen[seq] = start;
          }
          counts[seq] += 1;
          let occ = counts[seq];
          if (occ >= thresholds.repeatSequenceMinOccurrences &&
              (occ > bestOccurrences ||
                (occ === bestOccurrences && n > bestLength) ||
                (occ === bestOccurrences && n === bestLength &&
                  firstSeen[seq] < bestFirstSeen))) {
            best = seq.split("\n");
            bestOccurrences = occ;
            bestLength = n;
            bestFirstSeen = firstSeen[seq];
          }
        }
        if (best !== null) {
          analyzer.sequenceFired = true;
          firedNow.push(fire({
            code: "REPEATED_SEQUENCE",
            severity: "info",
            message:
              "Call sequence [" + best.join(", ") + "] repeated " +
              bestOccurrences + " times.",
            evidence: {
              sequence: best,
              occurrences: bestOccurrences,
              length: bestLength,
              threshold: thresholds.repeatSequenceMinOccurrences,
            },
            neuron: neuronNow(),
          }, index));
        }
      }
    } else if (event.event === "CATCH_ENTER" && event.trigger === "enter") {
      if (!analyzer.throwingFired) {
        analyzer.throwingFired = true;
        firedNow.push(fire({
          code: "THROWING_PATH",
          severity: "warning",
          message: "Exceptions were caught 1 time(s) during the trace.",
          evidence: { catches: 1, hashes: [event.hash] },
          neuron: null,
          neuronNote: NEURON_NOTE,
        }, index));
      }
    } else if (event.event === "IF_TEST" && event.trigger === "test") {
      let key = String(event.hash);
      let branch = analyzer.ifs[key];
      if (!branch) {
        branch = { hash: event.hash, trueCount: 0, falseCount: 0 };
        analyzer.ifs[key] = branch;
      }
      if (event.value === true) branch.trueCount += 1;
      else if (event.value === false) branch.falseCount += 1;
    }
    return firedNow;
  }

  function findings() {
    return analyzer.fired.slice();
  }

  function snapshot() {
    if (analyzer.finished) return analyzer.finalSummary;
    // Progress so far: the findings that have fired, the window
    // classification and the vector over the events so far. No scores:
    // the scorecard is only final, at finish().
    return {
      events: analyzer.events.length,
      findings: analyzer.fired.slice(),
      neuron: classifyWindow(analyzer.events),
      vectors: toVector(analyzer.events),
      finished: false,
    };
  }

  function finish() {
    if (analyzer.finished) return analyzer.finalSummary;
    // The final summary IS the batch analysis — findings, scores,
    // summary, neuron — plus the vector projection, so live vs batch
    // agreement holds by construction. The stream-end findings are
    // taken from it (same order, same evidence) and marked as decided
    // at stream end; the mid-stream firings keep their trip-time
    // evidence.
    let final = analyze(analyzer.events, options);
    let summary = final.summary;
    summary.language = options.language || "javascript";
    let lastIndex = analyzer.events.length - 1;
    for (let ii = 0; ii < final.findings.length; ++ii) {
      let f = final.findings[ii];
      if (f.code === "ZERO_ITERATION_LOOP" || f.code === "ONE_SIDED_BRANCH") {
        let fired = {
          code: f.code,
          severity: f.severity,
          message: f.message,
          evidence: f.evidence,
          neuron: f.neuron,
          firedAt: lastIndex,
          note: STREAM_END_NOTES[f.code],
        };
        if (f.neuronNote) fired.neuronNote = f.neuronNote;
        analyzer.fired.push(fired);
      }
    }
    analyzer.finished = true;
    analyzer.finalSummary = {
      findings: final.findings,
      scores: final.scores,
      summary: summary,
      neuron: final.neuron,
      vectors: toVector(analyzer.events),
      finished: true,
    };
    return analyzer.finalSummary;
  }

  return {
    feed: feed,
    findings: findings,
    snapshot: snapshot,
    finish: finish,
  };
}
