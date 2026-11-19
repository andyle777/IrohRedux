// TypeScript definitions for IrohRedux 0.7.0.
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

  /** The library version, e.g. "0.7.0". */
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
