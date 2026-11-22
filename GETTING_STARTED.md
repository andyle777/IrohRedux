# FOR HUMANS

This guide teaches you to run IrohRedux, step by step: trace a
program, analyze the trace, translate it, watch it live, direct
it, and check the box it runs on. If you only want the facts
(flags, JSON shapes, reachable categories), skip to the
[FOR AI](#for-ai) section at the end — the same file, machine
first.

## Install

Download from the [Releases page](https://github.com/andyle777/IrohRedux/releases).
No Node install needed for the binaries.

- **Windows, Linux, macOS:** the EXE for your system. Download,
  run. The EXE embeds its own Node runtime, version 18.5.0.
- **Android:** the APK. Install it on your phone. JavaScript legs
  only — there is no python3 on Android.

Or from source (needs Node >= 22):

```sh
git clone https://github.com/andyle777/IrohRedux.git
cd IrohRedux
npm install
npm run dist
npm test
```

Works offline — no network required. Nothing phones home, checks
for updates, or downloads at first run.

### Getting started

The idea behind Iroh is simple. You attach listeners to your code and as soon as the specified code part is reached, it will fire. You can listen for calls, returns, loops or any other supported code type.

Iroh's listeners are named in regard to [EStree](//github.com/estree/estree/blob/master/es5.md) which is an AST specification format for JavaScript. There is also a list [here](//github.com/andyle777/IrohRedux/blob/master/API.md#specification) which gives an simple overview of all code types you can listen for.

## The quick way (0.6.0)

If you just want the trace, skip the Stage ceremony — one call does it:

```js
import Iroh from "iroh";

const { events, result } = Iroh.trace(
  "function factorial(n) { if (n === 0) return 1; return n * factorial(n - 1); }; factorial(3);",
  { events: ["CALL"] }
);
// result === 6
// events: [{ type: "event", event: "FUNCTION_CALL", category: "CALL",
//            trigger: "before", hash: 11, indent: 1, name: "factorial",
//            arguments: [3], external: false }, ...]
```

For async programs, `await Iroh.traceAsync(code, options)` — same shape,
but the result is awaited and events from async continuations are included.
Top-level `await` works there too (`await Iroh.traceAsync("await
Promise.resolve(42);")` returns 42). `events` can be `"ALL"` (the
default), an array (`["CALL", "IF"]`), or a comma string (`"CALL,IF"`).
Pass `onEvent` to see each event as it fires. A runtime error throws
with the events that fired before it on `error.events`. TypeScript types
ship in `index.d.ts` — no `@types` package needed.

Modules trace with `await Iroh.traceModule(code, { filename })` (0.7.0,
Node only) — `import`/`export`, import attributes, `import.meta`, and
dynamic `import()` all work, and `result` is the live module namespace
object. `filename` is the base relative imports resolve against.
Decorators trace too (0.7.0): `@dec` on classes, methods, getters,
setters, and fields parses and runs, and the decorator calls fire
`CALL` events. `accessor` fields are not supported.

## Analyze the trace (0.8.0)

```js
import Iroh from "iroh";

const { events, result, analysis } = Iroh.analyzeTrace(`
  let s = 0;
  for (let i = 0; i < 150; i++) { s += i; }
  s;
`);
// result === 11175
// analysis.findings[0].code === "HOT_LOOP" — "Loop entered 150 times
// (threshold 100).", with evidence { hash, kind, iterations: 150,
// tests: 151, threshold: 100 } and neuron { label: "hot", score: 0.0259 }
// analysis.scores.coverage.value === 0.2333  (7 of 30 reachable
// categories fired — JavaScript reaches all 30, so the denominator
// here is 30; a C++ trace reaches 2, and reads "2 of 2 reachable")
// analysis.scores.fidelity.value === 1    (every region observed)
// analysis.scores.overhead.denominator === "statements"
```

`Iroh.analyze(events, options)` works on any events array — including
one the CLI streamed. Thresholds are options (`hotLoopThreshold`,
`deepRecursionThreshold`, `repeatSequenceMinOccurrences`,
`oneSidedMinTests`); `analyzeTraceAsync()` and `analyzeModule()` are the
async and module versions. The CLI appends the same analysis with
`--analyze`, after the result line. The neuron is a tiny perceptron:
`Iroh.classifyWindow(events)` returns its label, score, and the five
feature values, so the classification can be checked by hand.

## Translate the program (0.8.0)

```js
import Iroh from "iroh";

// JavaScript -> Python (hybrid: AST + trace evidence)
const py = Iroh.translate(
  "function add(a, b) { return a + b; } console.log(add(2, 3));",
  { to: "python" }
);
// py.code === "def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n"
// py.report.ok === true, py.report.staticOnly === false

// Python -> JavaScript (static-only by design — the reverse legs
// translate from source alone; native tracers exist since 0.9.0,
// but translation does not use them)
const js = Iroh.translate("def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n", {
  from: "python",
  to: "javascript",
});
// js.report.staticOnly === true
```

`to` is `"python" | "cpp" | "javascript" | "irohscript" | "basic"`; `from` defaults to
`"javascript"`. The report lists what translated cleanly, what needed an
assumption (with the trace evidence cited — C++ parameter types come from
the first call's arguments), and what could not be translated. A function
never called in the trace has no parameter types: pass them in
`options.types`, or the report lists it unsupported. The CLI translates
too: `node cli/iroh.js program.js --translate python` (exit 1 when
anything was unsupported), and `--from` is inferred from `.py` / `.cpp` /
`.iroh` / `.bas` files. Direct legs run out of JavaScript to every other
language; anything else goes two-hop via JavaScript and the report says
so.

Two 1.1.1-patch facts about translate. First, template literals to
Python now emit concatenation, not f-strings: `` `a=${"lit"}` `` becomes
`("a=" + "lit")`, so the emitted code parses and runs on Python 3.9–3.12
(the old f-string output was a SyntaxError below 3.12 while the report
said `ok: true`). Second, every translate result carries a `verify`
block: `{attempted, ran, interpreter, exit}` — for the Python leg the
emitted code is actually executed under `python3` (10 s cap) and `ran`
is true only when it exited 0; when it fails, `stderr` carries the
interpreter's output verbatim. `ran: null` means not attempted, never
success. Other legs record `attempted: false` with a reason. See
`API.md` for the full shape.

## Trace Python and C++ natively (0.9.0) — and IrohScript and BASIC (1.1.0)

```sh
node cli/iroh.js program.py --analyze
node cli/iroh.js program.cpp --analyze
node cli/iroh.js program.iroh --analyze
node cli/iroh.js program.bas --analyze
```

`--lang python|cpp|javascript|irohscript|basic` forces the language; the extension
infers it (`.py` → python, `.cpp/.cc/.cxx` → cpp, `.iroh` → irohscript,
`.bas` → basic). The events are the
same JSONL shape as JavaScript traces, so `Iroh.analyze()` works on them
unchanged — a Python hot loop analyzes to `HOT_LOOP` (150 iterations,
151 tests), a C++ deep recursion to `DEEP_RECURSION` (maxDepth 31,
threshold 20).

Python (stdlib only, `python/iroh/trace.py`): `sys.settrace` for calls
and returns, plus AST instrumentation of `while`/`for` tests
(`LOOP_TEST`/`LOOP_ENTER`), `if` tests (`IF_TEST`), and `except` handlers
(`CATCH_ENTER`), with file and line numbers as evidence. Generators
trace as one call pair (yields don't re-emit calls), and a program
importing a sibling module works — the tracer puts the script's
directory at `sys.path[0]`, as `python3 prog.py` does. The program's
stdout is redirected to stderr while it runs, so the JSONL stream stays
clean; the result line is `{"type":"result","value":null}`. Every leg
follows the same rule, the JavaScript one included: the CLI reroutes a
traced JavaScript program's `console.log` / `console.info` to stderr
for the duration of the run (the trace runs in-process, so the global
console is swapped, then restored), so stdout never mixes program
output with event lines. Honest
limits: per-assignment events fire for simple Name targets only
(tuple targets, attributes and subscripts are blind spots, and the
event carries the post-assignment value, unlike JS compound
assignments, which carry the RHS), only the target file is traced,
comprehensions/`async for`/lambdas are not loop/branch instrumented,
single-threaded.

IrohScript (stdlib only, `irohscript/src/tracer.py`): hooks in the IRX
interpreter — function calls (arguments, return, depth), `IF` tests
(`IF_TEST`), assignments (`ASSIGN`). A one-sided branch analyzes to
`ONE_SIDED_BRANCH`, a 25-deep recursion to `DEEP_RECURSION`. Honest
limits: the conditional `LOOP <Bool-expr>` runs and traces since
Amendment A1 (`HOT_LOOP` / `ZERO_ITERATION_LOOP` now fire); the
legacy bare `LOOP` still errors when executed (the spec shows the
form, not the rule). Since the lowering patch (Amendment A2,
2026-11-21) the conditional LOOP exchanges with JavaScript `while`
in both translate directions, and since the for-desugar patch
(Amendment A3, later the same day) a JavaScript for-loop desugars
into init + `LOOP <test>` + update too (and a do-while lowers since
Amendment A5, through a minted Bool flag that starts TRUE and is
rewritten from the test at the end of every body pass). `INTENT` has no event category; a call that raises
has no `CALL_END` / `LEAVE`.

BASIC (stdlib only, `irohscript/src/basic.py` + `src/basic_trace.py`):
a small dedicated interpreter — `FOR`/`NEXT` loops (`LOOP_TEST` /
`LOOP_ENTER`), `WHILE`/`WEND` loops (nested, since 1.1.0 — one
`LOOP_TEST` per iteration plus the final false test, kind `"While"`),
`IF` tests, `GOSUB` subroutines (as calls named
`gosub@<line>`), assignments, `INPUT`. A 150-iteration `FOR` loop
analyzes to `HOT_LOOP` (150 iterations, 151 tests), a never-entered one
to `ZERO_ITERATION_LOOP`. Honest limits: `GOTO` has no event category,
so `GOTO` loops are invisible in the trace; `DIM` and array reads have
no events. The v1 subset is LET, PRINT, IF/THEN/ELSE, FOR/NEXT,
WHILE/WEND, GOTO, GOSUB/RETURN, INPUT, DIM/arrays, END/STOP — anything
else (DATA/READ, DEF FN, built-in functions) is a clear error naming
the construct. Since the WHILE/WEND patch (Amendment A4, 2026-11-21)
WHILE/WEND also translates both ways with a JavaScript `while`
(a call inside the condition stays a loud, named stub — the WHILE
line is re-tested every pass), and a BASIC WHILE program rides
every translate leg from there: JavaScript `while`, Python
`while`, the IrohScript `LOOP`, C++ `while` — nested WHILE/WEND
included, each round trip executed in the tests. And since the
for-of patch (Amendment A6, 2026-11-22) a JavaScript `for-of`
rides both family legs too: to BASIC an array literal lowers to a
minted DIM walked FOR/NEXT (a variable joins only while it holds
its original literal — the bootstrap has no LEN at runtime), a
string literal unrolls per character, and IrohScript unrolls
literals per item (no array type exists there). `for-in` stays a
loud stub everywhere by design: no target has an object surface.
The C++ leg also gained a fix that day: a string literal in a
range-for used to walk the NUL terminator too; it is wrapped in
`std::string` now, with an execution test. And the GOTO lowering
(Amendment A7, same day): a BASIC program with a GOTO lowers its
mainline to a program-counter dispatch machine (`__pcw:
while/switch` on `__pc`, one case per basic block), so GOTO
chains, IF GOTO shortcuts, and GOTO escapes out of loop bodies
round-trip against the interpreter — while a GOTO into a loop
body or into a subroutine stays a loud, named stub. And the
single-namespace patch (Amendment A8, same day): a variable
declared inside a GOSUB body is program-wide, the way the
interpreter's one vars dict keeps it — the lowering hoists it to
a program-level `var` initialized 0 (or `""` for strings), so
sub writes, the mainline, and the machine all see the same
variable, and a GOSUB counter persists across calls. And the
unwritten-read patch (Amendment A9, same day): reading a
never-written variable prints 0 ("" for a string name) exactly
like the interpreter instead of crashing, and `LET A = A + 1`
counts from 0, `FOR I = I TO 2` runs from 0 to 2. And the Python leg's
value-parity patch (Amendment A10, same day): console.log(a && b)
prints the operand ("0"), not "false", and 6 / 2 prints "3",
not "3.0".

C++ (`cpp/iroh_trace_rt.cpp`): the program is compiled with
`-finstrument-functions -rdynamic -O0` and linked against the runtime
(compiled without instrumentation — the hooks must live in a separate
file). Function-level only in v1: no loop/branch/line events, so
coverage reads "2 of 2 reachable" for a C++ trace (CALL and FUNCTION
are the only categories its tracer can emit; 30 exist in the model)
and `HOT_LOOP`/`ONE_SIDED_BRANCH` cannot fire on a C++ trace. Names resolve via `dladdr` +
`__cxa_demangle`, falling back to the executable's `.symtab` for local
symbols (lambdas, `static` and anonymous-namespace functions);
unresolved names carry `"name": null` and the raw
`"address"`, never a faked name. `std::` internals are filtered by the
mangled name's outermost qualifier, so a user function that takes or
returns a std type is kept. The result line is the program's exit
code. From Python and C++ directly:

```python
from iroh import trace_python, scan_python
events, _ = trace_python("def f(n):\n    return f(n-1) if n else 1\n\nf(3)\n")
```

```cpp
#include "iroh.hpp"
iroh::native::Tracer tracer;
auto t = tracer.trace_code("int main() { return 42; }\n");
// t.events, t.exit_code == 42
```

## Scan the trace (0.9.0)

For AI consumers, `--scan` runs trace → analyze → vector in one pass and
prints ONE compact document instead of the event flood:

```sh
node cli/iroh.js program.py --scan
# {"type":"scan","vectors":{...},"findings":[...],"scores":{...},"summary":{...}}
```

The document is `{ vectors, findings, scores, summary }`: the trace
refracted into a deterministic feature vector (named features, all in
[0, 1] — the 0.8.0 neuron features plus coverage), the findings with
evidence, the scorecard with denominators on every number, and a summary
with `language`, the neuron classification, and `findingsTruncated`
(findings capped at 200 by default; the count of dropped ones is
reported, never hidden). Raw events ride along only with
`--include-events`. A 20,000-iteration loop (100k+ raw events) scans to
under 2% of the raw JSON bytes; scanning the same program twice gives
byte-identical output. Same schema for all five languages.
Library forms: `Iroh.scanTrace(code)`, `Iroh.scan(events)`,
`Iroh.toVector(events)`, `Iroh.cosineSimilarity(a, b)` /
`Iroh.euclideanDistance(a, b)` — identical traces have distance exactly
0. These are FEATURE VECTORS, not LLM embeddings: no model, no vector
DB, no new dependencies.

## Watch it live (0.9.0)

Scan is analyze-after-the-fact. The live wire analyzes WHILE the
program runs — findings stream the moment they trip:

```sh
node cli/iroh.js program.js --live
# {"type":"live-finding","code":"HOT_LOOP",...,"firedAt":505}
# {"type":"result","value":11175}
# {"type":"live-summary","findings":[...],"scores":{...},"summary":{...},"neuron":{...},"vectors":{...},"finished":true}
```

A 150-iteration loop fires `HOT_LOOP` at event 505, when it has run
100 iterations — the AI is told mid-run, not after. The library form
is `Iroh.liveAnalyzer(options)`: `.feed(event)` returns the findings
that fired on that event, `.findings()` lists all fired so far,
`.snapshot()` reports progress (no scores — those are final), and
`.finish()` returns the final summary. The fired findings' codes always
equal the batch `analyze()` codes on the same complete trace, and the
summary IS the batch analysis (findings, scores, summary, neuron) plus
the vector — so live vs batch agreement holds by construction. Two
findings need the complete trace and fire at stream end with a `note`
saying so: `ZERO_ITERATION_LOOP` and `ONE_SIDED_BRANCH`. For Python
and C++ the live lines print after the run, because the native tracers
buffer their events; for JavaScript they stream as the program runs.

## Direct the run (1.0.1)

Watching is half the story. The director acts on what the live wire
finds — while the program is still running:

```js
const Iroh = require("iroh");
let out = Iroh.direct(
  "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
  Iroh.runawayGuard()
);
// out.result === 4950 — the loop ran 100 iterations, then the director cut it.
// out.findings[0].code === "HOT_LOOP" (evidence.iterations === 100).
// out.directives[0].directive === { type: "set", name: "i", value: 10000 }.
```

The loop closes: trace → analyze live → direct → change → trace again.
Your own director is a callback — it receives the findings that just
fired plus the current snapshot, and returns a directive (or `null`):

```js
const out = Iroh.direct(code, (ctx) => {
  if (ctx.findings.some((f) => f.code === "HOT_LOOP")) {
    return { type: "stop", reason: "loop is too hot" };
  }
  return null;
});
```

Three directives: `{ type: "set", name, value }` writes a variable at
its next assignment (or flips a loop test when the counter advances by
`++`); a set may carry `scope` (a function name, or `null` for the top
level) and may name a member (`"obj.prop"`, one level, including
compound member assignments); `{ type: "skip", name, value }` makes the
next call of that name evaluate to the value without running;
`{ type: "stop", reason }` ends the run. Each applies once, at the
first matching point, and the record says whether and how it applied — a
directive that never matches stays in the audit log with
`applied: false` and a reason, never a pretence it took effect. A
runtime error throws with the events so far and the direction record so
far attached; a directed stop returns normally with `stopped: true`.
Async programs and modules have their own entries: `directAsync()`
(top-level await works there) and `directModule()` (Node.js only).
From the CLI:

```sh
node cli/iroh.js program.js --direct
# {"type":"directive","directive":{"type":"set","name":"i","value":10000},...}
# {"type":"result","value":4950}
# {"type":"direct-summary","stopped":false,...,"findings":[...],"directives":[...],"analysis":{...}}
```

`--direct=stop` makes the guard stop the run instead of throttling it.
Direct mode is JavaScript only — Python/C++ traces are buffered
after the run, so there is nothing live to direct — but modules and
top-level await work: `--direct` on a `.mjs` file or a script with
top-level await directs it (via `directModule()` / `directAsync()`).
`--direct` combines with `--analyze`, `--scan`, and `--live`; the
analysis and scan lines follow the direct-summary.

## Check the box and the run (1.1.1)

Two CLI commands answer "can this box run it, and did it pass":

```sh
node cli/iroh.js capabilities
# Node v24.22.1
# Language legs:
#   javascript: available (built-in engine)
#   python: available (python3 on PATH)
#   cpp: available (g++ on PATH)
#   ...
# Syntax features:
#   RegExp modifiers (?i:...): available
#   using declarations: available
#   ...
```

`iroh capabilities` prints one row per language leg (available, or
unavailable with why — a missing `python3` or `g++` is named, not
hidden) and per syntax feature (available, or unavailable with the
Node version that has it). `iroh capabilities --json` prints the same
as one JSON line (`{type:"capabilities", node, legs, features}`).
Features that need Node 24 skip their tests with a printed reason
naming the feature and the version; `engines.node` is `>= 22` (Node 18
went EOL in April 2025 and was never measured here, so it is not
certified).

```sh
node cli/iroh.js doctor
# Last test run: 2026-11-20T08:22:43.349Z on Node v24.22.1
#   node: ran 454, failed 0, skipped 0
#   python: ran 25, failed 0, skipped 0
#   ...
# Toolchains: node v24.22.1, python3 3.12.3, g++ ...
# dist: iroh-node.js 44dd8d776847, ...
```

`iroh doctor` prints the last recorded test run (from
`test-results/suite-summary.json`, written by `npm test` — one
machine-readable line per leg, `ran` / `failed` / `skipped` / `skips`,
a leg whose toolchain is absent reported as did-not-run, never as a
pass), the live toolchain versions, the dist hash, and the
capabilities. It does not run the suite itself — run `npm test` first.

Two more 1.1.1 CLI flags: `--max-events N` caps the recorded events
(JavaScript legs only — a runaway stops with an error line carrying
the partial events; a program that catches every thrown value can
defeat the stop), and `--verify` traces a JavaScript program twice
and diffs the events and result as JSON, printing
`{"type":"verify","ok":true,"events":N}` and exiting 1 on
disagreement (JavaScript only; it does not combine with `--translate`,
`--direct`, or `--synthesize`).

## Phone as server, laptop as node (1.1.1 patched)

The APK starts a local server on your phone after setup, and shows
its address on the status line:

```
Ready — Node v26.13.1 · IrohRedux 1.1.1 · JS legs only (no python3 on Android)
· Server on 192.168.1.5:8471
```

A laptop on the same Wi-Fi joins it and runs the legs the phone
cannot:

```sh
iroh node --server 192.168.1.5:8471
```

The phone runs the JavaScript legs locally and delegates Python,
C++, IrohScript and BASIC to the laptop. Results come back with
one extra field, `ranOn`, naming the machine that ran them. If no
connected node can run a leg, the server says so (HTTP 503), never
a faked result. Everything is on the local network only — no
internet is needed or used. To try it on one box, start a server
that only runs JavaScript (like the phone) and a node next to it:

```sh
iroh serve --port 8471 --host 127.0.0.1 --local-legs javascript
iroh node --server 127.0.0.1:8471
```

Then `curl http://127.0.0.1:8471/health` shows the server, its
dist hash, and the registered node. Full protocol, endpoints, and
the honest limits: `SERVER.md`.

The rest of this guide uses the classic Stage API, which is still fully
supported and gives you live listeners that can change values mid-flight.

## Examples

- [Intro](#intro)
- [Manipulate functions](#manipulate-functions)
- [Visualize code](#visualize-code)

### Intro

This is a short intro about how to use Iroh.

The pipeline of Iroh is simple:

 * Create a stage, pass in your code
 * Add listeners to the stage
 * Run the stage

##### 1. Create a stage

The code of this example is also available on [jsfiddle](//jsfiddle.net/58y7p92v/).

At first we need to create a ``stage``. The stage object is the root connection between us and the running code.

````js
let code = `let foo = 42`;
let stage = new Iroh.Stage(code);
````

``Iroh.Stage`` expects a string which contains the code you want to analyze.

##### 2. Add listeners

After creating a stage, we now need to specify what exactly we want to listen for. Let's listen for all variable declarations in our code. All event listeners provide specific events to listen for, you can find the whole list [here](//github.com/andyle777/IrohRedux/blob/master/API.md#runtimeevent).

E.g. ``Iroh.VAR`` has two events:
  * ``before``: What to do before a variable got it's value assigned
  * ``after``: What to do after the variable got it's value assigned

````js
// create a listener
let listener = stage.addListener(Iroh.VAR);
// jump in *after* the variable got created
listener.on("after", (e) => {
  // this logs the variable's 'name' and 'value'
  console.log(e.name, "=>", e.value); // prints "foo => 42"
});
````

##### 3. Run the stage
Our stage is now ready to be executed. Since Iroh patches the code we want to analyze, we need to manually run the patched code afterwards.

````js
// the stage object holds the patched version of our code
// we just use eval here to keep things simple
eval(stage.script);
````

Our console should now show up ``"foo => 42"``.

All right, you did your first magic with Iroh!

### Manipulate functions

Iroh allows to manipulate code while it's running. Most listeners provide values, which directly affect the running code when changing them.

The code used in this example is the following:
````js
function add(a, b) {
  return a + b;
};
````

Our goal is to make the function ``add`` always return ``42`` instead of ``a + b``.

The code of this example is also available on [jsfiddle](//jsfiddle.net/8ycm17uu/1/).

##### Adding the listener
````js
// this creates a listener for all function events
let listener = stage.addListener(Iroh.FUNCTION);
// this specifies to listen for all function returns
listener.on("return", (e) => {
  // make sure we only change the return value of the function 'add'
  if (e.name === "add") e.return = 42;
});
````

Now as soon as a return gets executed in our code, Iroh jumps in between and gives us some useful properties like the function's name and the return value which we can directly change.

So now we just have to run the stage:

````js
eval(stage.script); // we just use eval here to keep things simple
````

When now running ``add`` it should always return ``42``.

### Visualize code

Iroh keeps track of the control-flow of your program, means it generates a numeric indentation value based on when code branches are *entered* and *left*. A code branch can be an ``if``, ``else``, ``call``, ``loop`` and so on. For example, when entering an ``if``, the indentation value goes ``+1``, when leaving it decrements by ``-1``.

This makes it possible to create any kind of model from the running code in realtime. **All** listeners provide an ``RuntimeEvent.indent``!

The code of this example is also available on [jsfiddle](//jsfiddle.net/wwn90rp3/8/).

Input: 
````js
if (true) {
  for (let ii = 0; ii < 3; ++ii) {
    let a = ii * 2;
  };
}
````
So we have 2 branches here, ``if`` and ``for``.

Let's create listeners for all ``if`` and ``loop`` statements in our code.

````js
// while, for etc.
stage.addListener(Iroh.LOOP)
.on("enter", function(e) {
  // we enter the loop
  console.log(" ".repeat(e.indent) + "loop enter");
})
.on("leave", function(e) {
  // we leave the loop
  console.log(" ".repeat(e.indent) + "loop leave");
});

// if, else if
stage.addListener(Iroh.IF)
.on("enter", function(e) {
  // we enter the if
  console.log(" ".repeat(e.indent) + "if enter");
})
.on("leave", function(e) {
  // we leave the if
  console.log(" ".repeat(e.indent) + "if leave");
});
````

You may noticed the ``" ".repeat(e.indent)`` inside all listener events. This just repeats the string on its left (a blank sign here) x times. The higher the ``e.indent`` number is, the more we are padding to the right. This results in a nice effect which directly shows the control-flow of the running code.

After the program finished, your console should come up with something like this:
````
 if enter
  loop enter
  loop leave
 if leave
````
With each branch deepness level we move in by 1 blank sign.

You may noticed the first blank sign which is caused by ``Iroh.PROGRAM`` - when entering a program, the branch level increments by one and after the program is finished it decrements.

---

# FOR AI

Machine-readable facts. Load this section without guessing. If a
fact here disagrees with a prose paragraph above, this section wins
— and the disagreement is a bug; file it.

- Engine: IrohRedux 1.1.1 (patched in place, 20 Nov 2026). No
  1.1.2. No version bump. `dist/iroh-node.js` SHA-256:
  `44dd8d7768472911a5e2b04596acb99bd980c8fe24a8d71cae3a01a1dbbda30b`.
- Ask for JSON. Never parse console prose; it is for humans and
  will change. Event streams are JSON lines, one object per line,
  with the `language` field always set.
- `--scan` returns `{vectors, findings, scores, summary}`.
  Findings are capped at 200; when `summary.findingsTruncated`
  > 0 your list is a prefix, say so when you report.
- Every coverage number carries its own denominator. Use
  `reachable` when present. Missing is not 30 and not zero; if
  you cannot find it, report the score as unnormalised.
  - javascript: 30 (all categories).
  - python: 6 (ASSIGN, CATCH, CALL, FUNCTION, IF, LOOP).
  - cpp: 2 (CALL, FUNCTION).
  - irohscript: 4 (ASSIGN, CALL, FUNCTION, IF).
  - basic: 5 (ASSIGN, CALL, FUNCTION, IF, LOOP).
- Translate results carry a `verify` block:
  `{attempted, ran, interpreter, exit}` plus `stderr` when `ran`
  is false or `reason` when `attempted` is false. `ran: null`
  means not attempted, not success. Only the Python leg is
  executed (under `python3`, 10 s cap).
- Template literals to Python emit concatenation, not f-strings:
  `` `a=${x}` `` becomes `("a=" + str(x))`. The old f-string
  output was a SyntaxError on Python 3.9–3.11 while the report
  said `ok: true`.
- Server / node: `iroh serve` (default port 8471, local network
  only) serves `/trace`, `/analyze`, `/scan`, `/translate`,
  `/capabilities`, `/health` as JSON. Every result is the engine's
  own shape plus `ranOn` ("local" or the node id). A leg nobody
  can run is HTTP 503, never a faked result. Full protocol:
  `SERVER.md`.
- Works offline — no network required. No artifact phones home,
  checks for updates, or downloads at first run.
- Full machine-readable reference: `API.md` (FOR AI section) and
  `README.md` (FOR AI section). The AI bundle regenerates its
  `txt/` files from the same markdown sources, so they cannot
  drift.
