![IrohRedux — Watch your code run. Change it while it runs.](assets/banner.png)

<p align="center">
  <a href="https://github.com/andyle777/IrohRedux/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-0.5.1-orange.svg?style=flat-square" alt="Version 0.5.1" />
  <img src="https://img.shields.io/badge/node-%3E%3D%2018-339933.svg?style=flat-square" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/python-%3E%3D%203.9-3776AB.svg?style=flat-square" alt="Python >= 3.9" />
  <img src="https://img.shields.io/badge/C%2B%2B-17-00599C.svg?style=flat-square" alt="C++17" />
  <img src="https://img.shields.io/badge/tests-51%20passing-brightgreen.svg?style=flat-square" alt="51 tests passing" />
</p>

<p align="center">
  <b>Watch your code run. Change it while it runs.</b><br/>
  Iroh is a dynamic code analysis tool for JavaScript — record your code flow
  in realtime, intercept runtime information, and manipulate program behaviour
  on the fly. And now you don't even have to write JavaScript to use it.
</p>

<p align="center">
  <a href="//github.com/andyle777/IrohRedux/blob/master/GETTING_STARTED.md">Getting Started</a> ·
  <a href="//github.com/andyle777/IrohRedux/blob/master/API.md">API</a> ·
  <a href="//github.com/andyle777/IrohRedux/blob/master/CHANGELOG.md">Changelog</a>
</p>

---

### Why dynamic analysis?

Static analysis (Babel, ESLint) reads your code. Iroh Redux *runs* it — and tells you
what actually happened: which functions were called with what, which branches
were taken, what every variable held, moment by moment. That data only exists
at runtime, and Iroh Redux hands it to you while the code is still running, so you
can capture it, visualize it, or **change values mid-flight** and watch the
program react.

```js
const stage = new Iroh.Stage(`
  function factorial(n) {
    if (n === 0) return 1;
    return n * factorial(n - 1);
  };
  factorial(3);
`);
stage.addListener(Iroh.CALL).on("before", e => console.log("call", e.name, e.arguments));
stage.addListener(Iroh.CALL).on("after", e => console.log("call end ->", e.return));
eval(stage.script);
```

```
call factorial ( [3] )
  call factorial ( [2] )
    call factorial ( [1] )
      call factorial ( [0] )
        if
        if end
      call factorial end -> [1]
    call factorial end -> [1]
  call factorial end -> [2]
call factorial end -> [6]
```

### One engine, three languages

The engine is JavaScript, but the `iroh` CLI streams its trace events as
JSON lines — one event per line — so Python and C++ speak the same protocol
through thin clients. No rewrites, no bindings to compile, no second engine.

```mermaid
flowchart LR
  JS["JavaScript program"] --> Engine["Iroh engine<br/>(Stage + listeners)"]
  Engine --> CLI["iroh CLI<br/>JSON lines"]
  CLI --> PY["Python client<br/>python/iroh"]
  CLI --> CPP["C++ client<br/>cpp/iroh.hpp"]
  Engine --> LIB["JavaScript<br/>require('iroh')"]
```

#### JavaScript — the engine itself

```js
const Iroh = require("iroh");
const stage = new Iroh.Stage(code);
stage.addListener(Iroh.CALL).on("before", e => { /* e.name, e.arguments, e.hash, e.indent */ });
eval(stage.script);
```

#### CLI — trace any program, pipe the events anywhere

```sh
node cli/iroh.js program.js --events CALL,IF
cat program.js | node cli/iroh.js            # stdin works too
```

```json
{"type":"event","event":"FUNCTION_CALL","category":"CALL","trigger":"before","hash":11,"indent":1,"name":"factorial","arguments":[3],"external":false}
{"type":"event","event":"FUNCTION_CALL_END","category":"CALL","trigger":"after","hash":11,"indent":1,"name":"factorial","return":6,"arguments":[3],"external":false}
{"type":"result","value":6}
```

`--events ALL` is the default; `--no-result` skips the result line. Parse and
runtime errors come back as a final `{"type":"error",...}` line with a
non-zero exit code, and async programs are awaited before the result line.

#### Python — `from iroh import run`

```python
from iroh import run

events, result = run("[1, 2, 3].map(v => v * 2);", events=["VAR"])
# result == [2, 4, 6]
```

Stdlib only, needs Node.js and the CLI — see [`python/`](python/).

#### C++ — one header, no dependencies

```cpp
#include "iroh.hpp"

iroh::Client client;
auto trace = client.run("[1, 2, 3].map(v => v * 2);", {"VAR"});
// trace.result.as_array() == [2, 4, 6]
```

Header-only C++17, with a minimal JSON parser built in — see [`cpp/`](cpp/).

### What you get

- **Every event, live.** Calls, ifs, loops, assignments, allocations, awaits —
  with names, values, indentation, and the hash of the exact code location.
- **Values you can touch.** Listeners can read *and replace* arguments,
  return values, and variables while the program runs.
- **Modern JavaScript.** ES2022, arrows, optional chaining, nullish
  coalescing, private fields, async/await — all traced, all tested.
- **Three languages, one protocol.** JavaScript, Python, and C++ all consume
  the same JSON event stream.
- **No surprises.** 51 tests (39 Node + 7 Python + 5 C++), `npm test` runs
  them all. Zero runtime dependencies in the engine beyond Acorn, astring,
  and acorn-walk.

### Installation

```sh
npm install iroh
```

Or clone and build from source:

```sh
git clone https://github.com/andyle777/IrohRedux.git
cd IrohRedux
npm install
npm run dist        # builds dist/iroh-node.js, dist/iroh-node.es.js, dist/iroh-browser.js
npm test            # 51 tests: Node + Python + C++
```

The Python client installs with `pip install -e python/`; the C++ client is
a single header — just `#include "iroh.hpp"`.

### Learn more

- [Getting started](//github.com/andyle777/IrohRedux/blob/master/GETTING_STARTED.md) — worked examples you can run locally.
- [API](//github.com/andyle777/IrohRedux/blob/master/API.md) — the full listener and event reference, including `Iroh.assert` / `Iroh.log` and the `INSTR` / `CATEGORY` / `OP` label tables.
- [Changelog](//github.com/andyle777/IrohRedux/blob/master/CHANGELOG.md) — what changed in 0.4.0, 0.5.0, and 0.5.1.

---

*IrohRedux is a fork of Felix Maier's [Iroh](https://github.com/maierfelix/Iroh)
0.3.0 (2018), fixed and extended. The core idea is his; the 0.4.0 fixes, the
0.5.0 CLI and polyglot clients, and the 0.5.1 polish are the fork's.*
