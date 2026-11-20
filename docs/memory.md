# Trace memory / state model

For AI consumers loading IrohRedux traces. Short and factual; every
claim comes from the code in this tree (`src/index.js`, `src/setup.js`,
`src/analyze.js`, `src/scan.js`, `src/translate.js`).

## What a trace holds while it runs

A trace runs inside a `Stage` (`Iroh.Stage`). The Stage registers
itself in `Iroh.stages` under a unique key (`src/index.js`: the
constructor does `iroh.stages[stage.key] = stage`) and holds its
listeners (one list per event category). The generated (patched)
script reads the Stage through the registry while it evaluates.

## No release: a finished trace keeps its Stage (1.0.1)

There is no `Stage.release` and no `releaseTraceRun` in this
generation — `grep release src/` finds nothing. A finished Stage
stays registered in `Iroh.stages` forever, and its listeners (and
their closures) keep the whole trace alive. The caller owns the
events array it was handed, but the engine keeps its own copy too,
through the registered Stage.

Measured on this box (Node 24.22.1, `--expose-gc`): 200 traces of
the 150-loop program (763 events each, 152,600 events total) leave
a ~44,000 KiB residual heap after dropping the caller's references
and two GC passes. That is roughly 288 bytes per event retained —
not because the events are large, but because each Stage holds its
listeners, closures, and patched script as well as its events.

Consequence for a long-lived process: memory grows with every trace
you run in-process, unbounded. If you run many traces, run each in
its own process (the CLI does this naturally — one process per
invocation, memory freed on exit), or restart the process
periodically. The release step that fixes this (`Stage.release` /
`releaseTraceRun`) came in 1.1.1; it is not in 1.0.1, and this patch
does not backport it.

## Coverage denominators

Coverage is `fired / 30` for every language in 1.0.1 — the
JavaScript category model, applied to all tracers. `scores.coverage`
carries `{fired, total, value}` and `value` = fired/30.
`missingCategories` lists the categories that did not fire.
There is no `reachable` field in 1.0.1 (per-tracer reachable
denominators came in 1.1.1), so do not look for it — and do not
read a missing field as a zero.

| Language | Fired (typical) | What the tracer can see |
|---|---|---|
| javascript | up to 30 | all categories (the full engine) |
| python | 6 | ASSIGN, CATCH, CALL, FUNCTION, IF, LOOP |
| cpp | 2 | CALL, FUNCTION (function-level only) |

A C++ trace at 2 of 30 is complete at function level, not 28
short. A Python trace fires the six categories above and no
others. Source of truth: `src/labels.js` (the category table)
and `src/analyze.js` (the scorecard).

## findingsTruncated

Findings are capped at 200 (`maxFindings`, default 200).
`summary.findingsTruncated` is the dropped count. If it is > 0,
the finding list is a prefix, not the whole set — say so when you
report it. Any score derived from the list is a score over a
prefix. The dropped findings are counted, never hidden.

## Translate verification

This patched 1.0.1 tree adds `report.verify`:
`{attempted, ran, interpreter, exit}`, with `stderr` when execution
fails or `reason` when it is not attempted. Only Python output is
executed, under `python3` with a 10-second limit. `ran: null` means
not attempted; `report.ok` alone is not proof that generated code ran.

Template literals translated to Python use concatenation rather than
f-strings, so quoted or boolean interpolation no longer creates the
known Python 3.9–3.11 parse error. The verification block still reports
the actual execution outcome and interpreter.

## What this file does not cover

This is the trace memory/state model only. Engine identity, CLI
flags, and JSON shapes live in `README.md` (FOR AI) and `API.md`
(FOR AI). The generations registry is `generations.json`.
