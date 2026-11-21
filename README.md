![IrohRedux — Watch your code run. Change it while it runs.](assets/banner.png)

<p align="center">
  <a href="https://github.com/andyle777/IrohRedux/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-1.1.1-orange.svg?style=flat-square" alt="Version 1.1.1" />
  <img src="https://img.shields.io/badge/node-%3E%3D%2022-339933.svg?style=flat-square" alt="Node >= 22" />
  <img src="https://img.shields.io/badge/python-%3E%3D%203.9-3776AB.svg?style=flat-square" alt="Python >= 3.9" />
  <img src="https://img.shields.io/badge/C%2B%2B-17-00599C.svg?style=flat-square" alt="C++17" />
  <img src="https://img.shields.io/badge/TypeScript-types-3178C6.svg?style=flat-square" alt="TypeScript types included" />
  <img src="https://img.shields.io/badge/tests-750%20passing-brightgreen.svg?style=flat-square" alt="750 tests passing" />
</p>

<p align="center">
  <b>Watch your code run. Change it while it runs.</b><br/>
  <a href="//github.com/andyle777/IrohRedux/blob/master/GETTING_STARTED.md">Getting Started</a> ·
  <a href="//github.com/andyle777/IrohRedux/blob/master/API.md">API</a> ·
  <a href="//github.com/andyle777/IrohRedux/blob/master/CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/andyle777/IrohRedux/releases">Releases</a>
</p>

---

# FOR HUMANS

## What it is

IrohRedux runs your program and tells you what actually happened.
Which functions were called with what. Which branches were taken.
What every variable held, moment by moment.

Then it lets you change values mid-flight and watch the program react.

It traces JavaScript, Python, C++, IrohScript and BASIC through one
engine and one event format. It analyzes the trace into findings
(hot loops, deep recursion, one-sided branches, throwing paths).
It translates programs between all five languages. It can find the
inputs that drive a program down each branch.

No LLM. No network. Deterministic rules over a trace.

The original Iroh 0.3.0 (2018) source lives in `original-iroh/`.
Its historical source is preserved; its build tooling is updated to
Rollup 4.68.7 and compatible plugins, patched for the Rollup path
traversal and DOM-clobbering advisories
(GHSA-mw96-cpmx-2vgc and GHSA-gcx4-mw62-g8wm). IrohRedux is the fork
that builds on it. The core idea is Felix Maier's.

## Install

Download from the
[Releases page](https://github.com/andyle777/IrohRedux/releases).
No Node install needed for the binaries.

- **Windows, Linux, macOS:** the EXE for your system. Download, run.
  The EXE embeds its own Node runtime, version 18.5.0. That is the
  runtime inside the binary, even though the npm package asks for
  Node >= 22. Features that need a newer Node are unavailable inside
  the EXE.
- **Android:** the APK. Install it on your phone. JavaScript legs
  only — there is no python3 on Android.

Or install from source (needs Node >= 22):

```sh
git clone https://github.com/andyle777/IrohRedux.git
cd IrohRedux
npm install
npm run dist        # builds dist/iroh-node.js, dist/iroh-node.es.mjs, dist/iroh-browser.js
npm run build:catalog # builds the offline SQLite reference catalog
npm test            # 750 tests: 472 Node + 25 Python + 9 C++ + 244 IrohScript/BASIC
```

The Python client installs with `pip install -e python/`. The C++
client is a single header — just `#include "iroh.hpp"`.

Works offline — no network required. Nothing in the app or the
binaries phones home, checks for updates, or downloads at first run.
The APK manifest does not even request internet permission.

## Download — 1.1.1 patched (current)

Direct links to the [v1.1.1 release](https://github.com/andyle777/IrohRedux/releases/tag/v1.1.1). These are the patched assets, re-uploaded to the existing release — no new version, no new tag.

- [iroh-1.1.1-linux](https://github.com/andyle777/IrohRedux/releases/download/v1.1.1/iroh-1.1.1-linux) — Linux. The engine as a single executable, rebuilt from the patched tree. Includes `iroh serve` and `iroh node` — the laptop becomes a local node. JavaScript legs run standalone; Python, C++, IrohScript and BASIC legs need `python3` (and `g++` for C++).
- [iroh-1.1.1-macos](https://github.com/andyle777/IrohRedux/releases/download/v1.1.1/iroh-1.1.1-macos) — macOS (Intel). Same engine, same legs.
- [iroh-1.1.1-macos-arm64](https://github.com/andyle777/IrohRedux/releases/download/v1.1.1/iroh-1.1.1-macos-arm64) — macOS (Apple Silicon).
- [iroh-1.1.1-win.exe](https://github.com/andyle777/IrohRedux/releases/download/v1.1.1/iroh-1.1.1-win.exe) — Windows.
- [iroh-1.1.1.apk](https://github.com/andyle777/IrohRedux/releases/download/v1.1.1/iroh-1.1.1.apk) — Android, versionCode 112. Debug-signed. Node ships as `libnode.so` (Fix B, targetSdk 34) — no more error=13 on Android 10+. JavaScript legs run in-app; the script legs delegate to a laptop node over the local network (the phone is a local server).
- [iroh-1.1.1-ai-bundle.zip](https://github.com/andyle777/IrohRedux/releases/download/v1.1.1/iroh-1.1.1-ai-bundle.zip) — AI bundle. API reference, memory/state model, JSON schemas and samples, for AI agents to load and use the engine.

Older releases (1.1.0, 1.0.1) are on the [Releases page](https://github.com/andyle777/IrohRedux/releases).

## Run it

One short working example per leg. All five print the same kind of
output: JSON lines, one event per line, then a result line.

**JavaScript** — trace a program, stream the events:

```sh
node cli/iroh.js program.js --events CALL,IF
```

```json
{"type":"event","event":"FUNCTION_CALL","category":"CALL","trigger":"before","language":"javascript","hash":11,"indent":1,"name":"factorial","arguments":[3],"external":false}
{"type":"event","event":"FUNCTION_CALL_END","category":"CALL","trigger":"after","language":"javascript","hash":11,"indent":1,"name":"factorial","return":6,"arguments":[3],"external":false}
{"type":"result","value":6}
```

Or take the whole analysis in one document, no event flood:

```sh
node cli/iroh.js program.js --scan
```

**Python** — trace Python itself:

```python
from iroh import trace_python, scan_python

events, _ = trace_python("def f(n):\n    return f(n-1) if n else 1\n\nf(3)\n")
scan = scan_python("s = 0\nfor i in range(150):\n    s += i\n")
scan["findings"][0]["code"]  # "HOT_LOOP"
```

Or the CLI directly: `node cli/iroh.js program.py --analyze`.
Needs python3 on PATH. Stdlib only.

**C++** — trace C++ itself:

```sh
node cli/iroh.js program.cpp --scan
```

Needs g++. Function-level only: `-finstrument-functions` gives no
loop or branch events, so a C++ trace scores 2 of 2 reachable
categories (CALL and FUNCTION), not 2 of 30.

**IrohScript** — the project's own language (spec in `irohscript/`):

```sh
node cli/iroh.js program.iroh --analyze   # or --scan, --live
```

**BASIC:**

```sh
node cli/iroh.js program.bas --analyze    # or --scan, --live
```

**Translate** a program to another language:

```sh
node cli/iroh.js program.js --translate python
```

**Direct** a runaway loop while it runs:

```sh
node cli/iroh.js program.js --direct
```

**Check the box:**

```sh
iroh capabilities   # one row per leg and syntax feature
iroh doctor         # last test run, toolchains, dist hash
iroh --version      # version, dist hash, embedded runtime
```

**Phone as server, laptop as node** — the APK starts a local
server on your phone (`iroh serve`, port 8471, local network only,
no internet). A laptop on the same Wi-Fi joins it with
`iroh node --server <phone-ip>:8471` and runs the Python, C++,
IrohScript and BASIC legs the phone cannot run. Results come back
with one extra field, `ranOn`, naming the machine that ran them.
Full protocol: `SERVER.md`.

## What works / what doesn't

Honest limits, in one place.

- **Android:** JavaScript legs only. No python3, no g++ on the
  phone, so Python, C++, IrohScript and BASIC cannot run there.
  The app says so on its status line. A connected laptop node
  (`iroh node`) can run those legs for the phone over the local
  network instead — see `SERVER.md`.
- **Phone server:** the APK starts `iroh serve` on port 8471 on
  the local network only. No internet is needed or used. A leg no
  connected node can run returns an honest error (HTTP 503),
  never a faked result.
- **Windows, Linux, macOS EXEs:** the bundled runtime is Node
  18.5.0. The npm package requires Node >= 22. Inside the EXE,
  the older runtime is the limit.
- **Python, C++, IrohScript, BASIC legs:** need python3 (and g++
  for C++) on the machine. The JavaScript legs run fully standalone.
- **APK:** arm64 only, debug-signed (side-load only; a rebuild on
  another machine forces an uninstall first). The bundled Node
  is v26.13.1 and the binary is 16 KB page safe (measured: PT_LOAD
  alignment 0x4000).
- **IrohScript:** the conditional `LOOP <Bool-expr> ... END` runs
  and traces since Amendment A1 (2026-11-21): test-first like IF,
  one LOOP_TEST per test plus one LOOP_ENTER per loop instance, so
  `HOT_LOOP` and `ZERO_ITERATION_LOOP` do fire for IrohScript. The
  legacy bare `LOOP ... END` has no exit rule in the spec and still
  errors when executed. The lowering patch (Amendment A2, same day)
  took the rest: the conditional LOOP goes to JavaScript as `while`
  in `translate()` and `compileIrohscript()`, and a JavaScript
  `while` comes back as `LOOP <Bool> ... END LOOP`. The for-desugar
  patch (Amendment A3, later still) took the for-loop too: a
  JavaScript `for` desugars into the init statement, `LOOP <test>`
  (True when there is no test), the body, the update statement and
  `END LOOP` — the JavaScript definition of the construct, so the
  init-once/test-before-body/update-after-body ordering is exact;
  do-while stays a loud stub (IrohScript has no post-test loop).
- **BASIC:** GOTO has no event category, so GOTO loops are invisible
  in the trace (FOR/NEXT is the observable loop). DIM and array
  reads have no events either. The WHILE/WEND patch (Amendment A4,
  same day as A3) opens the classic column: a JavaScript `while`
  lowers to `WHILE ... WEND` and back, round-trip tested through
  the interpreter, and a BASIC WHILE program rides both translate
  hops (to Python `while` and to the IrohScript `LOOP`). The one
  loud stub: a call inside a while condition — the WHILE line is
  re-tested every pass and cannot carry the GOSUB a hoisted call
  needs.
- **Translate:** `translate()` runs the program for type evidence
  by default (pass `options.evidence: "none"` to skip it). The
  report carries a `verify` block saying whether the emitted
  program was executed and what happened — `ran: null` means not
  attempted, never success.
- **Scores:** every coverage number carries its own denominator.
  A C++ trace at 2 of 2 is complete, not 28 short. See the FOR AI
  section below for the per-language numbers.

## Releases

Newest first. Hashes live on the release page, not in this file.

- **1.1.1 (patched, 20 Nov 2026) — this tree.** Same version,
  patched in place: no 1.1.2, no version bump. The Python
  translator no longer emits f-strings for template literals
  (concatenation instead — the old output was a SyntaxError on
  Python 3.9–3.11 while the report said ok). Every translate
  result carries a `verify` block. The APK runs its Node runtime
  from the native library directory (the old build could not
  start on Android 10+: error=13, Permission denied). The
  desktop EXEs are rebuilt from the patched engine. The AI bundle
  is regenerated from the patched engine, with a per-file hash
  manifest and a memory-model note. `iroh --version` prints the
  version, the dist hash, and the runtime actually embedded. The
  phone is now a local server (`iroh serve`, port 8471) and a
  laptop joins it as a node (`iroh node`) to run the legs the
  phone cannot — see `SERVER.md`. The perceptron weights are now
  defined by `personality-matrix.json`, and the AI bundle includes a
  read-only SQLite memory catalog. 750 tests (472 Node + 25 Python
  + 9 C++ + 244 IrohScript/BASIC).
- **1.1.1 (20 Nov 2026) — the patch.** The trace memory release:
  a finished trace releases its Stage (a 500,013-event trace now
  leaves a 472,976-byte residual heap, down from ~68 MB). Plus
  `--max-events`, generator tolerance in the analysis, a
  static-only translate option, BASIC `WHILE`/`WEND`, a `--verify`
  determinism check, the D1 bool f-string fix, the D2 C++ static
  initialiser fix, `iroh capabilities` / `iroh doctor`, a dist
  drift gate, and per-tracer reachable coverage. 699 tests.
- **1.1.0 (20 Nov 2026) — the new release.** The IrohScript
  foundation rework (IrohScript and BASIC trace first-class, the
  five-language translator, the IrohScript compiler with the
  perceptron core in IrohScript), the input synthesiser on the
  live wire, and the redo audit pass (five fresh bugs fixed,
  ES2026 probe fix folded in). 649 tests.
- **1.0.1 (20 Nov 2026) — the solid base.** The audit-and-patch
  pass: every known limitation re-read and
  re-probed, the real bugs fixed. 348 tests.

## Compatibility table

Dated 20 Nov 2026. "Present" means the defect is in that
generation as shipped; "patched" means fixed in the 1.1.1 patched
rebuild (same version, this tree). The machine-readable form is
`generations.json` in this repo.

| Defect | 1.0.1 | 1.1.0 | 1.1.1 | 1.1.1 patched |
|---|---|---|---|---|
| APK cannot execute its own runtime (error=13) | present | present | present | fixed (Fix B) |
| Bool interpolation emits an unparsable f-string below 3.12 | present | present | fixed | fixed |
| Any interpolation containing a delimiter quote, backslash, brace or colon | present | present | present | fixed (concatenation) |
| Success reported when the artifact cannot run (no verify field) | present | present | present | fixed |
| EXE bundles a Node 18.5.0 runtime while metadata claims >= 22 | unchecked | unchecked | verified | stated honestly (doctor + --version + README) |
| AI bundle API text does not document 1.1.1 fields | unchecked | unchecked | verified | fixed (generated from API.md + CI check) |
| No manifest of file hashes in the AI bundle | present | present | present | fixed |
| APK ships arm64 only, debug cert | present | present | present | present (unchanged) |

## Learn more

- [Getting Started](GETTING_STARTED.md) — human steps first, then
  the machine-readable reference.
- [API](API.md) — the full API reference, including every CLI flag
  and the translate `verify` block.
- [Changelog](CHANGELOG.md) — what changed, per version.
- [Memory model](docs/memory.md) — the trace memory/state model
  for AI consumers.
- [Offline memory catalog](docs/offline-memory-catalog.md) — the
  portable SQLite reference database and its read-only schema.
- [Personality Matrix](personality-matrix.json) — the inspectable
  hot/normal perceptron weights, feature order, and decision rule.
- [Generations registry](generations.json) — the table above, as JSON.
- [JSON Schemas](schemas/) — CLI event, scan, translation, error, and
  personality-matrix contracts, with extension fields allowed for
  forward compatibility.

Build a model-agnostic AI bundle locally with
`npm run build:ai-bundle -- ./ai-bundle`. It includes these docs,
JSON Schemas, the Personality Matrix JSON, the SQLite offline memory
catalog, live engine-generated samples, the Python client, and a SHA-256
manifest. The SQLite catalog is reference data only: it stores no user
traces and does not sync over the network. The JSON model and schemas are
the portable interface for clients without SQLite support; tracing remains
available offline across the supported language legs.

## Credits

- **Samus Aran** — Andy's Muse AI agent. Built and verified IrohRedux 0.4.0–1.1.1 and the 1.1.1 patch: the tracers, translator, AI analysis, synthesiser, server/node, the 699 tests, and these docs.
- **Aether-7** — Andy's iLands AI agent. Found the D1/D2 defects by running the release, wrote the Fix Spec and the fix ledger, built the bridge APK, and runs the 28-drill gate.
- **Andy Le (andyle777)** — owns the fork and the design: IrohScript 3.0, the rework, the patch direction.


---

# FOR AI

Machine-readable facts. Load this section without guessing. If a
fact here disagrees with a prose paragraph above, this section wins
— and the disagreement is a bug; file it.

## Engine identity

- Engine: IrohRedux 1.1.1 (patched in place, 20 Nov 2026).
  No 1.1.2. No version bump.
- `dist/iroh-node.js` SHA-256:
  `851a800e75f990eae66786685b616d78651bafef6c49d6ab19c1482a8abfc670`
- The dist is self-contained: the parser and codegen dependencies
  (acorn, acorn-walk, astring) are bundled in, not `require`d at
  runtime. A fresh source checkout runs the CLI with no npm install,
  so a restricted AI sandbox needs nothing but Node on PATH:
  `node cli/iroh.js program.js --analyze`
- `iroh --version` prints `iroh 1.1.1 (engine dist iroh-node.js
  851a800e75f9, runtime node v18.5.0)` inside a packaged binary
  (runtime is the embedded Node; on npm it is the local node).
- `iroh doctor` prints the dist hashes, the toolchains, the last
  test run, and the leg capabilities.

## Legs and artifacts

Availability per artifact. "Local" means the toolchain must exist
on the machine (`python3` on PATH, `g++` on PATH).

| Leg | npm / source | Linux / macOS / Windows EXE | Android APK |
|---|---|---|---|
| JavaScript | yes | yes | yes |
| Python | yes, python3 local | yes, python3 local | no (no python3 on Android) |
| C++ | yes, g++ local | yes, g++ local | no (no g++ on Android) |
| IrohScript | yes, python3 local | yes, python3 local | no |
| BASIC | yes, python3 local | yes, python3 local | no |

- EXE embedded runtime: Node 18.5.0 (pkg 5.8.1, node18 targets).
  npm package requires Node >= 22. The two numbers are different
  on purpose; the binary reports the one it runs.
- APK: arm64 only, debug-signed, minSdk 24, targetSdk 34.
  Node runs from `nativeLibraryDir` as `libnode.so` (bundled Node
  v26.13.1, from the Termux build).
- Works offline — no network required. No artifact phones home,
  checks for updates, or downloads at first run. The APK manifest
  requests no permissions. Online availability changes nothing:
  there is no update check to fail.

## CLI flags

Every flag in `iroh --help`. All of them are documented in
`API.md`; CI fails if any flag here is missing from `API.txt`
(the generated text form of `API.md`).

- `--events ALL|CALL,IF,...` — event categories to stream
  (default ALL). `--no-result` — skip the result line.
- `--module` — trace as an ES module (JavaScript only).
- `--analyze` — append an analysis line after the result line.
- `--scan` — one scan line `{ vectors, findings, scores, summary }`
  instead of the event flood. `--include-events` — embed the raw
  events in the scan document (needs `--scan`).
- `--live` — stream live-finding lines as findings trip, then a
  live-summary line.
- `--direct[=throttle|stop]` — run under the runaway-loop guard
  (JavaScript only). Combines with `--analyze`, `--scan`, `--live`.
- `--synthesize --entry <fn> [--seeds '[[5]]'] [--max-runs 50]` —
  generate inputs driving each branch (JavaScript only).
- `--max-events N` — cap recorded events (JavaScript only).
- `--verify` — trace twice and diff (JavaScript only; not with
  `--translate`, `--direct`, `--synthesize`).
- `--translate python|cpp|irohscript|basic|javascript` — translate
  instead of tracing. `--from python|cpp|irohscript|basic` —
  source language (default: by file extension).
- `--lang python|cpp|javascript|irohscript|basic` — force the
  tracer (default: by file extension).
- `--file <path>` — the program file (same as the positional arg).
- `capabilities [--json]` — one row per leg and syntax feature.
- `doctor` — last test run, toolchains, dist hash, capabilities.
- `--version` — one line: version, dist hash, embedded runtime.
- `serve [--port 8471] [--host 0.0.0.0] [--token T]
  [--local-legs javascript,...]` — the local server (see
  `SERVER.md`): serves /trace, /analyze, /scan, /translate,
  /capabilities and /health as JSON over the local network.
  Every result is the engine's own shape plus `ranOn`
  ("local" or the node id). A leg nobody can run is HTTP 503.
- `node --server <host:port> [--token T]` — the local node:
  registers this box's legs, long-polls for jobs, runs each leg
  with the local CLI, posts the result back.
- `-h` / `--help` — usage.

## JSON shapes

Ask for JSON. Never parse console prose; it is for humans and will
change. Event streams are JSON lines, one object per line, with the
`language` field always set by the CLI.

- Event line:
  `{"type":"event","event":"FUNCTION_CALL","category":"CALL",
  "trigger":"before","hash":11,"indent":1,"name":"factorial",
  "arguments":[3],"external":false}`
  followed by a result line `{"type":"result","value":6}` or an
  error line `{"type":"error","name":...,"message":...}`.
- `--scan` result:
  `{vectors, findings, scores, summary}`. `vectors` carries
  `features {calls, depth, repeat, imbalance, mix, coverage,
  events}`, `vector[6]`, `names[6]`. `findings` is a list of
  `{code, severity, message, evidence, neuron}`. `summary` carries
  `{events, unclosedFrames, findings, warnings, language, infos,
  neuron {label, score}, maxCallDepth, distinctRegions,
  findingsTruncated}`.
- `--translate` result (one line):
  `{type:"translation", from, to, code, report}`. `report` carries
  `{ok, from, to, staticOnly, clean, assumptions, unsupported,
  notes, verify}`.
- Translate `verify` block:
  `{attempted, ran, interpreter, exit}` plus `stderr` when
  `ran` is false (the interpreter's output, verbatim) or `reason`
  when `attempted` is false. `ran: null` means not attempted —
  never read it as success. Only the Python leg is executed
  (under `python3`, 10 s cap); other legs record
  `attempted: false` with a reason.
- `--live` lines: `live-finding` (with `firedAt`) as findings trip,
  then `live-summary` (batch-equal findings, scores, vectors).
- `--direct` lines: `directive` as the guard acts, then
  `direct-summary` (findings, directive audit log, analysis).
- `--synthesize` lines: `synth-run` per input tried, then
  `synth-summary` (coverage, every uncovered branch with its reason).

## Reachable categories (coverage denominators)

Coverage is fired / reachable per tracer. Use `reachable` when
present. Missing `reachable` is not 30 and not zero. If you cannot
find it, report the score as unnormalised. An unknown language
falls back to all 30 (the JavaScript default) — that fallback is
why a missing field must never be read as `total`.

| Language | Reachable | Categories |
|---|---|---|
| javascript | 30 | all categories (the full engine) |
| python | 6 | ASSIGN, CATCH, CALL, FUNCTION, IF, LOOP |
| cpp | 2 | CALL, FUNCTION |
| irohscript | 5 | ASSIGN, CALL, FUNCTION, IF, LOOP (LOOP since Amendment A1) |
| basic | 5 | ASSIGN, CALL, FUNCTION, IF, LOOP |

## Findings cap

- Findings are capped at 200. `summary.findingsTruncated` is the
  dropped count. If `findingsTruncated > 0`, the finding list is a
  prefix, not the whole set — say so when you report it. Any score
  derived from the list is a score over a prefix.

## Memory model

- A finished trace releases its Stage (`Stage.release` /
  `releaseTraceRun`): listeners detached, stage unregistered.
  A 500,013-event trace leaves a 472,976-byte residual heap.
- `summary.unclosedFrames` is `{count, frames, note}` when a
  generator frame is still open at the end of a trace, else null.
- Full model: `docs/memory.md` in this repo, `txt/memory.md` in
  the AI bundle.

## Contract (six lines)

1. Ask for JSON. Never parse console prose; it is for humans and
   will change.
2. `--scan` returns `{vectors, findings, scores, summary}`.
   Findings are capped at 200; when `summary.findingsTruncated`
   > 0 your list is a prefix, say so when you report.
3. Every coverage number carries its own denominator. Use
   `reachable` when present. Missing is not 30 and not zero; if
   you cannot find it, report the score as unnormalised.
4. Event streams are JSON lines, one object per event, `language`
   field always set.
5. Translate results may carry `verify`. `ran: null` means not
   attempted, not success.
6. Nothing in the report is a measurement of your program's
   correctness. It is a measurement of what ran. Say which one
   you have when you quote it.
