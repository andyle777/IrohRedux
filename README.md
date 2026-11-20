![IrohRedux — Watch your code run. Change it while it runs.](assets/banner.png)

<p align="center">
  <a href="https://github.com/andyle777/IrohRedux/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-1.1.0-orange.svg?style=flat-square" alt="Version 1.1.0" />
  <img src="https://img.shields.io/badge/node-%3E%3D%2018-339933.svg?style=flat-square" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/python-%3E%3D%203.9-3776AB.svg?style=flat-square" alt="Python >= 3.9" />
  <img src="https://img.shields.io/badge/C%2B%2B-17-00599C.svg?style=flat-square" alt="C++17" />
  <img src="https://img.shields.io/badge/TypeScript-types-3178C6.svg?style=flat-square" alt="TypeScript types included" />
  <img src="https://img.shields.io/badge/tests-634%20passing-brightgreen.svg?style=flat-square" alt="634 tests passing" />
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

The original Iroh 0.3.0 (2018) lives in `original-iroh/`, preserved
untouched. IrohRedux is the fork that builds on it. The core idea is
Felix Maier's.

## Install

Download from the
[Releases page](https://github.com/andyle777/IrohRedux/releases).
No Node install needed for the binaries.

- **Windows, Linux, macOS:** the EXE for your system. Download, run.
  The EXE embeds its own Node runtime, version 18.5.0 — the same
  floor the npm package asks for (Node >= 18). `iroh --version`
  prints the runtime actually embedded.
- **Android:** the APK. Install it on your phone. JavaScript legs
  only — there is no python3 on Android.

Or install from source (needs Node >= 18):

```sh
git clone https://github.com/andyle777/IrohRedux.git
cd IrohRedux
npm install
npm run dist        # builds dist/iroh-node.js, dist/iroh-node.es.mjs, dist/iroh-browser.js
npm run build:catalog # builds the offline SQLite reference catalog
npm test            # 634 tests: 377 Node + 25 Python + 9 C++ + 223 IrohScript/BASIC
```

The Python client installs with `pip install -e python/`. The C++
client is a single header — just `#include "iroh.hpp"`.

Works offline — no network required. Nothing in the app or the
binaries phones home, checks for updates, or downloads at first run.
The APK manifest does not even request internet permission.

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
loop or branch events, so a C++ trace fires 2 categories (CALL and
FUNCTION) and reads "2 of 30" — complete for its tracer, not 28
short. (Per-language reachable sets are 1.1.1 work.)

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
iroh --version      # version, dist hash, embedded runtime
```

(1.1.0 has no `iroh doctor` or `iroh capabilities` — those are
1.1.1 commands, not backported. `--version` is the self-report
this generation gets.)

## What works / what doesn't

Honest limits, in one place.

- **Android:** JavaScript legs only. No python3, no g++ on the
  phone, so Python, C++, IrohScript and BASIC cannot run there.
  The app says so on its status line. There is no remote-execution
  service for the non-JS legs in this generation — that is a
  follow-up, not a feature here. (The 1.1.1 phone-as-server feature
  is not in 1.1.0.)
- **Windows, Linux, macOS EXEs:** the bundled runtime is Node
  18.5.0, matching the npm package floor (Node >= 18).
- **Python, C++, IrohScript, BASIC legs:** need python3 (and g++
  for C++) on the machine. The JavaScript legs run fully standalone.
- **APK:** arm64 only, debug-signed (side-load only; a rebuild on
  another machine forces an uninstall first). The bundled Node
  is v26.13.1 and the binary is 16 KB page safe (measured: PT_LOAD
  alignment 0x4000).
- **IrohScript:** LOOP has no defined exit rule in the spec, so
  executing one is an error, not a trace. `HOT_LOOP` and
  `ZERO_ITERATION_LOOP` can never fire for IrohScript until that
  rule is decided.
- **BASIC:** GOTO has no event category, so GOTO loops are invisible
  in the trace (FOR/NEXT is the observable loop). DIM and array
  reads have no events either.
- **Translate:** `translate()` runs the program for type evidence
  (there is no opt-out in 1.1.0 — the `evidence: "none"` option is
  1.1.1 work). The report carries a `verify` block saying whether
  the emitted program was executed and what happened — `ran: null`
  means not attempted, never success.
- **Scores:** every coverage number carries its own denominator,
  and in 1.1.0 the denominator is always 30 — the full category
  model — for every language. A C++ trace firing CALL and FUNCTION
  reads "2 of 30" with 28 missing categories: complete for its
  tracer, but the number reads short. The per-language reachable
  sets that fix this are 1.1.1 work, not in this generation. See
  the FOR AI section below.

## Releases

Newest first. Hashes live on the release page, not in this file.

- **1.1.0 (patched, 20 Nov 2026) — this tree.** Same version,
  patched in place: no 1.1.2, no version bump. The Python
  translator no longer emits f-strings for template literals
  (concatenation instead — the old output was a SyntaxError on
  Python 3.9–3.11 while the report said ok, and in 1.1.0 the bool
  case was broken too, which 1.1.1 had already fixed as D1).
  Every translate result carries a `verify` block. The APK runs
  its Node runtime from the native library directory (the old
  build could not start on Android 10+: error=13, Permission
  denied). The desktop EXEs are rebuilt from the patched engine.
  The AI bundle is regenerated from the patched engine, with a
  per-file hash manifest and a memory-model note. `iroh --version`
  prints the version, the dist hash, and the runtime actually
  embedded. 645 tests (390 Node + 25 Python + 9 C++ + 221
  IrohScript/BASIC).
- **1.1.0 (20 Nov 2026) — the new release.** The IrohScript
  foundation rework (IrohScript and BASIC trace first-class, the
  five-language translator, the IrohScript compiler with the
  perceptron core in IrohScript), the input synthesiser on the
  live wire, and the redo audit pass (five fresh bugs fixed,
  ES2026 probe fix folded in). 649 tests as shipped (392 Node +
  25 Python + 9 C++ + 223 IrohScript/BASIC — the release tree;
  this patch tree counts 637 at its base commit, ebe22f5).
- **1.0.1 (20 Nov 2026) — the solid base.** The audit-and-patch
  pass over 0.4.0–1.0.0: every known limitation re-read and
  re-probed, the real bugs fixed. 348 tests.

Newer: 1.1.1 exists as a later generation (the trace memory
release, plus its own patch). This tree is the 1.1.0 patch, not
1.1.1 — its fixes are the ones in the table below.

## Compatibility table

Dated 20 Nov 2026. "Present" means the defect is in that
generation as shipped; "patched" means fixed in the 1.1.0 patched
rebuild (same version, this tree). The machine-readable form is
`generations.json` in this repo.

| Defect | 1.0.1 | 1.1.0 | 1.1.0 patched |
|---|---|---|---|
| APK cannot execute its own runtime (error=13) | present | present | fixed (Fix B) |
| Bool interpolation emits an unparsable f-string below 3.12 | present | present | fixed (concatenation) |
| Any interpolation containing a delimiter quote, backslash, brace or colon | present | present | fixed (concatenation) |
| Success reported when the artifact cannot run (no verify field) | present | present | fixed |
| EXE bundles a Node 18.5.0 runtime while metadata claims a newer floor | not applicable (1.0.1/1.1.0 metadata says >= 18) | not applicable | stated honestly (--version + README) |
| AI bundle API text does not document the translate verify field | present | present | fixed (generated from API.md + flag check) |
| No manifest of file hashes in the AI bundle | present | present | fixed |
| APK ships arm64 only, debug cert | present | present | present (unchanged) |

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
  personality-matrix contracts for AI clients.

Build the local AI bundle with `npm run build:ai-bundle -- ./ai-bundle`.
It contains the current release documentation, schemas, the Personality
Matrix JSON, the SQLite offline memory catalog, engine-generated JSON
samples, the Python client, and per-file SHA-256 hashes. The SQLite
catalog is reference data only: it stores no user traces and does not
sync over the network. The JSON model and schemas are the portable
interface for clients without SQLite support; tracing works offline.

---

# FOR AI

Machine-readable facts. Load this section without guessing. If a
fact here disagrees with a prose paragraph above, this section wins
— and the disagreement is a bug; file it.

## Engine identity

- Engine: IrohRedux 1.1.0 (patched in place, 20 Nov 2026).
  No 1.1.2. No version bump.
- `dist/iroh-node.js` SHA-256:
  `bbb12a7068d904d88426999bd587e9f76485bbdb7b72a41616fab63ed33455f2`
- `iroh --version` prints `iroh 1.1.0 (engine dist iroh-node.js
  0b13cb174f03, runtime node v18.5.0)` inside a packaged binary
  (runtime is the embedded Node; on npm it is the local node).
- 1.1.0 has no `iroh doctor` (that is 1.1.1 work). `--version`
  is the self-report this generation gets.

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
  npm package requires Node >= 18. The two numbers agree; the
  binary reports the one it runs.
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
- `--translate python|cpp|irohscript|basic|javascript` — translate
  instead of tracing. `--from python|cpp|irohscript|basic` —
  source language (default: by file extension).
- `--lang python|cpp|javascript|irohscript|basic` — force the
  tracer (default: by file extension).
- `--file <path>` — the program file (same as the positional arg).
- `--version` — one line: version, dist hash, embedded runtime.
- `-h` / `--help` — usage.

(Not in 1.1.0: `--max-events`, the `--verify` CLI flag,
`iroh capabilities`, `iroh doctor`, `iroh serve`, `iroh node` —
those are 1.1.1 work. The translate *report's* `verify` field
below IS in this patch; it is not a CLI flag.)

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
  findingsTruncated}`. There is no `unclosedFrames` field in
  1.1.0 (that is 1.1.1 work).
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

## Coverage denominators (1.1.0 — no reachable sets)

Coverage is fired / total, and in 1.1.0 `total` is always 30 —
the full category model — for every language. There are no
per-language reachable sets in this generation (those are 1.1.1
work). `scores.coverage` carries `{fired, total, value,
firedCategories, missingCategories}` and `value` = fired/total.
`missingCategories` lists the categories of the 30-model that did
not fire — for a C++ trace that is 28 entries, because the C++
tracer is function-level by design (CALL and FUNCTION only).
Read it as "2 of 30 in a model the tracer cannot fill", not as
"28 categories missing". A C++ trace at 2 of 30 is complete for
its tracer.

## Findings cap

- Findings are capped at 200. `summary.findingsTruncated` is the
  dropped count. If `findingsTruncated > 0`, the finding list is a
  prefix, not the whole set — say so when you report it. Any score
  derived from the list is a score over a prefix.

## Memory model

- 1.1.0 has no `Stage.release`: a finished trace's Stage stays
  registered in `Iroh.stages` with its listeners, so retention
  grows with the trace in a long-lived process. (The 1.1.1 patch
  measured the same code path at ~137 bytes/event, a 500,013-event
  trace leaving ~68 MB before its release fix.)
- There is no `summary.unclosedFrames` field in 1.1.0.
- Full model: `docs/memory.md` in this repo, `txt/memory.md` in
  the AI bundle.

## Contract (six lines)

1. Ask for JSON. Never parse console prose; it is for humans and
   will change.
2. `--scan` returns `{vectors, findings, scores, summary}`.
   Findings are capped at 200; when `summary.findingsTruncated`
   > 0 your list is a prefix, say so when you report.
3. Every coverage number carries its own denominator. In
   1.1.0 the denominator is always 30 (the full category model),
   for every language — there are no per-language reachable sets
   in this generation. A C++ trace at 2 of 30 is complete for its
   tracer, not 28 short.
4. Event streams are JSON lines, one object per event, `language`
   field always set.
5. Translate results may carry `verify`. `ran: null` means not
   attempted, not success.
6. Nothing in the report is a measurement of your program's
   correctness. It is a measurement of what ran. Say which one
   you have when you quote it.
