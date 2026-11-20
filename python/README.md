# Iroh for Python

Trace JavaScript at runtime from Python, through the IrohRedux CLI.

```python
from iroh import run

events, result = run(
    "function factorial(n) {"
    "  if (n === 0) return 1;"
    "  return n * factorial(n - 1);"
    "}; factorial(3);",
    events=["CALL", "IF"],
)
print(result)  # 6
calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
print(calls[0]["arguments"])  # [3]
```

## Install

This package is a thin client over the IrohRedux CLI (`cli/iroh.js`), so it
needs Node.js and an IrohRedux checkout (or the `IROH_CLI` environment
variable pointing at the CLI).

```sh
pip install -e python/
```

## API

- `run(code, events=None)` — trace JavaScript source, return
  `(events, result)`. `events` is a list of category names to filter by
  (e.g. `["CALL", "IF"]`); the default is all categories.
- `trace_file(path, events=None)` — same, reading the source from a file.
- `TraceError` — raised on a parse or runtime error in the traced program,
  with `.message`, `.name`, and `.events` (the events that fired first).

## Trace Python natively (0.9.0)

- `trace_python(code, events=None)` — trace Python source with the
  native tracer (`sys.settrace` + AST instrumentation of loops, branches
  and `except` handlers), return `(events, result)` where result is
  `None`. Events are the same JSONL shape as JavaScript traces, so
  `Iroh.analyze()` findings fire on them (`HOT_LOOP` for a hot loop,
  `THROWING_PATH` for a caught exception).
- `trace_python_file(path, events=None)` — same, reading the source from
  a file.
- `scan(code, events=None)` — scan a JavaScript trace: one compact dict
  `{ vectors, findings, scores, summary }` (see `src/scan.js`).
- `scan_python(code, events=None)` / `scan_python_file(path, events=None)`
  — same, for a Python trace (`summary["language"] == "python"`).

Honest limits: no per-assignment events, only the target file is traced,
comprehensions/`async for`/lambdas are not loop/branch instrumented,
single-threaded. See the 0.9.0 CHANGELOG entry.

## Environment

- `IROH_CLI` — path to `cli/iroh.js` (default: found next to this package
  in the checkout).
- `IROH_NODE` — Node binary (default: `node`).
