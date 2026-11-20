![IrohRedux — Watch your code run. Change it while it runs.](assets/banner.png)

<p align="center">
  <a href="https://github.com/andyle777/IrohRedux/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-1.0.1-orange.svg?style=flat-square" alt="Version 1.0.1" />
  <img src="https://img.shields.io/badge/node-%3E%3D%2018-339933.svg?style=flat-square" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/python-%3E%3D%203.9-3776AB.svg?style=flat-square" alt="Python >= 3.9" />
  <img src="https://img.shields.io/badge/C%2B%2B-17-00599C.svg?style=flat-square" alt="C++17" />
  <img src="https://img.shields.io/badge/TypeScript-types-3178C6.svg?style=flat-square" alt="TypeScript types included" />
  <img src="https://img.shields.io/badge/tests-349%20passing-brightgreen.svg?style=flat-square" alt="349 tests passing" />
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

It traces JavaScript, Python and C++ through one engine and one event
format. It analyzes the trace into findings (hot loops, deep recursion,
one-sided branches, throwing paths). It translates programs between
JavaScript, Python and C++. No LLM. No network. Deterministic rules
over a trace.

The original Iroh 0.3.0 (2018) lives in `original-iroh/`, preserved
untouched. IrohRedux is the fork that builds on it. The core idea is
Felix Maier's.

## Install

Download from the
[Releases page](https://github.com/andyle777/IrohRedux/releases).
No Node install needed for the binaries.

- **Windows, Linux, macOS:** the EXE for your system. Download, run.
  The EXE embeds its own Node runtime, version 18.5.0. The npm
  package asks for Node >= 18, so the binary and the package agree.
- **Android:** the APK. Install it on your phone. JavaScript legs
  only — there is no python3 on Android.

Or install from source (needs Node >= 18):

```sh
git clone https://github.com/andyle777/IrohRedux.git
cd IrohRedux
npm install
npm run dist        # builds dist/iroh-node.js, dist/iroh-node.es.mjs, dist/iroh-browser.js
npm test            # 349 tests: 315 Node + 25 Python + 9 C++
```

The Python client installs with `pip install -e python/`. The C++
client is a single header — just `#include "iroh.hpp"`.

Works offline — no network required. Nothing in the app or the
binaries phones home, checks for updates, or downloads at first run.
The APK manifest does not even request internet permission.

## Run it

One short working example per leg. All three print the same kind of
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
loop or branch events, so a C++ trace scores 2 of 30 categories
(CALL and FUNCTION) — that is complete for what the tracer can see,
not 28 short.

**Translate** a program to another language:

```sh
node cli/iroh.js program.js --translate python
```

**Direct** a runaway loop while it runs:

```sh
node cli/iroh.js program.js --direct
```

**Check what you are running:**

```sh
node cli/iroh.js --version   # version, dist hash, embedded runtime
```

## What works / what doesn't

Honest limits, in one place.

- **Android:** JavaScript legs only. No python3, no g++ on the
  phone, so Python and C++ cannot run there. The app says so on
  its status line. There is no remote-execution service in this
  release: the Python/C++ legs cannot run on the phone at all, and
  no laptop can run them for it yet — that is a follow-up, not a
  feature here.
- **Windows, Linux, macOS EXEs:** the bundled runtime is Node
  18.5.0. The npm package requires Node >= 18, so the two agree.
- **Python and C++ legs:** need python3 (and g++ for C++) on the
  machine. The JavaScript legs run fully standalone.
- **APK:** arm64 only, debug-signed (side-load only; a rebuild on
  another machine forces an uninstall first). The bundled Node
  is v26.13.1.
- **Translate:** JavaScript to Python or C++, Python and C++ back
  to JavaScript — three languages only. Template literals to
  Python now emit concatenation, not f-strings (this patch, Fix
  Spec 3.5 Option 1): a bool, a string literal, or a ternary of
  strings interpolates through `__iroh_jsbool` / `str()` /
  `__iroh_jsnum`, so the emitted Python parses on 3.9–3.12 — the
  old emitter produced a SyntaxError on 3.9–3.11 while the report
  still said `ok: true`. Every translate result now carries a
  `verify` block (Fix Spec 3.7): the emitted Python is executed
  under python3 and the result recorded (`ran: null` is not
  `ran: true`; `stderr` verbatim when it does not run).
- **Scores:** every coverage number is fired out of 30 — the
  JavaScript category model, applied to every language. A C++
  trace at 2 of 30 is complete at function level, not 28 short.
  There is no per-language reachable denominator in 1.0.1 (that
  came in 1.1.1). See the FOR AI section below.
- **Trace memory:** a finished trace keeps its Stage registered
  in this generation (the release step came in 1.1.1). In a
  long-lived process that holds many traces, memory grows with
  the events retained — see `docs/memory.md`.

## Releases

Newest first. Hashes live on the release page, not in this file.

- **1.0.1 (patched, 20 Nov 2026) — this tree.** Same version,
  patched in place: no 1.1.2, no version bump. The APK runs its
  Node runtime from the native library directory (the old build
  could not start on Android 10+: error=13, Permission denied).
  The desktop EXEs are rebuilt from the 1.0.1 engine.
  `iroh --version` prints the version, the dist hash, and the
  runtime actually embedded. The AI bundle is regenerated from
  the 1.0.1 engine, with a per-file hash manifest and a
  memory-model note. 357 tests (323 Node + 25 Python + 9 C++).
  The engine fix is in this patch: the f-string translator defect
  is fixed (concatenation emitter + verify block) — see
  "What works / what doesn't".
- **1.0.1 (20 Nov 2026) — the solid base.** The AI director and
  live code engine (trace → analyze live → direct → change →
  trace again), plus the all-generations audit-and-patch pass:
  every known limitation re-read and re-probed, the real bugs
  fixed (translator number formatting, director member and scoped
  sets, directAsync/directModule, decorated computed keys and
  accessor fields, Python per-assignment events). 348 tests.
  (1.0.0 was built but never released; that work shipped in 1.0.1.)

## Compatibility table

Dated 20 Nov 2026. "Present" means the defect is in that
generation as shipped; "patched" means fixed in the 1.0.1 patched
rebuild (same version, this tree). The machine-readable form is
`generations.json` in this repo.

| Defect | 1.0.1 | 1.1.0 | 1.1.1 | 1.0.1 patched |
|---|---|---|---|---|
| APK cannot execute its own runtime (error=13) | present | present | present | fixed (Fix B) |
| Bool interpolation emits an unparsable f-string below 3.12 | present | present | fixed | fixed (concatenation emitter) |
| Any interpolation containing a delimiter quote, backslash, brace or colon | present | present | present | fixed (concatenation emitter) |
| Success reported when the artifact cannot run (no verify field) | present | present | present | fixed (report.verify) |
| EXE bundles a Node 18.5.0 runtime while metadata claims >= 22 | not applicable (1.0.1 metadata says >= 18) | unchecked | verified | stated honestly (--version + README) |
| AI bundle API text does not document the release | unchecked | unchecked | verified | fixed (generated from API.md + CI check) |
| No manifest of file hashes in the AI bundle | present | present | present | fixed |
| APK ships arm64 only, debug cert | present | present | present | present (unchanged) |

## Learn more

- [Getting Started](GETTING_STARTED.md) — human steps first, then
  the machine-readable reference.
- [API](API.md) — the full API reference, including every CLI flag.
- [Changelog](CHANGELOG.md) — what changed, per version.
- [Memory model](docs/memory.md) — the trace memory/state model
  for AI consumers.
- [Generations registry](generations.json) — the table above, as JSON.
- [JSON Schemas](schemas/) — CLI event, scan, translation, and error
  contracts for AI clients.

Build the local AI bundle with `npm run build:ai-bundle -- ./ai-bundle`.
It contains the current release documentation, schemas, engine-generated
JSON samples, the Python client, and per-file SHA-256 hashes. The CLI
works offline and does not call an AI model; any client can consume the
same JSON contracts.

---

# FOR AI

Machine-readable facts. Load this section without guessing. If a
fact here disagrees with a prose paragraph above, this section wins
— and the disagreement is a bug; file it.

## Engine identity

- Engine: IrohRedux 1.0.1 (patched in place, 20 Nov 2026).
  No 1.1.2. No version bump. The engine is unchanged by the patch.
- `dist/iroh-node.js` SHA-256:
  `4e2d2c2a5815dae5be79bade6aed3b3d5f8e65e93d4be26295793c579c52ef61`
- `iroh --version` prints `iroh 1.0.1 (engine dist iroh-node.js
  4e2d2c2a5815, runtime node v18.5.0)` inside a packaged binary
  (runtime is the embedded Node; on npm it is the local node).

## Legs and artifacts

Availability per artifact. "Local" means the toolchain must exist
on the machine (`python3` on PATH, `g++` on PATH).

| Leg | npm / source | Linux / macOS / Windows EXE | Android APK |
|---|---|---|---|
| JavaScript | yes | yes | yes |
| Python | yes, python3 local | yes, python3 local | no (no python3 on Android) |
| C++ | yes, g++ local | yes, g++ local | no (no g++ on Android) |

- Three traced languages only. No IrohScript, no BASIC, no
  input synthesiser, no `capabilities`, no `doctor`, no `serve`,
  no `node`, no `--max-events` — those are later generations.
- EXE embedded runtime: Node 18.5.0 (pkg 5.8.1, node18 targets).
  npm package requires Node >= 18. The two numbers agree.
- APK: arm64 only, debug-signed, minSdk 24, targetSdk 34.
  Node runs from `nativeLibraryDir` as `libnode.so` (bundled Node
  v26.13.1, from the Termux build). versionCode 102.
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
- `--file <path>` — the program file (same as the positional arg).
- `--module` — trace as an ES module (JavaScript only).
- `--analyze` — append an analysis line after the result line.
- `--scan` — one scan line `{ vectors, findings, scores, summary }`
  instead of the event flood. `--include-events` — embed the raw
  events in the scan document (needs `--scan`).
- `--live` — stream live-finding lines as findings trip, then a
  live-summary line.
- `--direct[=throttle|stop]` — run under the runaway-loop guard
  (JavaScript only). Combines with `--analyze`, `--scan`, `--live`.
- `--translate python|cpp|javascript` — translate instead of
  tracing. `--from python|cpp|javascript` — source language
  (default: by file extension).
- `--lang python|cpp|javascript` — force the tracer (default: by
  file extension).
- `--version` — one line: version, dist hash, embedded runtime.
- `-h` / `--help` — usage.

## JSON shapes

Ask for JSON. Never parse console prose; it is for humans and will
change. Event streams are JSON lines, one object per line, with the
`language` field always set.

- Event line:
  `{"type":"event","event":"FUNCTION_CALL","category":"CALL",
  "trigger":"before","language":"javascript","hash":11,"indent":1,"name":"factorial",
  "arguments":[3],"external":false}`
  followed by a result line `{"type":"result","value":6}` or an
  error line `{"type":"error","name":...,"message":...}`.
- `--scan` result:
  `{vectors, findings, scores, summary}`. `vectors` carries
  `features {calls, depth, repeat, imbalance, mix, coverage,
  events}`, `vector[6]`, `names[6]`. `findings` is a list of
  `{code, severity, message, evidence, neuron}`. `summary` carries
  `{events, findings, warnings, language, infos,
  neuron {label, score}, maxCallDepth, distinctRegions,
  findingsTruncated}`. There is NO `unclosedFrames` field in
  1.0.1 (that came in 1.1.1) — do not look for it.
- `--translate` result (one line):
  `{type:"translation", from, to, code, report}`. `report` carries
  `{ok, from, to, staticOnly, clean, assumptions, unsupported,
  notes, verify}`. Template literals to Python emit concatenation,
  not f-strings; `verify` records the execution check (`ran: null`
  is not `ran: true`).
- `--live` lines: `live-finding` (with `firedAt`) as findings trip,
  then `live-summary` (batch-equal findings, scores, vectors).
- `--direct` lines: `directive` as the guard acts, then
  `direct-summary` (findings, directive audit log, analysis).

## Coverage denominators

Coverage is fired / 30 for every language in 1.0.1 — the
JavaScript category model, applied to all tracers. There is no
`reachable` field in 1.0.1 (per-tracer reachable denominators
came in 1.1.1). A C++ trace at 2 of 30 is complete at function
level, not 28 short: the tracer can only fire CALL and FUNCTION.
A Python trace fires ASSIGN, CATCH, CALL, FUNCTION, IF, LOOP.
Do not read a missing `reachable` as 30 and do not read it as
zero — the field does not exist in this generation; the
denominator is always 30 and the honest reading is "of the
JavaScript model".

## Findings cap

- Findings are capped at 200. `summary.findingsTruncated` is the
  dropped count. If `findingsTruncated > 0`, the finding list is a
  prefix, not the whole set — say so when you report it. Any score
  derived from the list is a score over a prefix.

## Memory model

- A finished trace does NOT release its Stage in 1.0.1: the Stage
  stays registered in `Iroh.stages` and its listeners keep the
  trace alive. There is no `Stage.release` and no
  `releaseTraceRun` in this generation (those came in 1.1.1).
  In a long-lived process, memory grows with the events retained.
- Full model: `docs/memory.md` in this repo, `txt/memory.md` in
  the AI bundle.

## Contract (six lines)

1. Ask for JSON. Never parse console prose; it is for humans and
   will change.
2. `--scan` returns `{vectors, findings, scores, summary}`.
   Findings are capped at 200; when `summary.findingsTruncated`
   > 0 your list is a prefix, say so when you report.
3. Every coverage number is fired out of 30 in 1.0.1 — the
   JavaScript model, for every language. A C++ trace at 2 of 30
   is complete at function level, not 28 short.
4. Event streams are JSON lines, one object per event, `language`
   field always set.
5. Translate results carry a `verify` block: the emitted Python
   is executed under python3 and the result recorded. `ran: null`
   means not attempted, never success.
6. Nothing in the report is a measurement of your program's
   correctness. It is a measurement of what ran. Say which one
   you have when you quote it.
