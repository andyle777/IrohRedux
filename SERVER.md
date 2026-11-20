# IrohRedux server & node — the phone is a local server, the laptop is a local node

Everything here runs on the local network only. No internet is
needed, none is used, and nothing phones home.

## The shape

| Side   | What it is | What it runs |
| ------ | ---------- | ------------ |
| Phone (APK) | **Local server** — `iroh serve` | The JavaScript legs, locally. Anything else is delegated. |
| Laptop (EXE/CLI) | **Local node** — `iroh node --server <phone-ip>:8471` | The legs it has toolchains for (Python, C++, IrohScript, BASIC), on demand. |

The phone cannot run Python, C++, IrohScript or BASIC — there is
no python3 and no g++ on Android. Instead of failing those legs,
the server forwards the job to a connected laptop node that can
run it, waits for the result, and returns it as if it ran locally
— with one extra field, `ranOn`, naming the node that ran it. If
no node can run the leg, the server says so (HTTP 503), never a
faked result.

## Starting the server

On the phone the app starts the server itself after setup
succeeds, and shows the address on the status line:

```
Ready — Node v26.13.1 · IrohRedux 1.1.1 · JS legs only (no python3 on Android)
· Server on 192.168.1.5:8471
```

On a laptop (or any box) for testing:

```
iroh serve [--port 8471] [--host 0.0.0.0] [--token T] [--timeout-ms 120000]
```

- `--port` — default **8471**, override with `--port N`.
- `--host` — default `0.0.0.0` (every local interface, so a laptop
  on the same Wi-Fi reaches it). `--host 127.0.0.1` is loopback-only.
- `--token` — when set, every executing route and every node route
  requires the header `x-iroh-token: <token>` (401 without it).
  `/health` and `/capabilities` stay open. Without a token there is
  no auth, and the local network is the whole security model.
- `--timeout-ms` — how long a request waits for a delegated job
  (default 120000). The CLI itself has no timeout; the server must
  impose one or an HTTP request could hang forever.

On startup the server prints exactly one JSON line on stdout,
which the Android app parses for its status line:

```json
{"type":"listening","host":"0.0.0.0","port":8471,"addresses":["192.168.1.5","127.0.0.1"],"version":"1.1.1"}
```

Request logging goes to stderr, so stdout stays parseable.

## Starting a node

On the laptop:

```
iroh node --server 192.168.1.5:8471 [--token T]
```

The node registers the legs this machine can run, long-polls for
jobs, runs each leg with the local CLI, and posts the result back.
It runs until killed (SIGINT/SIGTERM stop it cleanly). The node id
is `hostname-pid`, so two nodes never collide.

Reconnect behaviour:

- The server forgets the node (restart / 30 s without a poll):
  the node re-registers and polls again.
- Wrong token (401): never fixes itself — the node logs it and
  exits 1.
- Network error (server down, Wi-Fi drop): backoff 1 s, 2 s, 4 s,
  8 s, 16 s, then 30 s, logging each retry, and re-register before
  polling again.
- A job the node cannot run is reported as a job failure, never
  faked and never swallowed.

## Discovery (v1: manual)

A laptop finds the phone by reading the address off the phone's
status line and passing it to `iroh node --server <host:port>`.
That is the v1 method: it is reliable, needs no new dependency,
and works on every network. mDNS (the phone advertising
`_iroh._tcp`) is a follow-up, not implemented — it would need a
dependency the project does not have, and manual entry already
covers the one-phone-one-laptop case.

## Endpoints

Every result shape is the shape the engine already produces. The
server adds exactly one field, `ranOn` (`"local"` or the node id).
A leg that ran but whose program errored returns HTTP 200 with an
`error` field — a program error is a result, not a transport
failure, so check `error` first. A leg nobody can run is HTTP 503
with `{error, leg, reason}`; a delegated job no node answers in
time is HTTP 504; bad input is HTTP 400; unknown routes are 404.

### GET /health

```json
// request: none
// response 200:
{"ok":true,"service":"iroh","version":"1.1.1","node":"v24.22.1",
 "distSha":"3650052798f7","uptimeSeconds":42,
 "localLegs":["javascript","python","cpp","irohscript","basic"],
 "nodes":1,"startedAt":"2026-11-20T08:10:55.707Z"}
```

### GET /capabilities

The `iroh capabilities --json` report, plus `nodes`: the
registered nodes and their legs.

```json
// response 200:
{"node":"v24.22.1","features":[...],"legs":[
  {"leg":"javascript","available":true,"why":"built-in engine"},
  {"leg":"python","available":false,"why":"python3 not found"}],
 "nodes":[{"id":"laptop-1234","node":"v24.22.1",
   "legs":[{"leg":"python","available":true,"why":"python3 on PATH"}],
   "alive":true}]}
```

### POST /trace

```json
// request:
{"language":"javascript","code":"let t = 0;\nfor (let i = 0; i < 150; i++) {\n  t += i;\n}\nt;\n"}
// response 200 (ran locally):
{"events":[...763 events...],"result":11175,"ranOn":"local","language":"javascript"}
// response 200 (delegated to a node):
{"events":[...],"result":null,"ranOn":"laptop-1234","language":"python"}
// response 503 (nobody can run it):
{"error":{"type":"error","name":"Error","message":"leg unavailable: no connected node can run python"},
 "leg":"python","reason":"no connected node can run python"}
```

`events` may be filtered with `"events":"CALL,IF"` (default
`"ALL"`), the same values as the CLI's `--events`.

### POST /analyze

```json
// request:
{"language":"javascript","code":"let t = 0;\nfor (let i = 0; i < 150; i++) {\n  t += i;\n}\nt;\n"}
// response 200: the analysis line, plus ranOn and language:
{"type":"analysis","findings":[{"code":"HOT_LOOP","severity":"warning","message":"...","evidence":{...},"neuron":{...}}],
 "scores":{...},"summary":{...},"neuron":{"label":"hot","score":0.0259},
 "ranOn":"local","language":"javascript"}
```

### POST /scan

```json
// request:
{"language":"javascript","code":"let t = 0;\nfor (let i = 0; i < 150; i++) {\n  t += i;\n}\nt;\n"}
// response 200: the scan document, plus ranOn and language:
{"vectors":{...},"findings":[{"code":"HOT_LOOP",...}],"scores":{...},
 "summary":{"events":763,"findings":1,"language":"javascript","findingsTruncated":0,...},
 "ranOn":"local","language":"javascript"}
```

`"includeEvents":true` embeds the raw events in the scan document
(the CLI's `--include-events`).

### POST /translate

```json
// request:
{"from":"javascript","to":"python","code":"function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n"}
// response 200:
{"code":"def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n",
 "report":{"ok":true,"from":"javascript","to":"python","staticOnly":false,
  "clean":[],"assumptions":[],"unsupported":[],"notes":[]},
 "ranOn":"local"}
```

The report is the translate report the engine already produces
(`{ok, from, to, staticOnly, clean, assumptions, unsupported,
notes}`); the server does not add a verify field of its own — if
the patched engine's report carries one, it rides along untouched.

### Node routes (the node client uses these; humans rarely call them)

```
POST /nodes
  {"id":"laptop-1234","node":"v24.22.1","legs":[{"leg":"python","available":true,...}]}
  -> {"ok":true,"id":"laptop-1234","longPollMs":25000,"nodeTimeoutMs":30000}

GET /jobs?node=laptop-1234
  -> {"job":null}                                  (nothing waiting; poll again)
  -> {"job":{"id":"...","operation":"trace","language":"python","code":"...",
             "events":"ALL","from":null,"to":null,"includeEvents":null}}

POST /jobs/<id>/result  {"result":{...leg result...}}  -> {"ok":true,"id":"..."}
POST /jobs/<id>/error   {"error":{...}}                -> {"ok":true,"id":"..."}
```

The long-poll hold is 25 s; the hold itself is the heartbeat — a
node that polls every 25 s is alive, one that stops is pruned
after 30 s, and its in-flight jobs fail at once (503 "node
disconnected") instead of hanging until the 120 s request timeout.

## How delegation picks a node

Local first: a leg this box can run never leaves the box.
Otherwise the server picks the connected node that advertised the
leg, preferring the one with the fewest in-flight jobs. The job
waits in that node's queue until its next poll (or is handed to
it at once if it is already polling).

## Defaults, in one place

| Setting | Default | Override |
| ------- | ------- | -------- |
| Port | 8471 | `--port N` |
| Host | 0.0.0.0 | `--host H` |
| Token | none (local network is the security model) | `--token T` |
| Request / job timeout | 120 s | `--timeout-ms N` |
| Long-poll hold | 25 s | server option `longPollMs` |
| Node pruned after | 30 s without a poll | server option `nodeTimeoutMs` |
| Request body cap | 10 MB | — |

## Files

| File | What it is |
| ---- | ---------- |
| `lib/serve.js` | The HTTP server (built-in `http` only). |
| `lib/node.js` | The node client (built-in `http` only). |
| `lib/leg.js` | One leg run via the CLI subprocess, shared by server and node — so a leg through the server is byte-identical to the same leg on the command line. |
| `cli/iroh.js` | `serve` and `node` subcommands. |
| `tests/server.test.js` | Server + node on loopback (see below). |
| APK `MainActivity.java` | Starts `iroh serve` after setup, shows the address on the status line. The APK build must stage `lib/` (see `stage_payload.sh`) or the server command dies with MODULE_NOT_FOUND. |

## What the tests prove, and what they cannot

`tests/server.test.js` runs a server and a node on loopback
(127.0.0.1, ephemeral ports) and proves: (a) a JS trace through
the server returns the same events as the local engine; (b) a
Python leg delegated to a node returns the same output as running
it locally (modulo the Python tracer's per-file event hash, which
is a CRC32 of kind:file:site — the two runs write the same code
to different temp files, so the hash legitimately differs and the
test compares everything else); (c) a leg with no capable node
returns an honest 503; (d) the server works on loopback with no
internet. Token auth (401 without, 200 with) and bad-input/unknown
routes are covered too.

What is NOT verified here: there is no real phone and no second
machine on this box. The phone-server + laptop-node split was
tested with two local processes only (a server started with
`--local-legs javascript` to simulate the phone, plus a node child
process). The APK change (Java starts the server, status line
shows the address) is code-reviewed, not run — there is no
Android emulator here — but the APK binary IS rebuilt with the
server in the 1.1.1 patched set (versionCode 112, `lib/` staged),
and the Linux EXE is rebuilt from the same tree, so the
serve + node split was exercised end-to-end with the packaged
binaries on loopback.
