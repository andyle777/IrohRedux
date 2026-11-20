### API

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
categories fired vs total, as `fired` / `total` with `value` =
fired/total), `fidelity` (regions observed vs total, with known blind
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

``toVector(events)`` / ``cosineSimilarity(a, b)`` / ``euclideanDistance(a, b)`` /
``compareVectors(a, b)``: Vector refracting (0.9.0) — deterministic
feature vectors, not LLM embeddings: no model, no vector DB, no new
dependencies. `toVector()` returns `{ features, vector, names }` — the
five neuron features (call count, max call depth, repeat rate, branch
imbalance, event-type mix) plus `coverage` (categories fired / total),
all normalized to [0, 1], with named features, the ordered numeric
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
(1.0.0) — run `code` under trace with `director` (a function, or
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

``runawayGuard(options)``: The built-in director (1.0.0) — a factory
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

``translate(code, options)``: Hybrid translation engine (0.8.0). Returns
`{ code, report }` where `report` is `{ ok, from, to, staticOnly, clean,
assumptions, unsupported, notes }`. JavaScript out (`to: "python" |
"cpp"`) is hybrid: the AST (static) plus trace evidence (dynamic — the
program is run through the tracer first, and the events resolve what
static analysis cannot: runtime types, values, which branches fired).
The reverse legs (`from: "python" | "cpp"`, `to: "javascript"`) are
static-only by design (`staticOnly: true`) — they translate from source
alone. Native Python and C++ tracers exist since 0.9.0, but the
translation legs do not use them. Python is parsed with Python's own `ast`
module (a small stdlib-only helper run through `python3`, which emits
the AST as JSON); C++ is parsed by a scoped subset parser in the
library. v1 scope, both directions: functions, arithmetic, loops,
conditionals, arrays (Python lists / C++ vectors), strings, console
output (`console.log` / `print` / `std::cout`). No classes, no
closures-as-objects, no async. Unsupported constructs are reported in
`report.unsupported` and the emitted code raises/throws at that point,
loudly — never silently mistranslated. Assumptions cite their trace
evidence (e.g. `FUNCTION_CALL 'add' arguments [2,3]` for a C++
parameter type). `options.types` supplies C++ types the trace could not
(`{ functions: { add: { params: ["int", "int"], returns: "int" } } }`).
The JS-out leg runs the program through the tracer for evidence, and
its `console.log` output is silenced while it runs, so `translate()` has
no visible side effects. But the evidence trace really runs the program,
so any other side effects (file writes, network calls, non-terminating
loops) happen for real — `translate()` does not sandbox it. `translateAsync(code, options)` is the async
version — in the ESM build the Python leg loads `child_process` by
dynamic import (the sync version needs the CJS build's `require` for
that leg); in a browser, the Python leg throws a clear error and the
C++ leg works.

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

#### Using Iroh from Python and C++:

The `iroh` CLI (`cli/iroh.js`) streams trace events as JSON lines, so
other languages can consume Iroh without speaking JavaScript — and since
0.9.0 Python and C++ programs trace NATIVELY through the same CLI, with
the same event shape and the same `analyze()` findings:
`node cli/iroh.js program.py` (or `--lang python`) runs the Python tracer
(`sys.settrace` + AST instrumentation, `python/iroh/trace.py`, stdlib
only); `node cli/iroh.js program.cpp` (or `--lang cpp`) compiles the
program with `-finstrument-functions` and runs it against the runtime in
`cpp/iroh_trace_rt.cpp` (function-level only — see the 0.9.0 CHANGELOG
entry for the honest limits). `--analyze` and `--scan` work for all three
languages. Thin clients live in `python/` (stdlib only:
`run(code, events=None)` → `(events, result)`,
`trace_python(code)` / `trace_python_file(path)`,
`scan(code)` / `scan_python(code)` / `scan_python_file(path)`) and
`cpp/` (header-only C++17: `iroh::Client::run(code, events)` →
`iroh::Trace`, plus `iroh::native::Tracer::trace_code(code)` /
`trace_file(path)` for tracing C++ itself, no Node needed). Both find the
CLI in the checkout or via `IROH_CLI`. See the README and each client's
own README for the full API.

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
