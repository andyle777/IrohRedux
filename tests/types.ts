// Type test for index.d.ts — exercises the public API under tsc.
// Run: npm run test:types
// This file is type-checked only; it is not executed by `npm test`.
import Iroh from "../index";
import type { TraceEvent, TraceResult, RuntimeEvent } from "../index";

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

void main;
void firstArgs;
