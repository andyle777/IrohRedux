// TypeScript definitions for IrohRedux 0.9.0.
//
//   import Iroh from "iroh";
//   const { events, result } = Iroh.trace("factorial(3);", { events: ["CALL"] });
//
// The engine traces JavaScript only. Events from Iroh.trace() are plain,
// JSON-safe objects; events handed to listeners are live RuntimeEvents.

export type Trigger = "before" | "after" | "enter" | "leave" | "fire" | "test" | "return";

/** A live event delivered to a listener callback. */
export interface RuntimeEvent {
  /** Instruction number (see Iroh.INSTR). */
  type: number;
  /** Category number (see Iroh.CATEGORY). */
  category: number;
  trigger: Trigger;
  /** Hash of the code location the event came from. */
  hash: number;
  /** Indentation level (call depth) of the event. */
  indent: number;
  name?: string;
  value?: unknown;
  result?: unknown;
  return?: unknown;
  arguments?: unknown[];
  object?: unknown;
  property?: string | number;
  op?: string;
  test?: unknown;
  left?: unknown;
  right?: unknown;
  context?: unknown;
  scope?: unknown;
  kind?: string;
  label?: string;
  prefix?: string;
  external?: boolean;
  sloppy?: boolean;
  isDefault?: boolean;
  default?: unknown;
  callee?: unknown;
}

/** A plain, JSON-safe event as returned by Iroh.trace() (and the CLI). */
export interface TraceEvent {
  type: "event";
  /** Instruction name, e.g. "FUNCTION_CALL". */
  event: string;
  /** Category name, e.g. "CALL". */
  category: string;
  trigger: Trigger;
  hash: number;
  indent: number;
  name?: string;
  value?: unknown;
  result?: unknown;
  return?: unknown;
  arguments?: unknown[];
  object?: unknown;
  property?: string | number;
  op?: string;
  test?: unknown;
  left?: unknown;
  right?: unknown;
  context?: unknown;
  scope?: unknown;
  kind?: string;
  label?: string;
  prefix?: string;
  external?: boolean;
  sloppy?: boolean;
  isDefault?: boolean;
  default?: unknown;
  callee?: unknown;
}

export interface TraceOptions {
  /**
   * Which categories to collect: "ALL" (default), an array of category
   * names (["CALL", "IF"]), or a comma string ("CALL,IF").
   */
  events?: "ALL" | string[] | string;
  /** Called for every event as it fires. */
  onEvent?: (event: TraceEvent) => void;
  /** Parser options passed to the Stage (ecmaVersion, allowHashBang). */
  stageOptions?: StageOptions;
}

export interface TraceModuleOptions extends TraceOptions {
  /**
   * Base path for relative imports in the traced module. When given,
   * the instrumented module is written next to this file, so
   * `import "./sibling.js"` resolves against its directory. Without
   * it, the module runs from a temp directory and only bare or
   * absolute imports resolve.
   */
  filename?: string;
}

export interface TraceModuleResult {
  /** The collected events, in firing order. */
  events: TraceEvent[];
  /**
   * The live module namespace object (the result of the dynamic
   * import). Use `result.default` for the default export.
   */
  result: Record<string, unknown>;
}

export interface TraceResult {
  /** The collected events, in firing order. */
  events: TraceEvent[];
  /**
   * The program's completion value. With traceAsync() this is the
   * awaited value; with trace() it may be a Promise when the program
   * is async.
   */
  result: unknown;
}

export interface RuntimeListener {
  on(trigger: Trigger, callback: (event: RuntimeEvent) => void): RuntimeListener;
  trigger(event: RuntimeEvent, trigger: Trigger): void;
}

export interface StageOptions {
  /** Language level for parsing (default: "latest"). */
  ecmaVersion?: number | string;
  /** Allow a #! line at the top of the script (default: true). */
  allowHashBang?: boolean;
  /**
   * "script" (default) or "module". trace()/traceAsync() reject
   * "module" — use traceModule() for modules.
   */
  sourceType?: "script" | "module";
  /**
   * Allow top-level await while parsing (traceAsync() sets this).
   * trace() rejects programs that use it, pointing at traceAsync().
   */
  allowAwaitOutsideFunction?: boolean;
}

export class Stage {
  constructor(code: string, options?: StageOptions);
  /** The instrumented source, ready to eval (with `Iroh` in scope). */
  script: string;
  /** The original submitted code. */
  input: string;
  /** The stage's unique key. */
  key: string;
  addListener(category: number): RuntimeListener;
  nodes: Record<string, unknown>;
  symbols: Record<string, unknown>;
}

// --- 0.8.0: AI analysis layer (src/analyze.js, src/neurons.js) -----------

/** The five trace-window features, all normalized to [0, 1]. */
export interface TraceFeatures {
  /** Call volume: min(FUNCTION_CALL count / 50, 1). */
  calls: number;
  /** Call depth: min(max FUNCTION_ENTER indent / 20, 1). */
  depth: number;
  /** Repetition: 1 - distinct (event, hash) pairs / total events. */
  repeat: number;
  /** Branch imbalance: |true - false| / (true + false) over IF_TEST. */
  imbalance: number;
  /** Busy share: (CALL + LOOP events) / total events. */
  mix: number;
}

/** A perceptron classification: label, score, and the features it used. */
export interface NeuronClassification {
  /** "hot" (a busy, repetitive, deeply-nested run) or "normal". */
  label: "hot" | "normal";
  /** dot(weights, features) + bias, rounded to 4 decimals. */
  score: number;
  /** The feature values — always visible, never a black box. */
  features: TraceFeatures;
}

/** A single perceptron (see createPerceptron). */
export interface Perceptron {
  /** The five weights, in FEATURE_NAMES order. */
  weights: number[];
  bias: number;
  predict(features: TraceFeatures | number[]): { score: number; label: "hot" | "normal" };
  /**
   * Classic perceptron update over the samples in order
   * (deterministic — no shuffling). A sample is
   * { x: [n, n, n, n, n] | TraceFeatures, y: 0 | 1 }.
   * Returns the number of updates made.
   */
  train(samples: Array<{ x: TraceFeatures | number[]; y: 0 | 1 }>, epochs?: number, learningRate?: number): number;
}

/** Finding codes the analyzer emits. */
export type FindingCode =
  | "HOT_LOOP"
  | "ZERO_ITERATION_LOOP"
  | "DEEP_RECURSION"
  | "REPEATED_SEQUENCE"
  | "ONE_SIDED_BRANCH"
  | "THROWING_PATH";

/** One finding: every finding cites its evidence. */
export interface AnalysisFinding {
  code: FindingCode;
  severity: "warning" | "info";
  message: string;
  /** Counts, names and hashes — never empty. */
  evidence: Record<string, unknown>;
  /**
   * The neuron classification, for hotness findings (HOT_LOOP,
   * DEEP_RECURSION, REPEATED_SEQUENCE); null for the others — the
   * perceptron classifies hot vs normal only.
   */
  neuron: { label: "hot" | "normal"; score: number } | null;
  /** Present when neuron is null: why this finding has no label. */
  neuronNote?: string;
}

export interface AnalyzeOptions {
  /** A loop is hot at this many iterations (default 100). */
  hotLoopThreshold?: number;
  /** Call depth is deep at this threshold (default 20). */
  deepRecursionThreshold?: number;
  /** A call sequence repeats at this many occurrences (default 3). */
  repeatSequenceMinOccurrences?: number;
  /** An if is one-sided after this many same-side tests (default 2). */
  oneSidedMinTests?: number;
  /**
   * The traced program's source, for the fidelity score's blind-spot
   * count and the overhead score's per-statement ratio. analyzeTrace()
   * passes the code automatically; without it, blindSpotStatements
   * is null (uncounted, not zero) and overhead is per-region.
   */
  source?: string;
}

export interface AnalysisScores {
  coverage: {
    /** Event categories fired. */
    fired: number;
    /** Total categories in CATEGORY. */
    total: number;
    /** fired / total, rounded to 4 decimals. */
    value: number;
    firedCategories: string[];
    missingCategories: string[];
    note: string;
  };
  fidelity: {
    /** Distinct event hashes observed. */
    observedRegions: number;
    /** Regions the trace shows were never entered. */
    missingRegions: number;
    /** Known blind-spot statements in the source, or null without source. */
    blindSpotStatements: number | null;
    /** observedRegions + missingRegions + blind spots. */
    totalRegions: number;
    /** observedRegions / totalRegions, rounded to 4 decimals. */
    value: number;
    knownBlindSpots: Array<{ kind: string; note: string }>;
  };
  overhead: {
    /** Total events in the trace. */
    events: number;
    /** Statements in the source, or null without source. */
    statements: number | null;
    /** Distinct regions observed. */
    regions: number;
    /** events / statements, or null without source. */
    eventsPerStatement: number | null;
    /** events / regions. */
    eventsPerRegion: number;
    /** eventsPerStatement when available, else eventsPerRegion. */
    value: number;
    /** Which ratio `value` is: "statements" or "regions". */
    denominator: "statements" | "regions";
  };
}

export interface AnalysisSummary {
  events: number;
  findings: number;
  warnings: number;
  infos: number;
  maxCallDepth: number;
  distinctRegions: number;
}

export interface AnalysisResult {
  findings: AnalysisFinding[];
  scores: AnalysisScores;
  summary: AnalysisSummary;
  /** The whole-trace window classification. */
  neuron: NeuronClassification;
}

export interface AnalyzeTraceOptions extends TraceOptions {
  /** Thresholds / source override — `source` defaults to the code. */
  analyze?: AnalyzeOptions;
}

export interface AnalyzeTraceResult extends TraceResult {
  analysis: AnalysisResult;
}

export interface AnalyzeModuleResult extends TraceModuleResult {
  analysis: AnalysisResult;
}

// --- 0.9.0: vector refracting + AI-friendly scan mode --------------------
// (src/vectors.js, src/scan.js)

/** The six vector features, in VECTOR_FEATURE_NAMES order. */
export type VectorFeatureName =
  | "calls"
  | "depth"
  | "repeat"
  | "imbalance"
  | "mix"
  | "coverage";

/** A trace refracted into a deterministic numeric feature vector. */
export interface TraceVector {
  /**
   * The named features, all normalized to [0, 1] — the five neuron
   * features plus coverage (categories fired / total categories) —
   * plus `events`, the raw event count (a plain count, not part of
   * the normalized vector).
   */
  features: TraceFeatures & { coverage: number; events: number };
  /** The six normalized features, in `names` order. */
  vector: number[];
  /** The feature names, in `vector` order. */
  names: VectorFeatureName[];
}

/** Both similarity measures between two vectors at once. */
export interface VectorComparison {
  /** Cosine similarity: 1 identical, 0 orthogonal, -1 opposite. */
  cosine: number;
  /** Euclidean distance: 0 identical, growing as they differ. */
  euclidean: number;
}

export interface ScanOptions extends AnalyzeOptions {
  /** Which language the trace came from (default "javascript"). */
  language?: "javascript" | "python" | "cpp";
  /**
   * Safety bound on the findings in the document (default 200).
   * Findings past the cap are dropped and counted in
   * summary.findingsTruncated — never hidden.
   */
  maxFindings?: number;
  /**
   * When true, the raw events ride along in the document under
   * `events` (default false — the scan replaces the flood).
   */
  includeEvents?: boolean;
}

/** The scan document: one compact JSON object per trace. */
export interface ScanResult {
  /** The trace refracted into a feature vector (see TraceVector). */
  vectors: TraceVector;
  /** The analyze() findings, capped at maxFindings. */
  findings: AnalysisFinding[];
  /** The analyze() scorecard, denominators on every number. */
  scores: AnalysisScores;
  summary: AnalysisSummary & {
    /** Which language the trace came from. */
    language: "javascript" | "python" | "cpp";
    /** The whole-trace window classification. */
    neuron: { label: "hot" | "normal"; score: number };
    /** Findings dropped by the maxFindings cap (0 when none). */
    findingsTruncated: number;
  };
  /** Present only with includeEvents: the raw events. */
  events?: TraceEvent[];
}

export interface ScanTraceOptions extends TraceOptions {
  /** Thresholds / source / language / cap — `source` defaults to the code. */
  analyze?: ScanOptions;
  /** Shorthand for analyze.maxFindings. */
  maxFindings?: number;
  /** Shorthand for analyze.includeEvents. */
  includeEvents?: boolean;
}

// --- 0.8.0: hybrid translation engine (src/translate.js) -----------------

export type TranslateFrom = "javascript" | "python" | "cpp";
export type TranslateTo = "python" | "cpp" | "javascript";

export interface TranslateTypeHints {
  functions?: Record<string, { params?: string[]; returns?: string }>;
  variables?: Record<string, string>;
}

export interface TranslateOptions {
  /** Source language (default "javascript"). */
  from?: TranslateFrom;
  /** Target language. */
  to: TranslateTo;
  /**
   * C++ types the trace could not supply, e.g.
   * { functions: { add: { params: ["int", "int"], returns: "int" } } }.
   */
  types?: TranslateTypeHints;
}

export interface TranslateReport {
  /** False when anything was unsupported. */
  ok: boolean;
  from: TranslateFrom;
  to: TranslateTo;
  /**
   * True for the reverse legs (Python/C++ -> JavaScript): there is no
   * tracer for those languages, so the translation is static-only.
   */
  staticOnly: boolean;
  /** What translated cleanly: { construct, count, detail }. */
  clean: Array<{ construct: string; count: number; detail: string }>;
  /** What needed an assumption, with the trace evidence cited. */
  assumptions: Array<{ what: string; evidence: string }>;
  /** What could not be translated: { construct, message }. */
  unsupported: Array<{ construct: string; message: string }>;
  notes: string[];
}

export interface TranslateResult {
  /** The translated program. */
  code: string;
  report: TranslateReport;
}

export interface IrohAPI {
  // --- Categories (numbers; use them with addListener) ---
  readonly THIS: number;
  readonly UNARY: number;
  readonly BINARY: number;
  readonly LOGICAL: number;
  readonly TERNARY: number;
  readonly CALL: number;
  readonly OP_NEW: number;
  readonly VAR: number;
  readonly ASSIGN: number;
  readonly UPDATE: number;
  readonly FUNCTION: number;
  readonly METHOD: number;
  readonly IF: number;
  readonly SWITCH: number;
  readonly FOR: number;
  readonly WHILE: number;
  readonly DO_WHILE: number;
  readonly TRY: number;
  readonly THROW: number;
  readonly RETURN: number;
  readonly BREAK: number;
  readonly CONTINUE: number;
  readonly PROGRAM: number;
  readonly LITERAL: number;
  readonly IDENTIFIER: number;
  readonly MEMBER: number;
  readonly OBJECT: number;
  readonly ARRAY: number;
  readonly CLASS: number;
  readonly AWAIT: number;

  /** The library version, e.g. "0.9.0". */
  readonly VERSION: string;

  /** Instruction numbers, keyed by name (e.g. INSTR.FUNCTION_CALL). */
  readonly INSTR: Record<string, number>;
  /** Category numbers, keyed by name (e.g. CATEGORY.CALL). */
  readonly CATEGORY: Record<string, number>;
  /** Operator numbers, keyed by name. */
  readonly OP: Record<string, number>;

  Stage: typeof Stage;

  /**
   * One-shot tracing. Runs `code` through a Stage and returns
   * { events, result }. A parse error throws before running; a runtime
   * error throws with the events that fired before it attached as
   * `(error as Error & { events: TraceEvent[] }).events`.
   */
  trace(code: string, options?: TraceOptions): TraceResult;
  /**
   * Async version of trace(): awaits the program's completion value, so
   * events from async continuations are included — and so top-level
   * `await` in scripts works. A program declaring its own top-level
   * `Iroh` is fine: the async wrapper runs under $$Iroh.
   */
  traceAsync(code: string, options?: TraceOptions): Promise<TraceResult>;
  /**
   * Trace an ES module: `import`/`export`, import attributes,
   * `import.meta`, dynamic `import()`, and top-level await all work.
   * Node only (the instrumented module is written to a temp .mjs file
   * and dynamic-imported). Returns a promise of { events, result }
   * where result is the live module namespace object. Options as for
   * trace(), plus `filename` — the base path relative imports resolve
   * against. The temp file is deleted after the trace settles.
   * trace()/traceAsync() reject module code, pointing here.
   */
  traceModule(code: string, options?: TraceModuleOptions): Promise<TraceModuleResult>;

  /**
   * AI analysis layer (0.8.0, deterministic — no LLM, no network).
   * Analyze a trace's events: deterministic findings over the
   * events, a toolkit scorecard with denominators on every number,
   * and the neuron's window classification. Thresholds in `options`
   * (see AnalyzeOptions); findings are HOT_LOOP,
   * ZERO_ITERATION_LOOP, DEEP_RECURSION, REPEATED_SEQUENCE,
   * ONE_SIDED_BRANCH and THROWING_PATH, each citing its evidence.
   */
  analyze(events: TraceEvent[], options?: AnalyzeOptions): AnalysisResult;
  /** Trace then analyze in one call; `options.analyze.source` defaults to the code. */
  analyzeTrace(code: string, options?: AnalyzeTraceOptions): AnalyzeTraceResult;
  /** Async version of analyzeTrace(), via traceAsync() (top-level await works). */
  analyzeTraceAsync(code: string, options?: AnalyzeTraceOptions): Promise<AnalyzeTraceResult>;
  /** Module version of analyzeTrace(), via traceModule(). Node only. */
  analyzeModule(code: string, options?: AnalyzeTraceOptions): Promise<AnalyzeModuleResult>;

  /**
   * The neuron layer (0.8.0): a tiny perceptron in pure JS.
   * extractFeatures() computes the five trace-window features;
   * classifyWindow() classifies a trace as "hot" or "normal" and
   * returns the label, score and features; createPerceptron() builds
   * a perceptron (default: the trained weights) that can be
   * re-trained deterministically in tests.
   */
  extractFeatures(events: TraceEvent[]): TraceFeatures;
  classifyWindow(events: TraceEvent[]): NeuronClassification;
  createPerceptron(weights?: number[], bias?: number): Perceptron;

  /**
   * Vector refracting (0.9.0): deterministic feature vectors, not LLM
   * embeddings — no model, no vector DB, no new dependencies. Same
   * events give the same vector, always; identical traces have
   * distance 0 and cosine 1. `a` and `b` may be plain number arrays
   * or toVector() results.
   */
  toVector(events: TraceEvent[]): TraceVector;
  cosineSimilarity(a: number[] | TraceVector, b: number[] | TraceVector): number;
  euclideanDistance(a: number[] | TraceVector, b: number[] | TraceVector): number;
  compareVectors(a: number[] | TraceVector, b: number[] | TraceVector): VectorComparison;

  /**
   * AI-friendly scan mode (0.9.0): trace -> analyze -> vector in one
   * pass, emitting one compact document { vectors, findings, scores,
   * summary } — no raw event flood unless includeEvents is set. Works
   * the same on JS, Python and C++ traces (same schema); the CLI
   * --scan flag is how Python/C++ traces reach it.
   */
  scan(events: TraceEvent[], options?: ScanOptions): ScanResult;
  /** Scan a JS script: trace it, then scan the events. */
  scanTrace(code: string, options?: ScanTraceOptions): ScanResult;
  /** Async version of scanTrace(), via traceAsync() (top-level await works). */
  scanTraceAsync(code: string, options?: ScanTraceOptions): Promise<ScanResult>;
  /** Module version of scanTrace(), via traceModule(). Node only. */
  scanModule(code: string, options?: ScanTraceOptions): Promise<ScanResult>;

  /**
   * Hybrid translation engine (0.8.0): JavaScript -> Python / C++
   * (static AST + trace evidence), Python -> JavaScript and C++ ->
   * JavaScript (static-only — the reverse legs translate from source
   * alone; native Python/C++ tracers exist since 0.9.0, but the
   * translation legs stay static by design). Returns { code, report };
   * unsupported constructs are reported in the report, never silently
   * mistranslated. The JS-out leg runs the program through the
   * tracer for evidence — its console.log output is silenced while
   * it runs, so translate() has no visible side effects.
   */
  translate(code: string, options: TranslateOptions): TranslateResult;
  /**
   * Async version of translate(). In the ESM build, the Python leg
   * loads child_process by dynamic import (the sync version needs
   * the CJS build's require for that leg).
   */
  translateAsync(code: string, options: TranslateOptions): Promise<TranslateResult>;

  /** Turn a live RuntimeEvent into a plain, JSON-safe object. */
  eventToJSON(event: RuntimeEvent, trigger: Trigger): TraceEvent;
  /** Serialize a runtime value safely (depth-capped, circular-safe). */
  safeValue(value: unknown, depth: number, seen: Set<unknown>): unknown;

  /** Acorn's parser (defaults: ecmaVersion "latest", allowHashBang true). */
  parse(input: string, options?: Record<string, unknown>): unknown;
  /** astring's generator: AST back to source code. */
  generate(ast: unknown, options?: Record<string, unknown>): string;

  /** Record a test assertion from traced code; returns the boolean. */
  assert(name: string, condition: unknown): boolean;
  resetAssertions(): void;
  /** The recorded assertions, in order. */
  assertions: Array<{ name: string; passed: boolean }>;
  /** console.log passthrough, for traced code to print. */
  log(...args: unknown[]): void;

  /** All running stages, keyed by stage key. */
  stages: Record<string, Stage>;
}

declare const Iroh: IrohAPI;
export default Iroh;
