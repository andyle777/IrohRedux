# IrohScript 3.0 — Minimum Viable System

The first runnable proof of Andy's IrohScript 3.0 ("The Complete Trifecta
Variant"). The full spec is `irohscript-3.0-spec.md`. This directory
implements **spec section 54 only** — the minimum viable system — and
nothing more. It is the Level 0 Python bootstrap (spec section 21).

> **Foundation note (1.0.1 rework):** this directory is a copy of the
> language home (`~/workspace/irohscript/`) into the IrohRedux repo, so
> IrohRedux can trace IrohScript (and BASIC) first-class. The home
> directory remains the language's home for now — the duplication and
> the question of a single canonical home are open questions for Andy,
> not settled here by deleting anything. The tracers below
> (`src/tracer.py`, `src/trace.py`, `src/basic.py`,
> `src/basic_trace.py`, `src/traceutil.py`) exist only in this copy;
> the bootstrap itself (`src/lexer.py` … `src/bridge.py`) is unchanged
> from the home copy.

## What is built

- **IrohCore** (`src/irohcore.py`) — the heart: canonicalization (the
  BASIC form and the legacy form mean the same thing) and the intent
  graph.
- **BASIC-first parser** (`src/lexer.py`, `src/parser.py`) — LET, CONST,
  FUNCTION, IF/ELSE, RETURN, PRINT, ACTION, STRUCT, ENUM, IMPORT,
  INTENT, LOOP (the legacy bare form, plus the conditional
  `LOOP <Bool-expr>` decided by Amendment A1, 2026-11-21), plus
  the legacy Iroh translator (`enemy -> defend`).
- **Type system** (`src/typesys.py`, `src/checker.py`) — Int, String,
  Float, Bool, STRUCT/ENUM types, CONST mutation rejection.
- **AST → IR → IRX** (`src/ast_nodes.py`, `src/ir.py`, `src/irx.py`) —
  IRX is JSON, version "3.0", opcode form per spec section 26.
- **Compiler passes** (`src/compiler.py`) — lexing, parsing, AST,
  semantic analysis, type checking, name resolution, canonicalization,
  IR generation, IRX emission; optimizer does constant folding
  (section 27) and dead-code elimination (section 28).
- **Interpreter** (`src/interpreter.py`) — executes IRX.
- **Python bridge** (`src/bridge.py`) — `IrohRuntime.execute(irx)` per
  spec section 47.

## How to run

From this directory:

```sh
python3 -m src.cli run examples/add.iroh
python3 -m src.cli compile examples/add.iroh            # IRX JSON
python3 -m src.cli compile examples/add.iroh --ast --ir # all stages
python3 -m unittest discover -s tests -v                # full suite
```

Or from Python:

```python
from src.bridge import IrohRuntime
runtime = IrohRuntime()
out = runtime.run_source('LET X : Int = 10')
# out: {"output": [...], "actions": [...], "intents": [...],
#       "variables": {"X": 10}, "irx": {...}, "warnings": [...]}
```

## Examples

| File | What it proves |
|---|---|
| `examples/add.iroh` | Functions, calls, PRINT (prints `30`) |
| `examples/defend_true.iroh` / `defend_false.iroh` | IF on a Bool |
| `examples/legacy.iroh` | `enemy -> defend` runs the action |
| `examples/fold.iroh` | Constant folding (`10 + 20` → `30`) |
| `examples/deadcode.iroh` | `IF FALSE` eliminated |
| `examples/structs.iroh` | STRUCT defaults, field assign, ENUM |
| `examples/intent.iroh` | INTENT enters the IrohCore graph |
| `examples/add.bas` | BASIC: LET, PRINT (prints `30`) |
| `examples/hotloop.bas` | BASIC: FOR/NEXT hot loop (prints `11325`) |
| `examples/gosub.bas` | BASIC: GOSUB/RETURN |
| `examples/input.bas` | BASIC: INPUT with a prompt |

## Tracing (IrohRedux 1.0.1 rework)

Both languages trace through the IrohRedux CLI with the same JSONL
event shape as JavaScript/Python/C++ (`node cli/iroh.js program.iroh`
/ `program.bas`, `--analyze` / `--scan` / `--live` all work):

```sh
python3 -m src.trace examples/add.iroh            # IrohScript tracer
python3 -m src.basic_trace examples/hotloop.bas   # BASIC tracer
```

- **IrohScript** (`src/tracer.py`): hooks in the IRX interpreter —
  function calls (arguments, return, depth), IF tests, assignments.
  Hashes are CRC32 of kind:file:instruction-path (IRX carries no
  source positions; the path is deterministic because compilation
  is). A function body traces under its definition path, never the
  call site. Blind spots: the legacy bare LOOP raises (no exit rule in the
  spec), but since Amendment A1 (2026-11-21) the conditional
  `LOOP <Bool-expr>` traces LOOP_TEST / LOOP_ENTER exactly like the
  python leg's while loop; INTENT has no event category; a call
  that raises has no CALL_END / LEAVE.
- **BASIC** (`src/basic.py`, `src/basic_trace.py`): a small dedicated
  interpreter — GOTO/FOR need a program counter, which the IrohScript
  tree-walk cannot express. v1 covers line numbers (optional), `:`
  separators, REM, `?`, LET/bare assignment, PRINT (`;`/`,`),
  INPUT (optional prompt), DIM/arrays (any dimension), IF/THEN/ELSE
  (single-line, and `IF … THEN <line>` as a jump), FOR/NEXT with STEP
  (nested), GOTO, GOSUB/RETURN, END/STOP. Events: FOR tests/entries,
  IF tests, GOSUB calls (`gosub@<line>`), assignments. Blind spots:
  GOTO has no event category (GOTO loops are invisible); DIM and
  array reads have no events. NOT in v1 (each a clear error naming
  the construct): DATA/READ, WHILE/WEND, DEF FN, ON GOTO/GOSUB,
  built-in functions, file I/O, PRINT zones, INPUT reprompting.
  FOR/GOTO/GOSUB inside an IF THEN/ELSE part is a v1 parse error.

## Rules the MVP pins down

These are decisions the spec leaves open, stated here so Andy can
overturn them. They are also listed as open design questions in the
build report.

- **Keywords are case-insensitive; identifiers keep their case.**
  Expressions never span a line. `#` starts a line comment.
- **Strict types:** Int and Float are distinct; assignment needs an
  exact match. Untyped function parameters are `Unknown` and compatible
  with everything (checked at runtime instead).
- **A bare identifier after ACTION (or on the right of `->`) names the
  action symbol itself** — that is what makes `enemy -> defend` and
  `IF enemy ACTION defend END IF` produce the identical Conditional.
  A legacy symbol may share a name with a BASIC keyword (`action ->
  result` parses); a word followed by `->` is always a legacy
  implication.
- **Arithmetic is Python-style:** `/` is true division (`7 / 2 = 3.5`),
  `%` is floored modulo (`-5 % 3 = 1`). This is the bootstrap's
  semantics; C++ truncated semantics is a one-line change.
- **Bools print as `TRUE` / `FALSE`.**
- **`LET Name : StructType`** with no value creates a default instance
  (fields defaulted: Int 0, Float 0.0, String "", Bool False).
- **Deterministic compiler:** same source + version + config → identical
  IRX (no clock, no environment, sorted JSON keys). No LLM anywhere in
  the compiler (spec section 31).

## Deliberately NOT built (spec section 54: runtime extensions)

SentenceTransformers, Chroma, RLM, LLM providers, iLanders, OmniMesh,
Dream, Pillars, emotion engine, Value/Reference/Handle semantics,
resource ownership (OPEN/USE/RELEASE), capability authorization,
`COMPILE "..."` as a language object. `IMPORT` of a namespace is
accepted and recorded, but any use of it is a clear compile error
naming the extension. Legacy `LOOP` parses to an AST node but executing
it raises a clear error: the spec shows the form, not the termination
rule. The conditional `LOOP <Bool-expr>` form (Amendment A1,
2026-11-21) does execute, test-first, and traces, and since the
lowering patch (Amendment A2, same day) it exchanges with JavaScript
`while` in both translate directions.

## Tests

244 tests, all passing (run: `python3 -m unittest discover -s tests`):

| Layer | Tests |
|---|---|
| Lexer | 21 |
| Parser | 37 |
| AST / canonicalization / IrohCore | 19 |
| Type checker / semantics | 31 |
| IR lowering | 10 |
| IRX / determinism | 7 |
| Optimizer | 13 |
| Interpreter | 26 |
| Python bridge | 7 |
| Golden (source → AST → IR → IRX) | 2 test methods over 10 fixtures |
| IrohScript tracer | 16 |
| BASIC interpreter | 41 |
| BASIC tracer | 14 |

Golden fixtures live in `tests/golden/*.json` and were hand-checked
after generation. If a golden test fails, fix the compiler (or get the
representation change approved) — do not silently regenerate them
(`python3 tests/gen_golden.py`).
