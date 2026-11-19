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
