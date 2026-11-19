#!/usr/bin/env node
// IrohRedux CLI — run JavaScript through Iroh and stream trace events as
// JSON lines, one event per line, so other languages can consume Iroh
// without speaking JavaScript.
//
//   node cli/iroh.js program.js [--events CALL,IF,VAR]
//   node cli/iroh.js program.mjs [--module] [--events CALL,IF,VAR]
//   cat program.js | node cli/iroh.js [--events CALL]
//   node cli/iroh.js program.js --analyze
//   node cli/iroh.js program.js --translate python
//   node cli/iroh.js program.py --translate javascript
//
// Output (stdout, JSONL):
//   {"type":"event","event":"CALL","category":"CALL","trigger":"before",
//    "hash":12,"indent":0,"name":"factorial","arguments":[[3]],"external":false}
//   {"type":"result","value":6}
//   {"type":"analysis","findings":[...],"scores":{...},"summary":{...},"neuron":{...}}
//   {"type":"translation","from":"javascript","to":"python","code":"...","report":{...}}
//
// --analyze appends an analysis line (see src/analyze.js) after the
// result line. --translate skips tracing and translates the program
// instead (see src/translate.js); it takes precedence over --events
// and --module, and exits 1 when the report lists anything
// unsupported. --from defaults by file extension (.py -> python,
// .cpp/.cc/.cxx -> cpp, anything else -> javascript); stdin defaults
// to javascript.
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
const path = require("node:path");

const Iroh = require("../dist/iroh-node.js");
// The singleton carries the label tables and the event projection (see
// src/setup.js and src/utils.js). The CLI uses Iroh.eventToJSON so its
// JSON lines are the same shape as Iroh.trace() events.
const CATEGORY = Iroh.CATEGORY;

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
    "Usage: iroh <file.js> [--events CALL,IF,VAR] [--no-result] [--analyze]\n" +
    "       iroh <file.mjs> [--module] [--events CALL,IF,VAR]\n" +
    "       cat file.js | iroh [--events CALL,IF,VAR]\n" +
    "       iroh <file.js> --translate python|cpp [--from javascript]\n" +
    "       iroh <file.py|.cpp> --translate javascript [--from python|cpp]\n" +
    "Events are streamed as JSON lines on stdout, then a result line.\n" +
    "Use --events ALL (default) or a comma list of categories, e.g. CALL.\n" +
    ".mjs files (or --module) run as ES modules through Iroh.traceModule();\n" +
    "everything else runs as a script through Iroh.traceAsync().\n" +
    "--analyze appends an analysis line after the result line.\n" +
    "--translate prints one translation line instead of tracing; --from\n" +
    "defaults by file extension (.py -> python, .cpp/.cc/.cxx -> cpp).\n"
  );
}

async function main() {
  let args = process.argv.slice(2);
  let file = null;
  let eventsArg = "ALL";
  let wantResult = true;
  let moduleFlag = false;
  let analyzeFlag = false;
  let translateTo = null;
  let fromArg = null;
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

  // Modules: an explicit --module, or a .mjs file. Scripts (including
  // top-level await) go through traceAsync(); modules through
  // traceModule(), with the file as the base for relative imports.
  let isModule = moduleFlag || (file !== null && file.endsWith(".mjs"));
  let out;
  try {
    if (isModule) {
      out = await Iroh.traceModule(code, {
        events: eventsArg,
        onEvent: (line) => printLine(line),
        filename: file || undefined,
      });
    } else {
      out = await Iroh.traceAsync(code, {
        events: eventsArg,
        onEvent: (line) => printLine(line),
      });
    }
  } catch (e) {
    printLine(errorLine(e));
    process.exitCode = 1;
    return;
  }
  if (wantResult) {
    printLine({ type: "result", value: Iroh.safeValue(out.result, 4, new Set()) });
  }
  if (analyzeFlag) {
    // The analysis runs over the collected events, with the source
    // attached so the fidelity score can count its blind spots.
    // (With an --events filter, coverage scores the filter — the
    // analysis note says so.)
    let analysis = Iroh.analyze(out.events || [], { source: code });
    printLine(Object.assign({ type: "analysis" }, analysis));
  }
}

main();
