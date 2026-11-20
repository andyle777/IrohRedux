// Type test for index.d.ts — exercises the public API under tsc.
// Run: npm run test:types
// This file is type-checked only; it is not executed by `npm test`.
import Iroh from "../index";
import type {
  TraceEvent,
  TraceResult,
  TraceModuleResult,
  RuntimeEvent,
  AnalysisResult,
  AnalyzeTraceResult,
  TraceFeatures,
  NeuronClassification,
  Perceptron,
  TraceVector,
  VectorComparison,
  ScanResult,
  LiveAnalyzer,
  LiveFinding,
  LiveSnapshot,
  LiveSummary,
  DirectResult,
  Directive,
  DirectiveEntry,
  Director,
  DirectorContext,
  LoopInfo,
  SynthesizeResult,
  SynthesizeOptions,
  SynthesizeProgressEvent,
  SynthesizedInput,
  Branch,
  BranchCoverage,
  UncoveredBranch,
  TranslateResult,
} from "../index";

const sync: TraceResult = Iroh.trace("factorial(3);", { events: ["CALL"] });
const calls: TraceEvent[] = sync.events.filter((e) => e.event === "FUNCTION_CALL");
const firstArgs: unknown = calls[0]?.arguments;

const opts = Iroh.trace("let x = 1; x;", {
  events: "VAR",
  onEvent: (e: TraceEvent) => {
    const n: string | undefined = e.name;
    void n;
  },
  stageOptions: { ecmaVersion: "latest", allowHashBang: true },
});
void opts;

const staged = new Iroh.Stage("let x = 1;", { ecmaVersion: 2022 });
void staged;

async function main(): Promise<void> {
  const asyncOut = await Iroh.traceAsync(
    "async function f() { return await Promise.resolve(42); } f();",
    { events: ["AWAIT"] }
  );
  const r: unknown = asyncOut.result;
  void r;

  // Top-level await in a script, and modules with a filename base.
  const tla = await Iroh.traceAsync("await Promise.resolve(42);", {
    stageOptions: { allowAwaitOutsideFunction: true },
  });
  void tla;
  const mod: TraceModuleResult = await Iroh.traceModule(
    "export const total = 2 + 3; export default total * 2;",
    { filename: "/tmp/example.mjs" }
  );
  const ns: Record<string, unknown> = mod.result;
  void ns;
  const modDefault: unknown = mod.result.default;
  void modDefault;
}

const stage = new Iroh.Stage("let x = [1, 2, 3].map(v => v * 2); x;");
stage.addListener(Iroh.CALL).on("before", (e: RuntimeEvent) => {
  const name: string | undefined = e.name;
  void name;
});
const script: string = stage.script;
void script;

const parsed: unknown = Iroh.parse("let a = 1;");
const generated: string = Iroh.generate(parsed);
void generated;

const version: string = Iroh.VERSION;
void version;

const callNum: number = Iroh.CALL;
void callNum;

const instr: Record<string, number> = Iroh.INSTR;
void instr;

Iroh.assert("one is one", 1 === 1);
Iroh.resetAssertions();
Iroh.log("hello from traced code");

const json: TraceEvent = Iroh.eventToJSON(
  { type: 1, category: 2, trigger: "before", hash: 3, indent: 0 } as RuntimeEvent,
  "before"
);
void json;

// 0.8.0: the analysis layer and the translation engine.
const analysis: AnalysisResult = Iroh.analyze(sync.events, { hotLoopThreshold: 10 });
const codes: string[] = analysis.findings.map((f) => f.code);
void codes;
const coverageValue: number = analysis.scores.coverage.value;
void coverageValue;
const blindSpots: number | null = analysis.scores.fidelity.blindSpotStatements;
void blindSpots;
const overheadDenominator: "statements" | "regions" = analysis.scores.overhead.denominator;
void overheadDenominator;

// 0.9.0: vector refracting and the AI-friendly scan mode.
const vector: TraceVector = Iroh.toVector(sync.events);
const vectorNames: string[] = vector.names;
void vectorNames;
const cosine: number = Iroh.cosineSimilarity(vector, vector);
void cosine;
const distance: number = Iroh.euclideanDistance(vector, vector);
void distance;
const comparison: VectorComparison = Iroh.compareVectors(vector, vector);
void comparison;
const scanned: ScanResult = Iroh.scanTrace("let s = 0; s;", { analyze: { language: "python" } });
const scanLanguage: "javascript" | "python" | "cpp" = scanned.summary.language;
void scanLanguage;
const truncated: number = scanned.summary.findingsTruncated;
void truncated;

// 0.9.0: live wire AI analysis mode.
const live: LiveAnalyzer = Iroh.liveAnalyzer({ language: "python" });
const liveFired: LiveFinding[] = live.feed(sync.events[0]);
void liveFired;
const liveFindings: LiveFinding[] = live.findings();
const liveFiredAt: number = liveFindings[0].firedAt;
void liveFiredAt;
const liveSnap: LiveSnapshot | LiveSummary = live.snapshot();
void liveSnap;
const liveFin: LiveSummary = live.finish();
const liveFinLanguage: "javascript" | "python" | "cpp" = liveFin.summary.language;
void liveFinLanguage;
const liveFinVectors: TraceVector = liveFin.vectors;
void liveFinVectors;

// 1.0.0: AI director + live code engine.
const guard: Director = Iroh.runawayGuard();
const stopGuard: Director = Iroh.runawayGuard({ action: "stop" });
void stopGuard;
const directed: DirectResult = Iroh.direct(
  "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
  guard,
  {
    hotLoopThreshold: 100,
    onDirective: (entry: DirectiveEntry) => {
      const via: "init" | "assign" | "member" | "loop-test" | "call" | "stop" | null = entry.appliedVia;
      void via;
    },
  }
);
const directedResult: unknown = directed.result;
void directedResult;
const directedStopped: boolean = directed.stopped;
void directedStopped;
const directedReason: string | null = directed.stopReason;
void directedReason;
const directedEvents: TraceEvent[] = directed.events;
void directedEvents;
const directedDirectives: DirectiveEntry[] = directed.directives;
void directedDirectives;
const directedAnalysis: LiveSummary = directed.analysis;
void directedAnalysis;
const customDirector: Director = (ctx: DirectorContext): Directive | null => {
  const hot = ctx.findings.find((f) => f.code === "HOT_LOOP");
  if (hot !== undefined && hot.loop !== undefined) {
    const loop: LoopInfo = hot.loop;
    return { type: "set", name: loop.counter, value: loop.value };
  }
  return null;
};
const custom: DirectResult = Iroh.direct("let i = 0; while (i < 10) { i++; } i;", customDirector);
void custom;
const undirected: DirectResult = Iroh.direct("1 + 2;", null);
void undirected;

const traced: AnalyzeTraceResult = Iroh.analyzeTrace("let s = 0; s;", {
  analyze: { source: "let s = 0; s;" },
});
void traced;
const neuron: NeuronClassification = Iroh.classifyWindow(sync.events);
void neuron;
const features: TraceFeatures = Iroh.extractFeatures(sync.events);
void features;
const perceptron: Perceptron = Iroh.createPerceptron();
const prediction: { score: number; label: "hot" | "normal" } = perceptron.predict(features);
void prediction;
const updates: number = perceptron.train([{ x: features, y: 0 }], 10, 0.1);
void updates;

const translated: TranslateResult = Iroh.translate("console.log(1 + 2);", { to: "python" });
const translatedCode: string = translated.code;
void translatedCode;

// Input synthesiser: inputs that drive a function down each branch.
const synthOpts: SynthesizeOptions = {
  entry: "classify",
  seeds: [[5]],
  maxRuns: 50,
  onProgress: (ev: SynthesizeProgressEvent) => {
    if (ev.type === "run") {
      const args: unknown[] = ev.args;
      void args;
    }
  },
};
const synthesized: SynthesizeResult = Iroh.synthesize(
  "function classify(x) { if (x > 10) { return \"big\"; } return \"small\"; }",
  synthOpts
);
const synthCoverage: BranchCoverage = synthesized.coverage;
const synthCovered: number = synthCoverage.covered;
void synthCovered;
const synthTotal: number = synthCoverage.total;
void synthTotal;
const synthBranches: Branch[] = synthesized.coverage.branches;
void synthBranches;
const synthUncovered: UncoveredBranch[] = synthesized.uncovered;
void synthUncovered;
const synthInputs: SynthesizedInput[] = synthesized.inputs;
void synthInputs;
const reportOk: boolean = translated.report.ok;
void reportOk;
const staticOnly: boolean = translated.report.staticOnly;
void staticOnly;

async function translateAsync(): Promise<void> {
  const out = await Iroh.translateAsync("def f():\n    return 1\n", {
    from: "python",
    to: "javascript",
  });
  void out;
  const analyzed = await Iroh.analyzeTraceAsync("await Promise.resolve(1);");
  void analyzed;
  const modAnalyzed = await Iroh.analyzeModule("export const x = 1;");
  void modAnalyzed;
}
void translateAsync;

void main;
void firstArgs;
