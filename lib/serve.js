// IrohRedux local server — the phone side of the server/node
// architecture. An HTTP server over the local network only (no
// internet needed, none used): the phone serves the engine's
// operations as JSON, runs the legs it can run locally, and
// delegates the legs it cannot run to connected laptop nodes.
//
// Node-only (built-in http). NOT bundled into dist/.
//
//   iroh serve [--port 8471] [--host 0.0.0.0] [--token T]
//     [--timeout-ms 120000]
//
// Endpoints (JSON in, JSON out; every result shape is the shape the
// engine already produces — the server adds exactly one field,
// `ranOn`, naming where the leg ran):
//   GET  /health        {ok, service, version, node, distSha,
//                       uptimeSeconds, localLegs, nodes, startedAt}
//   GET  /capabilities the `iroh capabilities --json` report, plus
//                       `nodes`: the registered nodes and their legs
//   POST /trace         {language, code, events?} ->
//                       {events, result, ranOn, language}
//   POST /analyze       {language, code, events?} ->
//                       the analysis line + {ranOn, language}
//   POST /scan          {language, code, events?, includeEvents?} ->
//                       the scan document + {ranOn, language}
//   POST /translate     {from, to, code} ->
//                       {code, report, ranOn}
//   POST /nodes         {id, node, legs} — a laptop registers
//   GET  /jobs?node=<id> — a node long-polls for work
//   POST /jobs/:id/result {result} — a node returns a job result
//   POST /jobs/:id/error  {error}  — a node reports a job failure
//
// `ranOn` is "local" or the id of the node that ran the leg. A leg
// that ran but whose program errored returns HTTP 200 with an
// `error` field (a program error is a result, not a transport
// failure — check `error` first). A leg nobody can run returns
// HTTP 503 with {error, leg, reason}; a delegated job that no node
// answers in time returns HTTP 504. Bad input is HTTP 400.
//
// Auth (v1): none by default — the server binds the local network
// only, and that is the whole security model. With --token, every
// executing route and every node route requires the header
// `x-iroh-token: <token>` (401 without it); /health and
// /capabilities stay open so a laptop can find the server before
// it has a token.
//
// Defaults, all overridable and all documented here rather than
// hidden: port 8471, host 0.0.0.0 (every local interface — a laptop
// on the same Wi-Fi reaches it; loopback-only is --host 127.0.0.1),
// per-request timeout 120 s (a delegated job nobody answers),
// long-poll hold 25 s, a node is dropped after 30 s without a poll.
// Job ids are crypto.randomUUID().
//
// On startup the server prints exactly one JSON line on stdout:
//   {"type":"listening","port":8471,"host":"0.0.0.0",
//    "addresses":["192.168.1.5","127.0.0.1"],"version":"1.1.1"}
// The Android app reads that line to show the server address on
// its status line. Request logging goes to stderr, so stdout stays
// parseable.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { runLeg, localLegs } = require("./leg");
const { capabilities } = require("./capabilities");

const DEFAULT_PORT = 8471;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_LONG_POLL_MS = 25000;
const DEFAULT_NODE_TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function version() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
    ).version || "unknown";
  } catch (e) {
    return "unknown";
  }
}

function distSha() {
  try {
    let bytes = fs.readFileSync(path.join(__dirname, "..", "dist", "iroh-node.js"));
    return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  } catch (e) {
    return "missing";
  }
}

// All IPv4 addresses of this box, LAN first, loopback last (the
// first non-loopback entry is what the phone shows on its status
// line; 127.0.0.1 is the fallback when there is no network at all).
function localAddresses() {
  let out = [];
  let interfaces = os.networkInterfaces();
  for (let name of Object.keys(interfaces)) {
    for (let addr of interfaces[name] || []) {
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      out.push(addr.address);
    }
  }
  out.push("127.0.0.1");
  return out;
}

function startServer(options) {
  options = options || {};
  let port = options.port === void 0 ? DEFAULT_PORT : options.port;
  let host = options.host || DEFAULT_HOST;
  let token = options.token || null;
  if (host !== "127.0.0.1" && host !== "::1" && (!token || typeof token !== "string" || token.length < 32)) {
    throw new Error("Non-loopback execution requires a token of at least 32 characters; trusted network only");
  }
  let cliPath = options.cliPath || path.join(__dirname, "..", "cli", "iroh.js");
  let timeoutMs = options.timeoutMs === void 0 ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  let longPollMs = options.longPollMs === void 0 ? DEFAULT_LONG_POLL_MS : options.longPollMs;
  let nodeTimeoutMs = options.nodeTimeoutMs === void 0 ? DEFAULT_NODE_TIMEOUT_MS : options.nodeTimeoutMs;
  // quiet: skip the stdout listening line and the stderr request
  // log (the test suite starts servers in-process and reads the
  // address from the returned handle instead).
  let quiet = options.quiet === true;
  // The legs this server may run locally. Default: what the
  // capability probe says this box can run. The phone overrides it
  // to ["javascript"] (the only leg Android can run); the test
  // suite uses the same override to simulate a phone.
  let legs = options.localLegs || localLegs();
  let startedAt = new Date().toISOString();
  let startedMs = Date.now();
  let ver = version();
  let sha = distSha();

  // nodes: id -> {id, node, legs, lastSeen, inflight}
  let nodes = new Map();
  let activeOperations = 0;
  // jobs: id -> {id, operation, language, code, events, from, to,
  //   includeEvents, nodeId, status, result, error, resolve, timer}
  let jobs = new Map();
  // pending: nodeId -> [job] (jobs waiting for that node's next poll)
  let pending = new Map();
  // waiters: nodeId -> [res] (long-poll responses held open)
  let waiters = new Map();

  function nodeAlive(n) {
    return Date.now() - n.lastSeen <= nodeTimeoutMs;
  }

  function pickNode(language) {
    let best = null;
    for (let n of nodes.values()) {
      if (!nodeAlive(n)) continue;
      let can = false;
      for (let ii = 0; ii < n.legs.length; ++ii) {
        if (n.legs[ii].leg === language && n.legs[ii].available) { can = true; break; }
      }
      if (!can) continue;
      if (best === null || n.inflight < best.inflight) best = n;
    }
    return best;
  }

  function failJob(job, message) {
    if (job.status !== "waiting") return;
    job.status = "failed";
    job.error = { type: "error", name: "Error", message: message };
    if (job.resolve) job.resolve();
  }

  // A node that stops polling is dead: drop it and fail its
  // in-flight jobs at once, instead of leaving the caller hanging
  // until the 120 s request timeout.
  let pruner = setInterval(() => {
    for (let n of nodes.values()) {
      if (nodeAlive(n)) continue;
      nodes.delete(n.id);
      pending.delete(n.id);
      for (let job of jobs.values()) {
        if (job.nodeId === n.id && job.status === "waiting") {
          failJob(job, "node " + n.id + " disconnected before returning the result");
        }
      }
      let held = waiters.get(n.id) || [];
      waiters.delete(n.id);
      for (let res of held) {
        try { sendJson(res, 404, { error: { type: "error", name: "Error", message: "unknown node — register first" } }); } catch (e) { /* gone */ }
      }
    }
  }, 5000);
  if (pruner.unref) pruner.unref();

  function sendJson(res, status, obj) {
    // The response may already be gone (client left, or close()
    // force-closed the socket): never throw for a dead socket.
    if (res.destroyed || res.writableEnded) return;
    try {
      let body = JSON.stringify(obj);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    } catch (e) { /* client gone */ }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let chunks = [];
      let size = 0;
      let tooBig = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          tooBig = true;
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (tooBig) {
          reject(new Error("body too large (max " + MAX_BODY_BYTES + " bytes)"));
          return;
        }
        let text = Buffer.concat(chunks).toString("utf8");
        if (!text) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error("body is not valid JSON: " + e.message));
        }
      });
      req.on("error", reject);
    });
  }

  function checkToken(req) {
    if (token === null) return true;
    return req.headers["x-iroh-token"] === token;
  }

  function envelopeFor(operation, out, ranOn, language) {
    if (out.error) {
      return { error: out.error, ranOn: ranOn, language: language };
    }
    if (operation === "trace") {
      return { events: out.events, result: out.result, ranOn: ranOn, language: language };
    }
    if (operation === "analyze") {
      return Object.assign({}, out.analysis, { ranOn: ranOn, language: language });
    }
    if (operation === "scan") {
      return Object.assign({}, out.scan, { ranOn: ranOn, language: language });
    }
    // translate
    return { code: out.translation.code, report: out.translation.report, ranOn: ranOn, language: language };
  }

  async function runOperation(operation, body) {
    let language = operation === "translate"
      ? (body.from || "javascript")
      : (body.language || "javascript");
    let legOptions = {
      operation: operation,
      language: language,
      code: body.code || "",
      events: body.events || "ALL",
      from: body.from,
      to: body.to,
      includeEvents: body.includeEvents,
      cliPath: cliPath,
      timeoutMs: timeoutMs,
    };
    if (operation === "translate") {
      if (["javascript", "python", "cpp", "irohscript", "basic"].indexOf(body.to) === -1) {
        return { status: 400, body: { error: { type: "error", name: "Error", message: "Unknown target language: " + body.to } } };
      }
    } else if (["javascript", "python", "cpp", "irohscript", "basic"].indexOf(language) === -1) {
      return { status: 400, body: { error: { type: "error", name: "Error", message: "Unknown language: " + language } } };
    }
    // Local first: a leg this box can run never leaves the box.
    if (legs.indexOf(language) !== -1) {
      let out = await runLeg(legOptions);
      return { status: 200, body: envelopeFor(operation, out, "local", language) };
    }
    // Otherwise delegate to a connected node that advertised it.
    let node = pickNode(language);
    if (node === null) {
      return {
        status: 503,
        body: {
          error: { type: "error", name: "Error", message: "leg unavailable: no connected node can run " + language },
          leg: language,
          reason: "no connected node can run " + language,
        },
      };
    }
    let job = {
      id: crypto.randomUUID(),
      lease: crypto.randomBytes(32).toString("hex"),
      operation: operation,
      language: language,
      code: body.code || "",
      events: body.events || "ALL",
      from: body.from,
      to: body.to,
      includeEvents: body.includeEvents,
      nodeId: node.id,
      status: "waiting",
      result: null,
      error: null,
      resolve: null,
      timer: null,
    };
    jobs.set(job.id, job);
    node.inflight += 1;
    let done = new Promise((resolve) => { job.resolve = resolve; });
    job.timer = setTimeout(() => {
      failJob(job, "node " + node.id + " did not return the result in " + timeoutMs + " ms");
    }, timeoutMs);
    // Hand the job to the node at once if it is already polling;
    // otherwise queue it for its next poll.
    let held = waiters.get(node.id) || [];
    if (held.length > 0) {
      let res = held.shift();
      try { sendJson(res, 200, { job: publicJob(job) }); } catch (e) { /* gone */ }
    } else {
      let queue = pending.get(node.id) || [];
      queue.push(job);
      pending.set(node.id, queue);
    }
    await done;
    clearTimeout(job.timer);
    jobs.delete(job.id);
    const remaining = (pending.get(node.id) || []).filter(j => j.id !== job.id);
    if (remaining.length) pending.set(node.id, remaining); else pending.delete(node.id);
    node.inflight = Math.max(0, node.inflight - 1);
    if (job.status === "failed") {
      let status = /did not return|disconnected/.test(job.error.message) ? 504 : 502;
      return { status: status, body: { error: job.error, leg: language, ranOn: node.id } };
    }
    return { status: 200, body: envelopeFor(operation, job.result, node.id, language) };
  }

  function publicJob(job) {
    return {
      id: job.id,
      lease: job.lease,
      operation: job.operation,
      language: job.language,
      code: job.code,
      events: job.events,
      from: job.from,
      to: job.to,
      includeEvents: job.includeEvents,
    };
  }

  function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch (e) {
      sendJson(res, 400, { error: { type: "error", name: "Error", message: "bad URL" } });
      return;
    }
    let pathname = url.pathname;
    if (!quiet) process.stderr.write("iroh serve " + req.method + " " + pathname + "\n");
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "iroh",
        version: ver,
        node: process.version,
        distSha: sha,
        uptimeSeconds: Math.floor((Date.now() - startedMs) / 1000),
        localLegs: legs,
        nodes: nodes.size,
        startedAt: startedAt,
      });
      return;
    }
    if (req.method === "GET" && pathname === "/capabilities") {
      let report = capabilities();
      let nodeList = [];
      for (let n of nodes.values()) {
        nodeList.push({ id: n.id, node: n.node, legs: n.legs, alive: nodeAlive(n) });
      }
      sendJson(res, 200, Object.assign({}, report, { nodes: nodeList }));
      return;
    }
    if (req.method === "POST" && pathname === "/nodes") {
      if (!checkToken(req)) {
        sendJson(res, 401, { error: { type: "error", name: "Error", message: "missing or wrong x-iroh-token" } });
        return;
      }
      readBody(req).then((body) => {
        if (!body || typeof body.id !== "string" || !body.id || body.id.length > 256 || !Array.isArray(body.legs) || body.legs.length > 5 || body.legs.some(l => !l || typeof l.leg !== "string" || typeof l.available !== "boolean")) {
          sendJson(res, 400, { error: { type: "error", name: "Error", message: "register needs {id, legs}" } });
          return;
        }
        if (nodes.has(body.id) || nodes.size >= 64) { sendJson(res, 409, {error: {message: "node already registered or node limit reached"}}); return; }
        const session = crypto.randomBytes(32).toString("hex");
        nodes.set(body.id, {
          session,
          id: body.id,
          node: body.node || "unknown",
          legs: body.legs,
          lastSeen: Date.now(),
          inflight: 0,
        });
        sendJson(res, 200, { ok: true, id: body.id, session, longPollMs: longPollMs, nodeTimeoutMs: nodeTimeoutMs });
      }).catch((e) => {
        sendJson(res, 400, { error: { type: "error", name: "Error", message: e.message } });
      });
      return;
    }
    if (req.method === "GET" && (pathname === "/jobs" || pathname === "/heartbeat")) {
      if (!checkToken(req)) {
        sendJson(res, 401, { error: { type: "error", name: "Error", message: "missing or wrong x-iroh-token" } });
        return;
      }
      let nodeId = url.searchParams.get("node");
      let node = nodes.get(nodeId);
      if (!node) {
        sendJson(res, 404, { error: { type: "error", name: "Error", message: "unknown node — register first" } });
        return;
      }
      if (req.headers["x-iroh-session"] !== node.session) { sendJson(res, 403, {error:{message:"worker session required"}}); return; }
      node.lastSeen = Date.now();
      if (pathname === "/heartbeat") { sendJson(res, 200, {ok:true}); return; }
      let queue = pending.get(nodeId) || [];
      while (queue.length > 0 && (queue[0].status !== "waiting" || !jobs.has(queue[0].id))) queue.shift();
      if (queue.length > 0) {
        let job = queue.shift();
        sendJson(res, 200, { job: publicJob(job) });
        return;
      }
      // Long-poll: hold the response until a job arrives or the
      // hold expires. The hold IS the heartbeat — a node that
      // polls every 25 s is alive; one that stops is pruned.
      let list = waiters.get(nodeId) || [];
      if (list.length) { sendJson(res, 409, {error:{message:"poll already pending"}}); return; }
      list.push(res);
      waiters.set(nodeId, list);
      let finished = false;
      let timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        let rest = (waiters.get(nodeId) || []).filter((r) => r !== res);
        waiters.set(nodeId, rest);
        try { sendJson(res, 200, { job: null }); } catch (e) { /* gone */ }
      }, longPollMs);
      if (timer.unref) timer.unref();
      res.on("close", () => {
        clearTimeout(timer);
        if (finished) return;
        finished = true;
        let rest = (waiters.get(nodeId) || []).filter((r) => r !== res);
        waiters.set(nodeId, rest);
      });
      return;
    }
    let jobResult = pathname.match(/^\/jobs\/([^/]+)\/(result|error)$/);
    if (req.method === "POST" && jobResult) {
      if (!checkToken(req)) {
        sendJson(res, 401, { error: { type: "error", name: "Error", message: "missing or wrong x-iroh-token" } });
        return;
      }
      let jobId = jobResult[1];
      let kind = jobResult[2];
      let job = jobs.get(jobId);
      if (!job || job.status !== "waiting") {
        sendJson(res, 404, { error: { type: "error", name: "Error", message: "unknown job: " + jobId } });
        return;
      }
      readBody(req).then((body) => {
        const owner = nodes.get(job.nodeId);
        if (!owner || req.headers["x-iroh-session"] !== owner.session || !body || body.lease !== job.lease || jobs.get(jobId) !== job || job.status !== "waiting") { sendJson(res, 403, {error:{message:"invalid or expired job lease"}}); return; }
        if (kind === "result" && (!body.result || typeof body.result !== "object" || Array.isArray(body.result) || (!body.result.error && (job.operation === "trace" ? !Array.isArray(body.result.events) || !Object.prototype.hasOwnProperty.call(body.result,"result") : !body.result[job.operation === "analyze" ? "analysis" : job.operation === "translate" ? "translation" : "scan"])))) { sendJson(res, 400, {error:{message:"invalid result envelope"}}); return; }
        if (kind === "error" && (!body.error || typeof body.error.message !== "string")) { sendJson(res, 400, {error:{message:"invalid error envelope"}}); return; }
        if (kind === "result") {
          job.status = "done";
          job.result = body.result || null;
        } else {
          job.status = "failed";
          job.error = body.error || { type: "error", name: "Error", message: "node reported a job failure" };
        }
        if (job.resolve) job.resolve();
        sendJson(res, 200, { ok: true, id: jobId });
      }).catch((e) => {
        sendJson(res, 400, { error: { type: "error", name: "Error", message: e.message } });
      });
      return;
    }
    if (req.method === "POST" && (pathname === "/trace" || pathname === "/analyze" || pathname === "/scan" || pathname === "/translate")) {
      if (!checkToken(req)) {
        sendJson(res, 401, { error: { type: "error", name: "Error", message: "missing or wrong x-iroh-token" } });
        return;
      }
      readBody(req).then(async (body) => {
        try {
          if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.code !== "string" || (body.events !== undefined && typeof body.events !== "string")) { sendJson(res,400,{error:{message:"invalid operation body"}}); return; }
          if (activeOperations >= 4) { sendJson(res,429,{error:{message:"execution capacity reached"}}); return; }
          activeOperations++;
          try { let out = await runOperation(pathname.slice(1), body); sendJson(res, out.status, out.body); } finally { activeOperations--; }
        } catch (e) {
          sendJson(res, 500, { error: { type: "error", name: "Error", message: "server error: " + (e.message || String(e)) } });
        }
      }).catch((e) => {
        sendJson(res, 400, { error: { type: "error", name: "Error", message: e.message } });
      });
      return;
    }
    sendJson(res, 404, { error: { type: "error", name: "Error", message: "unknown route: " + req.method + " " + pathname } });
  }

  let server = http.createServer({requestTimeout: 30000, headersTimeout: 15000}, handle);
  server.maxConnections = 128;
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      let actualPort = server.address().port;
      let addresses = localAddresses();
      if (!quiet) {
        // The one stdout line the Android app parses for its status
        // line. Everything else the server says goes to stderr.
        process.stdout.write(JSON.stringify({
          type: "listening",
          host: host,
          port: actualPort,
          addresses: addresses,
          version: ver,
        }) + "\n");
        process.stderr.write(
          "iroh serve listening on " + host + ":" + actualPort +
          " (http://" + addresses[0] + ":" + actualPort + ")\n"
        );
      }
      resolve({
        server: server,
        host: host,
        port: actualPort,
        addresses: addresses,
        version: ver,
        close: () => {
          return new Promise((done) => {
            clearInterval(pruner);
            // A node long-polls forever and re-polls on the same
            // keep-alive socket, so server.close() alone never
            // fires: it waits for a connection that never ends
            // (the poll in flight completes, the node re-polls at
            // once, and the socket stays open). Answer the held
            // polls, fail the waiting jobs so their timers clear,
            // and force the sockets closed — close() must resolve
            // even while a node is still polling.
            for (let held of waiters.values()) {
              for (let res of held) {
                sendJson(res, 503, { error: { type: "error", name: "Error", message: "server shutting down" } });
              }
            }
            waiters.clear();
            for (let job of jobs.values()) {
              if (job.status === "waiting") failJob(job, "server shutting down");
            }
            if (server.closeAllConnections) server.closeAllConnections();
            server.close(() => done());
          });
        },
      });
    });
  });
}

module.exports = {
  startServer,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LONG_POLL_MS,
  DEFAULT_NODE_TIMEOUT_MS,
};
