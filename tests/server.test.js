// Server / node tests — the phone is the local server, the laptop
// is a local node (see SERVER.md). A server and a node run on this
// box as two local processes (in-process server + a CLI child for
// the node); there is no real phone or second machine here, so the
// phone-server + laptop-node split is proven with a server started
// with --local-legs javascript (the phone simulation: only the JS
// leg runs locally) and a node child that supplies the rest.
// Every test binds loopback only (127.0.0.1, ephemeral ports), so
// the suite needs no internet and no second interface.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const Iroh = require("../dist/iroh-node.js");
const { startServer } = require("../lib/serve");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");
const LOOP_JS = "let t = 0;\nfor (let i = 0; i < 150; i++) {\n  t += i;\n}\nt;\n";
const PY_CODE = "x = 1\nprint(x + 1)\n";

function request(port, method, pathname, body, token) {
  return new Promise((resolve, reject) => {
    let payload = body === undefined ? null : JSON.stringify(body);
    let headers = { "Content-Type": "application/json" };
    if (payload !== null) headers["Content-Length"] = Buffer.byteLength(payload);
    if (token) headers["x-iroh-token"] = token;
    let req = http.request(
      { host: "127.0.0.1", port: port, path: pathname, method: method, headers: headers },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch (e) {
            reject(new Error("server returned non-JSON: " + text.slice(0, 200)));
            return;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function waitFor(predicate, timeoutMs, what) {
  let deadline = Date.now() + (timeoutMs || 10000);
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for: " + what);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// The engine, run in-process: the reference a server trace must
// match exactly.
async function localJsTrace(code) {
  let events = [];
  let out = await Iroh.traceAsync(code, {
    events: "ALL",
    onEvent: (line) => { events.push(line); },
  });
  return { events: events, result: Iroh.safeValue(out.result, 4, new Set()) };
}

// The CLI, run directly: the reference a delegated leg must match.
function localCliTrace(code, language) {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-server-test-"));
  try {
    let ext = language === "python" ? ".py" : language === "cpp" ? ".cpp" : ".js";
    let file = path.join(dir, "program" + ext);
    fs.writeFileSync(file, code, "utf8");
    let proc = spawnSync(process.execPath, [CLI, file, "--lang", language], { encoding: "utf8" });
    assert.equal(proc.status, 0, "local CLI run failed: " + proc.stderr);
    let events = [];
    let result = null;
    for (let line of proc.stdout.split("\n")) {
      line = line.trim();
      if (!line) continue;
      let obj = JSON.parse(line);
      if (obj.type === "event") events.push(obj);
      else if (obj.type === "result") result = obj.value;
    }
    return { events: events, result: result };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("server: a JS trace through the server matches the local engine exactly", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true });
  t.after(() => handle.close());
  let health = await request(handle.port, "GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.service, "iroh");
  assert.equal(health.body.version, require("../package.json").version);
  assert.ok(health.body.distSha);
  assert.ok(handle.addresses.indexOf("127.0.0.1") !== -1);
  let res = await request(handle.port, "POST", "/trace", { language: "javascript", code: LOOP_JS });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
  assert.equal(res.body.ranOn, "local");
  assert.equal(res.body.language, "javascript");
  let local = await localJsTrace(LOOP_JS);
  assert.deepEqual(
    res.body.events.map(({ language, ...event }) => event),
    local.events.map(({ language, ...event }) => event)
  );
  assert.deepEqual(res.body.result, local.result);
  assert.equal(res.body.result, 11175);
});

test("server: /scan and /analyze through the server carry the HOT_LOOP finding", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true });
  t.after(() => handle.close());
  let scan = await request(handle.port, "POST", "/scan", { language: "javascript", code: LOOP_JS });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.ranOn, "local");
  assert.equal(scan.body.findings[0].code, "HOT_LOOP");
  assert.equal(scan.body.summary.events, 763);
  let analysis = await request(handle.port, "POST", "/analyze", { language: "javascript", code: LOOP_JS });
  assert.equal(analysis.status, 200);
  assert.equal(analysis.body.ranOn, "local");
  assert.ok(analysis.body.findings.some((f) => f.code === "HOT_LOOP"));
});

test("server: /translate through the server returns the code and the report", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true });
  t.after(() => handle.close());
  let res = await request(handle.port, "POST", "/translate", {
    from: "javascript",
    to: "python",
    code: "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ranOn, "local");
  assert.equal(res.body.report.ok, true);
  assert.match(res.body.code, /def add/);
});

test("server: /capabilities matches the CLI report and lists registered nodes", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true });
  t.after(() => handle.close());
  let res = await request(handle.port, "GET", "/capabilities");
  assert.equal(res.status, 200);
  assert.equal(res.body.node, process.version);
  assert.ok(Array.isArray(res.body.legs));
  assert.ok(res.body.legs.some((l) => l.leg === "javascript" && l.available));
  assert.deepEqual(res.body.nodes, []);
});

test("server: a leg no node can run returns an honest 503, never a faked result", async (t) => {
  // Phone simulation: only javascript runs locally, no node connected.
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true, localLegs: ["javascript"] });
  t.after(() => handle.close());
  let res = await request(handle.port, "POST", "/trace", { language: "python", code: PY_CODE });
  assert.equal(res.status, 503);
  assert.equal(res.body.leg, "python");
  assert.match(res.body.reason, /no connected node can run python/);
  assert.equal(res.body.events, undefined);
  // JavaScript still runs locally on the same server.
  let js = await request(handle.port, "POST", "/trace", { language: "javascript", code: "1 + 1;" });
  assert.equal(js.status, 200);
  assert.equal(js.body.ranOn, "local");
  assert.equal(js.body.result, 2);
});

test("server+node: a Python leg delegated to a node matches a local run", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true, localLegs: ["javascript"] });
  t.after(() => handle.close());
  let nodeProc = spawn(process.execPath, [CLI, "node", "--server", "127.0.0.1:" + handle.port], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    try {
      nodeProc.kill("SIGTERM");
    } catch (e) {
      // Already gone.
    }
  });
  // Wait until the server sees the node (registration is the proof
  // the long-poll loop is alive).
  await waitFor(async () => {
    let health = await request(handle.port, "GET", "/health");
    return health.body.nodes === 1;
  }, 15000, "node registration");
  let res = await request(handle.port, "POST", "/trace", { language: "python", code: PY_CODE });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
  assert.notEqual(res.body.ranOn, "local");
  assert.match(res.body.ranOn, /-/); // hostname-pid
  let local = localCliTrace(PY_CODE, "python");
  // The Python tracer's event hash is a CRC32 of kind:file:site,
  // and the two runs write the same code to different temp files,
  // so the hash legitimately differs — compare everything else.
  function stripHashes(events) {
    return events.map((e) => {
      let copy = Object.assign({}, e);
      delete copy.hash;
      return copy;
    });
  }
  assert.deepEqual(stripHashes(res.body.events), stripHashes(local.events));
  assert.deepEqual(res.body.result, local.result);
});

test("server: --token requires x-iroh-token on executing routes, /health stays open", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true, token: "secret123" });
  t.after(() => handle.close());
  let noToken = await request(handle.port, "POST", "/trace", { language: "javascript", code: "1;" });
  assert.equal(noToken.status, 401);
  let wrongToken = await request(handle.port, "POST", "/trace", { language: "javascript", code: "1;" }, "nope");
  assert.equal(wrongToken.status, 401);
  let withToken = await request(handle.port, "POST", "/trace", { language: "javascript", code: "1;" }, "secret123");
  assert.equal(withToken.status, 200);
  assert.equal(withToken.body.result, 1);
  let health = await request(handle.port, "GET", "/health");
  assert.equal(health.status, 200);
});

test("server: bad input is a 400, unknown routes are 404", async (t) => {
  let handle = await startServer({ host: "127.0.0.1", port: 0, longPollMs: 1000, quiet: true });
  t.after(() => handle.close());
  let badLang = await request(handle.port, "POST", "/trace", { language: "cobol", code: "1;" });
  assert.equal(badLang.status, 400);
  let badTarget = await request(handle.port, "POST", "/translate", { from: "javascript", to: "cobol", code: "1;" });
  assert.equal(badTarget.status, 400);
  let unknown = await request(handle.port, "GET", "/nope");
  assert.equal(unknown.status, 404);
});


test("security: unauthenticated non-loopback bind is refused", async () => {
  await assert.rejects(async () => startServer({host:"0.0.0.0",port:0,quiet:true}), /token/);
});
test("security: worker polling requires its issued session", async t => {
  const h = await startServer({port:0,quiet:true});
  t.after(() => h.close());
  assert.equal(h.host,"127.0.0.1");
  const r = await request(h.port,"POST","/nodes",{id:"test-worker",legs:[]});
  assert.equal(r.status,200);
  assert.equal(typeof r.body.session,"string");
  assert.equal((await request(h.port,"GET","/jobs?node=test-worker")).status,403);
  assert.equal((await request(h.port,"POST","/nodes",{id:"test-worker",legs:[]})).status,409);
});
