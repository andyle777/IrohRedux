# Changelog

## 1.0.1 — All-generations audit-and-patch pass (20 Nov 2026)

Every known limitation from 0.4.0 through 1.0.0, re-read and re-probed.
The ones that were real, fixable bugs are fixed here; the ones that
were out of scope or genuinely infeasible are named below with the
evidence for leaving them. All 295 prior tests still pass; the suite
is now 348 tests (314 Node + 25 Python + 9 C++).

### Translation — `%`, number formatting, string concat, type conflicts (`src/translate.js`)

- `%` is JS `%` now, in every leg. JS → Python emits a
  `__iroh_jsmod(a, b)` helper (`a - int(a / b) * b`, ints stay int,
  floats stay float); JS → C++ emits `std::fmod` when either operand
  is a double (plain `%` for ints); Python → JS emits the floored form
  `((l % r) + r) % r` and the old `noteOnce("mod", ...)` warning is
  gone — the warning was a confession, not a fix. Probed: `-5 % 3`
  gives -2 (JS) / 1 (Python semantics, floored), `5 % -3` gives -1
  (JS) / -1 (floored, same), `-5.5 % 2` gives -1.5 (JS) / 0.5
  (floored).
- Numbers print like JS numbers now. `__iroh_jsnum(double)` in C++
  and `__iroh_jsnum(v)` in Python implement ECMAScript
  Number::toString placement rules over the shortest round-trip
  digits: 1e16 prints "10000000000000000" (Python's repr used to
  switch to exponential at 1e16, JS waits until 1e21), 1e21 prints
  "1e+21", 1e-7 prints "1e-7", 0.000001 prints "0.000001",
  0.1 + 0.2 prints "0.30000000000000004". Routed at string concat,
  template literal interpolation, `String()`, and console/print
  double args. Two bugs found by probes and fixed on the way: the
  `%e` digit-extraction loop ran when there was no `.` in the string
  (precision 0 gives "1e-07", `find('.')` is npos, `dot + 1` wrapped
  to 0 — `1e-7` printed as "1.1e-7"); and C++ `String(true)` printed
  "1" (`std::to_string(true)`), now "true".
- String `+` concat with a double or a bool works in both legs.
  Python `+` was silently broken before this: `"x" + 1.5` emitted
  `print("x" + 1.5)`, which raises TypeError at runtime with zero
  unsupported entries — a silent mistranslation, fixed by the
  `pyStringOf` routing. C++ `"b" + true` failed to compile before
  this: `cppStringOf` returned the raw `"b"` literal (const char*)
  and the bool ternary (const char*), giving pointer arithmetic.
  Fixed: `cppStringOf` wraps string literals and bool ternaries in
  `std::string(...)`. A 16-line cross-language probe (%, concat,
  `String`, template literals, 1e16/1e-7/1e21/0.000001, 0.1+0.2)
  matches JS output byte-for-byte in both C++ and Python.
- C++ type conflicts are refused, not silently built on the first
  call. `buildTraceEnv` now collects ALL calls and ALL return values
  per function; `cppSignature` refuses with a clear message when a
  parameter or return type differs across calls (hints fill gaps but
  never override trace evidence — the refusal message says so). The
  assumption messages now read "(verified consistent across N calls)"
  and "(verified consistent across N returns)". Probed: `f(1);
  f("a")` refuses with the conflict message; same-type calls pass
  with the "verified consistent across 2 calls" assumption; a return
  conflict across two calls refuses.
- `inferType` returned "int" for any integer-valued numeric literal,
  so `String(1e21)` emitted `std::to_string(1e+21)` (full digits,
  not "1e+21") — found by the new tests. Only a safe integer is
  "int" now (`Number.isSafeInteger(node.value) ? "int" : "double"`).

### Director — member set, scope-aware set, directAsync/directModule, onFinding (`src/direct.js`, `src/setup.js`)

- A `set` directive with a dotted name (`"obj.prop"`, one level)
  applies at member assignments (`=` and compound `+=` etc.) by
  overwriting `raw.object[raw.property] = d.value` after the write,
  with `appliedVia: "member"`; the recorded line is updated too.
  Probed: `o.a = 7` set to 42 → result 42, event line shows
  `result: 42, object: {a: 42}`; `o.a += 5` set to 99 → 99.
  Caveat: a setter property runs twice (once for the original write,
  once for the overwrite). Deeper than one level (`o.a.b`) is refused
  by `validateDirective`.
- A `set` directive may carry `scope`: a function name to set only
  that function's variable, `null` for the top level only, omitted
  for any scope (the 1.0.0 behaviour). Matching uses
  `stage.currentScope`. Probed: scoped set on inner `i` → inner()
  returns 77; unscoped set hits top-level `i` first (inner returns
  1); `scope: null` → top-level `i` = 55; wrong scope → applied
  false.
- `directAsync(code, director, options)` — like `direct()`, but
  asynchronous: top-level await works there. `directModule(code,
  director, options)` — like `direct()`, but for modules: import/
  export and top-level await work, result is the live module
  namespace. Both share `direct()`'s setup and completion handling
  (`directInternal`, mode `"sync" | "async" | "module"`); parse
  errors and module code reject (never throw synchronously). The
  Node-only temp-file/import machinery moved from `src/setup.js`
  into a shared `importTracedModule(iroh, run, options)`;
  `traceModule` is a thin wrapper over it now, and the error message
  generalized from "Iroh.traceModule() requires Node.js" to
  "Modules require Node.js" (no test or doc asserted the old
  wording). Probed: guard throttles a module loop (4950, loop-test);
  skip + TLA in a module → "skipped", appliedVia "call"; plain
  module works; `traceModule` still works after the extraction.
- New `onFinding(findings)` option on `direct()`/`directAsync()`/
  `directModule()`: called with the enriched fired findings (which
  carry `firedAt`) after the director is consulted — for a caller
  that wants to print live findings without being the director.
- `index.d.ts` updated for the new API: `scope` on set directives,
  `"member"` in `appliedVia`, `onFinding`, and the
  `directAsync`/`directModule` declarations (the `direct()` doc's
  "rejected with the trace() pointers" is now "with the direct()
  pointers").

### CLI — mode validation before the file read, `--direct` for modules and TLA (`cli/iroh.js`)

- Mode-combination validation moved BEFORE the file read (after
  language validation): `--translate` + `--live`/`--scan`/`--analyze`/
  `--direct` → usage error exit 2; `--direct` + `--events` (non-ALL)
  → exit 2; `--include-events` without `--scan` → exit 2. Before
  this, `--direct --module` and `--direct --translate python` on a
  missing file gave a file-read error (exit 1) before any mode
  validation. `--translate` + `--events`/`--module` remains
  documented precedence (not rejected).
- `--direct` now uses `Iroh.directAsync()` for scripts (top-level
  await works) and `Iroh.directModule()` for modules (`.mjs` or
  `--module`); the old `--direct cannot run modules` rejection is
  gone. `--direct` + `--analyze`/`--scan` honoured (analysis line /
  scan line after the direct-summary, built from `out.events`);
  `--live` honoured via the new `onFinding` hook (live-finding lines
  as findings trip; no separate live-summary in direct mode — the
  direct-summary already carries the live finish). Before this,
  `--direct --analyze/--scan/--live` all ran direct mode and printed
  only the direct-summary, silently ignoring the other flags.
  Probed: `--direct --analyze --scan --live` on a 10,000-iteration
  runaway → 513 event lines + 1 directive + 1 live-finding
  (HOT_LOOP) + 1 direct-summary + 1 analysis + 1 scan.

### Decorators — computed keys, eval order, accessor fields (`src/decorators-plugin.js`, `src/decorators.js`)

- Decorated computed keys parsed and ran — before this they failed
  at parse time (`@dec [key()]()`, `@dec ["m"]()`, `@dec [k()] = 5`
  all failed with "Unexpected token"), because `parseExprSubscripts`
  greedily consumed the `[` as a member access on the decorator. No
  test covered computed keys; the 0.7.0 CHANGELOG claim "computed
  keys evaluate twice" was written from reading the desugar, never
  tested — the real bug was worse. Fix: `parseDecoratorExpression()`
  with a subscript loop that breaks (leaving the `[` for the element
  parser) when a throwaway-probe token scan says the bracket starts
  a computed element name (the token after the matching `]` is `(`
  or `=` or `;` or `}` or `@`). `?.[` is deliberately not
  intercepted (pathological case; greedy parse errors clearly).
- The key now evaluates exactly once. The element's key becomes a
  SequenceExpression evaluated in phase 1, in definition order:
  `(keyTemp = <origKey>, decTemp1 = <dec1>, ..., keyTemp)` for
  computed keys, `(keyTemp = lit(name), decTemp1 = <dec1>, ...,
  keyTemp)` for plain keys — so the context `name`, method target
  and field applies all read the temp and nothing re-evaluates. (An
  earlier attempt used a static-block prologue; V8 probing proved
  computed keys evaluate BEFORE all static blocks, so the prologue
  ran after the key was read and installed the method under
  `undefined`.) Probed: `key()` runs exactly once, method installed
  under the right key (`m()` returns 42); computed field key once,
  value 7, context kind "field", name "f".
- Eval order is now the spec order: an instance field's apply runs
  in a static block spliced before the element (phase 2, in
  definition order, interleaved with static field initializers),
  instead of as a statement after the class (which ran static field
  decorators first regardless of definition order). Probed:
  `["eval:inst","eval:stat","apply:inst","apply:stat"]` and the
  reverse, both in order. Class decorator expressions are hoisted
  into temps in a trailing static block (documented `this` caveat: a
  class decorator expression reading `this` sees the class inside a
  static block, where the proposal gives it the enclosing `this`).
- Accessor fields land. The plugin detects the contextual `accessor`
  keyword (only when a name follows, so `accessor()`, `accessor = 1`,
  `accessor;` remain a plain method/field named "accessor"). The
  desugar rewrites an accessor into a private storage field
  (`#Iroh$$acc_<name>`) plus a getter/setter pair; decorated
  accessors apply the decorators to the `{get, set}` pair one at a
  time (reverse order), merging get/set per decorator and composing
  any `{init}` returns. Probed: undecorated instance/static,
  decorated get/set replacement (kind "accessor", `c.x` → 100),
  `{init}` (3 → 30), two-decorator init order (d2's init first:
  3*2=6, then d1's +100 = 106), set-only return (get kept),
  computed decorated (key once, ctx "accessor:m"), `access.get`/
  `set`/`has`, static `{init}` (5 → 6) and static get/set (77).
  Decorated private accessors throw a clear error — loud, not
  silent. Remaining gap: method-vs-field apply order (method applies
  still run after the class, so a method's decorators apply after
  all field decorators regardless of definition order).

### Python tracer — per-assignment events (`python/iroh/trace.py`)

- `ASSIGN` events fire for simple Name targets: `x = ...`, `x +=
  ...` (op map for all 13 augmented operators), `x: int = ...`
  (only when a value is present). Tuple targets, attributes and
  subscripts are deliberately left uninstrumented (documented blind
  spot, like JS destructuring). The event carries the post-assignment
  value as `value`/`result` — unlike JS compound assignments, which
  carry the RHS — documented in the hook comment, not hidden. A
  failed assignment (`z = 1 / 0`) emits nothing, because the hook
  runs after the value is computed. Probed: `a = b = 5` → two events
  (a=5, b=5); `o['k'] = 9` → no event; `y: int` (annotation only)
  → no event; `w = 42` inside a function → event. One prior test
  changed: the live `--live` Python test's `firedAt` went from 100
  to 200 — the finding still fires at iteration 100, but each
  iteration now emits 2 events (LOOP_TEST + ASSIGN), so the event
  count at firing doubled; the test now says so.

### Left, with the evidence

- 0.9.0 no-timeout — left, by design. A timeout is a behaviour
  change, not a fix; the README/API/CHANGELOG all say a
  non-terminating program hangs exactly as running it directly
  would, and a caller that needs one should wrap the CLI run.
- 0.9.0 C++ function-level only — NOT attempted. Loop/branch
  instrumentation for C++ is a new engine (the subset parser
  translates C++ to JS; it does not rewrite C++ source with hooks),
  not a stretch goal. C++ stays function-level.
- 0.9.0 `.close()`d generators leaving an unclosed CALL — left.
  Probed: trace shows FUNCTION_CALL + FUNCTION_ENTER only, no
  CALL_END/LEAVE — `sys.settrace` fires no event at all for a close
  with no `finally` block, so the tracer cannot observe it. The
  depth is still correct, because the yield already dropped it.
- 1.0.0 identifier compound set (`x += 5`) — NOT fixable via the
  event. Probed: the event is ASSIGN `{op: "+=", result: 5, value:
  5, object: "x"}` — `result` is the RHS only, the event carries no
  current value of `x`, so a set cannot be computed from it. Member
  compound assignments ARE fixed (the event carries the object).
- 0.8.0 `translate()` evidence-trace side effects — inherent. The
  trace runs the program, so side effects happen and a
  non-terminating program never translates; documented in API.md,
  not "fixed".
- 0.4.0 limits — left: no `Iroh.CHAIN` listener; private-field and
  destructuring assignments produce no ASSIGN event; member
  logical-assignment RHS evaluated eagerly. None fell out of this
  pass; recorded, not attempted.

### Tests

- 53 new tests: 12 in `tests/decorators.test.js` (38 total),
  23 in `tests/translate.test.js` (91 total), 11 in
  `tests/direct.test.js` (31 total), 4 in `tests/cli.test.js`
  (13 total), 3 in `tests/native.test.js` (21 total). Two prior
  tests changed, both intentional behaviour changes, both noted
  above: the direct() module/TLA rejection tests now assert the
  direct() pointers (not the trace() pointers) and that `--direct
  --module` runs; the live Python test's `firedAt` 100 → 200 (new
  ASSIGN events per iteration). Full suite: 348 tests (314 Node +
  25 Python + 9 C++), all passing; types green; browser bundle
  smoke-tested (VERSION 1.0.1, `direct()` + guard work in a `vm`).

## 1.0.0 — AI director and live code engine (20 Nov 2026)

The original vision complete. The engine runs a program under trace
and changes it mid-flight; the director sits on the live wire, reads
findings as they fire, and calls the shots. Trace → analyze live →
direct → change → trace again, and the record makes the run auditable
instead of a black box. All 275 prior tests still pass; the suite is
now 295 tests (261 Node + 25 Python + 9 C++).

### The demo — a runaway loop, caught live

```js
const Iroh = require("iroh");
let out = Iroh.direct(
  "let i = 0; let total = 0; while (i < 10000) { total += i; i++; } total;",
  Iroh.runawayGuard()
);
// out.result === 4950 — the loop ran 100 iterations (0..99), then the
// director cut it. out.stopped === false.
// out.findings[0] === HOT_LOOP, evidence.iterations === 100.
// out.directives[0].directive === { type: "set", name: "i", value: 10000 },
// applied: true, appliedVia: "loop-test".
```

### Live code engine — `Iroh.direct(code, director, options)` (new `src/direct.js`)

- The director is called once before the run (findings `[]`, event
  `null`), then whenever new live findings fire, with
  `{ findings, allFindings, snapshot, event, eventIndex, directives }`.
  It returns a directive, an array of directives, or `null`. A
  `null` director (or one that returns `null`) leaves the run
  untouched — the record then has no directives, and the run is
  `trace()` with a direction audit.
- Three directives, each taking effect in the running program — not
  after it. The mechanism is the tracer's own: DEBUG functions return
  the event's value after triggering listeners, so a listener that
  mutates the event changes the program (verified by probes before
  building, then by tests):
  - `set` — `{ type: "set", name, value }` writes a variable at its
    next value-flow point: a declaration's initializer (`VAR_INIT`
    returns `event.value`), or a plain assignment (`x = v` is patched
    to `x = DEBUG_ASSIGN(...)`, which returns `event.result`). A loop
    counter advanced by `i++` has no assignment point, so a set for it
    applies at the next `LOOP_TEST` for a loop whose test compares
    that variable with a numeric literal: the comparison is evaluated
    with the set value, and the test is flipped to `false` only when
    the set value makes it false.
  - `skip` — `{ type: "skip", name, value }` replaces the callee with
    a stub on the next `FUNCTION_CALL` "before" event for that name:
    the real function never runs (no `FUNCTION_ENTER`, no side
    effects) and the call expression evaluates to the stub's return.
    A skip issued in response to the very call that tripped the
    finding applies to that call now — the call has not run yet.
  - `stop` — `{ type: "stop", reason }` throws a sentinel from the
    listener. A program inside `try`/`catch` may swallow one throw,
    so the engine re-throws the sentinel at every following event
    until it propagates out or the program ends; a stop is a normal
    outcome (the run returns with `stopped: true`), not an error.
- Ordering inside one event: pending directives apply first (so the
  live analyzer sees the directed value), then the event feeds the
  live analyzer, then the director is consulted on new findings. A
  directive issued in response applies at the NEXT matching point —
  except a skip for the current call. A set issued on a `HOT_LOOP`
  trip does NOT flip the trip test itself: that iteration's body still
  runs, so the iterations the analysis counts are exactly the bodies
  that ran, and the loop exits at the next test. When a directive
  applies, the JSON line is mutated alongside the raw event, so the
  recorded trace shows what the program actually ran with — a flipped
  loop test reads `false` in the events.
- The record: `{ result, stopped, stopReason, events, findings,
  directives, analysis }`. Every directive is an audit entry
  `{ directive, issuedAtEvent, applied, appliedAtEvent, appliedVia,
  note }` — a directive that never matches stays in the log with
  `applied: false` and a reason, never a pretence it took effect. The
  analysis is the live `finish()` summary, so live vs batch agreement
  holds by construction (the tests assert `direct()` findings
  deep-equal `analyze(events)` findings). A runtime error throws with
  the events so far as `error.events` (like `trace()`) and the
  direction record so far as `error.direct`. `options.onEvent` /
  `options.onDirective` callbacks fire as the run proceeds.

### AI director — `Iroh.runawayGuard(options)` (same file)

- The built-in director, a factory returning a director function so
  one guard instance directs one run. On `HOT_LOOP` it throttles by
  default: it sets the loop's counter to the value that makes its test
  false (resolved from the loop statement's AST — `i < 10000` → set
  `i` to `10000`; `i <= 9999` → `10000`; `i > 0` → `0`). With
  `{ action: "stop" }` it stops the run with a reason instead. A loop
  whose counter cannot be resolved — `while (true)`, a non-literal
  bound, a compound test, `==` / `===` — cannot be throttled, so the
  guard stops the run and says so.
- Proven: the demo above (throttle, `while`/`for`/counting-down/`<=`
  loops); stop mode; `while (true)` falling back to stop; a stop
  inside `try`/`catch` still ending the run; a custom director
  resetting a counter mid-run through the next assignment (total 20
  vs 45 undirected); a skipped call whose side effect never ran; a
  skip landing on the very call that tripped `REPEATED_SEQUENCE`.

### CLI — `--direct[=throttle|stop]`

- `node cli/iroh.js program.js --direct` runs the script under the
  guard: event lines stream as usual, `{"type":"directive",...}` lines
  print when directives take effect, then the result line and one
  final `{"type":"direct-summary",...}` with `stopped`/`stopReason`,
  the findings, the full directive audit log and the analysis. A
  directed stop exits 0; a runtime error is an error line and exit 1.
- JavaScript scripts only: Python/C++ traces are buffered after the
  run, so there is nothing live to direct, and modules have no
  direction hook (`--direct` with a `.py`/`.cpp` file or `--module`
  is a usage error, exit 2). A director supplied as a JS file is NOT
  in v1 — the CLI runs the built-in guard only.

### Known limitations (1.0.0 — updated in 1.0.1: the first two are fixed, the rest stand)

- ~~`direct()` runs scripts synchronously (like `trace()`) — top-level
  `await` and modules are rejected with the same pointers `trace()`
  gives. There is no `directAsync()` / `directModule()` in v1.~~
  Fixed in 1.0.1: `directAsync()` (top-level await) and
  `directModule()` (modules, Node.js only) exist; `direct()` rejects
  modules and TLA with the `direct()` pointers.
- ~~`set` applies at the next plain assignment or declaration of that
  variable, or at the next test of a loop comparing it with a numeric
  literal. Member assignments (`obj.prop = v`) are written inside
  `DEBUG_ASSIGN` before the event fires, and compound assignments
  (`x += v`) pass only the right-hand value through the event — neither
  is a set point, and a set never applies there. Matching is by name
  only, not by scope: a set for `"i"` applies to the first `i`
  assignment reached, in whichever scope that is.~~
  Fixed in 1.0.1, in part: member assignments (plain and compound)
  are set points now (`appliedVia: "member"`), and a set may carry
  `scope` (a function name, or `null` for the top level). Identifier
  compound assignments (`x += v`) are NOT fixed — the event carries
  only the RHS, no current value of `x`, so a set cannot be computed
  from it (probed in the 1.0.1 pass).
- A stop is delivered by throwing a sentinel from the next event. A
  program that swallows every thrown value defeats it only in the
  narrow case where no further event fires after the catch — in
  practice `PROGRAM_LEAVE` always fires and re-throws it, so a stop
  inside `try`/`catch` still ends the run (proven by a test). A call
  interrupted by a stop evaluates to `null` if the program catches the
  sentinel inside `DEBUG_FUNCTION_CALL`'s own handling.
- A `set` that would keep a loop test true (e.g. setting the counter
  back to 5 in an `i++` loop) cannot take effect at the loop test and
  stays pending until an assignment point — if none comes, it is
  recorded unapplied. The guard always sets the counter past its
  limit, so this does not affect throttling.
- Each directive applies once, at the first matching point, then it is
  consumed. A director that wants a standing rule (e.g. "always skip
  calls named X") must re-issue it on every finding, or issue it at
  the start call and accept that it applies to the first matching
  call only.
- On a stopped run, the stream-end findings (`ZERO_ITERATION_LOOP`,
  `ONE_SIDED_BRANCH`) describe the trace as it stands — a loop the run
  never reached counts as zero-iteration in the recorded trace.
- No timeout: a program that never terminates and never trips a
  finding hangs `direct()` and the CLI, exactly as running it
  directly would — the director only gets a say when a finding fires
  (or at the start call).

### Tests

- 20 new tests in `tests/direct.test.js`, wired into `tests/index.js`:
  the runaway demo as a test (throttle and stop mode, `while(true)`,
  `for`, counting-down and `<=` loops); set via assignment, via
  declaration, and unapplied; skip (side effect never runs) and skip
  on the tripping call; stop (custom director, and inside
  `try`/`catch`); a do-nothing director; a runtime error carrying the
  direction record; director bugs failing loudly; the callback hooks;
  module/TLA rejection; the CLI end to end (`--direct`,
  `--direct=stop`, and the three usage errors). Full suite: 295 tests
  (261 Node + 25 Python + 9 C++), all passing; types green; browser
  bundle smoke-tested (VERSION 1.0.0, `direct()` + guard work in a
  `vm`).

## 0.9.0 — native Python and C++ tracers, vector refracting, AI-friendly scan mode (20 Nov 2026)

IrohRedux stops being a JavaScript-only tracer. Python and C++ programs
now trace natively, through the same JSON event shape, so
`Iroh.analyze()` works unchanged across all three languages. And the
trace itself refracts into a deterministic feature vector, with a scan
mode that turns trace → analyze → vector into ONE compact JSON document
for AI consumers — no raw event flood unless asked for. All 206 prior
tests still pass; the suite is now 275 tests (241 Node + 25 Python + 9 C++),
after the hardening pass and the live wire mode below.

### Native Python tracer — `python/iroh/trace.py` (stdlib only)

- `sys.settrace` for calls and returns: every call of a function
  defined in the target file emits `FUNCTION_CALL` (trigger "before",
  with the call arguments) and `FUNCTION_ENTER` (trigger "enter", with
  the call depth as `indent`); every return emits `FUNCTION_CALL_END`
  (trigger "after", with the return value) and `FUNCTION_LEAVE`.
  Frames from other files (imports, the standard library) are not
  traced.
- AST instrumentation of the target file before it runs, so the
  analyzer's loop/branch/catch findings work: `while` and `for` tests
  are wrapped in a hook emitting `LOOP_TEST` (value true/false) and
  `LOOP_ENTER` on the first true test; `if` tests emit `IF_TEST`; the
  first statement of every `except` handler emits `CATCH_ENTER`.
  Hashes are CRC32 of kind:file:line — deterministic across runs.
- Proven end to end: a Python hot loop (150 iterations) traced then
  analyzed yields `HOT_LOOP` with `iterations: 150, tests: 151`; a
  caught exception yields `THROWING_PATH`; factorial(3) traces calls
  `[3], [2], [1], [0]` with returns `[1, 1, 2, 6]` and depth 0–3.
- The traced program's stdout is redirected to stderr while it runs,
  so the JSONL stream on stdout stays clean (its prints are still
  visible, on the other stream). Uncaught exceptions end with a final
  `{"type":"error",...}` line and exit 1; the result line is
  `{"type":"result","value":null}` — a Python program has no
  completion value.
- Python client: `trace_python(code)` / `trace_python_file(path)` and
  `scan_python(code)` / `scan_python_file(path)` (via the CLI).
- Honest limits: NO per-assignment events — assignments are not
  instrumented, so no `ASSIGN` events fire (every assignment is a
  blind spot here). Comprehensions, `async for` and lambdas' bodies
  are not loop/branch instrumented. Only the target file is traced;
  functions imported from other modules run untraced. Single-threaded
  (`threading.settrace` is not installed). A program that replaces
  `sys.settrace` itself will break the trace.

### Native C++ tracer — `cpp/iroh_trace_rt.cpp` (function-level only)

- The program is compiled with `-finstrument-functions -rdynamic -O0`
  and linked against the runtime, which is compiled WITHOUT
  instrumentation (the hooks must live in a separate uninstrumented
  file — defining them in the instrumented file fails, and
  `no_instrument_function` alone does not fix it). The hooks emit one
  JSON line per function entry/exit on stderr, in the CLI's event
  shape, with names resolved by `dladdr` + `__cxa_demangle`.
- Proven end to end: factorial(3) traces `main` + 4× `factorial(int)`
  at depths 0–4; `countdown(30)` analyzes to `DEEP_RECURSION`
  (`maxDepth: 31`, threshold 20). The result line is the program's
  exit code.
- v1 is FUNCTION-LEVEL ONLY: `-finstrument-functions` gives no
  line/loop/branch events, so a C++ trace has no `LOOP_TEST`, `IF_TEST`
  or `CATCH_ENTER` — coverage is honestly low (2 of 30 categories) and
  `HOT_LOOP`/`ONE_SIDED_BRANCH`/`THROWING_PATH` cannot fire on a C++
  trace. `std::` internals instantiated in the user's translation unit
  are filtered out by parsing the MANGLED name's outermost qualifier
  (see the hardening pass below), and unresolved names fall back to
  the executable's `.symtab` before giving up as null.
  When a name cannot be resolved the event carries `"name": null` and
  the raw `"address"` — never a faked name. Only one translation unit
  (a single .cpp file) is supported in v1; `-O0` is used on purpose,
  since inlined functions get no hooks at all. A traced program that
  writes to stderr shares the event channel (the CLI driver skips
  non-JSON lines, forwarding the program's own stderr output to its
  own stderr); its stdout is forwarded to the CLI's stderr by the
  CLI, and discarded by the C++ native client.
- C++ client: `iroh::native::Tracer::trace_code()` /
  `trace_file()` — compile, run, parse the stderr JSONL, no Node
  needed. `exit_code` is the program's exit code; a program killed by
  a signal raises `TraceError`.

### CLI — `--lang` and `--scan`

- `node cli/iroh.js program.py` / `program.cpp` traces natively now —
  `--lang python|cpp|javascript`, or inferred from the extension
  (`.py` → python, `.cpp/.cc/.cxx` → cpp). `--analyze` and `--events`
  work for all three languages. `--module` stays JavaScript-only.
- `--scan` runs trace → analyze → vector in one pass and prints ONE
  `{"type":"scan",...}` line instead of the event flood. See below.

### Vector refracting + AI-friendly scan mode — `src/vectors.js`, `src/scan.js`

- `Iroh.toVector(events)` refracts a trace into a deterministic
  numeric feature vector: the 0.8.0 neuron features (call count, max
  call depth, repeat rate, branch imbalance, event-type mix) plus
  coverage (categories fired / total), all normalized to [0, 1], with
  NAMED features, the ordered numeric `vector`, and `names`. These are
  FEATURE VECTORS, not LLM embeddings: no model, no vector DB, no new
  dependencies, no randomness. Same events → same vector, always.
- `Iroh.cosineSimilarity(a, b)` / `Iroh.euclideanDistance(a, b)` /
  `Iroh.compareVectors(a, b)` — identical traces have distance
  exactly 0 and cosine exactly 1; mismatched lengths throw instead of
  guessing.
- `Iroh.scan(events, options)` / `scanTrace(code, options)` /
  `scanTraceAsync()` / `scanModule()` emit ONE compact document
  `{ vectors, findings, scores, summary }`: the vector projection, the
  analyze() findings (every finding cites its evidence), the scorecard
  (denominators on every number), and a summary that adds `language`,
  the neuron classification, and `findingsTruncated`. Findings are
  capped at `maxFindings` (default 200) as a safety bound — the count
  of dropped findings is reported, never hidden. The raw events ride
  along only with `includeEvents: true`. Same schema for JS, Python
  and C++ traces.
- Bounded, tested: a 20,000-iteration loop traces to 100k+ raw events
  and scans to under 2% of the raw JSON bytes (and under the 64 KiB
  sanity bound). Scanning the same program twice gives byte-identical
  output.
- Cross-language, honestly: the same loop in JS and Python agrees on
  the language-independent features (calls, depth, imbalance) and
  analyzes to the same `HOT_LOOP` with 150 iterations — but the vectors
  are NOT identical, because repeat/mix/coverage measure
  instrumentation granularity, and the JS engine instruments far more
  (literals, assignments, binary ops) than the Python tracer's
  call/loop/branch events. The test asserts exactly that, with the
  reason in the comment.
- The 0.8.0 translation legs stay static-only by design (the reverse
  legs translate from source alone). Native Python/C++ tracers exist
  now, but translation does not use them — the docs that said "there
  is no tracer for those languages" now say so correctly.

### Live wire AI analysis mode — `src/live.js`, CLI `--live`

- Analysis that runs WHILE the program runs, not after: `Iroh.liveAnalyzer(options)` with `.feed(event)` (returns the findings that fired on that event), `.findings()` (all fired so far, in fire order), `.snapshot()` (progress: event count, findings fired, the window classification and the vector so far — no scores, those are final), and `.finish()` (the final summary). A finding fires the moment its threshold trips: `HOT_LOOP` when a loop's true-test count reaches 100, `DEEP_RECURSION` when a `FUNCTION_ENTER` indent reaches 20, `REPEATED_SEQUENCE` when a call sequence reaches 3 occurrences (the first sequence to reach it; at most one live finding), `THROWING_PATH` on the first `CATCH_ENTER`. Each fired finding carries `firedAt` (the 0-based index of the event that tripped it) and the evidence as of the trip.
- Two findings cannot be decided incrementally, so they fire at stream end with a `note` saying so, never a wrong early call: `ZERO_ITERATION_LOOP` (a loop could still be entered later) and `ONE_SIDED_BRANCH` (a later test could take the other arm).
- Consistency holds by construction, not by re-implementation: the fired findings' codes equal the batch `analyze()` codes on the same complete trace, and `finish()` returns the batch analysis itself (findings, scores, summary, neuron) plus the `toVector()` projection. Live evidence is the counts as of the trip; the summary is the final tally. Deterministic: the same events give the same findings in the same order, twice. `feed()` after `finish()` throws.
- CLI: `node cli/iroh.js program.js --live` streams `{"type":"live-finding",...}` lines as findings trip (suppressing the event flood, like `--scan`), then a final `{"type":"live-summary",...}` after the result line. A 150-iteration JS loop fires `HOT_LOOP` at event 505 of 763, with 100 iterations — the AI is told mid-run. Works for Python and C++ traces too (same event shape); their live lines print after the run, because the native tracers buffer their events. Proven end to end on all three languages; 10 new tests in `tests/live.test.js` (mid-stream firing, live vs batch agreement across every finding code, determinism, stream-end notes, CLI on JS/Python/C++).

### Hardening pass (0.9.0, same release — audit-and-patch on the 0.9.0 additions only)

- Python tracer: a generator yielding N values traced as N+1 calls —
  `sys.settrace` fires a "return" event per yield and a "call" per
  resume. The tracer now tells a yield from a real return by the
  opcode at `f_lasti` (`YIELD_VALUE`/`SEND` = suspend, `RETURN_*` =
  return; a frame whose last event was an exception is really exiting,
  which covers `raise` and `close()`), so a generator is ONE call pair
  and a suspended generator leaves the call stack (its depth no longer
  inflates other calls' indents). `def f(a, b=2, *args, c, **kw)` raised
  `TypeError: 'int' object is not iterable` — `co_varnames` is
  positional, kwonly, `*args`, `**kwargs`, and the code read `*args` at
  the kwonly slot; fixed, and kwonly args are now reported in
  `arguments` (merged with `**kwargs`). Return events carried the
  running depth, one more than their call's indent; they now carry the
  frame's own indent, like the JS engine's `FUNCTION_LEAVE`. A program
  importing a sibling module failed under the tracer only
  (`ModuleNotFoundError`): the tracer now puts the script's directory
  at `sys.path[0]`, as `python3 prog.py` does, and restores it after.
- C++ tracer: the emitted-stack was a fixed 4096 entries — past it,
  exits popped the wrong frame's flag and pairing shifted (a 5000-deep
  recursion with mixed filtered/unfiltered frames came out with
  61,750 CALL_ENDs for 45,022 CALLs and a simulated depth of −16,728).
  The stack now grows by doubling. The `std::` noise filter tested
  "demangled name contains `std::` anywhere", which dropped every user
  function taking or returning a std type — `std::string greet(...)`
  vanished — and the first fix attempt (token before the first `(`)
  leaked std internals whose names carry template arguments
  (`std::__str_concat`, `std::operator+`, `std::distance`). The filter
  now parses the MANGLED name's outermost qualifier (Itanium prefix:
  `St` / `N...St` / `__`-leading source name / thunk and local-name
  forms), with a unit test (`cpp/test_filter.cpp`, 19 cases). Local
  symbols (lambdas, `static` and anonymous-namespace functions)
  resolved to `null` because `dladdr` only sees dynamic symbols; the
  runtime now falls back to the executable's `.symtab`, parsed lazily
  from `/proc/self/exe` (ELF64, STT_FUNC symbols, binary search by
  address, ET_DYN load bias) — `helper`, `(anonymous namespace)::
  anon_helper` and `main::{lambda...}::operator()` all resolve now.
- CLI: a program killed by a signal (e.g. `abort()`) returned only the
  error line — the events it emitted before dying were parsed after the
  signal check and dropped. The event channel is now parsed before the
  signal check, so a crash keeps its events. `spawnSync`'s default
  1 MiB `maxBuffer` killed a 5000-deep C++ recursion with ENOBUFS and
  zero events (~4 MB of events); all CLI `spawnSync` calls now pass
  512 MiB. Traced programs got EOF on stdin (`input()` raised EOFError,
  `scanf` read nothing); both tracers now inherit the CLI's stdin. A
  traced C++ program's own stderr lines were silently dropped from the
  event channel; non-JSON lines are now forwarded to the CLI's stderr.
- Scan: `maxFindings: -5` emitted all but the last five findings and
  reported a truncation of 305 (`slice(0, -5)`); the cap is now clamped
  to >= 0, with a non-number falling back to the default 200.
  `scanTrace`/`scanTraceAsync`/`scanModule` wrote their `source`/
  `language` defaults onto the caller's `options.analyze` object; they
  now copy it first.
- Docs: the README's scan example showed numbers from no real run
  (303 events, `mix` 0.2, `coverage` 0.23, `hash` 1, kind
  `ForStatement` for a Python trace); it now shows the actual output
  of `node cli/iroh.js program.py --scan` on that program (152 events,
  `mix` 1, `coverage` 0.0333). The README footer changelog line now
  mentions 0.9.0.

### Known limitations (0.9.0 — updated in 1.0.1: per-assignment events landed, the rest stand)

- Python: ~~no per-assignment events;~~ per-assignment events fire
  for simple Name targets only (tuple targets, attributes and
  subscripts are blind spots; the event carries the post-assignment
  value, unlike JS compound assignments, which carry the RHS);
  comprehensions, `async for` and lambdas not loop/branch
  instrumented; target file only; single thread; a program that
  replaces `sys.settrace` breaks the trace. A generator closed with
  `.close()` (or abandoned while suspended) leaves its CALL unclosed
  in the stream: `sys.settrace` fires no event at all for a close
  with no `finally` block, so the tracer cannot observe it — the
  depth is still correct, because the yield already dropped it.
- C++: function-level only; single .cpp file; `-O0` only (inlined
  functions invisible); `std::`/`__` names filtered (by the mangled
  name's outermost qualifier); unresolved names are null with an
  address (only on a stripped binary now — `.symtab` covers the rest);
  the program's stderr shares the event channel; the C++ native client
  discards program stdout. `Tc` (covariant-return) thunks are not
  parsed by the filter and are kept — a kept std thunk is noise, a
  dropped user function would be a bug, and the safe direction wins.
- Scan: findings capped at 200 by default (count reported); the scan
  of a Python/C++ trace cannot count blind spots from source (the
  fidelity score's source parser is Acorn — Python/C++ sources parse
  to null, so `blindSpotStatements` is null, uncounted, not zero).
- No timeout anywhere: a program that never terminates hangs the
  tracer and the CLI indefinitely, exactly as running it directly
  would. No timeout is imposed — adding one silently would change
  behaviour; a caller that needs one should wrap the CLI run.
- The 0.8.0 subset parser was NOT reused to add loop/branch
  instrumentation to C++: it translates C++ to JS, it does not rewrite
  C++ source with hooks, and bending it into a rewriter would have
  been a new engine, not a stretch goal. C++ stays function-level in
  0.9.0.

## 0.8.0 — AI analysis layer and hybrid translation engine (20 Nov 2026)

The machine-learning / neuron / AI-input work, plus the translation
engine that grew out of it. All 120 prior tests still pass; the suite
is now 206 tests (194 Node + 7 Python + 5 C++).

### Analysis layer — `Iroh.analyze(events, options)` (new `src/analyze.js`)

- Feed a trace's events in, get `{ findings, scores, summary, neuron }`
  out. Deterministic rules over the events — no LLM, no network, no
  randomness: the same events always give the same analysis. Thresholds
  live in `options` with documented defaults.
- Finding codes: `HOT_LOOP` (a loop at/above `hotLoopThreshold`, default
  100 iterations — counted from `LOOP_TEST` events with value `true`,
  because `LOOP_ENTER` fires once per loop entry, not per iteration),
  `ZERO_ITERATION_LOOP` (a loop tested but never entered),
  `DEEP_RECURSION` (call depth at/above `deepRecursionThreshold`,
  default 20), `REPEATED_SEQUENCE` (the same call sequence repeating
  at/above `repeatSequenceMinOccurrences`, default 3 — call-name n-grams
  of length 2..4, most frequent wins), `ONE_SIDED_BRANCH` (an if
  evaluated at least `oneSidedMinTests` times, default 2, always the
  same side), `THROWING_PATH` (exceptions caught during the trace —
  uncaught exceptions end the trace itself and are reported by the
  caller, since `trace()` throws with the events attached). Every
  finding cites its evidence (counts, names, hashes) — no finding
  without evidence.
- Toolkit scorecard (`scores`), every number with its denominator
  stated: `coverage` (event categories fired vs total, as
  `fired`/`total`); `fidelity` (regions observed vs total — observed is
  distinct event hashes, missing is regions the trace shows were never
  entered; the known blind spots, private-field and destructuring
  assignments, are counted from `options.source` when given and listed
  as uncounted — null, not zero — when it is not, never hidden);
  `overhead` (events per statement when the source is given, else
  events per region, with `denominator` saying which).
- Convenience: `Iroh.analyzeTrace(code, options)` (trace then analyze in
  one call; `options.analyze.source` defaults to the code),
  `analyzeTraceAsync()` (via `traceAsync()`, top-level await works),
  `analyzeModule()` (via `traceModule()`, Node only).
- CLI: `--analyze` appends a final `{"type":"analysis",...}` line after
  the result line, same shape `analyze()` returns. (With an `--events`
  filter, coverage scores the filter — the analysis note says so.)
  Python/C++ clients get this via the CLI flag; no client changes.

### Neuron layer — a tiny perceptron in pure JS (new `src/neurons.js`)

- Features from a trace window, all normalized to [0, 1]: call count,
  max call depth, repeat rate, branch imbalance, event-type mix.
  `Iroh.extractFeatures(events)` computes them;
  `Iroh.classifyWindow(events)` returns `{ label, score, features }` —
  label `"hot"` or `"normal"`, the score, and the feature values, so the
  classification is inspectable, never a black box.
- The default weights were trained offline on 200 synthetic labeled
  traces (deterministic LCG, seeds 12345/999): converged at epoch 1,
  train 200/200, held-out 100/100. They are frozen constants — no
  randomness at runtime. `Iroh.createPerceptron(weights, bias)` builds
  a perceptron with a deterministic `train(samples, epochs,
  learningRate)` for re-training or checking in tests.
- The perceptron classifies hotness only, and the analyzer says so:
  hotness findings (`HOT_LOOP`, `DEEP_RECURSION`, `REPEATED_SEQUENCE`)
  carry `neuron: { label, score }`; `ONE_SIDED_BRANCH`,
  `ZERO_ITERATION_LOOP` and `THROWING_PATH` carry `neuron: null` with a
  `neuronNote`, rather than a forced label.

### Translation engine — `Iroh.translate(code, options)` (new `src/translate.js`)

- Hybrid, both directions: JavaScript -> Python / C++ AND Python ->
  JavaScript / C++ -> JavaScript. `Iroh.translate(code, { from, to })`
  returns `{ code, report }` where `report` is `{ ok, from, to,
  staticOnly, clean, assumptions, unsupported, notes }`.
- "Hybrid" means static + dynamic: the JavaScript-out leg runs the
  program through the tracer first and uses the events to resolve what
  static analysis cannot — runtime types (C++ parameter and return
  types come from the first call's arguments / return value), values,
  which branches actually fired. Assumptions cite their trace evidence
  (e.g. `FUNCTION_CALL 'add' arguments [2,3]`). The reverse legs are
  static-only — there is no tracer for Python or C++, and the report
  says so (`staticOnly: true`).
- Python -> JavaScript parses with Python's own `ast` module: a small
  stdlib-only Python helper (embedded in the source) is run through
  `python3` and emits the AST as JSON; no hand-rolled Python parser.
  C++ -> JavaScript uses a scoped subset parser written for this
  engine. v1 scope, both directions: functions, arithmetic, loops,
  conditionals, arrays (Python lists / C++ vectors), strings, console
  output (`console.log` / `print` / `std::cout`). No classes, no
  closures-as-objects, no async.
- Unsupported constructs are reported in `report.unsupported`, never
  silently mistranslated: the emitted code raises/throws at that point,
  loudly. `options.types` supplies C++ types the trace could not
  (`{ functions: { add: { params: ["int", "int"], returns: "int" } } }`).
- The JS-out leg runs the program through the tracer for evidence, and
  its `console.log` output is silenced while it runs — `translate()` is
  a pure function with no visible side effects. (The traced program's
  `console.log` runs natively — the instrumenter does not rewrite it —
  so the global `console.log` is swapped for the duration, not just
  `Iroh.log`.)
- `Iroh.translateAsync(code, options)` is the async version — in the
  ESM build the Python leg loads `child_process` by dynamic import (the
  sync version needs the CJS build's `require` for that leg); in a
  browser the Python leg throws a clear error and the C++ leg works.
- CLI: `--translate python|cpp|javascript` prints one
  `{"type":"translation",...}` line instead of tracing (exit 1 when
  anything was unsupported); `--from` defaults by file extension (`.py`
  -> python, `.cpp`/`.cc`/`.cxx` -> cpp, else javascript); `--translate`
  takes precedence over `--events`/`--module`.

### Known limitations (0.8.0 — updated in 1.0.1: the translation limits below are fixed, the analysis limits stand)

- Analysis: `HOT_LOOP` counts true `LOOP_TEST` events, so a loop whose
  test has side effects (or a `do...while`, whose first iteration has no
  test) counts slightly differently from a plain iteration count — the
  evidence states the test count, so the number is checkable.
  `REPEATED_SEQUENCE` looks at call names only, not arguments — two
  different calls to the same function in the same pattern read as one
  sequence. `THROWING_PATH` sees caught exceptions only; an uncaught
  exception is the caller's, not the analyzer's. The perceptron is a
  heuristic, not a verdict — its weights were trained on synthetic
  traces, not on real programs, and it answers one question (hot vs
  normal) only.
- Translation: ~~C++ parameter types come from the FIRST call in the
  trace — a function called later with different argument types would
  break the translation, and the report says so.~~ Fixed in 1.0.1:
  ALL calls and return values are collected; a parameter or return
  type that differs across calls is refused with a clear message, and
  consistent types are reported as "(verified consistent across N
  calls)". Functions never called in the trace need a type hint, or
  they are reported unsupported. A `Math.round` in Python is emulated
  as `math.floor(x + 0.5)` (Python's `round()` is banker's rounding);
  ~~string concatenation of a double in C++ is refused outright
  (`std::to_string` prints 6 decimals, unlike JS).~~ Fixed in 1.0.1:
  `__iroh_jsnum` prints doubles with JS Number::toString rules, and
  string `+` concat with a double or a bool works in both legs (the
  Python leg was silently broken before this — `"x" + 1.5` emitted
  `print("x" + 1.5)`, a runtime TypeError with zero unsupported
  entries). ~~Python `%` and JS `%` differ for negative operands —
  the report notes it.~~ Fixed in 1.0.1: `%` is JS `%` in every leg
  (`__iroh_jsmod` in Python, `std::fmod` for doubles in C++, the
  floored form for Py → JS). The C++ subset parser rejects anything
  outside v1 with a clear message rather than guessing. The Python
  leg needs `python3` on `PATH` (and the CJS build, or
  `translateAsync`, for the sync path).
- The `translate()` evidence trace runs the program: a program with
  side effects (writes, network) performs them during translation, and
  a program that never terminates never translates. That is the price
  of the hybrid leg; the report notes when the trace was unavailable
  and the translation falls back to static inference.

### Tests

- `tests/analyze.test.js` (18 tests): every finding code has a trace
  that triggers it and one that does not; scorecard denominators;
  perceptron determinism (same input, same output, twice) and learning
  (a fresh perceptron converges on a synthetic task); the CLI
  `--analyze` line.
- `tests/translate.test.js` (68 tests): for every covered construct,
  the translated Python runs under `python3` and the translated C++
  compiles with `g++` and runs, both producing the same output as the
  original JS — and the translated JavaScript runs under `node` and
  matches the original Python/C++ program's output. Unsupported
  constructs assert `report.ok === false` with the construct listed;
  `staticOnly` is true for the reverse legs, false for the JS-out legs.
  The Python and C++ legs are skipped (not failed) when their
  toolchain is absent.
- Full suite: 206 tests (194 Node + 7 Python + 5 C++), all passing,
  plus the TypeScript type test (`npm run test:types`).

## 0.7.0 — Modules, top-level await, and decorators (20 Nov 2026)

The option-C work from the 0.6.0 planning, plus the two features that
go with it. All 79 prior tests still pass; the suite is now 120 tests
(108 Node + 7 Python + 5 C++).

### Modules — `Iroh.traceModule(code, options)`
- ES modules trace now: `import`/`export` declarations, import
  attributes (`with { type: "json" }`), `import.meta`, dynamic
  `import()`, and top-level await inside modules. `trace()` and
  `traceAsync()` reject module code with a pointer at `traceModule()`
  instead of a bare Acorn error.
- Execution path: the instrumented code is written to a temp `.mjs`
  file and dynamic-imported (Node only — `vm.SourceTextModule` still
  needs `--experimental-vm-modules` on Node 24, so it is not used).
  The generated script's `Iroh` binding is satisfied without importing
  the dist (which would break singleton identity between the CJS and
  ESM builds): the header is rewritten to a
  `globalThis.__irohStages[...]` registry holding the same object as
  `Iroh.stages`. The registry is refcounted, so concurrent traces do
  not clobber each other, and it is removed when the last one settles.
- `result` is the live module namespace object (`result.default` for
  the default export). Options are trace()'s, plus `filename`: when
  given, the temp module is written next to that file, so relative
  imports resolve against its directory. Without it the module runs
  from a fresh temp directory and only bare or absolute imports
  resolve. The temp file (and its temp directory, when one was made)
  is deleted after the trace settles. `import.meta.url` is the temp
  file's URL, not the caller's.
- `node:fs` / `node:os` / `node:path` / `node:url` are loaded lazily
  via `new Function("s", "return import(s);")` — a static import in
  `src/` would break the browser (iife) rollup build, and buble
  cannot parse `import()` syntax, so the string form is parsed at
  runtime. In the browser `traceModule()` throws a clear error.
- CLI: `cli/iroh.js` now delegates to `Iroh.traceAsync()` (scripts)
  and `Iroh.traceModule()` (modules). New `--module` flag; `.mjs`
  files auto-detect module mode; the traced file's path is passed as
  `filename`, so its relative imports resolve. Exit codes unchanged
  (0 success, 1 parse/runtime error line, 2 usage/unknown category).

### Top-level await — in scripts as well as modules
- `traceAsync()` accepts programs containing top-level `await`
  (`await Promise.resolve(42)` as a whole program returns 42). It
  always runs the generated script inside an async IIFE — V8's message
  for top-level `await` in a plain Function ("missing) after argument
  list") does not mention await, so sniffing the sync failure to
  decide is unreliable, and the wrapper changes nothing observable
  for ordinary programs. `trace()` rejects top-level await with a
  pointer at `traceAsync()` (detected by a probe parse with
  `allowAwaitOutsideFunction: true` — Acorn itself reports it as a
  bare "Unexpected token").
- A program declaring its own top-level `Iroh` works under
  `traceAsync()`: the async wrapper always runs under `$$Iroh` (the
  header is rewritten), because the user's `const Iroh` would shadow
  the wrapper's parameter inside the IIFE — a runtime TDZ error, not
  a compile error, so it cannot be caught by retrying on a
  SyntaxError. (A sync-form probe would only catch it when the Iroh
  declaration precedes the first await.) `trace()` keeps its
  compile-time retry under `$$Iroh`.
- `traceAsync()` now returns a rejected promise (instead of throwing
  synchronously) when the program is module code or otherwise fails
  before running, so `assert.rejects` and `.catch` work on it.

### Decorators — parse and trace
- Acorn core does not support decorator syntax, and no maintained
  Acorn 8 decorator plugin exists on npm (`acorn-decorators` 404s;
  `acorn-es7` targets Acorn 5/6 and the abandoned 2016 proposal), so
  0.7.0 ships its own: an Acorn plugin (`src/decorators-plugin.js`,
  a subclass-returning `Parser.extend` plugin — `parse()` calls each
  plugin as `plugin(ParserClass)` and expects the extended class
  back) plus a desugar stage (`src/decorators.js`) that runs in
  `Stage.patch` after parsing, before the other patch stages.
  astring 1.9 does not generate `Decorator` nodes, so decorators are
  desugared away before generation, not regenerated.
- The plugin parses `@expr` before class declarations and
  expressions, class elements, and `export` / `export default` of a
  class (including class expressions in mid-statement position, via a
  `parseExprAtom` extension). It does not parse `accessor` fields —
  those are a parse error, as in native engines without the flag.
- Semantics follow the 2023-11 decorators proposal, checked against
  Babel's `@babel/plugin-proposal-decorators` output for the hard
  cases: decorator expressions evaluate in written order, decorators
  apply in reverse order within each element, elements in definition
  order, class decorators last; a decorator returning a value
  replaces it, and a decorator returning `undefined` keeps the
  original (class, method, and field — a logging-only decorator must
  not destroy the class). Field decorator returns are initializers,
  called per instance (once at class definition for static fields).
  Context objects carry `kind` (`class` / `method` / `getter` /
  `setter` / `field`), `name`, `static`, `private`, `access` (`has`
  / `get` / `set` — getters have no `set`, setters have no `get`),
  and `addInitializer` (static callbacks run after the class is
  defined with `this` = the class; instance ones run at the end of
  the constructor, which the desugar wraps or adds).
- Decorator invocations fire normal `FUNCTION_CALL` events: applies
  reuse the existing `DEBUG_FUNCTION_CALL` link, with the hash
  pointing at the original `Decorator` node. The decorator
  expressions themselves stay non-magic, so `@factory()` fires a
  CALL event for the factory too; the scaffolding is magic.
- Getters and setters: public accessors are replaced via
  `Object.defineProperty` (assigning the function as a plain property
  would destroy the accessor, and reading one through the target
  would invoke it — so the decorator receives the function off the
  property descriptor). Private getters/setters keep their shape and
  their bodies delegate to the decorated function (`return
  _call_x(this)`), following Babel.
- Private methods: `C.prototype.#m` is illegal (a private method
  needs an instance receiver), so — again following Babel — a
  decorated private method becomes a private FIELD holding the
  decorated function, applied once in a static block at class
  definition. Private members' `access` closures are built in a
  static block inside the class body (the only place `#m` is legal);
  the block is spliced BEFORE its element, so the holder exists
  before a static field's initializer (which runs the decorators
  inline) reads it. For static private members the block captures
  `this` (the class) into a temp — the class binding is not assigned
  yet while a hoisted class expression evaluates.
- Decorated constructors are a clear error, matching Babel:
  "Decorators can't be used with a constructor. Did you mean '@dec
  class { ... }'?"
- Also fixed while here: `DEBUG_FUNCTION_CALL` no longer reads
  `object.constructor.prototype` (dead code — assigned but never
  used) — it crashed on module namespace objects (null prototype)
  and on `Object.create(null)` objects. The `addInitializer` arrays
  are now initialized BEFORE the class evaluates (a static field
  decorator runs during class definition and may call
  `addInitializer`).

### Known limitations (0.7.0 — updated in 1.0.1: the first three are fixed, the rest stand)
- ~~No `accessor` fields: `@dec accessor x = 1` is a parse error.~~
  Fixed in 1.0.1: accessor fields parse and trace, decorated and
  undecorated, instance and static, with `{init}` composition.
  Decorated private accessors throw a clear error (not supported yet).
- ~~Computed keys with side effects evaluate twice: the key expression
  is cloned into the context `name`, so it runs once in the class
  definition and once per decorator application.~~ Fixed in 1.0.1:
  decorated computed keys parse (before this they failed at parse
  time — the real bug was worse than the claim), and the key evaluates
  exactly once, via a SequenceExpression in phase 1.
- ~~Decorator expressions for instance fields evaluate after the class
  definition, not during it: their applies run as statements after
  the class, while static fields' applies run inline during
  definition — so evaluation order between a static field and an
  instance element follows definition order only when the static
  field comes first.~~ Fixed in 1.0.1: instance field applies run in
  a static block spliced before the element (phase 2, in definition
  order). Remaining gap: method-vs-field apply order — method applies
  still run after the class, so a method's decorators apply after all
  field decorators regardless of definition order.
- `import.meta.url` in a traced module is the temp file's URL.
- The decorator desugar is a source-to-source transform: the
  instrumented code is the desugared form, so event hashes for
  decorator applies point at the original `Decorator` nodes but the
  generated code around them is scaffolding (magic, no events of its
  own). A hoisted class expression's temp fires VAR events (noise,
  but the class is fully traced).

## 0.6.0 — Next generation: 2026 syntax and a modern SDK (19 Nov 2026)

### Syntax — parser moved from ES2022 to "latest"
- The parser default is now Acorn's `"latest"` (plus `allowHashBang`) in
  all three parse sites (`src/stage/index.js`, `src/helpers.js`,
  `src/utils.js`). Hashbangs, RegExp `v` flags, RegExp modifiers
  (`(?i:...)`), and `using` declarations all parse and trace now —
  verified by probe before and after: 5 of 12 modern features failed
  before, 0 fail after (the 12th, import attributes, is module syntax
  and still needs module support — see below).
- `using` declarations even fire `VAR_DECLARE` / `VAR_INIT` events for
  free (acorn-walk visits them as VariableDeclarations), and disposal
  runs — verified in block, function, and `await using` positions.
  Top-level `using` in a *script* is still a parse error, matching
  native behaviour (it is only valid in modules); same for `import`.
- Runtime features that needed no syntax change (`Object.groupBy`,
  `Set` methods, `Promise.try`, iterator helpers, `Float16Array`,
  `RegExp.escape`, `findLast`) already traced fine and are now covered
  by tests in `tests/modern.test.js` (8 tests).

### SDK — modern terms
- **`Iroh.trace(code, options)`** — one-shot tracing: returns
  `{ events, result }`, `result` live (not serialized). Options:
  `events` (`"ALL"` by default, an array, or a comma string) and
  `onEvent(event)` (called as events fire). A parse error throws before
  running; a runtime error throws with the events that fired before it
  on `error.events`.
- **`Iroh.traceAsync(code, options)`** — awaits the program's completion
  value, so events from async continuations are included.
- **Shared event projection.** `Iroh.eventToJSON(event, trigger)` (in
  `src/utils.js`, exposed on the singleton) is the one place that turns
  a RuntimeEvent into a plain JSON-safe object; the CLI now uses it too,
  so CLI lines and `trace()` events are the same shape by construction.
  The generated script's `Iroh` binding is supplied by running it
  through a fresh `Function` with the instance as its `Iroh` parameter
  (strict, returning `$$frameValue`) — eval inside the library has no
  such binding, which the first trace tests caught.
- **Browser-build constraint, learned the hard way.** The browser bundle
  is transpiled by buble (ES2015-only): `traceAsync` is a Promise chain
  instead of `async`/`await`, and every loop in `src/` is an indexed
  `for` — buble cannot compile `async` functions or `for...of`, and its
  failure is a bare `Cannot read properties of undefined (reading
  'magicString')` with no file or line. The 0.6.0 work broke the browser
  build twice on exactly this before the constraint was found.
- **`package.json` `exports`** — proper modern resolution (`types`,
  `browser`, `import`, `require`), plus a `./cli` subpath.
- **TypeScript types** — `index.d.ts` ships in the package: `Stage`,
  `RuntimeListener`, `RuntimeEvent`, `TraceEvent`, `TraceOptions`,
  `TraceResult`, `IrohAPI`, all category constants. Verified with
  `tsc --strict` on `tests/types.ts` (`npm run test:types`);
  TypeScript 7.0.2 added as a devDependency.
- Docs: a "quick way" section at the top of `GETTING_STARTED.md`,
  `trace`/`traceAsync`/`eventToJSON`/`safeValue` in `API.md`, and the
  `trace()` one-liner in the README's JavaScript quick start.

### Hardening, first pass (before the GitHub push)
- **Stage options were silently dropped.** The constructor took `opt`
  and stored `{}`; the `StageOptions` in `index.d.ts` promised
  `ecmaVersion` / `allowHashBang` that did nothing. `patch()` now
  reads `this.options`, and `trace()` accepts `stageOptions` and passes
  them through. Covered by tests in both `modern.test.js` and
  `trace.test.js`.
- **`traceAsync` rejections lost the trace.** The sync path attached
  prior events to a thrown error, but an async rejection carried none
  of them. The rejection handler now attaches `err.events` too.
- **ESM bundle renamed to `.mjs`.** `import Iroh from "iroh"` worked
  but Node warned that `dist/iroh-node.es.js` "does not parse as
  CommonJS" and reparsed it as ESM. The bundle is now
  `dist/iroh-node.es.mjs` (`package.json` `module` + `exports`
  updated); the warning is gone, verified by a self-reference ESM test
  (`tests/esm.test.mjs`).
- **README** footer and changelog line now mention 0.6.0;
  `package-lock.json` regenerated (was still 0.5.1).
- Browser bundle smoke-tested in a `vm` with a fake `window`: loads,
  `VERSION` is 0.6.0, `trace()` works.

### Hardening, second pass (before the GitHub push)
- **Bare blocks now return their completion value.** The known
  limitation from the first pass is fixed: STAGE1.Program scans
  backwards for the last expression statement and recurses into
  trailing blocks (and nested blocks) to find one, so `{ 1; }` is `1`
  and `{ { 2; } }` is `2`. Blocks with no expression statement still
  return `undefined`, and the old looseness (the last expression
  statement wins even when a declaration follows it) is unchanged.
- **A program may declare its own top-level `Iroh`.** `trace()` runs
  the script through a `Function` whose parameter is named `Iroh`, so
  `const Iroh = 5;` used to fail with "Identifier 'Iroh' has already
  been declared". On that exact SyntaxError it retries with the
  instance under `$$Iroh` and the generated header rewritten; the
  user's own `Iroh` then works as their variable. (Writing the retry
  caught a second bug: in a replacement string `$$` means a literal
  `$`, so the rewrite used a replacement function.)
- **Primitive throws no longer risk masking.** `trace()` attached
  prior events with `e.events = events`, which throws a TypeError in
  strict mode when the program threw a string, a number, or null —
  hiding the original error. Events are now attached only when the
  thrown value is an object or function (both sync and async paths);
  primitives rethrow unchanged.
- **The CLI reports non-Error throws.** A program throwing a string
  used to produce a bare `{"type":"error"}` line with no name or
  message. A shared `errorLine()` normalizes any thrown value
  (`name: "Error"`, `message: String(e)`).
- Buble re-checked on every changed `src/` file after this pass: no
  `async`/`await`, no `for...of` anywhere.

### Not done — deliberately
- **Module syntax is still out of scope.** `import` / `export` and
  import attributes need `sourceType: "module"`, and traced modules
  can't run through plain `eval` — that is a different execution path
  (the option-C work from the 0.6.0 planning), not this release.
  Import attributes fail with the clear Acorn message, covered by a test.

### Tests
- 79 tests now: 67 Node (16 behaviour + 15 fixtures + 9 CLI + 11 modern
  syntax + 15 trace + 1 ESM) + 7 Python + 5 C++, plus the TypeScript
  type test. `npm test` runs all three suites; `npm run test:types`
  checks the types.

## 0.5.1 — Spazzed-up README (19 Nov 2026)

Presentation only, no code changes to the engine or the clients.

- New banner (`assets/banner.png`): "IrohRedux — Watch your code run.
  Change it while it runs.", with the factorial trace woven through it.
- README rewritten: badges (license, version, Node, Python, C++, tests),
  the factorial demo up front, a Mermaid diagram of the one-engine /
  three-languages layout, quick starts for JavaScript, the CLI, Python and
  C++, and a plain list of what you get. The old imgur logo is gone —
  the banner replaces it.
- Descriptions tightened: `package.json` ("Watch JavaScript run — and
  change it mid-flight..."), Python package ("watch JavaScript run and
  trace it live, from Python").

## 0.5.0 — C++, JavaScript and Python friendly (19 Nov 2026)

The engine is still JavaScript — Iroh traces JavaScript, and that hasn't
changed. What changed is who can *use* it. One new piece unlocks the other
two languages: a CLI that runs a program through Iroh and streams its
trace events as JSON lines, with thin clients on top for Python and C++.

### Added
- **`cli/iroh.js` — the bridge.** `node cli/iroh.js program.js
  [--events CALL,IF]` (or pipe a program on stdin, or `--file`) runs it
  through a Stage and prints one JSON object per line: trace events
  (`event`, `category`, `trigger`, `hash`, `indent`, plus the event's own
  fields), then `{"type":"result","value":...}`. Parse/runtime errors are
  a final `{"type":"error",...}` line with a non-zero exit code; async
  programs are awaited before the result line. Values are serialized
  safely (depth-capped, circular references and functions marked, promises
  shown as `"[Promise]"`). Also wired as the `iroh` bin in `package.json`.
- **`python/iroh` — Python client.** Stdlib only. `run(code, events=None)`
  and `trace_file(path, events=None)` return `(events, result)` as plain
  Python data; `TraceError` (with `.name` and the `.events` that fired
  before the failure) on parse/runtime errors. Finds the CLI in the
  checkout, or via `IROH_CLI` / `IROH_NODE`. `pyproject.toml` included;
  `pip install -e python/`. 7 tests (`npm run test:python`).
- **`cpp/iroh.hpp` — C++ client.** Header-only, C++17, no dependencies
  (a minimal JSON parser is included). `iroh::Client::run(code, events)`
  / `run_file(path, events)` return an `iroh::Trace` with `.events`
  (`iroh::Json` values) and `.result`; `iroh::TraceError` on failure.
  Writes the code to a temp file and runs the CLI with `popen`.
  `cpp/example.cpp` traces factorial; 5 tests in `cpp/test_client.cpp`
  (`npm run test:cpp`).
- **Label tables on the singleton.** `Iroh.INSTR` / `Iroh.CATEGORY` /
  `Iroh.OP` are now exposed (in `src/setup.js`) so consumers — notably
  the CLI, which turns event type/category numbers back into names — can
  read them. `require("iroh")` still returns the singleton directly; the
  dist export shape is unchanged.

### Changed
- README: tagline and description now say JavaScript, Python and C++;
  new "Use it from Python and C++" section with CLI, Python and C++
  examples. Fixed the broken Examples link (it pointed at
  `IrohReduxexamples/index.html`, which doesn't exist) — it now points at
  `GETTING_STARTED.md`.
- `package.json`: description updated, `iroh` bin added, keywords extended
  (`python`, `cpp`, `cli`), `test:python` / `test:cpp` scripts added.
- `npm test` now runs the Node suite (behaviour + fixtures + CLI, 39
  tests) plus the Python and C++ suites when `python3` / `g++` are
  available (skipped, not failed, when absent).

### Not done — deliberately
- Iroh still traces **JavaScript only**. A native Python tracer or C++
  tracer would be a separate library each, not a next update. Python and
  C++ programs trace JavaScript programs through the CLI; they don't get
  their own code traced.

## 0.4.0 — Fix and extend (21 Nov 2026, AEDT 19 Nov 2026)

Fork of Felix Maier's Iroh 0.3.0 (last upstream commit Jan 2018), kept under
the name `iroh` in `package.json`. The core engine is unchanged: parse with
Acorn, rewrite the AST in 8 patch stages, regenerate with astring, fire
listeners while the code runs.

### Fixed — real bugs, not just age
- **Arrow functions as callbacks crashed.** `STAGE6` passed the generated
  arrow name (`$$ANON_ARROW_*`) as a bare identifier to `DEBUG_FUNCTION_ENTER`,
  but astring never emits an `id` for arrows, so `[1,2,3].map(x => x * 2)`
  threw `ReferenceError: $$ANON_ARROW_* is not defined`. The name is now
  passed as a string literal (it is only stored as `currentScope` and the
  event name comes from `nodes[hash].node.id.name`). Same fix for
  `FunctionExpression` — object methods and getters (`m() {}`, `get v() {}`)
  also lose the artificial id in generated code and threw the same way.
- **Expression-bodied arrows returned `undefined`.** The old code built a
  `DEBUG_FUNCTION_RETURN` call into the dead `node.argument` field and left
  the expression bare in the block. Arrows now convert to a block with a
  real `ReturnStatement`, handled by the normal return path.
- **`null ?? 7` evaluated to `null`.** The `OP` table had no `??` and
  `DEBUG_LOGICAL` had no case for it, so the result fell through as `null`.
  Both added; `??=` also works.
- **Private fields crashed.** The `MemberExpression` patch passed a bare
  `#x` identifier to `DEBUG_MEMBER_EXPR` — invalid JS outside a member
  expression. `PrivateIdentifier` is now passed as a string literal, while
  the outer member keeps the original node so `.#x` still generates.
- **Class methods printed to stdout.** `DEBUG_METHOD_ENTER`/`LEAVE` were the
  only debug traces left live; they printed `method`/`ctor` on every class
  method call. Silenced like the rest of the file.
- **Build warning.** Rollup warned about unresolved `acorn/dist/walk`;
  the walk code now comes from the `acorn-walk` package.
- **Browser build.** Broke during the upgrade (buble cannot parse astring
  1.9's `.mjs`; the old `namedExports` for astring conflicted with 1.9).
  The iife config now resolves CJS entry points and only declares
  `namedExports` for acorn/acorn-walk. `npm run browser` builds again and
  the bundle was verified to run.
- **Dead links.** README/GETTING_STARTED pointed at `maierfelix.github.io`,
  the rawgit CDN (dead) and the upstream repo. Now pointed at this repo;
  the browser distribution is built locally with `npm run browser`.

### Extended — modern syntax (Acorn 5 → 8.19, astring 1 → 1.9)
- Parses ES2022 (pinned `ecmaVersion: 2022` in `Stage.patch` and in the
  internal `parse()` helpers): optional chaining, nullish coalescing,
  async/await, class fields, private fields, logical assignment.
  Node types with no dedicated patch handler are walked generically by
  acorn-walk's base visitors — they run, they just don't get their own
  listener yet. `import`/`export` still require `sourceType: module` and
  are intentionally unsupported.
- `engines` is now `node >= 18` (was `>= 6`).

### Tests — first real suite
- `tests/index.js` was a stub that threw `Not implemented yet`. There is
  now a real suite in `tests/iroh.test.js` on Node's built-in test runner
  (no new dependencies): **16 tests, all passing on Node v24.22.1** —
  factorial trace, VAR/CALL/FUNCTION listeners, return-value rewriting,
  the arrow/method/getter regressions, stdout silence for class methods,
  modern syntax, control flow, listener coverage, and an AWAIT test.

### Fixtures — the 2017 fixtures finally run
- `tests/expressions/*` and `tests/other/*` were dead since 2017: they
  were written against an `Iroh.assert` / `Iroh.log` API that was never
  implemented, so nothing ever ran them. That API now exists in the
  library (`src/setup.js`): `Iroh.assert(name, condition)` records
  `{name, passed}` in `Iroh.assertions` (and returns the boolean) instead
  of throwing, so one failing check does not hide the rest;
  `Iroh.resetAssertions()` clears the record between runs; `Iroh.log`
  is a `console.log` passthrough. See `API.md`.
- `tests/fixtures.test.js` runs every fixture file through a Stage in its
  own `vm` context and requires every assertion to pass — a fixture with
  no assertions at all fails loudly instead of passing silently. Async
  fixtures are awaited via the program frame value.
- 8 new fixtures in the same style, for the 2026 functionality:
  `arrow-callbacks`, `optional-chaining`, `nullish`, `async-await`,
  `private-fields`, `class-fields`, `logical-assignment`,
  `destructuring-spread` — **31 tests total (16 + 15 fixtures), all
  passing on Node v24.22.1**.

### Fixed — found by running the fixtures
- **`fn.toString()` leaked instrumented source.** Patched functions now
  report their original source: stage1 injects `fn.toString = function()
  { return "<original source>"; }` after each function declaration, using
  the node's original start/end positions. The injection is invisible in
  traces (magic assignment/member nodes, no CALL/MEMBER/ASSIGN events)
  and the replacement function gets the normal treatment so its frame
  stays balanced. Covers declarations that are direct children of a block
  or of the program; bare-`if` consequents and function expressions are
  not covered yet. This makes the 2017 `tests/other/toString.js` fixture
  pass.
- **Optional calls crashed.** `g?.goodbye?.()` threw inside
  `DEBUG_FUNCTION_CALL` (`root.name` on `undefined`). It now
  short-circuits: if the call is optional and the object is nullish or
  the method does not exist, the value is `undefined` and no CALL event
  fires for a call that did not happen.
- **Logical assignment on members crashed.** `obj.x ||= 7` threw
  `Invalid operator 21`: `evalObjectAssignmentExpression` had no cases
  for `||`, `&&`, `??`. Added, written longhand (the browser build's
  buble cannot parse `||=` in library source). Note: the right-hand value
  is evaluated eagerly — native `||=` would short-circuit it.
- **Destructuring assignment crashed the walker.** `[a, b] = [b, a]`
  passed literal `null` as the DEBUG_ASSIGN object/property arguments.
  Pattern assignments (and private-field assignments, below) are now
  left as native assignments — walked, but not wrapped — so they run
  correctly without an ASSIGN event.
- **Private fields/methods, three fixes.** (1) `this.#reset()` calls
  passed the bare `#reset` node into the debug call — the callee is now
  the member expression itself, and `DEBUG_FUNCTION_CALL` accepts a
  function as its `call` argument, because `this["reset"]` cannot reach
  a `#reset` method. (2) `this.#count += 1` went through DEBUG_ASSIGN
  as `obj["count"]`, which is a *public* property — a different slot from
  `#count` — and silently wrote the wrong one; private-field assignments
  are now left native. (3) Same bare-`#x` fix in the member-expression
  patch (0.4.0, earlier round).
- **Async tracing crashed after an `await` inside `try`.** An async
  function that awaited inside a try block threw "Unexpected frame type
  FUNCTION_CALL" on its continuation: the shared frame stack had moved
  on while it was suspended, so TRY_LEAVE/RETURN resolved frames against
  the wrong stack. New `DEBUG_AWAIT` (stage8 `AwaitExpression` handler)
  saves the frame state at each `await` and restores it when the awaited
  value settles, before the continuation runs. New listener
  `Iroh.AWAIT` (`fire`, with the awaited value). Limitation: it restores
  the pointer to the saved frames, not a snapshot — code that pops frames
  below the saved point while suspended can still leave the chain stale.

### Known limitations
- No dedicated listeners yet for optional chaining or class fields — they
  execute and can be observed through the listeners on the expressions
  around them, but there is no `Iroh.CHAIN` event.
- Private-field and destructuring assignments run correctly but produce
  no ASSIGN event.
- The right-hand side of a member logical assignment (`obj.x ||= y`) is
  evaluated eagerly; native `||=` would short-circuit it.

## 0.3.0 — upstream (Jan 2018)

Last upstream release by Felix Maier. See git history.
