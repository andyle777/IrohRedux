// Capability detection (1.1.1, F1): the package claims a Node floor
// in engines.node, and its own suite must be green on that floor.
// Shared by the test suite (tests/capabilities.js, which turns a
// missing feature into a named skip) and the CLI (`iroh capabilities
// --json`, which prints one row per language leg and per syntax
// feature). This file is Node-only (it spawns subprocesses) and is
// NOT bundled into dist/ — the browser has no child_process, and
// the browser build must never import it.
//
// Each syntax probe runs `node -e <snippet>` in a subprocess, so a
// SyntaxError in the probe (e.g. `using` on Node 22) cannot break
// the calling process. Results are cached per process: the probes
// run once, the first time anything asks.
//
// A capability skip is honest for a green suite and dishonest as a
// floor claim, so the engines floor is set only to versions the
// suite was actually measured on (see package.json).

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// feature -> { snippet, node, what }
//   snippet: code that exits 0 only when the feature exists.
//   node: the oldest Node that has it (the version the skip names).
//   what: a human-readable name for the skip reason.
const FEATURES = {
  regexpModifiers: {
    snippet: "/(?i:a)b/.test('Ab')",
    node: "24",
    what: "RegExp modifiers (?i:...)",
  },
  usingDeclarations: {
    // A bare block: top-level `using` in a CommonJS script is a
    // SyntaxError even on Node 24, so the probe must be inside a
    // block (or a function). A block is enough to prove the syntax
    // parses and the disposal runs.
    snippet: "{ using x = { [Symbol.dispose]() {} }; }",
    node: "24",
    what: "using declarations",
  },
  awaitUsing: {
    snippet: "(async () => { await using x = { [Symbol.asyncDispose]() {} }; })();",
    node: "24",
    what: "await using declarations",
  },
  regexpEscape: {
    snippet: "if (typeof RegExp.escape !== 'function') process.exit(1);",
    node: "24",
    what: "RegExp.escape",
  },
  promiseTry: {
    snippet: "if (typeof Promise.try !== 'function') process.exit(1);",
    node: "24",
    what: "Promise.try",
  },
  errorIsError: {
    snippet: "if (typeof Error.isError !== 'function') process.exit(1);",
    node: "24",
    what: "Error.isError",
  },
  arrayFromAsync: {
    snippet: "if (typeof Array.fromAsync !== 'function') process.exit(1);",
    node: "22",
    what: "Array.fromAsync",
  },
  jsonRawJSON: {
    snippet: "if (typeof JSON.rawJSON !== 'function') process.exit(1);",
    node: "22",
    what: "JSON.rawJSON",
  },
  objectGroupBy: {
    snippet: "if (typeof Object.groupBy !== 'function') process.exit(1);",
    node: "21",
    what: "Object.groupBy",
  },
};

const cache = {};

function has(feature) {
  if (feature in cache) return cache[feature];
  let def = FEATURES[feature];
  if (!def) throw new Error("capabilities: unknown feature " + feature);
  let result = spawnSync(process.execPath, ["-e", def.snippet], {
    encoding: "utf8",
    timeout: 15000,
  });
  // A probe that exits 0 has the feature; anything else (non-zero
  // exit, signal, timeout, spawn error) means it does not.
  let ok = result.status === 0;
  cache[feature] = ok;
  return ok;
}

// One row per syntax feature: { feature, what, node, available }.
function featureRows() {
  return Object.keys(FEATURES).map((feature) => {
    let def = FEATURES[feature];
    return {
      feature: feature,
      what: def.what,
      node: def.node,
      available: has(feature),
    };
  });
}

// Whether a command is on PATH. Scans PATH in-process (no shell,
// so no shell-injection surface and no deprecation warning): the
// `command -v` form needs shell: true, which Node flags.
function hasCommand(cmd) {
  let dirs = (process.env.PATH || "").split(path.delimiter);
  for (let ii = 0; ii < dirs.length; ++ii) {
    let candidate = path.join(dirs[ii], cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (e) {
      // Not here; try the next directory.
    }
  }
  return false;
}

// One row per language leg: { leg, available, why }.
// javascript is the built-in engine and is always available.
// python, irohscript and basic all run through python3 (the
// IrohScript and BASIC tracers spawn it); cpp needs g++.
function legRows() {
  let python = hasCommand("python3");
  let cpp = hasCommand("g++");
  return [
    { leg: "javascript", available: true, why: "built-in engine" },
    {
      leg: "python",
      available: python,
      why: python ? "python3 on PATH" : "python3 not found",
    },
    {
      leg: "cpp",
      available: cpp,
      why: cpp ? "g++ on PATH" : "g++ not found",
    },
    {
      leg: "irohscript",
      available: python,
      why: python
        ? "python3 on PATH (tracer runs through the Python bootstrap)"
        : "python3 not found",
    },
    {
      leg: "basic",
      available: python,
      why: python
        ? "python3 on PATH (tracer runs through the Python bootstrap)"
        : "python3 not found",
    },
  ];
}

// The full capability report: { node, features, legs }.
function capabilities() {
  return {
    node: process.version,
    features: featureRows(),
    legs: legRows(),
  };
}

module.exports = { FEATURES, has, featureRows, hasCommand, legRows, capabilities };
