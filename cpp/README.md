# Iroh for C++

Trace JavaScript at runtime from C++, through the IrohRedux CLI.
Header-only, C++17, no third-party dependencies (a minimal JSON parser is
included in the header).

```cpp
#include "iroh.hpp"

iroh::Client client;
auto trace = client.run(
    "function factorial(n) {"
    "  if (n === 0) return 1;"
    "  return n * factorial(n - 1);"
    "}; factorial(3);",
    {"CALL", "IF"});
// trace.result.as_number() == 6
// trace.events: FUNCTION_CALL / FUNCTION_CALL_END / IF_TEST / ...
```

## Build

```sh
make          # builds example and test_client
make test     # runs the tests
./example     # prints the factorial trace
```

Run from the repo root so `./cli/iroh.js` is found, or set `IROH_CLI`.

## API

- `iroh::Client()` — finds the CLI via `IROH_CLI`, else `./cli/iroh.js`,
  `../cli/iroh.js`, `../../cli/iroh.js`. Node binary via `IROH_NODE`.
- `run(code, events = {})` — trace JavaScript source, return an
  `iroh::Trace` with `.events` (a vector of `iroh::Json`) and `.result`.
  `events` filters by category, e.g. `{"CALL", "IF"}`; empty means all.
- `run_file(path, events = {})` — same, for a file.
- `iroh::TraceError` — thrown on a parse or runtime error, with `.name`
  (e.g. `"SyntaxError"`) and `.events` (the events that fired first).
- `iroh::Json` — the parsed JSON value: `.as_string()`, `.as_number()`,
  `.as_bool()`, `.as_array()`, `.as_object()`, `["key"]`, `.has(key)`.

## Trace C++ natively (0.9.0)

- `iroh::native::Tracer()` — finds the runtime `cpp/iroh_trace_rt.cpp`
  via `IROH_TRACE_RT`, else `./cpp/`, `../cpp/`, `../../cpp/`. Compiler
  via `IROH_CXX` (default `g++`).
- `trace_code(code)` / `trace_file(path)` — compile the program with
  `-finstrument-functions -rdynamic -O0`, link it against the runtime,
  run it, and return an `iroh::NativeTrace` with `.events` (the parsed
  stderr JSONL) and `.exit_code` (the program's exit code; `has_exit_code`
  false when the program was killed by a signal). Throws `TraceError` on
  a compile failure or a signal death.
- `trace_code` / `trace_file` with a `std::set<std::string>` of event
  names filter the events the same way `run()` does.

Function-level only in v1: `-finstrument-functions` gives no
loop/branch/line events, so coverage is honestly low (2 of 30
categories). Names resolve via `dladdr` + `__cxa_demangle`; unresolved
names are `null` with the raw `address`, never a faked name. Single
`.cpp` file, `-O0` only (inlined functions get no hooks). See the 0.9.0
CHANGELOG entry.
