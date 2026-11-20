// IrohRedux local node — the laptop side of the server/node
// architecture. Connects to a phone server, registers the legs
// this machine can run, long-polls for jobs, runs each leg with
// the local CLI, and posts the result back.
//
// Node-only (built-in http). NOT bundled into dist/.
//
//   iroh node --server <host:port> [--token T]
//
// The node is a daemon: it runs until killed (SIGINT/SIGTERM stop
// it cleanly). It needs no internet — server and node talk over
// the local network only.
//
// Reconnect behaviour, all of it deliberate:
//   - A poll that returns 404 means the server forgot this node
//     (it restarted, or pruned it): re-register, then poll again.
//   - A poll that returns 401 means the token is wrong: that never
//     fixes itself, so the node logs it and exits 1.
//   - Any network error (server down, Wi-Fi drop): back off
//     1 s, 2 s, 4 s, 8 s, 16 s, then 30 s, logging each retry to
//     stderr, and re-register before polling again (the server
//     may have restarted while the node was away).
//   - A job the node cannot run (it advertised the leg, but the
//     local run failed to start) is reported to /jobs/:id/error,
//     never faked and never swallowed.
//
// The node id is hostname-pid, so two nodes on one laptop (or two
// laptops with the same hostname) never collide. The server picks
// the connected node with the fewest in-flight jobs for a leg.

"use strict";

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { runLeg } = require("./leg");
const { legRows } = require("./capabilities");

const BACKOFFS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function log(msg) {
  process.stderr.write("iroh node: " + msg + "\n");
}

// One HTTP request, JSON in and out. Rejects on network error,
// on a non-2xx status (with .status and .body attached), and on
// a response that is not JSON.
function request(server, method, pathname, body, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    let payload = body === null || body === undefined ? null : JSON.stringify(body);
    let headers = { "Content-Type": "application/json" };
    if (payload !== null) headers["Content-Length"] = Buffer.byteLength(payload);
    if (token) headers["x-iroh-token"] = token;
    let req = http.request(
      {
        host: server.host,
        port: server.port,
        path: pathname,
        method: method,
        headers: headers,
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch (e) {
            let err = new Error("server returned non-JSON: " + text.slice(0, 200));
            err.status = res.statusCode;
            reject(err);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let err = new Error(
              "server returned " + res.statusCode + ": " +
              ((parsed && parsed.error && parsed.error.message) || text.slice(0, 200))
            );
            err.status = res.statusCode;
            err.body = parsed;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("request timed out after " + timeoutMs + " ms"));
    });
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function parseServer(spec) {
  let raw = String(spec || "").trim();
  if (!raw) throw new Error("--server needs a host:port, e.g. --server 192.168.1.5:8471");
  raw = raw.replace(/^https?:\/\//, "");
  let slash = raw.indexOf("/");
  if (slash !== -1) raw = raw.slice(0, slash);
  let parts = raw.split(":");
  if (parts.length !== 2 || !parts[0] || !Number(parts[1])) {
    throw new Error("--server needs a host:port, e.g. --server 192.168.1.5:8471 (got " + spec + ")");
  }
  return { host: parts[0], port: Number(parts[1]) };
}

async function runNode(options) {
  options = options || {};
  let server = parseServer(options.server);
  let token = options.token || null;
  let cliPath = options.cliPath || path.join(__dirname, "..", "cli", "iroh.js");
  let timeoutMs = options.timeoutMs === void 0 ? 120000 : options.timeoutMs;
  let id = os.hostname() + "-" + process.pid;
  let stopping = false;
  let longPollMs = 25000;

  function stop() {
    if (stopping) return;
    stopping = true;
    log("stopping");
    process.exit(0);
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  async function register() {
    let res = await request(server, "POST", "/nodes",
      { id: id, node: process.version, legs: legRows() }, token, 15000);
    if (res.longPollMs) longPollMs = res.longPollMs;
    return res;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Register first, with backoff: the server may not be up yet
  // when the node starts (the phone and the laptop boot in either
  // order).
  let backoff = 0;
  for (;;) {
    if (stopping) return;
    try {
      await register();
      log("registered as " + id + " with " + server.host + ":" + server.port);
      break;
    } catch (e) {
      if (e.status === 401) {
        log("server rejected the token (401) — check --token and restart");
        process.exitCode = 1;
        return;
      }
      log("cannot register (" + e.message + ") — retrying in " + BACKOFFS_MS[backoff] + " ms");
      await sleep(BACKOFFS_MS[backoff]);
      backoff = Math.min(backoff + 1, BACKOFFS_MS.length - 1);
    }
  }

  // Work loop: poll, run, report, repeat.
  backoff = 0;
  for (;;) {
    if (stopping) return;
    let polled;
    try {
      polled = await request(server, "GET", "/jobs?node=" + encodeURIComponent(id),
        null, token, longPollMs + 10000);
      backoff = 0;
    } catch (e) {
      if (e.status === 401) {
        log("server rejected the token (401) — check --token and restart");
        process.exitCode = 1;
        return;
      }
      if (e.status === 404) {
        // The server forgot this node (restart / prune):
        // re-register and poll again.
        log("server forgot this node (404) — re-registering");
        try {
          await register();
        } catch (e2) {
          log("re-register failed (" + e2.message + ") — retrying in " + BACKOFFS_MS[backoff] + " ms");
          await sleep(BACKOFFS_MS[backoff]);
          backoff = Math.min(backoff + 1, BACKOFFS_MS.length - 1);
        }
        continue;
      }
      log("poll failed (" + e.message + ") — retrying in " + BACKOFFS_MS[backoff] + " ms");
      await sleep(BACKOFFS_MS[backoff]);
      backoff = Math.min(backoff + 1, BACKOFFS_MS.length - 1);
      // After a network error the server may have restarted, so
      // re-register before polling again.
      try {
        await register();
      } catch (e2) {
        // The next poll will 404 and re-register; keep going.
      }
      continue;
    }
    let job = polled.job;
    if (!job) continue;
    log("job " + job.id + " (" + job.operation + " " + job.language + ")");
    let out;
    try {
      out = await runLeg({
        operation: job.operation,
        language: job.language,
        code: job.code,
        events: job.events,
        from: job.from,
        to: job.to,
        includeEvents: job.includeEvents,
        cliPath: cliPath,
        timeoutMs: timeoutMs,
      });
    } catch (e) {
      // runLeg resolves rather than rejects, so this is a bug in
      // the runner itself — report it as a job failure, honestly.
      try {
        await request(server, "POST", "/jobs/" + job.id + "/error",
          { error: { type: "error", name: "Error", message: "node failed to run the job: " + (e.message || String(e)) } },
          token, 15000);
      } catch (e2) {
        log("could not report job " + job.id + " failure: " + e2.message);
      }
      continue;
    }
    try {
      await request(server, "POST", "/jobs/" + job.id + "/result",
        { result: out }, token, 15000);
      log("job " + job.id + " done (" + (out.error ? "error: " + out.error.message : "ok") + ")");
    } catch (e) {
      // The server may have given up on the job (timeout) — the
      // result has nowhere to go. Log it and move on.
      log("could not return job " + job.id + " result: " + e.message);
    }
  }
}

module.exports = { runNode, parseServer };
