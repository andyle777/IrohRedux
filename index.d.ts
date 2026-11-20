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

// --- 0.9.0: live wire AI analysis mode (src/live.js) -----------------------

export interface LiveAnalyzerOptions extends AnalyzeOptions {
  /** Which language the trace came from (default "javascript"). */
  language?: "javascript" | "python" | "cpp";
}

/** A finding that fired live: the batch finding plus where it tripped. */
export interface LiveFinding extends AnalysisFinding {
  /** 0-based index of the event that tripped this finding. */
  firedAt: number;
  /**
   * Present on findings that can only be decided at stream end
   * (ZERO_ITERATION_LOOP, ONE_SIDED_BRANCH): why they waited.
   */
  note?: string;
}

/** Progress so far, from snapshot() (no scores — those are final). */
export interface LiveSnapshot {
  /** Events fed so far. */
  events: number;
  /** Findings fired so far, in fire order. */
  findings: LiveFinding[];
  /** The window classification over the events so far. */
  neuron: NeuronClassification;
  /** The vector over the events so far. */
  vectors: TraceVector;
  finished: false;
}

/** The final summary, from finish(): the batch analysis + vectors. */
export interface LiveSummary extends AnalysisResult {
  /** The batch-equal findings (the final tally). */
  findings: AnalysisFinding[];
  /** The trace refracted into a feature vector. */
  vectors: TraceVector;
  /** The summary adds the trace language. */
  summary: AnalysisSummary & { language: "javascript" | "python" | "cpp" };
  finished: true;
}

/** An incremental analyzer: feed events, get findings as they trip. */
export interface LiveAnalyzer {
  /** Feed one event; returns the findings that fired on it (usually []). */
  feed(event: TraceEvent): LiveFinding[];
  /** All findings fired so far, in fire order. */
  findings(): LiveFinding[];
  /** Progress so far (no scores — those are final). */
  snapshot(): LiveSnapshot | LiveSummary;
  /** Finish the stream: the final summary (batch-equal findings + scores + vectors). */
  finish(): LiveSummary;
}

// --- 1.0.0: AI director + live code engine (src/direct.js) ------------------

/** A directive a director returns: set a variable, skip a call, stop the run. */
export type Directive =
  | {
      type: "set";
      name: string;
      value: unknown;
      /**
       * Scope the set: a function name to set only that function's
       * variable, null for the top level only, omitted for any scope
       * (the 1.0.0 behaviour — the first matching assignment wins).
       * A dotted name ("obj.prop", one level) sets a member.
       */
      scope?: string | null;
    }
  | { type: "skip"; name: string; value: unknown }
  | { type: "stop"; reason?: string };

/**
 * A loop's test, resolved from its HOT_LOOP finding: the counter, the
 * numeric bound, the comparison (normalized to counter-on-the-left),
 * and `value` — the counter value that makes the test false, or null
 * when no single value falsifies it (== / ===).
 */
export interface LoopInfo {
  hash: number;
  kind: string;
  counter: string;
  bound: number;
  operator: string;
  counterOnLeft: boolean;
  value: number | null;
}

/** A live finding as the director sees it: HOT_LOOP carries its loop info. */
export interface DirectorFinding extends LiveFinding {
  /** Present on HOT_LOOP when the loop test resolved to a counter comparison. */
  loop?: LoopInfo;
}

/** One audit-log entry: the directive, when it was issued, and whether it took effect. */
export interface DirectiveEntry {
  directive: Directive;
  /** 0-based event index at issue (-1 for directives issued before the run). */
  issuedAtEvent: number;
  applied: boolean;
  /** 0-based event index where it applied (null when never applied). */
  appliedAtEvent: number | null;
  /**
   * How it applied: "init" (a declaration's initial value), "assign"
   * (a plain assignment), "member" (a member assignment, "obj.prop"),
   * "loop-test" (a loop test flipped to false),
   * "call" (a skipped call), "stop" (the run stopped); null when never
   * applied.
   */
  appliedVia: "init" | "assign" | "member" | "loop-test" | "call" | "stop" | null;
  /** Why it applied this way, or why it never applied. */
  note: string | null;
}

/** What a director receives: the findings that just fired, plus the current snapshot. */
export interface DirectorContext {
  /** Findings that fired on the just-processed event (or [] at the start call). */
  findings: DirectorFinding[];
  /** All findings fired so far, in fire order. */
  allFindings: LiveFinding[];
  /** Progress so far (no scores — those are final). */
  snapshot: LiveSnapshot | LiveSummary;
  /** The JSON event line that just fired (null at the start call). */
  event: TraceEvent | null;
  /** 0-based index of that event (-1 at the start call). */
  eventIndex: number;
  /** The directive audit log so far. */
  directives: DirectiveEntry[];
}

/** A director: called once before the run, then whenever new findings fire. */
export type Director = (ctx: DirectorContext) => Directive | Directive[] | null | void;

export interface DirectOptions extends LiveAnalyzerOptions {
  /** Passed to the Stage (ecmaVersion, allowHashBang). */
  stageOptions?: StageOptions;
  /** Called for every JSON event line as it fires. */
  onEvent?: (line: TraceEvent) => void;
  /** Called when a directive is applied (or when a stop is issued). */
  onDirective?: (entry: DirectiveEntry) => void;
  /**
   * Called with the findings that just fired (the enriched live
   * findings, with firedAt), after the director is consulted — for a
   * caller that wants to print live findings without being the
   * director.
   */
  onFinding?: (findings: DirectorFinding[]) => void;
}

/** The directed run's record: the outcome, the findings, and the full audit log. */
export interface DirectResult {
  /** The program's completion value (undefined when stopped). */
  result: unknown;
  /** True when the director stopped the run. */
  stopped: boolean;
  /** The stop reason (null when the run completed). */
  stopReason: string | null;
  /** The JSON event lines, in order. */
  events: TraceEvent[];
  /** The live findings (batch-equal — the finish() findings). */
  findings: AnalysisFinding[];
  /** Every directive issued, with whether and how it applied. */
  directives: DirectiveEntry[];
  /** The live finish() summary: findings, scores, summary, neuron, vectors. */
  analysis: LiveSummary;
}

export interface RunawayGuardOptions {
  /**
   * "throttle" (default): set the runaway loop's counter to the value
   * that makes its test false, so the loop exits at the next test.
   * "stop": stop the run with a reason instead. A loop whose counter
   * cannot be resolved stops either way.
   */
  action?: "throttle" | "stop";
}

// --- Input synthesiser (src/synth.js, CLI --synthesize) ---------------------

/** One arm of a branch: true/false for if/loop/ternary, matched for a switch case. */
export interface BranchArm {
  /** "true" | "false" (if/loop/ternary) or "matched" (switch case/default). */
  arm: string;
  /** How many times this arm was observed across all runs. */
  observed: number;
  /** True once the arm was observed at least once. */
  covered: boolean;
  /** The run index that first covered it (null when never covered). */
  coveredBy: number | null;
}

/** One branch site: a condition evaluation point in the program. */
export interface Branch {
  /** "if:<test start>" | "loop:<test start>" | "ternary:<test start>" | "case:<test start>" | "default:<case start>". */
  id: string;
  /** "if" | "loop" | "ternary" | "case". */
  kind: string;
  /** The condition's source text ("switch discriminant === 1" for a case). */
  condition: string;
  /** The enclosing statement's source text (truncated to 200 chars). */
  statement: string;
  /** The condition's source span. */
  location: { start: number; end: number };
  /** One entry per arm (two for if/loop/ternary, one for a switch case). */
  arms: BranchArm[];
  /** True when every arm was observed at least once. */
  covered: boolean;
  /** Why each uncovered arm was not covered (null when covered). */
  reasons: Record<string, string | null>;
}

/** Branch coverage, arms covered / arms total, denominators on every number. */
export interface BranchCoverage {
  /** Arms observed at least once. */
  covered: number;
  /** Arms total (two per if/loop/ternary site, one per switch case). */
  total: number;
  /** covered / total, rounded to 4 decimals (1 when there are no branches). */
  value: number;
  /** Branch sites (distinct condition evaluation points). */
  sites: number;
  /** Every site, in first-seen order. */
  branches: Branch[];
}

/** One input actually run, in run order. */
export interface SynthesizedInput {
  /** The arguments passed to the entry function. */
  args: unknown[];
  /** The run index (0-based). */
  run: number;
  /** The entry function's return value for these inputs (JSON-safe). */
  result: unknown;
  /** The error message when the run threw (null when it completed). */
  error: string | null;
  /** True when the run hit the loop cap and a loop test was flipped. */
  capped: boolean;
  /** "branch:arm" pairs this run first covered. */
  covers: string[];
  /** "seed" | "solver" | "mutation" — where the input came from. */
  via: string;
}

/** A branch left uncovered, with the reason it was not covered. */
export interface UncoveredBranch {
  id: string;
  kind: string;
  condition: string;
  statement: string;
  location: { start: number; end: number };
  /** The uncovered arm ("true" | "false" | "matched"). */
  arm: string;
  /** Why the solver could not flip it (or that the budget ran out). */
  reason: string;
  /** How many times the arm was observed (0 by definition). */
  observed: number;
}

/** A progress event streamed through onProgress while synthesizing. */
export type SynthesizeProgressEvent =
  | {
      type: "run";
      run: number;
      args: unknown[];
      result: unknown;
      error: string | null;
      capped: boolean;
      newlyCovered: Array<{ branch: string; arm: string }>;
    }
  | { type: "branch-covered"; branch: string; arm: string; run: number; args: unknown[] }
  | { type: "live-finding"; run: number; finding: LiveFinding };

export interface SynthesizeOptions {
  /** The name of the function under test (a top-level function in the code). Required. */
  entry: string;
  /** Seed argument arrays (default: one call with no arguments). */
  seeds?: unknown[][];
  /** Total run budget, seeds included (default 50). */
  maxRuns?: number;
  /** True tests allowed per loop per run before the test is flipped (default 10000). */
  loopCap?: number;
  /** Called as runs complete and arms are covered; live findings stream here too. */
  onProgress?: (event: SynthesizeProgressEvent) => void;
  /** Thresholds for the live analyzers (see AnalyzeOptions). */
  analyze?: AnalyzeOptions;
  /** Passed to the Stage (ecmaVersion, allowHashBang). */
  stageOptions?: StageOptions;
}

/** The synthesis report: inputs, coverage, runs, uncovered branches, findings. */
export interface SynthesizeResult {
  /** The entry function, as given. */
  entry: string;
  /** Every input actually run, in run order (seeds first). */
  inputs: SynthesizedInput[];
  /** Branch coverage: arms covered / arms total, with every site. */
  coverage: BranchCoverage;
  /** Runs used / run budget. */
  runs: { used: number; budget: number };
  /** Every arm left uncovered, with its reason. */
  uncovered: UncoveredBranch[];
  /** Live findings: per-run findings (deduped) plus the final aggregate ONE_SIDED_BRANCH findings. */
  findings: AnalysisFinding[];
  summary: {
    branchesCovered: number;
    branchesTotal: number;
    sites: number;
    inputsRun: number;
    inputsSynthesized: number;
    runsUsed: number;
    runsBudget: number;
    uncoveredBranches: number;
  };
}

// --- 0.8.0: hybrid translation engine (src/translate.js) -----------------

export type TranslateFrom = "javascript" | "python" | "cpp" | "irohscript" | "basic";
export type TranslateTo = "python" | "cpp" | "javascript" | "irohscript" | "basic";

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
  /**
   * Where the IrohScript sources live (the repo's irohscript/
   * directory). Defaults to IROHSCRIPT_HOME, then <cwd>/irohscript.
   * Only needed for the irohscript and basic legs.
   */
  irohscriptHome?: string;
  /**
   * Run the emitted Python under python3 and record the result in
   * report.verify (1.1.0 patch, Fix Spec 3.7). Default true for the
   * Python leg; pass false to skip the execution check.
   */
  verify?: boolean;
}

export interface CompileIrohscriptOptions {
  /**
   * Where the IrohScript sources live (the repo's irohscript/
   * directory). Defaults to IROHSCRIPT_HOME, then <cwd>/irohscript.
   */
  irohscriptHome?: string;
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
  /**
   * Whether the emitted program was executed to check it runs
   * (1.1.0 patch, Fix Spec 3.7). Only the Python leg is executed;
   * other legs record attempted: false. ran: null means not
   * attempted — never read it as success. When ran is false,
   * stderr carries the interpreter's output verbatim.
   */
  verify?: {
    attempted: boolean;
    ran: boolean | null;
    interpreter?: string;
    exit?: number | null;
    stderr?: string;
    reason?: string;
  };
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
   * Live wire AI analysis mode (0.9.0): analysis that runs WHILE the
   * program runs. Feed events as they arrive; findings fire the moment
   * their threshold trips (HOT_LOOP, DEEP_RECURSION, REPEATED_SEQUENCE,
   * THROWING_PATH), each carrying `firedAt` and the evidence as of the
   * trip. Findings that need the complete trace (ZERO_ITERATION_LOOP,
   * ONE_SIDED_BRANCH) fire at finish() with a `note` saying so. The
   * fired findings' codes equal batch analyze() codes on the same
   * complete trace, and finish() returns the batch analysis itself
   * (findings, scores, summary, neuron) plus the vector — so live vs
   * batch agreement holds by construction. Deterministic: the same
   * events give the same findings in the same order, twice.
   */
  liveAnalyzer(options?: LiveAnalyzerOptions): LiveAnalyzer;

  /**
   * AI director + live code engine (1.0.0): run `code` under trace
   * with `director` (or null for an undirected run) and change it
   * mid-flight. The director is called once before the run, then
   * whenever new live findings fire, and returns a directive, an array
   * of them, or null: { type: "set", name, value } writes a variable
   * at its next assignment/initialization (or flips a loop test when
   * the counter advances by ++), { type: "skip", name, value } makes
   * the next call of that name evaluate to the value without running,
   * { type: "stop", reason } ends the run. A set may carry `scope`
   * (a function name, or null for the top level) and may name a
   * member ("obj.prop", one level). The record is auditable:
   * every directive carries whether and how it applied. A runtime
   * error throws with the events so far as error.events and the record
   * so far as error.direct; a directed stop returns normally with
   * stopped: true. Scripts only (synchronous, like trace()) — modules
   * and top-level await are rejected with the direct() pointers (use
   * directModule() / directAsync() for those), and Python/C++ traces
   * cannot be directed. The `events` option is ignored: the director
   * needs the full stream, so direct() always traces ALL categories.
   */
  direct(code: string, director: Director | null, options?: DirectOptions): DirectResult;
  /**
   * Like direct(), but asynchronous: runs `code` under trace with
   * `director` and returns a promise of the record. Top-level await
   * works here (direct() rejects it). Modules are rejected — use
   * directModule() for those.
   */
  directAsync(code: string, director: Director | null, options?: DirectOptions): Promise<DirectResult>;
  /**
   * Like direct(), but for modules: runs `code` as a module under
   * trace with `director` and returns a promise of the record.
   * Top-level await and import/export work here. The result is the
   * live module namespace (traceModule semantics), not the completion
   * value. Node.js only.
   */
  directModule(code: string, director: Director | null, options?: DirectOptions): Promise<DirectResult>;
  /**
   * The built-in director: a runaway-loop guard. On HOT_LOOP it
   * throttles (sets the loop's counter past its limit) or, with
   * { action: "stop" }, stops the run with a reason. A loop whose
   * counter cannot be resolved stops either way. A factory: it returns
   * the director function, so one guard instance directs one run.
   */
  runawayGuard(options?: RunawayGuardOptions): Director;

  /**
   * Input synthesiser: generate concrete inputs that drive the entry
   * function down each branch, on the live wire. Runs the function
   * with the seed inputs under trace, reads the live analyzer's
   * ONE_SIDED_BRANCH findings as the target list, and solves for
   * inputs that flip each uncovered branch — boundary values for
   * numeric comparisons, the observed constant for equality, the
   * observed string for string equality, each side of && / ||, 1 / 0
   * for a bare parameter, .length against a numeric literal, and the
   * discriminant value for a switch case — with seeds plus guided
   * mutation as fallback. A branch the solver cannot flip is reported
   * in `uncovered` with its reason, never hidden. Each run is capped
   * at `loopCap` true tests per loop (default 10000): the next test
   * is flipped to false and the run is marked capped, and the flipped
   * test does not count as coverage. Scripts only, synchronous entry
   * functions — modules, top-level await and async entries are
   * rejected; seeds must be JSON values. The program runs, so its
   * side effects happen.
   */
  synthesize(code: string, options: SynthesizeOptions): SynthesizeResult;

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

  /**
   * Compile IrohScript source to a JavaScript module string (the
   * compiler backend, part 3 of the 1.0.1 rework). Either emits clean,
   * runnable ES2015 JavaScript or throws a clear error naming the
   * construct it cannot compile — there is no report and no stub.
   * Division/modulo are Python-style (7/2 = 3.5, -5 % 3 = 1).
   * options.irohscriptHome names the directory holding the
   * irohscript package; otherwise IROHSCRIPT_HOME, <cwd>/irohscript,
   * or <cwd>. Needs the Node.js CJS build with python3 on PATH.
   */
  compileIrohscript(source: string, options?: CompileIrohscriptOptions): string;
  /**
   * Async version of compileIrohscript(). In the ESM build, the
   * Python leg loads child_process by dynamic import (the sync
   * version needs the CJS build's require for that leg).
   */
  compileIrohscriptAsync(source: string, options?: CompileIrohscriptOptions): Promise<string>;

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
