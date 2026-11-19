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

``translate(code, options)``: Hybrid translation engine (0.8.0). Returns
`{ code, report }` where `report` is `{ ok, from, to, staticOnly, clean,
assumptions, unsupported, notes }`. JavaScript out (`to: "python" |
"cpp"`) is hybrid: the AST (static) plus trace evidence (dynamic — the
program is run through the tracer first, and the events resolve what
static analysis cannot: runtime types, values, which branches fired).
The reverse legs (`from: "python" | "cpp"`, `to: "javascript"`) are
static-only — there is no tracer for Python or C++, and the report says
so (`staticOnly: true`). Python is parsed with Python's own `ast`
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
no visible side effects. `translateAsync(code, options)` is the async
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

The engine traces JavaScript only, but the `iroh` CLI (`cli/iroh.js`)
streams trace events as JSON lines, so other languages can consume Iroh
without speaking JavaScript. Thin clients live in `python/` (stdlib only:
`run(code, events=None)` → `(events, result)`) and `cpp/` (header-only
C++17: `iroh::Client::run(code, events)` → `iroh::Trace`). Both find the
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
