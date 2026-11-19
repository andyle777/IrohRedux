# Changelog

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
