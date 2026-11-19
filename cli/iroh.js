#!/usr/bin/env node
// IrohRedux CLI — run JavaScript through Iroh and stream trace events as
// JSON lines, one event per line, so other languages can consume Iroh
// without speaking JavaScript.
//
//   node cli/iroh.js program.js [--events CALL,IF,VAR]
//   node cli/iroh.js program.mjs [--module] [--events CALL,IF,VAR]
//   cat program.js | node cli/iroh.js [--events CALL]
//
// Output (stdout, JSONL):
//   {"type":"event","event":"CALL","category":"CALL","trigger":"before",
//    "hash":12,"indent":0,"name":"factorial","arguments":[[3]],"external":false}
//   {"type":"result","value":6}
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
    "Usage: iroh <file.js> [--events CALL,IF,VAR] [--no-result]\n" +
    "       iroh <file.mjs> [--module] [--events CALL,IF,VAR]\n" +
    "       cat file.js | iroh [--events CALL,IF,VAR]\n" +
    "Events are streamed as JSON lines on stdout, then a result line.\n" +
    "Use --events ALL (default) or a comma list of categories, e.g. CALL.\n" +
    ".mjs files (or --module) run as ES modules through Iroh.traceModule();\n" +
    "everything else runs as a script through Iroh.traceAsync().\n"
  );
}

async function main() {
  let args = process.argv.slice(2);
  let file = null;
  let eventsArg = "ALL";
  let wantResult = true;
  let moduleFlag = false;
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
}

main();
