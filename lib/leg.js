// Run one IrohRedux engine operation by spawning the CLI as a
// subprocess. Shared by the server (lib/serve.js) and the node client
// (lib/node.js): both are thin wrappers around the CLI, so a leg run
// through the server is byte-identical to the same leg run on the
// command line — the server adds HTTP and delegation, never a second
// implementation of the engine.
//
// Node-only (child_process, temp files). NOT bundled into dist/.
//
//   runLeg({ operation, language, code, events, from, to,
//            includeEvents, cliPath, timeoutMs })
//     operation: "trace" | "analyze" | "scan" | "translate"
//     language:  "javascript" | "python" | "cpp" | "irohscript" | "basic"
//     code:      the program source (always written to a temp file;
//                the CLI's stdin is closed, so a traced program that
//                reads input sees EOF instead of hanging the server)
//   -> Promise<{ events, result, analysis, scan, translation, error }>
//      events:      the trace event lines (trace/analyze only; scan
//                   mode suppresses the flood, translate has none)
//      result:      the result-line value (null for script tracers)
//      analysis:    the analysis line, or null
//      scan:        the scan document, or null
//      translation: the translation line {from,to,code,report}, or null
//      error:       an error-line object, or null. A leg that ran but
//                   whose program errored reports it here (the events
//                   leading up to it are still in `events`); a leg
//                   that could not start (missing toolchain, timeout)
//                   reports that instead.
//
// A run that exceeds timeoutMs is killed and reported as a timeout
// error — the CLI itself has no timeout, so the server must impose
// one or an HTTP request could hang forever. Default 120 s.

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXTENSIONS = {
  javascript: ".js",
  python: ".py",
  cpp: ".cpp",
  irohscript: ".iroh",
  basic: ".bas",
};
const LANGUAGES = Object.keys(EXTENSIONS);

function runLeg(options) {
  options = options || {};
  let operation = options.operation || "trace";
  let language = options.language || "javascript";
  let code = typeof options.code === "string" ? options.code : "";
  let eventsArg = options.events || "ALL";
  let cliPath = options.cliPath || path.join(__dirname, "..", "cli", "iroh.js");
  let timeoutMs = options.timeoutMs === void 0 ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  if (LANGUAGES.indexOf(language) === -1) {
    return Promise.resolve({
      events: [],
      result: null,
      analysis: null,
      scan: null,
      translation: null,
      error: { type: "error", name: "Error", message: "Unknown language: " + language },
    });
  }
  if (operation !== "trace" && operation !== "analyze" && operation !== "scan" && operation !== "translate") {
    return Promise.resolve({
      events: [],
      result: null,
      analysis: null,
      scan: null,
      translation: null,
      error: { type: "error", name: "Error", message: "Unknown operation: " + operation },
    });
  }
  return new Promise((resolve) => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-leg-"));
    let file = path.join(dir, "program" + EXTENSIONS[language]);
    let done = false;
    function finish(out) {
      if (done) return;
      done = true;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // Best effort.
      }
      resolve(out);
    }
    let args;
    let input = null;
    if (operation === "translate") {
      // Translate reads the program from stdin; --from/--to pick
      // the legs. The code never touches a temp file here.
      args = ["--translate", options.to, "--from", options.from || language];
      input = code;
    } else {
      fs.writeFileSync(file, code, "utf8");
      args = [file, "--lang", language, "--events", eventsArg];
      if (operation === "analyze") args.push("--analyze");
      if (operation === "scan") {
        args.push("--scan");
        if (options.includeEvents) args.push("--include-events");
      }
    }
    let child;
    try {
      child = spawn(process.execPath, [cliPath].concat(args), {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (e) {
      finish({
        events: [],
        result: null,
        analysis: null,
        scan: null,
        translation: null,
        error: { type: "error", name: "Error", message: "Could not start the CLI: " + e.message },
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    function terminate() {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch (e) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    let timer = setTimeout(() => {
      try {
        terminate();
      } catch (e) {
        // Already gone.
      }
      finish({
        events: [],
        result: null,
        analysis: null,
        scan: null,
        translation: null,
        error: { type: "error", name: "TimeoutError", message: "leg run timed out after " + timeoutMs + " ms" },
      });
    }, timeoutMs);
    let outputBytes = 0;
    function collect(chunk, isError) {
      if (done) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        clearTimeout(timer); terminate();
        finish({events:[],result:null,analysis:null,scan:null,translation:null,error:{type:"error",name:"OutputLimitError",message:"leg output exceeds 8 MiB"}});
        return;
      }
      if (isError) stderr += chunk.toString("utf8"); else stdout += chunk.toString("utf8");
    }
    child.stdout.on("data", chunk => collect(chunk,false));
    child.stderr.on("data", chunk => collect(chunk,true));
    child.on("error", (e) => {
      clearTimeout(timer);
      finish({
        events: [],
        result: null,
        analysis: null,
        scan: null,
        translation: null,
        error: { type: "error", name: "Error", message: "Could not run the CLI: " + e.message },
      });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (done) return;
      let events = [];
      let result = null;
      let analysis = null;
      let scan = null;
      let translation = null;
      let error = null;
      let lines = stdout.split("\n");
      for (let ii = 0; ii < lines.length; ++ii) {
        let line = lines[ii].trim();
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch (e) {
          // Non-JSON on stdout is not expected from the CLI; ignore
          // it (program output goes to stderr by design).
          continue;
        }
        if (obj.type === "event") events.push(obj);
        else if (obj.type === "result") result = obj.value;
        else if (obj.type === "analysis") analysis = obj;
        else if (obj.type === "scan") scan = obj;
        else if (obj.type === "translation") translation = obj;
        else if (obj.type === "error") error = obj;
      }
      if (status !== 0 && error === null) {
        error = {
          type: "error",
          name: "Error",
          message: "CLI exited with code " + status + (stderr ? ": " + stderr.trim().slice(0, 500) : ""),
        };
      }
      finish({
        events: events,
        result: result,
        analysis: analysis,
        scan: scan,
        translation: translation,
        error: error,
      });
    });
    // stdin: translate gets the code; every other mode gets EOF
    // immediately, so a traced program that reads input does not
    // hang the server waiting on a terminal that isn't there.
    try {
      if (input !== null) child.stdin.write(input);
      child.stdin.end();
    } catch (e) {
      // The child may already have exited.
    }
  });
}

// The languages this box can run locally, from the capability
// probe (lib/capabilities.js). javascript is the built-in engine
// and is always available; python/irohscript/basic need python3,
// cpp needs g++.
function localLegs() {
  let caps;
  try {
    caps = require("./capabilities").capabilities();
  } catch (e) {
    return ["javascript"];
  }
  let out = [];
  for (let ii = 0; ii < caps.legs.length; ++ii) {
    if (caps.legs[ii].available) out.push(caps.legs[ii].leg);
  }
  return out;
}

module.exports = { runLeg, localLegs, DEFAULT_TIMEOUT_MS, LANGUAGES };
