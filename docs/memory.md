# Trace memory and state model

This note describes the IrohRedux 1.1.1 patched trace lifecycle for
AI consumers and other long-lived clients. It reflects the code in
`src/setup.js`, `src/stage/index.js`, `src/direct.js`, and `src/synth.js`.

## Trace lifecycle

A trace creates a `Stage` that owns its event listeners and instrumented
program while the program runs. When the run settles, IrohRedux detaches
the listeners and removes the Stage from the Iroh stage registry. This
cleanup applies to synchronous and asynchronous traces, modules, direct
runs, and synthesis candidate runs, including runtime-error paths.

The returned events remain owned by the caller and are not cleared.
Keeping a result or its events therefore keeps those objects alive; the
engine no longer retains completed Stages and their listener closures.

On the measured 500,013-event run described in the 1.1.1 release notes,
the residual heap after dropping the result and forcing garbage
collection was 472,976 bytes. This is a measurement from that run, not
a per-machine memory guarantee.

## Incomplete generator frames

`summary.unclosedFrames` is `null` when every frame has closed. If a
generator is still open when tracing ends, it is an object containing
`count`, `frames`, and `note`. This reports an incomplete observation;
it does not by itself mean the trace failed.

## Scan output and coverage

`--scan` returns `{vectors, findings, scores, summary}`. The default
finding limit is 200. If `summary.findingsTruncated` is greater than
zero, `findings` is only a prefix of all findings; mention that when
reporting results.

Coverage is `fired / reachable` when `reachable` is present. Use the
reported denominator for that tracer; do not assume every language can
reach all JavaScript event categories. If the denominator is absent,
report the score as unnormalised rather than inventing one.

Reachable categories in this release:

| Language | Reachable | Categories |
|---|---:|---|
| javascript | 30 | All categories |
| python | 6 | ASSIGN, CATCH, CALL, FUNCTION, IF, LOOP |
| cpp | 2 | CALL, FUNCTION |
| irohscript | 5 | ASSIGN, CALL, FUNCTION, IF, LOOP (LOOP since Amendment A1) |
| basic | 5 | ASSIGN, CALL, FUNCTION, IF, LOOP |

These are capabilities of the current tracers, not a claim that a
particular run exercised every category. A filtered event trace also
measures only the events that were collected.

## Translation verification

Translation results include `report.verify`. `ran: true` means the
generated Python program ran successfully under the reported
interpreter. `ran: false` means execution was attempted and failed;
`ran: null` means it was not attempted. The current implementation
executes only the Python target, with a 10-second limit. Never treat
`report.ok` alone as proof that generated code ran or is correct.

## Process boundaries

Trace state is released when a run settles, but the caller still owns
the returned events and may retain them. For additional isolation, the
CLI starts a new process per invocation. No network service or external
AI model is required for local tracing.
