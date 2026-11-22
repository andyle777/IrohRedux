### API

# FOR HUMANS

This is the precise reference for every surface IrohRedux exposes.
If you are new, start with [Getting Started](GETTING_STARTED.md)
and the [README](README.md) — this file is for looking up exact
shapes, options, and flags. There are four surfaces:

- **Library** (`Iroh.trace`, `analyze`, `translate`, `direct`,
  `synthesize`, `scan`, `liveAnalyzer`, `compileIrohscript`) —
  import it from Node or ESM; types ship in `index.d.ts`.
- **CLI** (`node cli/iroh.js`, or the packaged `iroh` binary) —
  streams JSON lines; see [CLI flags](#cli-flags) for every flag.
- **Python client** (`python/iroh/`: `run`, `trace_python`,
  `scan_python`) and **C++ client** (`cpp/iroh.hpp`) — thin
  clients over the CLI; see [Using Iroh from Python, C++,
  IrohScript and BASIC](#using-iroh-from-python-c-irohscript-and-basic).
- **Server / node** (`iroh serve`, `iroh node`) — the phone is a
  local server, a laptop is a local node; see `SERVER.md` and the
  [CLI flags](#cli-flags) section.

The machine-readable facts (JSON shapes, reachable categories,
findings cap, translate `verify` block) are in the
[FOR AI](#for-ai) section at the end of this file. The generated
text form of this file is `txt/API.txt` in the AI bundle, and CI
checks that every flag in `iroh --help` appears in it.

- [Iroh](#iroh)
- [Iroh.Stage](#irohstage)
- [Iroh.Stage.RuntimeListener](#irohstageruntimelistener)
- [RuntimeListener.RuntimeEvent](#runtimeevent)
- [Listener Specification](#specification)

#### Iroh:

``Stage``: Returns a new stage object to work with after being instantiated.

``stages``: An object which contains references to all running stages.

``parse``: A reference to ``acorn.parse`` to turn source code into an AST.

``generate``: A reference to ``astring.generate`` to turn an AST back into source code.

``assert(name, condition)``: Records a test assertion from code running inside a stage — `{name, passed}` appended to ``Iroh.assertions`` — and returns the boolean. It records instead of throwing, so one failing check does not hide the rest. Use ``Iroh.resetAssertions()`` to clear the record between runs. This is the API the fixtures in ``tests/expressions/`` and ``tests/other/`` were written against (see ``tests/fixtures.test.js``).

``log(...args)``: Prints from inside traced code (a ``console.log`` passthrough), also used by the fixtures.

``assertions``: The recorded assertions from ``Iroh.assert`` calls, in order.

``trace(code, options)``: One-shot tracing (0.6.0). Runs `code` through a
Stage and returns `{ events, result }` — `events` is the list of plain,
JSON-safe event objects (same shape as the CLI's JSON lines), `result` is
the program's completion value, live (not serialized). Options: `events`
(`"ALL"` by default, an array of category names, or a comma string),
`onEvent(event)` (called for every event as it fires), and `stageOptions`
(passed to the Stage: `ecmaVersion`, `allowHashBang`, `sourceType`,
`allowAwaitOutsideFunction`). A parse error throws before running; a
runtime error throws with the events that fired before it attached as
`error.events`. Module code (`import`/`export`, `import.meta`) and
top-level `await` are rejected with a pointer at `traceModule()` /
`traceAsync()` instead of a bare SyntaxError. A program declaring its
own top-level `Iroh` is fine — the runner retries under `$$Iroh`.

``traceAsync(code, options)``: Async version of `trace()`. Awaits the
program's completion value before returning, so events from async
continuations (await, promises) are included — and so top-level `await`
in scripts works (`await Promise.resolve(42)` as a whole program
returns 42). Returns a Promise of `{ events, result }`. A program that
fails before running (module code, parse error) rejects the promise
rather than throwing synchronously. A program declaring its own
top-level `Iroh` is fine — the async wrapper always runs under
`$$Iroh`, so the user's `Iroh` is untouched.

``traceModule(code, options)``: Trace an ES module (0.7.0, Node only).
`import`/`export` declarations, import attributes (`with { type:
"json" }`), `import.meta`, dynamic `import()`, and top-level await all
work. Returns a Promise of `{ events, result }` where `result` is the
live module namespace object (`result.default` for the default export).
Options are `trace()`'s, plus `filename`: when given, the instrumented
module is written next to that file, so relative imports resolve
against its directory; without it the module runs from a fresh temp
directory and only bare or absolute imports resolve. The temp file is
deleted after the trace settles. `import.meta.url` is the temp file's
URL, not the caller's. Throws a clear error in the browser.

``analyze(events, options)``: AI analysis layer (0.8.0, deterministic —
no LLM, no network, no randomness). Takes a trace's events array (what
`trace()` / `traceModule()` return, and what the CLI streams) and returns
`{ findings, scores, summary, neuron }`. Findings are `{ code, severity,
message, evidence, neuron }` from deterministic rules — every finding
cites its evidence (counts, names, hashes), no finding without evidence.
Codes: `HOT_LOOP` (a loop at/above `hotLoopThreshold`, default 100
iterations), `ZERO_ITERATION_LOOP` (a loop tested but never entered),
`DEEP_RECURSION` (call depth at/above `deepRecursionThreshold`, default
20), `REPEATED_SEQUENCE` (the same call sequence repeating at/above
`repeatSequenceMinOccurrences`, default 3), `ONE_SIDED_BRANCH` (an if
evaluated at least `oneSidedMinTests` times, default 2, always the same
side), `THROWING_PATH` (exceptions caught during the trace — uncaught
exceptions end the trace itself and are reported by the caller, since
`trace()` throws with the events attached). The hotness findings
(`HOT_LOOP`, `DEEP_RECURSION`, `REPEATED_SEQUENCE`) carry a `neuron`
classification `{ label, score }`; the others carry `neuron: null` and a
`neuronNote` — the perceptron classifies hot vs normal only, so it is
not forced onto findings it does not fit. Scores: `coverage` (event
categories fired vs the categories this tracer can reach, as `fired` /
`reachable` / `total` with `value` = fired/reachable — a C++ trace
firing CALL and FUNCTION reads "2 of 2 reachable" with value 1, not
"2 of 30"; `missingCategories` lists the reachable categories that did
not fire, and the note always names the denominator, e.g. "2 of 2
reachable for a cpp trace (30 exist in the model)"), `fidelity` (regions observed vs total, with known blind
spots — private-field and destructuring assignments produce no `ASSIGN`
event, so they are counted from `options.source` when given and listed
as uncounted, never hidden, when it is not), `overhead` (events per
statement when the source is given, else events per region, with
`denominator` saying which). `summary` counts the events, findings,
warnings, infos, max call depth, and distinct regions. `neuron` is the
whole-trace window classification from `classifyWindow()`.

``analyzeTrace(code, options)``: Trace then analyze in one call (0.8.0).
Returns `{ events, result, analysis }`; `options.analyze` holds the
analyze thresholds, and `analyze.source` defaults to the code being
traced. `analyzeTraceAsync(code, options)` is the async version, via
`traceAsync()` (top-level await works); `analyzeModule(code, options)`
is the module version, via `traceModule()` (Node only). All three return
a Promise of the same shape except `analyzeTrace()`, which is sync.

``extractFeatures(events)`` / ``classifyWindow(events)`` /
``createPerceptron(weights, bias)``: The neuron layer (0.8.0) — a tiny
perceptron in pure JS, no dependencies. Features, all normalized to
[0, 1]: call count, max call depth, repeat rate, branch imbalance,
event-type mix. `classifyWindow()` returns `{ label, score, features }`
— label `"hot"` or `"normal"`, the score, and the feature values, so the
classification is inspectable, never a black box. `createPerceptron()`
builds a perceptron with the frozen trained weights by default (trained
offline on 200 synthetic labeled traces, deterministic; train 200/200,
held-out 100/100) and a deterministic `train(samples, epochs,
learningRate)` for re-training or checking in tests. The perceptron
classifies hotness only.

``toVector(events, options)`` / ``cosineSimilarity(a, b)`` / ``euclideanDistance(a, b)`` /
``compareVectors(a, b)``: Vector refracting (0.9.0) — deterministic
feature vectors, not LLM embeddings: no model, no vector DB, no new
dependencies. `toVector()` returns `{ features, vector, names }` — the
five neuron features (call count, max call depth, repeat rate, branch
imbalance, event-type mix) plus `coverage` (categories fired /
reachable for the trace's language — `options.language`, default
`"javascript"` — so a function-level C++ trace is not penalised for
the categories its tracer cannot emit), all normalized to [0, 1], with named features, the ordered numeric
vector, and `names`. `features.events` is the raw event count (a plain
count, not part of the normalized vector). The same events give the same
vector, always; identical traces have Euclidean distance exactly 0 and
cosine similarity exactly 1, and a one-empty comparison returns cosine
0. `compareVectors()` returns both measures at once. Arguments may be
plain number arrays or `toVector()` results; mismatched lengths throw
instead of guessing.

``scan(events, options)``: AI-friendly scan mode (0.9.0) — trace →
analyze → vector in one pass, emitting ONE compact document
`{ vectors, findings, scores, summary }`: the `toVector()` projection,
the `analyze()` findings (every finding cites its evidence), the
scorecard (denominators on every number), and a summary that adds
`language` (default `\"javascript\"`), the neuron classification, and
`findingsTruncated`. Findings are capped at `maxFindings` (default 200)
as a safety bound — findings past the cap are dropped and counted in
`summary.findingsTruncated`, never hidden. The raw events ride along
only with `includeEvents: true`. Same schema for JS, Python and C++
traces. `scanTrace(code, options)` / `scanTraceAsync(code, options)` /
`scanModule(code, options)` are the trace-then-scan one-shot versions
(mirroring the analyzeTrace family; `options.analyze.source` defaults to
the code). The CLI `--scan` flag is how Python and C++ traces reach it.

``liveAnalyzer(options)``: Live wire AI analysis mode (0.9.0) —
analysis that runs WHILE the program runs. Returns an analyzer with
`feed(event)` (returns the findings that fired on that event, usually
`[]`), `findings()` (all findings fired so far, in fire order),
`snapshot()` (progress so far: event count, findings fired, the window
classification and the vector over the events so far — no scores,
those are final), and `finish()` (the final summary: the batch
analysis `{ findings, scores, summary, neuron }` plus `vectors` and
`finished: true`). A finding fires the moment its threshold trips:
`HOT_LOOP` when a loop's true-test count reaches `hotLoopThreshold`,
`DEEP_RECURSION` when a `FUNCTION_ENTER` indent reaches
`deepRecursionThreshold`, `REPEATED_SEQUENCE` when a call sequence
reaches `repeatSequenceMinOccurrences` (the first sequence to reach it;
at most one live `REPEATED_SEQUENCE`), `THROWING_PATH` on the first
`CATCH_ENTER`. Each fired finding is the batch finding plus `firedAt`
(the 0-based index of the event that tripped it) and the evidence as
of the trip — the counts are the counts so far, and the neuron label is
the window classification over the events so far. Two findings cannot
be decided incrementally, so they fire at `finish()` with a `note`
saying so, never a wrong early call: `ZERO_ITERATION_LOOP` and
`ONE_SIDED_BRANCH`. The fired findings' codes equal the batch
`analyze()` codes on the same complete trace, and `finish()` returns
the batch analysis itself, so live vs batch agreement holds by
construction. Deterministic: the same events give the same findings in
the same order, twice. `feed()` after `finish()` throws. The CLI
`--live` flag streams `{"type":"live-finding",...}` lines as they fire
(suppressing the event flood, like `--scan`), then a final
`{"type":"live-summary",...}` after the result line; for Python/C++
the live lines print after the run, because the native tracers buffer
their events. Options are the `analyze()` thresholds plus `source`
(for the final scorecard) and `language` (default `\"javascript\"`).

``direct(code, director, options)``: AI director + live code engine
(1.0.1) — run `code` under trace with `director` (a function, or
`null` for an undirected run) and change it mid-flight. The director
is called once before the run (`findings: []`, `event: null`), then
whenever new live findings fire, with `{ findings, allFindings,
snapshot, event, eventIndex, directives }`, and returns a directive, an
array of directives, or `null`. Three directives, each taking effect in
the running program: `{ type: "set", name, value }` writes a variable
at its next value-flow point — a declaration's initializer, a plain
assignment (`x = v`), a member assignment (`obj.prop = v`, one level,
including compound member assignments), or the next test of a loop
comparing that variable with a numeric literal (the test is flipped to
`false` only when the set value makes the comparison false, for
counters advanced by `i++`); a set may carry `scope` (a function name,
or `null` for the top level; omitted means any scope, first match
wins); `{ type: "skip", name, value }` makes the next call of that
name evaluate to `value` without running — the real function never
executes, no `FUNCTION_ENTER`, no side effects (a skip issued for the
very call that tripped the finding applies to that call now);
`{ type: "stop", reason }` ends the run with a reason. Each directive
applies once, at the first matching point, then it is consumed; a
directive that never matches is recorded with `applied: false` and a
reason. A set on a property with a setter runs the setter twice (once
for the original write, once for the overwrite). A stop is delivered by
throwing a sentinel from the next event — a program inside
`try`/`catch` may swallow one throw, so the engine re-throws it at
every following event until it propagates out. Returns
`{ result, stopped, stopReason, events, findings, directives,
analysis }` — `analysis` is the live `finish()` summary, so live vs
batch agreement holds by construction. A runtime error throws with the
events so far as `error.events` (like `trace()`) and the direction
record so far as `error.direct`; a directed stop returns normally with
`stopped: true`. Options are the `liveAnalyzer()` thresholds plus
`stageOptions`, `onEvent(line)`, `onDirective(entry)` and
`onFinding(findings)` (called with the findings that just fired, after
the director is consulted). The `events` option is ignored — the
director needs the full stream, so `direct()` always traces ALL
categories. Scripts only (synchronous, like `trace()`) — modules and
top-level await are rejected with the `direct()` pointers (use
`directModule()` / `directAsync()` for those), and Python/C++ traces
cannot be directed.

``directAsync(code, director, options)`` (1.0.1): like `direct()`, but
asynchronous — top-level await works here. Returns a promise of the
same record. Modules are rejected (use `directModule()`).

``directModule(code, director, options)`` (1.0.1): like `direct()`, but
for modules — `import`/`export` and top-level await work here, and the
result is the live module namespace (traceModule semantics). Returns a
promise of the same record. Node.js only.

``runawayGuard(options)``: The built-in director (1.0.1) — a factory
returning a director function, so one guard instance directs one run.
On `HOT_LOOP` it throttles by default: it sets the loop's counter to
the value that makes its test false (`i < 10000` → set `i` to `10000`;
`i <= 9999` → `10000`; `i > 0` → `0`), so the loop exits at the next
test. With `{ action: "stop" }` it stops the run with a reason
instead. A loop whose counter cannot be resolved — `while (true)`, a
non-literal bound, a compound test, `==` / `===` — cannot be
throttled, so the guard stops the run and says so. The CLI `--direct`
flag runs a script under this guard (throttle by default,
`--direct=stop` stops instead), streaming
`{"type":"directive",...}` lines as directives take effect and closing
with a `{"type":"direct-summary",...}` — findings, the full directive
audit log and the analysis. A directed stop exits 0. `--direct` works
on modules (`.mjs` or `--module`) and scripts with top-level await,
and combines with `--analyze`, `--scan`, and `--live` (the analysis
and scan lines follow the direct-summary). Conflicting mode
combinations (`--translate` with `--live`/`--scan`/`--analyze`/
`--direct`, `--direct` with a non-ALL `--events`, `--include-events`
without `--scan`) are usage errors, exit 2, checked before the file
is read.

``synthesize(code, options)``: Input synthesiser (1.1.0) —
generate concrete inputs that drive a named entry function down each
branch, on the live wire. Runs the function with the seed inputs under
trace, reads the live analyzer's `ONE_SIDED_BRANCH` findings as the
target list, and solves for inputs that flip each uncovered branch —
boundary values for numeric comparisons (`x > 10` → 11 and 10),
the observed constant for equality (`x === 7` → 7), the observed
string for string equality, each side of `&&` / `||`, 1 / 0 for a
bare parameter, a string of the right length for `.length` against a
numeric literal, and the discriminant value for a switch case — with
seeds plus guided mutation as fallback. Iterates until every branch is
covered or the run budget (default 50 runs, seeds included) is hit.
Returns `{ entry, inputs, coverage, runs, uncovered, findings,
summary }` — `coverage` is arms covered / arms total with every
branch site (`branches`, each with `arms`, `covered` and per-arm
`reasons`); `runs` is used / budget; `uncovered` lists every arm left
uncovered WITH its reason (a condition over `Date.now()` /
`Math.random` / `new Date`, a compound expression the v1 solver
cannot invert, a branch the budget ran out on); `findings` is the
per-run live findings (deduped by code + branch site + message) plus
the final aggregate `ONE_SIDED_BRANCH` findings with their branch
attached. Each run is capped at `loopCap` true tests per loop (default
10000): the next test is flipped to false and the run is marked
`capped`, and the flipped test does not count as coverage — a
non-terminating candidate is a capped run, not a hang. Progress
streams through `onProgress(event)` as `run` (with `newlyCovered`),
`branch-covered` and `live-finding` events, the way `--live` streams
findings. Scripts only, synchronous entry functions — modules,
top-level await and async entries are rejected; seeds must be JSON
values. The program runs, so its side effects happen. The CLI
`--synthesize --entry <name>` prints `synth-run` / `synth-branch` /
`synth-summary` JSON lines (and `live-finding` lines with `--live`),
with `--seeds '<json>'` and `--max-runs <n>`; it rejects
`--module` / `--direct` / `--events` combinations with exit 2.
v1 solver limits, stated honestly: it solves direct
parameter-vs-literal comparisons only — compound expressions
(`x * 2 > 10`), comparisons between two parameters, and conditions
over external or nondeterministic values are reported uncovered, not
faked; a switch default is solved with a value matching no case
literal, and only `===` case literals are solved.

``translate(code, options)``: Hybrid translation engine (0.8.0; all five
languages as sources and targets since the 1.0.1 rework, part 2). Returns
`{ code, report }` where `report` is `{ ok, from, to, staticOnly, clean,
assumptions, unsupported, notes, verify }` — the `verify` block is new
in the 1.1.1 patch (see below). JavaScript out (`to: "python" |
"cpp" | "irohscript" | "basic"`) is hybrid: the AST (static) plus trace
evidence (dynamic — the program is run through the tracer first, and
the events resolve what static analysis cannot: runtime types, values,
which branches fired). Template literals to Python emit concatenation,
not f-strings (1.1.1 patch): `` `a=${x}` `` becomes `("a=" + str(x))`
— literal text via `JSON.stringify`, booleans via `__iroh_jsbool`,
doubles via `__iroh_jsnum`, ints and unknown types via `str()` (a
recorded assumption), arrays unsupported (a loud stub). The old
f-string output was a SyntaxError on Python 3.9–3.11 while the report
said `ok: true`; the concatenation form parses and runs on 3.9–3.12,
and the execution-matrix gate (`npm run check:matrix`) proves it on
all four interpreters. The reverse legs (`from: "python" | "cpp" |
"irohscript" | "basic"`, `to: "javascript"`) are static-only by design
(`staticOnly: true`) — they translate from source alone. Native Python
and C++ tracers exist since 0.9.0, but the translation legs do not use
them. Any other pair (IrohScript to Python, BASIC to C++, Python to
C++) goes two-hop through JavaScript, and the report's notes say so.
Python is parsed with Python's own `ast` module (a small stdlib-only
helper run through `python3`, which emits the AST as JSON); C++ is
parsed by a scoped subset parser in the library. IrohScript is parsed
by the bootstrap compiler (an embedded helper run through `python3`;
`options.irohscriptHome` names the directory holding the `irohscript`
package — the CLI passes the in-repo copy) and BASIC by the in-repo
`src/basic.py` parser. v1 scope, both directions: functions,
arithmetic, loops, conditionals, arrays (Python lists / C++ vectors),
strings, console output (`console.log` / `print` / `std::cout`).
JavaScript functions become BASIC GOSUB subroutines; IrohScript
`ACTION`/`INTENT` become `__iroh_action`/`__iroh_intent` recorders;
recursive functions to BASIC are still unsupported, and the legacy bare
IrohScript LOOP does not lower (no
exit rule). Since Amendment A2 (2026-11-21) the conditional LOOP
lowers both ways: IrohScript `LOOP <Bool>` becomes a JavaScript
`while`, and a JavaScript `while` becomes IrohScript `LOOP <Bool> ...
END LOOP`, with the round trip run in the tests. Since Amendment A5
(2026-11-22) a JavaScript do-while lowers through a minted Bool flag
(`LET __do_while_flag_N : Bool = TRUE`, `LOOP <flag>`, the body,
`<flag> = <test>`, `END LOOP`; to BASIC: `LET <flag> = -1`, `WHILE
<flag>`, the body, `LET <flag> = <test>`, `WEND`) — the body runs
once before the first test either way, and the test runs exactly
once per pass, so runs match the JavaScript one for one. Since Amendment A3
(2026-11-21) a JavaScript for-loop desugars into IrohScript instead
of stubbing: the init statement (LET with its inferred type, or an
assignment), `LOOP <test>` (True when the loop has no test), the
body, the update statement, `END LOOP` — the JavaScript definition
of the construct, so the init-once/test-before-body/update-after-body
ordering is exact, and every piece keeps its own stub rules (the
loop variable stays in scope after the loop, the same flat-scope
simplification the BASIC leg makes). Since Amendment A4
(2026-11-21) a JavaScript `while` also lowers into BASIC as
`WHILE ... WEND` — the bootstrap interpreter's own test-first
construct (1.1.1 M5) — and BASIC `WHILE ... WEND` lowers into
JavaScript as `while`, both round-trip tested. One case stays a
loud stub: a call inside the condition, which unlike FOR bounds
cannot be hoisted to a GOSUB before the loop, because the WHILE
line is re-tested every pass. Since Amendment A6 (2026-11-22) a
JavaScript for-of lowers instead of stubbing: to BASIC, an array
iterable rides DIM + FOR/NEXT — an inline literal is hoisted once
through the declaration machinery into a minted `__for_of_arr_N`
(a translate-time-fact walk: the bootstrap has no LEN at runtime, so
a variable only qualifies while it is known to hold its original
array literal; a reassignment retires the fact and stubs loudly),
and the minted `__for_of_idx_N` walks `0..n-1` re-assigning the loop
variable from the array each pass; a string literal unrolls one pass
per character (printable ASCII only, loud stub beyond). To
IrohScript, literals unroll one pass per item (first pass declares,
later passes re-assign — the flat-scope re-binding; the language has
no array type, so a runtime iterable is a loud stub). for-in stays
a loud stub on every leg by design: no v1 target has an object
surface. The same amendment fixed a silent divergence on the C++
leg: a string literal in `for (auto c : ...)` decays to a char
array and the walk included the NUL terminator; it is now wrapped
in `std::string(...)`, with a compiled-and-run test that would
catch the stray byte. Since Amendment A7 (2026-11-22) a BASIC
program containing a GOTO lowers its mainline through the
program-counter dispatch machine: `__pc` walks the flat line
slots exactly the way the interpreter does (`__pcw: while (true)
switch (__pc)`, one case per basic block, a case start at every
valid GOTO target's line slot, a GOTO a jump of `__pc`, `var`
hoisted declarations because a case can be re-entered). Backward
jumps, the `IF ... THEN GOTO` shortcut, a GOTO out of a FOR/WHILE
body, and a re-entered loop header all match the interpreter's
execution (test-first parity). Loud stubs by design: a GOTO into
a loop body (the body lowers to structured JavaScript; entering
without the loop header is not representable), a GOTO into a
GOSUB subroutine (subroutines lower to functions), a GOTO inside
a subroutine, and a GOTO to an undefined line. No classes, no
closures-as-objects, no async. The Python leg accepts `for (i = A; ...)`
with `i` declared earlier, not just `for (let i = A; ...)` — the BASIC
leg emits the first form so the loop variable stays visible after the
loop. Unsupported constructs are reported in `report.unsupported` and
the emitted code raises/throws at that point, loudly — never silently
mistranslated. Assumptions cite their trace evidence (e.g.
`FUNCTION_CALL 'add' arguments [2,3]` for a C++ parameter type).
`options.types` supplies C++ types the trace could not
(`{ functions: { add: { params: ["int", "int"], returns: "int" } } }`).
The JS-out leg runs the program through the tracer for evidence, and
its `console.log` output is silenced while it runs, so `translate()` has
no visible side effects. But the evidence trace really runs the program,
so any other side effects (file writes, network calls, non-terminating
loops) happen for real — `translate()` does not sandbox it. `translateAsync(code, options)` is the async
version — in the ESM build the Python leg loads `child_process` by
dynamic import (the sync version needs the CJS build's `require` for
that leg); in a browser, the Python leg throws a clear error and the
C++ leg works. The async path now honours `to` for the Python,
IrohScript and BASIC legs (before the 1.0.1 rework it ignored `to`
and always returned JavaScript).

``report.verify`` (1.1.1 patch): every translate result carries a
verify block — `{ attempted, ran, interpreter, exit }`, plus `stderr`
when `ran` is false (the interpreter's output, verbatim) or `reason`
when `attempted` is false. Only the Python leg is executed: the
emitted code is run under `python3` (10 s cap, probe cached,
`IROH_PYTHON` overrides the interpreter), and `ran` is true only
when it exited 0. `ran: null` means not attempted — never read it as
success. The other legs record `attempted: false` with a reason
(`verify is only implemented for the Python leg`). Pass
`options.verify: false` to opt out (the block then records
`attempted: false`, reason `verify disabled by option`). A program
error in the emitted code surfaces as `ran: false` with the
interpreter's stderr — for example a JavaScript `%` on a negative
number translates to Python `%`, which raises `ZeroDivisionError`
on `10 % 0` where JavaScript returns `NaN`: a real semantic gap
between the languages, surfaced by the verify block, not hidden.

``compileIrohscript(source, options)``: The IrohScript compiler
backend (1.0.1 rework, part 3). Compiles IrohScript source to a
JavaScript module string — clean, runnable ES2015, or a clear error
naming the construct it cannot compile. Unlike `translate()`, there
is no report and no stub: the legacy bare LOOP (no exit rule; the
thrown error points at the conditional form), ACTION, INTENT, the
legacy Conditional form, and IMPORT all throw. The conditional LOOP
<Bool-expr> (Amendment A1) lowers to a JavaScript `while` since
Amendment A2 (2026-11-21), keeping the test-first semantics. Structs
become factory
functions (`export function Features() { return { calls: 0, ... }; }`),
enums become string-valued objects, top-level functions are exported.
Division/modulo are Python-style, the bootstrap's semantics: DIV
emits plain `/` (float division, the same as Python's) and MOD emits
a floored `__iroh_pymod` helper. `options.irohscriptHome` names the
directory holding the `irohscript` package. `compileIrohscriptAsync(source, options)` is the async version (dynamic import of
`child_process`, works in ESM Node). The first core component
compiled this way is the perceptron's scoring core
(`irohscript/core/perceptron.iroh` -> `src/neurons-irohscript.js`,
regenerated with `npm run codegen:irohscript`); the checked-in
generated file is verified against a fresh compile by the test suite,
so it cannot drift from its source. In a browser, both entries throw
a clear error (no python3 there).

``eventToJSON(event, trigger)``: Turns a live RuntimeEvent into the plain
object `trace()` returns. The CLI uses this too, so its JSON lines and
`trace()` events are the same shape.

``safeValue(value, depth, seen)``: Serializes a runtime value safely —
depth-capped, circular references marked `"[Circular]"`, functions as
`"[Function name]"`, promises as `"[Promise]"`.

``INSTR`` / ``CATEGORY`` / ``OP``: The label tables — instruction numbers,
category numbers and operator numbers, keyed by name. Exposed so consumers
can turn event type/category numbers back into names; the CLI
(`cli/iroh.js`) uses them to print `"event":"FUNCTION_CALL"` instead of a
raw number. `Iroh.CALL`, `Iroh.IF`, etc. are the category numbers
themselves (see [Listener Specification](#specification)).

#### Using Iroh from Python, C++, IrohScript and BASIC:

The `iroh` CLI (`cli/iroh.js`) streams trace events as JSON lines, so
other languages can consume Iroh without speaking JavaScript — and since
0.9.0 Python and C++ programs trace NATIVELY through the same CLI, with
the same event shape and the same `analyze()` findings, joined in the
1.0.1 rework by IrohScript and BASIC:
`node cli/iroh.js program.py` (or `--lang python`) runs the Python tracer
(`sys.settrace` + AST instrumentation, `python/iroh/trace.py`, stdlib
only); `node cli/iroh.js program.cpp` (or `--lang cpp`) compiles the
program with `-finstrument-functions` and runs it against the runtime in
`cpp/iroh_trace_rt.cpp` (function-level only — see the 0.9.0 CHANGELOG
entry for the honest limits). `node cli/iroh.js program.iroh` (or
`--lang irohscript`) runs the IrohScript tracer (IRX interpreter hooks,
`irohscript/src/trace.py`, stdlib only); `node cli/iroh.js program.bas`
(or `--lang basic`) runs the BASIC tracer (a small dedicated interpreter,
`irohscript/src/basic_trace.py`, stdlib only) — see the 1.0.1-rework
CHANGELOG entry for what each sees and what it honestly cannot.
`--analyze`, `--scan` and `--live` work for all five languages. Two
more CLI commands (1.1.1): `iroh capabilities` prints one row per
language leg (available, or unavailable with why) and per syntax
feature (available, or unavailable with the Node version that has
it); `iroh capabilities --json` prints the same as one JSON line
(`{type:"capabilities", node, legs, features}`). `iroh doctor`
prints the last recorded test run (from
`test-results/suite-summary.json`, written by `npm test`), the live
toolchain versions, the dist hash, and the capabilities — it does not
run the suite itself. Two more flags (1.1.1): `--max-events N` caps
the recorded events (JavaScript legs only — a runaway stops with an
error line carrying the partial events; a program that catches every
thrown value can defeat the stop), and `--verify` traces a JavaScript
program twice and diffs the events and result as JSON, printing
`{"type":"verify","ok":true,"events":N}` and exiting 1 on
disagreement (JavaScript only; it does not combine with `--translate`,
`--direct`, or `--synthesize`). Thin clients live in `python/` (stdlib only:
`run(code, events=None)` → `(events, result)`,
`trace_python(code)` / `trace_python_file(path)`,
`scan(code)` / `scan_python(code)` / `scan_python_file(path)`) and
`cpp/` (header-only C++17: `iroh::Client::run(code, events)` →
`iroh::Trace`, plus `iroh::native::Tracer::trace_code(code)` /
`trace_file(path)` for tracing C++ itself, no Node needed). Both find the
CLI in the checkout or via `IROH_CLI`. See the README and each client's
own README for the full API.

#### CLI flags

Every flag in `iroh --help` (run `iroh --help` to see the usage
text; CI checks that each flag below appears in `txt/API.txt`,
the generated text form of this file). Flags take a value with
`=` or a space (`--events CALL,IF` or `--events=CALL,IF`).

- `--events ALL|CALL,IF,...` — event categories to stream
  (default `ALL`). A comma list, e.g. `--events CALL,IF`.
- `--no-result` — skip the result line.
- `--module` — trace as an ES module (JavaScript only;
  `.mjs` files imply it).
- `--analyze` — append an analysis line after the result line.
- `--scan` — print ONE scan line
  `{ vectors, findings, scores, summary }` instead of the event
  flood.
- `--include-events` — embed the raw events in the scan document.
  Needs `--scan`.
- `--live` — stream `live-finding` lines as findings trip, then a
  final `live-summary` line. For Python/C++ the live lines print
  after the run (the native tracers buffer their events).
- `--direct[=throttle|stop]` — run under the runaway-loop guard
  (JavaScript only; throttle by default, `--direct=stop` stops).
  Combines with `--analyze`, `--scan`, `--live`. Always traces
  ALL categories.
- `--synthesize --entry <fn> [--seeds '[[5]]'] [--max-runs 50]` —
  generate inputs driving each branch of the named entry function
  (JavaScript only). `--seeds` is a JSON array of argument arrays;
  `--max-runs` is the run budget (default 50, seeds included).
- `--max-events N` — cap the recorded events (JavaScript legs
  only). The run stops with a clear error and the partial events
  attached once N events have fired.
- `--verify` — trace the program twice (JavaScript legs only) and
  diff the events and the result, printing a verify line
  `{ok, events, firstDiff}`; exit 1 when the two runs disagree.
  Does not combine with `--translate`, `--direct`, `--synthesize`.
- `--translate python|cpp|irohscript|basic|javascript` — translate
  instead of tracing; prints one translation line. Cannot be
  combined with `--live`, `--scan`, `--analyze`, `--direct`.
  Exit 1 when anything was unsupported.
- `--from python|cpp|irohscript|basic|javascript` — source
  language for `--translate` (default: by file extension —
  `.py` → python, `.cpp/.cc/.cxx` → cpp, `.iroh` → irohscript,
  `.bas` → basic).
- `--lang python|cpp|javascript|irohscript|basic` — force the
  tracer (default: inferred from the file extension).
- `--file <path>` — the program file (same as the positional
  argument).
- `capabilities [--json]` — one row per language leg and per
  syntax feature (available, or unavailable with why).
  `--json` prints the same as one JSON line.
- `doctor` — the last recorded test run, the live toolchain
  versions, the dist hash, and the capabilities. Does not run
  the suite itself — run `npm test` first.
- `--version` — one line: version, dist hash, embedded runtime
  (`iroh 1.1.1 (engine dist iroh-node.js 462e7462c4f3, runtime
  node v18.5.0)` inside a packaged binary).
- `serve [--port 8471] [--host 0.0.0.0] [--token T]
  [--timeout-ms 120000] [--local-legs javascript,...]` — start
  the local server (see `SERVER.md`): serves `/trace`, `/analyze`,
  `/scan`, `/translate`, `/capabilities`, `/health` as JSON over
  the local network (default port 8471, all interfaces). Runs the
  legs this box can run, delegates the rest to connected nodes.
  `--local-legs` restricts which legs run locally (the phone
  passes `javascript`); `--timeout-ms` caps how long a request
  waits for a delegated job (default 120000 ms).
- `node --server <host:port> [--token T]` — connect this machine
  to a server as a worker: registers the legs this box can run,
  long-polls for jobs, runs each leg with the local CLI, posts
  the result back. Reconnects with backoff when the server drops;
  stops cleanly on SIGINT/SIGTERM.
- `-h` / `--help` — usage.

Conflicting combinations are usage errors (exit 2, checked
before the file is read): `--translate` with `--live` / `--scan` /
`--analyze` / `--direct`; `--direct` with a non-ALL `--events`;
`--include-events` without `--scan`; `--synthesize` with
`--module` / `--direct` / `--events`.

#### Iroh.Stage:

``key``: The stage's unique key.

``input``: The original submitted code.

``script``: The patched version of the submitted code.

``nodes``: An object which contains references to all AST nodes in the code, indexed by their relative ``hash`` code.

``symbols``: An object which contains references to all functions, indexed by the given function's name.

``addListener``: Takes an numeric listener type as it's first parameter and returns an ``RuntimeListener`` object.

``getFunctionNodeByName``: Returns the raw AST node related to the passed in function name.

#### Iroh.Stage.RuntimeListener:

Each ``RuntimeListener`` event has an ``RuntimeEvent`` argument which contains various event specific properties.

Example:
````js
let listener = stage.addListener(Iroh.ALLOC);
listener.on("fire", (e) => console.log(e.value));
````
``Iroh.ALLOC`` has only one event called ``fire``. This means the listener just fires as soon as the related code get's executed. In this case ``fire`` triggers when an object or array gets created. The event's property ``value`` contains a reference to the allocated object. Since ``fire`` gets triggered before the actual code gets executed, we can even modify the passed in data!

All listener events provide you the following fixed options:

##### Properties:

All ``RuntimeEvents`` come with the following fixed properties:

``hash``: Unique numeric hash which is also a link to the original AST node. The hash is only used once for the specific code location.

``indent``: Numeric indentation level which can be used to model the code's flow. Increases when entering a branch (e.g. ``Iroh.IF.enter``) and decreases after leaving a branch (e.g. ``Iroh.IF.leave``).

##### Methods:

All ``RuntimeEvents`` come with the following fixed methods:

``getASTNode``: Returns the original AST node

``getPosition``: Returns an object with the original source position (``start``, ``end``)

``getLocation``: Returns an object with the original source location, which is better formated than ``getPosition``. The object contains: (``start.line``, ``start.column``), (``end.line``, ``end.column``).

``getSource``: Returns the original (non-patched) relative source code

### RuntimeEvent

This list gives you an overview, which events a listener supports and which properties come along with it.

**``Iroh.IF``**:
 * ``test``
    * ``hash``: Unique hash
    * ``value``: The if's condition value
    * ``indent``: Indent level
 * ``enter``
    * ``hash``: Unique hash
    * ``value``: The if's condition value
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level

**``Iroh.ELSE``**:
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level

**``Iroh.LOOP``**:
 * ``test``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``value``: The loop's condition value
    * ``kind``: Indicates the loop kind e.g. ``WhileStatement``
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``kind``: Indicates the loop kind e.g. ``DoWhileStatement``
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``kind``: Indicates the loop kind e.g. ``ForStatement``

**``Iroh.BREAK``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``value``: Do break or not
    * ``indent``: Indent level

**``Iroh.CONTINUE``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``value``: Do continue or not
    * ``indent``: Indent level

**``Iroh.SWITCH``**:
 * ``test``
    * ``hash``: Unique hash
    * ``value``: The switch's tested value
    * ``indent``: Indent level
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level

**``Iroh.CASE``**:
 * ``test``
    * ``hash``: Unique hash
    * ``value``: The case's tested value
    * ``indent``: Indent level
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``default``: Default case or not
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``default``: Default case or not

**``Iroh.CALL``**:
 * ``before``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``arguments``: The call's arguments
    * ``context``: The context the call is performed in
    * ``object``: The call's object
    * ``call``: Called function if object is null
    * ``callee``: String version of the called function name
    * ``external``: E.g. ``Array.map`` and ``eval`` are external calls
 * ``after``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``arguments``: The call's arguments
    * ``return``: The returned value after the call is performed
    * ``context``: The context the call is performed in
    * ``object``: The call's object
    * ``call``: Called function if object is null
    * ``callee``: String version of the called function name
    * ``external``: E.g. ``Array.map`` and ``eval`` are external calls

**``Iroh.AWAIT``** (new in 0.4.0):
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``value``: The value being awaited

**``Iroh.FUNCTION``**:
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``scope``: The function's inner scope
    * ``sloppy``: Got called from outside
    * ``arguments``: The function's arguments
    * ``name``: The function's name
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``sloppy``: Got called from outside
    * ``name``: The function's name
 * ``return``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``sloppy``: Got called from outside
    * ``return``: The return statement's value
    * ``name``: The function's name

**``Iroh.VAR``**:
 * ``before``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``name``: The variable's name
 * ``after``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``name``: The variable's name
    * ``value``: The variable's value

**``Iroh.NEW``**:
 * ``before``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``ctor``: The passed constructor
    * ``name``: Auto-generated constructor name
    * ``arguments``: The passed constructor arguments
 * ``after``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``return``: The new's returned value

**``Iroh.TRY``**:
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level

**``Iroh.CATCH``**:
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level

**``Iroh.FINALLY``**:
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level

**``Iroh.ALLOC``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``value``: The passed value (``object`` or ``array``)

**``Iroh.MEMBER``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``object``: The member expression's object
    * ``property``: The member expression's property

**``Iroh.THIS``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``context``: The context

**``Iroh.LITERAL``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``value``: The literal's value

**``Iroh.ASSIGN``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``op``: The used operator
    * ``object``: The left value
    * ``property``: The right value, ``null`` if ``object`` is an identifier
    * ``value``: The value to assign with

**``Iroh.TERNARY``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``test``: The tested condition
    * ``truthy``: The truth trigger
    * ``falsy``: The falsy trigger
    * ``result``: The returned value

**``Iroh.LOGICAL``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``op``: The used operator
    * ``left``: The left value
    * ``right``: The right value
    * ``result``: The result

**``Iroh.BINARY``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``op``: The used operator
    * ``left``: The left value
    * ``right``: The right value
    * ``result``: The result

**``Iroh.UNARY``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``op``: The used operator
    * ``value``: The unary's value
    * ``result``: The result

**``Iroh.UPDATE``**:
 * ``fire``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``op``: The used operator
    * ``prefix``: Prefix or postfix indicator
    * ``result``: The result

**``Iroh.PROGRAM``**:
 * ``enter``
    * ``hash``: Unique hash
    * ``indent``: Indent level
 * ``leave``
    * ``hash``: Unique hash
    * ``indent``: Indent level
    * ``return``: The program's returned frame value


### Specification:

Iroh provides the following listeners types, which can be used to listen for specific code types.

````js
Iroh.IF
  if () {}
  else if () {}
Iroh.ELSE
  else {}
Iroh.LOOP
  while () {}
  do {} while ()
  for () {}
  for (a in b) {}
  for (a of b) {}
Iroh.BREAK
  break
Iroh.CONTINUE
  continue
Iroh.SWITCH
  switch () {}
Iroh.CASE
  case :
  default :
Iroh.CALL
  object()
Iroh.FUNCTION
  function() {}
Iroh.VAR
  let
  var
  const
Iroh.OP_NEW
  new object()
Iroh.TRY
  try {}
Iroh.CATCH
  catch(e) {}
Iroh.FINALLY
  finally() {}
Iroh.ALLOC
  {},
  []
Iroh.MEMBER
  a.b
  a[b]
Iroh.AWAIT
  await x
Iroh.THIS
  this
Iroh.LITERAL
  ""
  1
  true
  ..
Iroh.ASSIGN
  a = 2
  a += 2
  ..
Iroh.TERNARY
  true ? 1 : 0
Iroh.LOGICAL
  &&,
  ||
Iroh.BINARY
  +,
  -,
  *
  ..
Iroh.UNARY
  +0,
  -0,
  !true
  typeof a
  ..
Iroh.UPDATE
  ++object
  --object
  object++
  object--
  ..
Iroh.PROGRAM
  Code enter,
  Code exit
````

#### FOR AI

Machine-readable facts. Load this section without guessing. If a
fact here disagrees with a prose paragraph above, this section wins
— and the disagreement is a bug; file it. The generated text form
of this file is `txt/API.txt` in the AI bundle; CI checks that
every flag in `iroh --help` appears in it.

- Engine: IrohRedux 1.1.1 (patched in place, 20 Nov 2026). No
  1.1.2. No version bump. `dist/iroh-node.js` SHA-256:
  `462e7462c4f32f53a3e5964792ef26746c71224dadbfe591675dc12ccb0d6e31`.
- Ask for JSON. Never parse console prose; it is for humans and
  will change. Event streams are JSON lines, one object per line,
  with the `language` field always set. A CLI trace's stdout is
  exactly those JSON lines on every leg: the traced program's own
  prints (`console.log` / `print` / `std::cout`) are rerouted to
  stderr while it runs, so one JSON parse per line never trips on
  program output.
- Event line:
  `{"type":"event","event":"FUNCTION_CALL","category":"CALL",
  "trigger":"before","language":"javascript","hash":11,"indent":1,"name":"factorial",
  "arguments":[3],"external":false}`, followed by a result line
  `{"type":"result","value":6}` or an error line
  `{"type":"error","name":...,"message":...}`.
- `--scan` result: `{vectors, findings, scores, summary}`.
  `vectors` carries `features {calls, depth, repeat, imbalance,
  mix, coverage, events}`, `vector[6]`, `names[6]`. `findings` is
  a list of `{code, severity, message, evidence, neuron}`.
  `summary` carries `{events, unclosedFrames, findings, warnings,
  language, infos, neuron {label, score}, maxCallDepth,
  distinctRegions, findingsTruncated}`.
- `--translate` result (one line):
  `{type:"translation", from, to, code, report}`. `report`
  carries `{ok, from, to, staticOnly, clean, assumptions,
  unsupported, notes, verify}`.
- Translate `verify` block: `{attempted, ran, interpreter,
  exit}` plus `stderr` when `ran` is false (the interpreter's
  output, verbatim) or `reason` when `attempted` is false.
  `ran: null` means not attempted — never read it as success.
  Only the Python leg is executed (under `python3`, 10 s cap);
  other legs record `attempted: false` with a reason.
- `--live` lines: `live-finding` (with `firedAt`) as findings
  trip, then `live-summary` (batch-equal findings, scores,
  vectors). `--direct` lines: `directive` as the guard acts, then
  `direct-summary` (findings, directive audit log, analysis).
  `--synthesize` lines: `synth-run` per input tried, then
  `synth-summary` (coverage, every uncovered branch with its
  reason).
- Reachable categories (coverage denominators). Coverage is fired
  / reachable per tracer. Use `reachable` when present. Missing
  `reachable` is not 30 and not zero. If you cannot find it,
  report the score as unnormalised. An unknown language falls back
  to all 30 (the JavaScript default).
  - javascript: 30 (all categories).
  - python: 6 (ASSIGN, CATCH, CALL, FUNCTION, IF, LOOP).
  - cpp: 2 (CALL, FUNCTION).
  - irohscript: 4 (ASSIGN, CALL, FUNCTION, IF).
  - basic: 5 (ASSIGN, CALL, FUNCTION, IF, LOOP).
- Findings cap: findings are capped at 200.
  `summary.findingsTruncated` is the dropped count. If
  `findingsTruncated > 0`, the finding list is a prefix, not the
  whole set — say so when you report it. Any score derived from
  the list is a score over a prefix.
- Memory model: a finished trace releases its Stage
  (`Stage.release` / `releaseTraceRun`); a 500,013-event trace
  leaves a 472,976-byte residual heap.
  `summary.unclosedFrames` is `{count, frames, note}` when a
  generator frame is still open at the end of a trace, else null.
  Full model: `docs/memory.md` in the repo, `txt/memory.md` in
  the AI bundle.
- Server / node: `iroh serve` (default port 8471, local network
  only) serves `/trace`, `/analyze`, `/scan`, `/translate`,
  `/capabilities`, `/health` as JSON. Every result is the engine's
  own shape plus `ranOn` ("local" or the node id). A leg nobody
  can run is HTTP 503, never a faked result. Full protocol:
  `SERVER.md`.
- Works offline — no network required. No artifact phones home,
  checks for updates, or downloads at first run.
