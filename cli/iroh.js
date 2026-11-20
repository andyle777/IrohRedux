#!/usr/bin/env node
// IrohRedux CLI — run a program through Iroh and stream trace events as
// JSON lines, one event per line, so other languages can consume Iroh
// without speaking JavaScript. Since 0.9.0 the CLI also traces Python
// and C++ natively, and scans any language's trace into one compact
// JSON document for AI consumers.
//
//   node cli/iroh.js program.js [--events CALL,IF,VAR]
//   node cli/iroh.js program.mjs [--module] [--events CALL,IF,VAR]
//   cat program.js | node cli/iroh.js [--events CALL]
//   node cli/iroh.js program.py [--lang python]
//   node cli/iroh.js program.cpp [--lang cpp]
//   node cli/iroh.js program.js --analyze
//   node cli/iroh.js program.py --scan
//   node cli/iroh.js program.js --live
//   node cli/iroh.js program.js --direct
//   node cli/iroh.js program.js --direct=stop
//   node cli/iroh.js program.js --translate python
//   node cli/iroh.js program.py --translate javascript
//
// The language is --lang python|cpp|javascript, or inferred from the
// file extension (.py -> python, .cpp/.cc/.cxx -> cpp, anything else ->
// javascript); stdin defaults to javascript.
//
// Output (stdout, JSONL):
//   {"type":"event","event":"CALL","category":"CALL","trigger":"before",
//    "hash":12,"indent":0,"name":"factorial","arguments":[[3]],"external":false}
//   {"type":"result","value":6}
//   {"type":"analysis","findings":[...],"scores":{...},"summary":{...},"neuron":{...}}
//   {"type":"scan","vectors":{...},"findings":[...],"scores":{...},"summary":{...}}
//   {"type":"live-finding","code":"HOT_LOOP","severity":"warning",
//    "message":"...","evidence":{...},"neuron":{...},"firedAt":505}
//   {"type":"live-summary","findings":[...],"scores":{...},"summary":{...},
//    "neuron":{...},"vectors":{...},"finished":true}
//   {"type":"directive","directive":{"type":"set","name":"i","value":10000},
//    "issuedAtEvent":505,"applied":true,"appliedAtEvent":510,
//    "appliedVia":"loop-test","note":"..."}
//   {"type":"direct-summary","stopped":false,"stopReason":null,
//    "findings":[...],"directives":[...],"analysis":{...}}
//   {"type":"translation","from":"javascript","to":"python","code":"...","report":{...}}
//
// --analyze appends an analysis line (see src/analyze.js) after the
// result line. --scan appends ONE scan line (see src/scan.js) instead
// of the raw event flood: the scan runs trace -> analyze -> vector in
// one pass and emits { vectors, findings, scores, summary } — no event
// lines are printed in scan mode unless --include-events embeds the
// raw events in the scan document. --live (see src/live.js) streams
// {"type":"live-finding",...} lines as findings trip while the program
// runs — HOT_LOOP when a loop's iteration count crosses its threshold,
// DEEP_RECURSION when call depth crosses its threshold — then a final
// {"type":"live-summary",...} with the batch-equal findings, the
// scorecard and the vector. Each live finding carries `firedAt` (the
// 0-based index of the event that tripped it) and the evidence as of
// the trip; findings that need the complete trace (ZERO_ITERATION_LOOP,
// ONE_SIDED_BRANCH) fire in the summary instead, with a `note` saying
// so. For JavaScript the live lines stream as the program runs; for
// Python/C++ they print after the run, because the native tracers
// buffer their events. --direct (see src/direct.js) runs a JavaScript
// script under the built-in runaway-loop guard: event lines stream as
// usual, {"type":"directive",...} lines print when the guard's
// directives take effect, then the result line and one final
// {"type":"direct-summary",...} with stopped/stopReason, the findings,
// the full directive audit log and the analysis. --direct=stop makes
// the guard stop the run instead of throttling the loop. Direct mode
// is JavaScript-only — Python/C++ traces are buffered after the run,
// so there is nothing live to direct. Scripts (including top-level
// await) run through Iroh.directAsync(); modules — a .mjs file, or
// --module — through Iroh.directModule(). --analyze and --scan are
// honoured in direct mode too (an analysis line / a scan line after
// the direct-summary, built from the directed run's events); --live
// streams live-finding lines as findings trip, and the direct-summary
// already carries the live finish, so no separate live-summary line
// is printed. --direct always traces ALL categories, so --events with
// anything but ALL is a usage error. --translate skips tracing and
// translates the program instead (see src/translate.js); it takes
// precedence over --events and --module, and exits 1 when the report
// lists anything unsupported. --translate cannot be combined with
// --live, --scan, --analyze or --direct — those consume a trace the
// translate mode never runs. --from defaults by file extension (.py
// -> python, .cpp/.cc/.cxx -> cpp, anything else -> javascript);
// stdin defaults to javascript. --include-events only means
// something with --scan, so without it it is a usage error.
//
// Language notes (0.9.0 native tracers):
// - Python runs through python/iroh/trace.py (sys.settrace + AST
//   instrumentation, stdlib only). The program's own stdout is
//   redirected to stderr while it runs, so the JSONL stream stays
//   clean; its prints are still visible, on the other stream.
// - C++ runs through cpp/iroh_trace_rt.cpp: the program is compiled
//   with -finstrument-functions -rdynamic -O0 and linked against the
//   runtime (compiled without instrumentation), then run with its
//   stderr as the event channel and its stdout forwarded to this
//   process's stderr. Non-JSON lines on that channel are the
//   program's own stderr output, forwarded to this process's stderr
//   instead of dropped. v1 is function-level only. The result line for
//   C++ is the program's exit code; for Python it is null (a Python
//   program has no completion value).
// - Both tracers inherit the CLI's stdin, so a traced program that
//   reads input (input(), scanf) behaves as if run directly. Neither
//   tracer imposes a timeout: a program that never terminates hangs
//   the CLI, exactly as running it directly would.
//
// Errors are a final {"type":"error",...} line and a non-zero exit code.
// Use --no-result to skip the result line. Requires the built dist
// (`npm run build`); the CLI loads ../dist/iroh-node.js.
//
// Scripts run through Iroh.traceAsync() (so top-level await works);
// modules — a .mjs file, or --module — run through Iroh.traceModule(),
// and the result line is the module namespace object. Relative imports
// in a module resolve against the traced file; from stdin they resolve
// against a temp directory and will usually fail.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const Iroh = require("../dist/iroh-node.js");
// The singleton carries the label tables and the event projection (see
// src/setup.js and src/utils.js). The CLI uses Iroh.eventToJSON so its
// JSON lines are the same shape as Iroh.trace() events.
const CATEGORY = Iroh.CATEGORY;

const PYTHON = process.env.IROH_PYTHON || "python3";
const CXX = process.env.IROH_CXX || "g++";
// spawnSync's default maxBuffer is 1 MiB — a deep C++ recursion emits
// ~4 MB of events and would die with ENOBUFS and zero events. 512 MiB
// is far above any sane trace (and the run would OOM on events long
// before that, since they are all held in memory anyway).
const MAX_BUFFER = 512 * 1024 * 1024;
const TRACE_PY = path.join(__dirname, "..", "python", "iroh", "trace.py");
const CPP_RT = path.join(__dirname, "..", "cpp", "iroh_trace_rt.cpp");

// Normalize any thrown value into an error line. A program may throw a
// string, a number, or null — those have no .name/.message, so without
// this the error line would carry no information at all.
function errorLine(e, message) {
  let name = (e && typeof e === "object" && e.name) ? e.name : "Error";
  let msg = message !== undefined
    ? message
    : ((e && typeof e === "object" && e.message !== undefined) ? e.message : String(e));
  return { type: "error", name: name, message: msg };
}

function printLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function printUsage() {
  process.stderr.write(
    "Usage: iroh <file.js> [--events CALL,IF,VAR] [--no-result] [--analyze] [--scan]\n" +
    "       iroh <file.mjs> [--module] [--events CALL,IF,VAR]\n" +
    "       iroh <file.py> [--lang python] [--scan]\n" +
    "       iroh <file.cpp> [--lang cpp] [--scan]\n" +
    "       cat file.js | iroh [--events CALL,IF,VAR]\n" +
    "       iroh <file.js> --translate python|cpp [--from javascript]\n" +
    "       iroh <file.py|.cpp> --translate javascript [--from python|cpp]\n" +
    "       iroh <file.js> --direct[=throttle|stop]\n" +
    "Events are streamed as JSON lines on stdout, then a result line.\n" +
    "Use --events ALL (default) or a comma list of categories, e.g. CALL.\n" +
    ".mjs files (or --module) run as ES modules through Iroh.traceModule();\n" +
    "everything else runs as a script through Iroh.traceAsync().\n" +
    "--analyze appends an analysis line after the result line.\n" +
    "--scan appends ONE scan line { vectors, findings, scores, summary }\n" +
    "instead of the event flood; --include-events embeds the raw events\n" +
    "in the scan document. --live streams live-finding lines as findings\n" +
    "trip while the program runs, then a final live-summary line with\n" +
    "the findings, scores and vectors. --direct runs the script under\n" +
    "the runaway-loop guard (throttle by default, --direct=stop stops\n" +
    "the run instead): directive lines print as the guard acts, then a\n" +
    "final direct-summary line with the findings, the directive audit\n" +
    "log and the analysis. --direct works for scripts (top-level await\n" +
    "included) and for modules (.mjs or --module). --analyze and\n" +
    "--scan are honoured with --direct (an analysis / scan line after\n" +
    "the direct-summary); --live streams live-finding lines during a\n" +
    "directed run. --direct always traces ALL categories. --lang\n" +
    "python|cpp|javascript selects the\n" +
    "tracer (default: inferred from the file extension).\n" +
    "--translate prints one translation line instead of tracing; --from\n" +
    "defaults by file extension (.py -> python, .cpp/.cc/.cxx -> cpp).\n" +
    "--translate cannot be combined with --live, --scan, --analyze or\n" +
    "--direct. --include-events needs --scan.\n"
  );
}

// Parse JSONL text into objects, skipping blank lines and lines that
// are not JSON (a traced C++ program writing to stderr shares the
// event channel — its non-JSON lines are skipped, not fatal). When
// `onSkipped` is given, each skipped line is passed to it, so the
// caller can forward program output instead of dropping it silently.
function parseLines(text, onSkipped) {
  let out = [];
  if (!text) return out;
  let lines = text.split("\n");
  for (let ii = 0; ii < lines.length; ++ii) {
    let line = lines[ii].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      // Not JSON — program output sharing the channel; skip it.
      if (onSkipped) onSkipped(line);
    }
  }
  return out;
}

function inferLanguage(file) {
  if (file !== null && file.endsWith(".py")) return "python";
  if (file !== null && /\.(cpp|cc|cxx)$/.test(file)) return "cpp";
  return "javascript";
}

// Run the Python tracer on `file` (a real path). Returns
// { events, result, error } — error is an error-line object or null.
// stdin is inherited, so a traced program that reads input (input(),
// sys.stdin.read()) sees the same stdin the CLI was given instead of
// an immediate EOF.
function runPython(file, eventsArg) {
  let proc = spawnSync(PYTHON, [TRACE_PY, "--events", eventsArg, file], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["inherit", "pipe", "inherit"],
  });
  if (proc.error) {
    return { events: [], result: null, error: errorLine(proc.error, "Could not run " + PYTHON + ": " + proc.error.message) };
  }
  let events = [];
  let result = null;
  let error = null;
  let lines = parseLines(proc.stdout);
  for (let ii = 0; ii < lines.length; ++ii) {
    let item = lines[ii];
    if (item.type === "event") events.push(item);
    else if (item.type === "result") result = item.value;
    else if (item.type === "error") error = item;
  }
  if (proc.status !== 0 && error === null) {
    error = errorLine(new Error("python tracer exited with code " + proc.status));
  }
  return { events: events, result: result, error: error };
}

// Compile `file` (a .cpp path) with -finstrument-functions against the
// runtime, run it, and collect its stderr events. Returns
// { events, result, error } — result is the program's exit code.
function runCpp(file, eventsArg) {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-cpp-"));
  try {
    let rtObj = path.join(dir, "rt.o");
    let bin = path.join(dir, "prog");
    let rt = spawnSync(CXX, ["-std=c++17", "-O0", "-c", CPP_RT, "-o", rtObj], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    if (rt.error) {
      return { events: [], result: null, error: errorLine(rt.error, "Could not run " + CXX + ": " + rt.error.message) };
    }
    if (rt.status !== 0) {
      return { events: [], result: null, error: errorLine(new Error("Could not compile the tracer runtime"), "Could not compile the tracer runtime: " + (rt.stderr || "").trim()) };
    }
    let comp = spawnSync(CXX, ["-std=c++17", "-O0", "-finstrument-functions", "-rdynamic", "-g", file, rtObj, "-o", bin, "-ldl"], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    if (comp.error) {
      return { events: [], result: null, error: errorLine(comp.error, "Could not run " + CXX + ": " + comp.error.message) };
    }
    if (comp.status !== 0) {
      return { events: [], result: null, error: errorLine(new Error("Compilation failed"), "Compilation failed: " + (comp.stderr || "").trim()) };
    }
    // The binary's stdout is the program's own output — forward it to
    // this process's stderr so it stays visible without corrupting
    // the JSONL stream; its stderr is the event channel. stdin is
    // inherited, so a traced program that reads input (scanf, getline)
    // sees the same stdin the CLI was given instead of an immediate
    // EOF.
    let run = spawnSync(bin, [], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["inherit", "pipe", "pipe"],
    });
    if (run.stdout) process.stderr.write(run.stdout);
    if (run.error) {
      return { events: [], result: null, error: errorLine(run.error) };
    }
    // Parse the event channel FIRST — even when the program crashed,
    // the events it emitted before dying are real evidence, and the
    // non-JSON lines mixed into the channel are the program's own
    // stderr output, forwarded to this process's stderr instead of
    // being dropped silently.
    let events = [];
    let lines = parseLines(run.stderr, (line) => { process.stderr.write(line + "\n"); });
    for (let ii = 0; ii < lines.length; ++ii) {
      if (lines[ii].type === "event") events.push(lines[ii]);
    }
    if (eventsArg.toUpperCase() !== "ALL") {
      let wanted = {};
      let names = eventsArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      for (let ii = 0; ii < names.length; ++ii) wanted[names[ii]] = true;
      events = events.filter((e) => wanted[e.category]);
    }
    if (run.signal) {
      return { events: events, result: null, error: errorLine(new Error("Program killed by signal " + run.signal)) };
    }
    return { events: events, result: run.status, error: null };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // Best effort.
    }
  }
}

async function main() {
  let args = process.argv.slice(2);
  let file = null;
  let eventsArg = "ALL";
  let wantResult = true;
  let moduleFlag = false;
  let analyzeFlag = false;
  let scanFlag = false;
  let includeEventsFlag = false;
  let liveFlag = false;
  let directMode = null; // "throttle" | "stop" once --direct is given
  let translateTo = null;
  let fromArg = null;
  let langArg = null;
  for (let ii = 0; ii < args.length; ++ii) {
    let arg = args[ii];
    if (arg === "--events") {
      eventsArg = args[++ii];
      if (eventsArg === void 0) { printUsage(); process.exitCode = 2; return; }
    } else if (arg.startsWith("--events=")) {
      eventsArg = arg.slice("--events=".length);
    } else if (arg === "--file") {
      file = args[++ii];
      if (file === void 0) { printUsage(); process.exitCode = 2; return; }
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    } else if (arg === "--no-result") {
      wantResult = false;
    } else if (arg === "--module") {
      moduleFlag = true;
    } else if (arg === "--analyze") {
      analyzeFlag = true;
    } else if (arg === "--scan") {
      scanFlag = true;
    } else if (arg === "--include-events") {
      includeEventsFlag = true;
    } else if (arg === "--live") {
      liveFlag = true;
    } else if (arg === "--direct") {
      directMode = "throttle";
    } else if (arg.startsWith("--direct=")) {
      let mode = arg.slice("--direct=".length);
      if (mode !== "throttle" && mode !== "stop") {
        process.stderr.write("Unknown --direct mode: " + mode + " (use throttle or stop)\n");
        printUsage();
        process.exitCode = 2;
        return;
      }
      directMode = mode;
    } else if (arg === "--lang") {
      langArg = args[++ii];
      if (langArg === void 0) { printUsage(); process.exitCode = 2; return; }
    } else if (arg.startsWith("--lang=")) {
      langArg = arg.slice("--lang=".length);
    } else if (arg === "--translate") {
      translateTo = args[++ii];
      if (translateTo === void 0) { printUsage(); process.exitCode = 2; return; }
    } else if (arg.startsWith("--translate=")) {
      translateTo = arg.slice("--translate=".length);
    } else if (arg === "--from") {
      fromArg = args[++ii];
      if (fromArg === void 0) { printUsage(); process.exitCode = 2; return; }
    } else if (arg.startsWith("--from=")) {
      fromArg = arg.slice("--from=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      return;
    } else if (arg.startsWith("--")) {
      process.stderr.write("Unknown option: " + arg + "\n");
      printUsage();
      process.exitCode = 2;
      return;
    } else if (file === null) {
      file = arg;
    } else {
      process.stderr.write("Unexpected argument: " + arg + "\n");
      printUsage();
      process.exitCode = 2;
      return;
    }
  }

  // Language: explicit --lang, else inferred from the extension.
  // Validated before reading any file, so a bad --lang is a usage
  // error (exit 2) even when the file is missing too.
  let language = langArg ? langArg.toLowerCase() : inferLanguage(file);
  if (language !== "javascript" && language !== "python" && language !== "cpp") {
    process.stderr.write("Unknown language: " + language + " (use javascript, python or cpp)\n");
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (moduleFlag && language !== "javascript") {
    process.stderr.write("--module is JavaScript-only\n");
    printUsage();
    process.exitCode = 2;
    return;
  }
  // Mode combinations are validated before any file is read, so a bad
  // combination is a usage error (exit 2) even when the file is
  // missing too — a missing file must never mask it.
  if (translateTo !== null && (liveFlag || scanFlag || analyzeFlag || directMode !== null)) {
    process.stderr.write("--translate cannot be combined with --live, --scan, --analyze or --direct (those consume a trace the translate mode never runs)\n");
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (directMode !== null && eventsArg.toUpperCase() !== "ALL") {
    process.stderr.write("--direct always traces ALL categories (the director and the live analyzer need the full stream); --events with --direct is a usage error\n");
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (includeEventsFlag && !scanFlag) {
    process.stderr.write("--include-events only means something with --scan\n");
    printUsage();
    process.exitCode = 2;
    return;
  }

  let code;
  if (file !== null) {
    try {
      code = fs.readFileSync(file, "utf8");
    } catch (e) {
      printLine(errorLine(e, "Cannot read " + file + ": " + (e.message || String(e))));
      process.exitCode = 1;
      return;
    }
  } else if (!process.stdin.isTTY) {
    code = fs.readFileSync(0, "utf8");
  } else {
    printUsage();
    process.exitCode = 2;
    return;
  }

  // Translate mode takes precedence over tracing: no events, no
  // result line — one translation line, exit 1 when anything was
  // unsupported.
  if (translateTo !== null) {
    let from = fromArg;
    if (!from) {
      if (file !== null && file.endsWith(".py")) from = "python";
      else if (file !== null && /\.(cpp|cc|cxx)$/.test(file)) from = "cpp";
      else from = "javascript";
    }
    let out;
    try {
      out = Iroh.translate(code, { from: from, to: translateTo });
    } catch (e) {
      printLine(errorLine(e));
      process.exitCode = 1;
      return;
    }
    printLine({ type: "translation", from: from, to: translateTo, code: out.code, report: out.report });
    process.exitCode = out.report.ok ? 0 : 1;
    return;
  }

  // Language was determined and validated before the file was read
  // (a bad --lang is a usage error, exit 2, even when the file is
  // missing too).

  // Resolve the requested categories (before running anything, so an
  // unknown category is a usage error, exit 2, not a trace failure).
  let categories;
  if (eventsArg.toUpperCase() === "ALL") {
    categories = Object.keys(CATEGORY);
  } else {
    categories = eventsArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    for (let name of categories) {
      if (typeof Iroh[name] !== "number") {
        process.stderr.write("Unknown event category: " + name + "\n");
        printUsage();
        process.exitCode = 2;
        return;
      }
    }
  }

  // Run the trace in the selected language. JavaScript streams its
  // events as they fire; Python and C++ collect theirs from the
  // native tracer's output first.
  let collected = [];
  let result = null;
  let traceError = null;
  // The live wire analyzer (see src/live.js): findings fire as events
  // arrive. For JavaScript the events stream through it as the program
  // runs; for Python/C++ they are fed after the run, because the
  // native tracers buffer their events.
  let liveAnalyzer = liveFlag
    ? Iroh.liveAnalyzer({ language: language, source: code })
    : null;
  function printLiveFindings(fired) {
    for (let ii = 0; ii < fired.length; ++ii) {
      printLine(Object.assign({ type: "live-finding" }, fired[ii]));
    }
  }
  // Direct mode: run the script under the built-in runaway-loop guard
  // (Iroh.directAsync / Iroh.directModule, see src/direct.js). Event
  // lines stream as usual, directive lines print when the guard's
  // directives take effect, then the result line and one final
  // direct-summary line — the findings, the full directive audit log
  // and the analysis. A directed stop is a normal outcome (exit 0),
  // not a failure; a runtime error is an error line and exit 1, like
  // the other paths. JavaScript only: Python/C++ traces are buffered
  // after the run, so there is nothing live to direct. Scripts run
  // through directAsync() (so top-level await works); modules — a
  // .mjs file, or --module — through directModule(). --analyze and
  // --scan are honoured after the direct-summary (built from the
  // directed run's events); --live streams live-finding lines as
  // findings trip, via the onFinding hook — the direct-summary already
  // carries the live finish, so no separate live-summary line is
  // printed. Event lines stream even with --scan: the directive lines
  // cite event indices, so suppressing the events would leave them
  // pointing at lines the user never saw.
  if (directMode !== null) {
    if (language !== "javascript") {
      process.stderr.write("--direct is JavaScript-only: Python/C++ traces are buffered after the run, so there is nothing live to direct\n");
      printUsage();
      process.exitCode = 2;
      return;
    }
    let isModule = moduleFlag || (file !== null && file.endsWith(".mjs"));
    let guard = Iroh.runawayGuard({ action: directMode });
    let out;
    try {
      let directOptions = {
        source: code,
        onEvent: (line) => {
          collected.push(line);
          printLine(line);
        },
        onDirective: (entry) => {
          printLine({
            type: "directive",
            directive: entry.directive,
            issuedAtEvent: entry.issuedAtEvent,
            applied: entry.applied,
            appliedAtEvent: entry.appliedAtEvent,
            appliedVia: entry.appliedVia,
            note: entry.note,
          });
        },
      };
      if (liveFlag) {
        directOptions.onFinding = (fired) => {
          printLiveFindings(fired);
        };
      }
      if (isModule) {
        out = await Iroh.directModule(code, guard, directOptions);
      } else {
        out = await Iroh.directAsync(code, guard, directOptions);
      }
    } catch (e) {
      if (e && Array.isArray(e.events)) collected = e.events;
      printLine(errorLine(e));
      process.exitCode = 1;
      return;
    }
    if (wantResult) {
      printLine({ type: "result", value: Iroh.safeValue(out.result, 4, new Set()) });
    }
    printLine({
      type: "direct-summary",
      stopped: out.stopped,
      stopReason: out.stopReason,
      findings: out.findings,
      directives: out.directives,
      analysis: out.analysis,
    });
    if (analyzeFlag) {
      let analysis = Iroh.analyze(out.events, { source: code });
      printLine(Object.assign({ type: "analysis" }, analysis));
    }
    if (scanFlag) {
      let doc = Iroh.scan(out.events, {
        language: language,
        source: code,
        includeEvents: includeEventsFlag,
      });
      printLine(Object.assign({ type: "scan" }, doc));
    }
    process.exitCode = 0;
    return;
  }
  if (language === "javascript") {
    // Modules: an explicit --module, or a .mjs file. Scripts (including
    // top-level await) go through traceAsync(); modules through
    // traceModule(), with the file as the base for relative imports.
    let isModule = moduleFlag || (file !== null && file.endsWith(".mjs"));
    let out;
    try {
      if (isModule) {
        out = await Iroh.traceModule(code, {
          events: eventsArg,
          onEvent: (line) => {
            collected.push(line);
            if (liveFlag) {
              printLiveFindings(liveAnalyzer.feed(line));
            } else if (!scanFlag) {
              printLine(line);
            }
          },
          filename: file || undefined,
        });
      } else {
        out = await Iroh.traceAsync(code, {
          events: eventsArg,
          onEvent: (line) => {
            collected.push(line);
            if (liveFlag) {
              printLiveFindings(liveAnalyzer.feed(line));
            } else if (!scanFlag) {
              printLine(line);
            }
          },
        });
      }
      result = Iroh.safeValue(out.result, 4, new Set());
    } catch (e) {
      traceError = errorLine(e);
      // The JS tracers attach prior events to the error; keep them.
      if (e && Array.isArray(e.events)) collected = e.events;
    }
  } else {
    // Native tracers need a real file. From stdin, write the code to
    // a temp file first (the Python tracer filters frames by filename;
    // the C++ driver compiles the file).
    let traceFile = file;
    let tmpDir = null;
    if (traceFile === null) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-stdin-"));
      traceFile = path.join(tmpDir, language === "python" ? "stdin.py" : "stdin.cpp");
      fs.writeFileSync(traceFile, code, "utf8");
    }
    try {
      let run = language === "python"
        ? runPython(traceFile, eventsArg)
        : runCpp(traceFile, eventsArg);
      collected = run.events;
      result = run.result;
      traceError = run.error;
    } finally {
      if (tmpDir !== null) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
          // Best effort.
        }
      }
    }
    // Python and C++ traces print their events after the run, in
    // order — unless scan mode suppresses the flood, or live mode
    // prints live-finding lines instead (fed after the run, because
    // the native tracers buffer their events).
    if (liveFlag) {
      for (let ii = 0; ii < collected.length; ++ii) {
        printLiveFindings(liveAnalyzer.feed(collected[ii]));
      }
    } else if (!scanFlag) {
      for (let ii = 0; ii < collected.length; ++ii) printLine(collected[ii]);
    }
  }

  if (traceError !== null) {
    printLine(traceError);
    process.exitCode = 1;
    return;
  }
  if (wantResult) {
    printLine({ type: "result", value: result });
  }
  if (analyzeFlag) {
    // The analysis runs over the collected events, with the source
    // attached so the fidelity score can count its blind spots.
    // (With an --events filter, coverage scores the filter — the
    // analysis note says so.)
    let analysis = Iroh.analyze(collected, { source: code });
    printLine(Object.assign({ type: "analysis" }, analysis));
  }
  if (scanFlag) {
    // One compact document: vectors, findings, scores, summary.
    // The raw events ride along only with --include-events.
    let doc = Iroh.scan(collected, {
      language: language,
      source: code,
      includeEvents: includeEventsFlag,
    });
    printLine(Object.assign({ type: "scan" }, doc));
  }
  if (liveFlag) {
    // The final live summary: the batch-equal findings (including the
    // stream-end ones, with their notes), the scorecard and the vector.
    // Not printed when the trace itself errored — same as --analyze.
    let summary = liveAnalyzer.finish();
    printLine(Object.assign({ type: "live-summary" }, summary));
  }
}

main();
