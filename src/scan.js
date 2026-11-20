// AI-friendly scan mode for IrohRedux 0.9.0 — trace -> analyze ->
// vector in ONE pass, emitting ONE compact JSON document instead of
// the raw event flood:
//
//   { vectors, findings, scores, summary }
//
// - `vectors` is the toVector() projection (src/vectors.js): named
//   features, the ordered numeric vector, and the feature names.
// - `findings`, `scores` are exactly what Iroh.analyze() returns —
//   every finding cites its evidence, every score carries its
//   denominator.
// - `summary` is analyze()'s summary plus the scan's own fields:
//   `language` (javascript/python/cpp), `neuron` (the window
//   classification), and `findingsTruncated` (0 unless the findings
//   cap below bit — a large trace must scan to something far smaller
//   than its raw event stream, so findings are capped; the cap is a
//   safety bound, and the count of dropped findings is reported,
//   never hidden).
//
// The scan works the same across languages: scan(events) only reads
// the plain event objects, so a JS, Python or C++ trace scans to the
// same schema. scanTrace()/scanTraceAsync()/scanModule() are the JS
// conveniences (trace then scan); Python and C++ traces reach the
// scan through the CLI --scan flag.
//
//   Iroh.scan(events, options)          -> scan document
//   Iroh.scanTrace(code, options)       -> scan document (JS, sync)
//   Iroh.scanTraceAsync(code, options)  -> Promise of the same
//   Iroh.scanModule(code, options)      -> Promise of the same
//
// Options: language (default "javascript"), source (for the fidelity
// score's blind-spot count — defaults to the traced code in the
// scanTrace family), the analyze() thresholds (hotLoopThreshold,
// deepRecursionThreshold, repeatSequenceMinOccurrences,
// oneSidedMinTests, via options.analyze in the scanTrace family),
// maxFindings (default 200), includeEvents (default false — when
// true the raw events ride along in the document under `events`, for
// callers that explicitly want the flood).

import { analyze } from "./analyze";
import { toVector } from "./vectors";

export const SCAN_DEFAULTS = {
  maxFindings: 200,
};

// The scan of a trace's events. Pure function — no tracing, no I/O.
export function scan(events, options) {
  options = options || {};
  events = Array.isArray(events) ? events : [];
  let maxFindings = options.maxFindings === void 0
    ? SCAN_DEFAULTS.maxFindings : options.maxFindings;
  // A negative cap is nonsense, not a request for "all but N": slice(0, -5)
  // would emit all but the last five findings and report a negative
  // truncation. Clamp to >= 0; a non-number falls back to the default.
  if (typeof maxFindings !== "number" || !isFinite(maxFindings)) {
    maxFindings = SCAN_DEFAULTS.maxFindings;
  }
  maxFindings = Math.max(0, Math.floor(maxFindings));
  let analysis = analyze(events, options);
  let vectors = toVector(events, { language: options.language || "javascript" });
  let allFindings = analysis.findings;
  let truncated = 0;
  let findings = allFindings;
  if (allFindings.length > maxFindings) {
    truncated = allFindings.length - maxFindings;
    findings = allFindings.slice(0, maxFindings);
  }
  let summary = {
    events: analysis.summary.events,
    findings: analysis.summary.findings,
    warnings: analysis.summary.warnings,
    infos: analysis.summary.infos,
    maxCallDepth: analysis.summary.maxCallDepth,
    distinctRegions: analysis.summary.distinctRegions,
    unclosedFrames: analysis.summary.unclosedFrames,
    language: options.language || "javascript",
    neuron: {
      label: analysis.neuron.label,
      score: analysis.neuron.score,
    },
    findingsTruncated: truncated,
  };
  let doc = {
    vectors: vectors,
    findings: findings,
    scores: analysis.scores,
    summary: summary,
  };
  if (options.includeEvents) {
    doc.events = events;
  }
  return doc;
}

// Scan a JS script: trace it, then scan the events. Options are
// trace()'s, plus `analyze` (thresholds / source override — `source`
// defaults to the code), `language` (default "javascript"),
// `maxFindings` and `includeEvents`.
export function scanTrace(code, options) {
  options = options || {};
  let out = this.trace(code, options);
  // Copy: scanOptions defaults (source, language) are written onto this
  // object, and aliasing the caller's options.analyze would mutate
  // their object as a side effect of scanning.
  let scanOptions = Object.assign({}, options.analyze);
  if (scanOptions.source === void 0) scanOptions.source = code;
  if (scanOptions.language === void 0) scanOptions.language = "javascript";
  if (options.maxFindings !== void 0 && scanOptions.maxFindings === void 0) {
    scanOptions.maxFindings = options.maxFindings;
  }
  if (options.includeEvents !== void 0 && scanOptions.includeEvents === void 0) {
    scanOptions.includeEvents = options.includeEvents;
  }
  return scan(out.events, scanOptions);
}

// Async version of scanTrace(): scripts with top-level await, via
// traceAsync(). Returns a Promise of the scan document.
export function scanTraceAsync(code, options) {
  options = options || {};
  let iroh = this;
  let scanOptions = Object.assign({}, options.analyze);
  if (scanOptions.source === void 0) scanOptions.source = code;
  if (scanOptions.language === void 0) scanOptions.language = "javascript";
  if (options.maxFindings !== void 0 && scanOptions.maxFindings === void 0) {
    scanOptions.maxFindings = options.maxFindings;
  }
  if (options.includeEvents !== void 0 && scanOptions.includeEvents === void 0) {
    scanOptions.includeEvents = options.includeEvents;
  }
  return iroh.traceAsync(code, options).then(function(out) {
    return scan(out.events, scanOptions);
  });
}

// Module version of scanTrace(), via traceModule(). Node only.
// Returns a Promise of the scan document.
export function scanModule(code, options) {
  options = options || {};
  let iroh = this;
  let scanOptions = Object.assign({}, options.analyze);
  if (scanOptions.source === void 0) scanOptions.source = code;
  if (scanOptions.language === void 0) scanOptions.language = "javascript";
  if (options.maxFindings !== void 0 && scanOptions.maxFindings === void 0) {
    scanOptions.maxFindings = options.maxFindings;
  }
  if (options.includeEvents !== void 0 && scanOptions.includeEvents === void 0) {
    scanOptions.includeEvents = options.includeEvents;
  }
  return iroh.traceModule(code, options).then(function(out) {
    return scan(out.events, scanOptions);
  });
}
