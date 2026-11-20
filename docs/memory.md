# Trace memory / state model

For AI consumers loading IrohRedux traces. Short and factual; every
claim comes from the code in this tree (`src/stage/index.js`,
`src/setup.js`, `src/analyze.js`, `src/scan.js`, `src/vectors.js`,
`src/translate.js`). This is the 1.1.0 model — it is NOT the 1.1.1
model: there is no `Stage.release`, no `summary.unclosedFrames`,
and no per-language reachable sets here. Those are 1.1.1 work.

## What a trace holds while it runs

A trace runs inside a `Stage` (`Iroh.Stage`). The Stage registers
itself in `Iroh.stages` under a unique key (`src/index.js`) and holds
its listeners (one list per event category). The generated (patched)
script reads the Stage through the registry while it evaluates —
never after.

## Release: there is none in 1.1.0

A finished trace's Stage stays registered in `Iroh.stages` with its
listeners. Nothing unregisters it and nothing empties the listener
lists. In a long-lived process retention grows with the trace: every
Stage, its listeners, and the closures that capture the trace stay
alive. The 1.1.1 patch measured this same code path at ~137
bytes/event, a 500,013-event trace leaving ~68 MB before its release
fix — that measurement is of the pre-fix engine, which is this
behaviour. The returned events array is yours; the engine keeps its
own references too, so dropping your copy does not free the Stage.
If you trace many programs in one process, restart the process or
expect the heap to grow.

## Coverage denominators: always 30 in 1.1.0

Coverage is `fired / total`, and `total` is always 30 — the full
category model — for every language. `scores.coverage` carries
`{fired, total, value, firedCategories, missingCategories}` and
`value` = fired/total, plus a note: "Assumes an unfiltered trace
(events: ALL). A trace collected with an events filter scores the
filter, not the toolkit." `missingCategories` lists the categories
of the 30-model that did not fire. A C++ trace firing CALL and
FUNCTION reads "2 of 30" with 28 missing categories: complete for
its tracer (function-level by design), but the number reads short.
There are no per-language reachable sets in this generation — the
`reachable` field does not exist anywhere in a 1.1.0 report, and a
consumer must never invent one. `toVector()` scores coverage the
same way: fired / 30 for every language (`src/vectors.js`).

## findingsTruncated

Findings are capped at 200 (`maxFindings`, default 200).
`summary.findingsTruncated` is the dropped count. If it is > 0,
the finding list is a prefix, not the whole set — say so when you
report it. Any score derived from the list is a score over a
prefix. The dropped findings are counted, never hidden.

## Translate verify block

Every `translate()` result carries `report.verify`:
`{attempted, ran, interpreter, exit}`, plus `stderr` when `ran`
is false (the interpreter's output, verbatim) or `reason` when
`attempted` is false. Only the Python leg is executed (under
`python3`, 10 s cap); other legs record `attempted: false` with a
reason. `ran: null` means not attempted — never read it as
success. Template literals to Python emit concatenation, not
f-strings (1.1.0 patch): `` `a=${x}` `` becomes `("a=" + str(x))`.
Ints go through `str()`, bools through `__iroh_jsbool`, doubles
through `__iroh_jsnum`.

## What this file does not cover

This is the trace memory/state model only. Engine identity, CLI
flags, and JSON shapes live in `README.md` (FOR AI) and `API.md`
(FOR AI). The generations registry is `generations.json`.
