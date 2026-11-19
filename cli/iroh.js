#!/usr/bin/env node
// IrohRedux CLI — run JavaScript through Iroh and stream trace events as
// JSON lines, one event per line, so other languages can consume Iroh
// without speaking JavaScript.
//
//   node cli/iroh.js program.js [--events CALL,IF,VAR]
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
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Iroh = require("../dist/iroh-node.js");
// The singleton carries the label tables (see src/setup.js), so the CLI
// can turn event type/category numbers back into names.
const INSTR = Iroh.INSTR;
const CATEGORY = Iroh.CATEGORY;

const TRIGGERS = ["before", "after", "enter", "leave", "fire", "test", "return"];

// Event fields that are safe to copy onto the JSON line. Everything else
// on a RuntimeEvent (instance, node, location) is an internal reference
// and is never serialized.
const FIELDS = [
  "name", "value", "result", "return", "op", "test", "left", "right",
  "arguments", "object", "property", "context", "scope", "kind", "label",
  "prefix", "external", "sloppy", "isDefault", "default", "callee",
];

function safeValue(value, depth, seen) {
  if (value === null) return null;
  switch (typeof value) {
    case "undefined": return null;
    case "function": return "[Function " + (value.name || "anonymous") + "]";
    case "bigint": return value.toString() + "n";
    case "symbol": return value.toString();
    case "string":
    case "number":
    case "boolean":
      return value;
  }
  if (value instanceof Error) return { error: value.message };
  if (typeof value.then === "function") return "[Promise]";
  if (depth <= 0) return "[Object]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => safeValue(v, depth - 1, seen));
  }
  let out = {};
  for (let key of Object.keys(value)) {
    try {
      out[key] = safeValue(value[key], depth - 1, seen);
    } catch (e) {
      out[key] = "[Unserializable]";
    }
  }
  return out;
}

function instructionName(type) {
  for (let key in INSTR) {
    if (INSTR[key] === type) return key;
  }
  return String(type);
}

function categoryName(category) {
  for (let key in CATEGORY) {
    if (CATEGORY[key] === category) return key;
  }
  return String(category);
}

function printLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function printUsage() {
  process.stderr.write(
    "Usage: iroh <file.js> [--events CALL,IF,VAR] [--no-result]\n" +
    "       cat file.js | iroh [--events CALL,IF,VAR]\n" +
    "Events are streamed as JSON lines on stdout, then a result line.\n" +
    "Use --events ALL (default) or a comma list of categories, e.g. CALL.\n"
  );
}

async function main() {
  let args = process.argv.slice(2);
  let file = null;
  let eventsArg = "ALL";
  let wantResult = true;
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
      printLine({ type: "error", name: e.name, message: "Cannot read " + file + ": " + e.message });
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

  // Resolve the requested categories.
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

  let stage;
  try {
    stage = new Iroh.Stage(code);
  } catch (e) {
    printLine({ type: "error", name: e.name, message: e.message });
    process.exitCode = 1;
    return;
  }

  for (let name of categories) {
    let listener = stage.addListener(Iroh[name]);
    for (let trigger of TRIGGERS) {
      listener.on(trigger, (event) => {
        let line = {
          type: "event",
          event: instructionName(event.type),
          category: categoryName(event.category),
          trigger: trigger,
          hash: event.hash,
          indent: event.indent,
        };
        for (let field of FIELDS) {
          if (event[field] !== void 0 && event[field] !== null) {
            line[field] = safeValue(event[field], 3, new Set());
          }
        }
        printLine(line);
      });
    }
  }

  let result;
  try {
    result = eval(stage.script);
    if (result && typeof result.then === "function") result = await result;
  } catch (e) {
    printLine({ type: "error", name: e.name, message: e.message });
    process.exitCode = 1;
    return;
  }
  if (wantResult) {
    printLine({ type: "result", value: safeValue(result, 4, new Set()) });
  }
}

main();
