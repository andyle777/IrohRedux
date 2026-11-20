import { CATEGORY, INSTR, OP } from "./labels";
import { VERSION, IS_BROWSER } from "./cfg";
import { parse } from "./helpers";

export function setup() {
  this.generateCategoryBits();
  // Expose the label tables on the singleton, so consumers (notably the
  // CLI, which needs to turn event type/category numbers back into
  // names) can read them without the dist bundle changing its export
  // shape — `require("iroh")` still returns this object directly.
  this.INSTR = INSTR;
  this.CATEGORY = CATEGORY;
  this.OP = OP;
  this.VERSION = VERSION;
  // Test assertions, for code running inside a stage. The 2017 fixtures
  // in tests/expressions/ and tests/other/ were written against this API,
  // but it was never implemented — `Iroh.assert` was undefined at runtime.
  // assert() records and returns the result instead of throwing, so one
  // failing check does not hide the rest of the fixture; the harness (or
  // the user) reads Iroh.assertions afterwards. resetAssertions() clears
  // the record, e.g. between fixture runs.
  this.assertions = [];
  this.assert = function(name, condition) {
    let passed = !!condition;
    this.assertions.push({ name: String(name), passed: passed });
    return passed;
  };
  this.resetAssertions = function() {
    this.assertions = [];
  };
  // Iroh.log is the fixtures' way to print from inside traced code.
  this.log = function() {
    console.log.apply(console, arguments);
  };
};

export function generateCategoryBits() {
  for (let key in CATEGORY) {
    this[key] = CATEGORY[key] | 0;
  };
};

const TRACE_TRIGGERS = ["before", "after", "enter", "leave", "fire", "test", "return"];

function resolveTraceCategories(iroh, events) {
  if (events === void 0 || events === null || events === "ALL") {
    return Object.keys(CATEGORY);
  }
  let names = Array.isArray(events) ? events : String(events).split(",");
  names = names.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let name = names[ii];
    if (!(name in CATEGORY) || typeof iroh[name] !== "number") {
      throw new Error("Unknown event category: " + name);
    }
  }
  return names;
}

// Shared core of trace() / traceAsync() / traceModule(): build the
// Stage and attach listeners for the requested categories. Returns
// { stage, events }. A parse error throws before anything runs; the
// two errors users hit most often get a pointer at the right entry
// point instead of Acorn's bare message:
//   - import/export/import.meta in a script -> Iroh.traceModule()
//   - top-level await in Iroh.trace() -> Iroh.traceAsync()
// Acorn reports top-level await as a bare "Unexpected token", so the
// await case is decided by a probe: if the code parses with top-level
// await allowed, the failure was the await.
function createTraceRun(iroh, code, options) {
  options = options || {};
  let names = resolveTraceCategories(iroh, options.events);
  let stage;
  try {
    stage = new iroh.Stage(code, options.stageOptions || {});
  } catch (e) {
    if (e instanceof SyntaxError) {
      let msg = e.message;
      if (
        msg.indexOf("may appear only with 'sourceType: module'") !== -1 ||
        msg.indexOf("outside a module") !== -1
      ) {
        throw new Error(
          "This program uses import/export (or import.meta) — trace it with Iroh.traceModule(); Iroh.trace() and Iroh.traceAsync() run scripts only"
        );
      }
      let stageOptions = options.stageOptions || {};
      if (!stageOptions.allowAwaitOutsideFunction) {
        try {
          parse(code, {
            locations: true,
            ecmaVersion: stageOptions.ecmaVersion || "latest",
            allowHashBang: stageOptions.allowHashBang !== false,
            sourceType: stageOptions.sourceType || "script",
            allowAwaitOutsideFunction: true,
          });
          // It parses with top-level await allowed, so the failure
          // was the await.
          throw new Error(
            "This program uses top-level await — run it with Iroh.traceAsync() (or Iroh.traceModule() for modules); Iroh.trace() runs synchronously"
          );
        } catch (probeError) {
          if (probeError.message.indexOf("top-level await") !== -1) {
            throw probeError;
          }
          // The probe failed too: fall through to the original error.
        }
      }
    }
    throw e;
  }
  let events = [];
  let onEvent = options.onEvent;
  // Raw-event hook for the director engine (src/direct.js): the raw
  // event object, its trigger, and the JSON line — called synchronously
  // inside the DEBUG call, after the line is recorded, so mutating the
  // raw event changes the running program.
  let rawOnEvent = options.rawOnEvent;
  // Indexed loops, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let listener = stage.addListener(iroh[names[ii]]);
    for (let jj = 0; jj < TRACE_TRIGGERS.length; ++jj) {
      let trigger = TRACE_TRIGGERS[jj];
      listener.on(trigger, (event) => {
        let line = iroh.eventToJSON(event, trigger);
        events.push(line);
        // The raw hook runs before onEvent: a director mutates the raw
        // event (and, through applyEntry, the line) so downstream
        // consumers — onEvent, the live analyzer, the recorded events —
        // all see the directed value, the value the program actually
        // ran with.
        if (rawOnEvent) rawOnEvent(event, trigger, line);
        if (onEvent) onEvent(line);
      });
    }
  }
  return { stage: stage, events: events };
}

// Compile a Stage's generated script into a runnable function. The
// generated script starts with `const $$STx1 = Iroh.stages[...]` —
// it needs an `Iroh` binding in scope that is this instance. eval()
// inside the library has no such binding (the class is named Iroh,
// the instance is not), so run the script through a fresh Function
// with the instance passed in as its `Iroh` parameter. The function
// is strict, matching the eval-based usage, and returns $$frameValue
// — the program's completion value, the same value eval() returns.
//
// Two retries, same try/catch pattern as the old trace():
//   - a program that declares its own top-level `Iroh` collides with
//     the Function parameter ("Identifier 'Iroh' has already been
//     declared"): retry with the instance under `$$Iroh` and the
//     generated header rewritten to match.
//   - top-level `await` is a SyntaxError in a plain Function: when
//     allowAsync, the script is wrapped in an async IIFE instead
//     (`return (async function() { ...; return $$frameValue; })();`).
//     The Iroh-collision retry applies to the wrapper too.
// The header rewrite replaces the FIRST occurrence of `Iroh.stages[`
// — which is the generated header, the first statement of the script
// — via a function, because in a replacement string `$$` means a
// literal `$`.
function compileRunner(iroh, stage, allowAsync) {
  function rewriteHeader(script, name) {
    if (name === "Iroh") return script;
    return script.replace("Iroh.stages[", () => name + ".stages[");
  }
  function syncSource(name) {
    return '"use strict";\n' + rewriteHeader(stage.script, name) + "\n; return $$frameValue;";
  }
  function asyncSource(name) {
    return '"use strict";\nreturn (async function() {\n' + rewriteHeader(stage.script, name) + "\n; return $$frameValue;\n})();";
  }
  // traceAsync() always uses the async wrapper: a top-level `await`
  // is a SyntaxError in a plain Function, and the message V8 gives
  // for it ("missing ) after argument list") does not even mention
  // await, so sniffing the sync failure to decide is unreliable.
  // The wrapper changes nothing observable for ordinary programs:
  // the IIFE returns the program's completion value (adopting a
  // promise if it is one), and traceAsync() awaits it either way.
  // The wrapper always runs under $$Iroh, not Iroh: the generated
  // header sits INSIDE the IIFE, where a user's own top-level
  // `const Iroh` would shadow the wrapper's `Iroh` parameter for
  // the whole IIFE scope — a RUNTIME TDZ error ("Cannot access
  // 'Iroh' before initialization"), not a compile error, so it
  // cannot be caught by retrying on a SyntaxError. (A sync-form
  // probe would only catch it when the Iroh declaration precedes
  // the first await; `await ...; const Iroh = 5;` would still hit
  // the TDZ.) Under $$Iroh the user's own Iroh is untouched. If
  // the user declared $$Iroh itself, fall back to Iroh.
  if (allowAsync) {
    try {
      return new Function("$$Iroh", asyncSource("$$Iroh"));
    } catch (e) {
      if (
        e instanceof SyntaxError &&
        e.message.indexOf("'$$Iroh' has already been declared") !== -1
      ) {
        return new Function("Iroh", asyncSource("Iroh"));
      }
      throw e;
    }
  }
  try {
    return new Function("Iroh", syncSource("Iroh"));
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    let msg = e.message;
    if (msg.indexOf("'Iroh' has already been declared") !== -1) {
      return new Function("$$Iroh", syncSource("$$Iroh"));
    }
    if (msg.indexOf("may appear only with 'sourceType: module'") !== -1) {
      throw new Error(
        "This program uses import/export — trace it with Iroh.traceModule(); Iroh.trace() and Iroh.traceAsync() run scripts only"
      );
    }
    throw e;
  }
}

// One-shot tracing — the modern SDK entry point. Runs `code` through a
// Stage and returns { events, result }: `events` is the list of plain
// event objects (same shape as the CLI's JSON lines — see
// Iroh.eventToJSON), `result` is the program's completion value, live
// (not serialized). Options:
//   events: "ALL" (default), an array of category names (["CALL","IF"]),
//           or a comma string ("CALL,IF").
//   onEvent(event): called for every event as it fires.
//   stageOptions: passed to the Stage (ecmaVersion, allowHashBang,
//           sourceType, allowAwaitOutsideFunction). sourceType
//           "module" is rejected here — use traceModule().
// A parse error throws before running; a runtime error throws with the
// events that fired before it attached as error.events. Top-level
// await and modules are rejected with a pointer at traceAsync() /
// traceModule() instead of a bare SyntaxError.
export function trace(code, options) {
  options = options || {};
  if (options.stageOptions && options.stageOptions.sourceType === "module") {
    throw new Error("Iroh.trace() cannot run modules — use Iroh.traceModule()");
  }
  let run = createTraceRun(this, code, options);
  let runner = compileRunner(this, run.stage, false);
  let result;
  try {
    result = runner(this);
  } catch (e) {
    attachTraceEvents(e, run.events);
    throw e;
  }
  return { events: run.events, result: result };
};

// Attach the events that fired before an error to the error itself, so
// the trace of a failed program is not lost. Only objects can carry a
// property — a program may throw a string, a number, or null, and in
// strict mode assigning to a primitive throws, masking the original
// error. Those rethrow unchanged.
function attachTraceEvents(err, events) {
  if (err !== null && (typeof err === "object" || typeof err === "function")) {
    err.events = events;
  }
}

// Internal run machinery, shared with the director engine
// (src/direct.js): createTraceRun builds a Stage and attaches the event
// listeners, compileRunner turns a Stage's generated script into a
// runnable function, importTracedModule runs an instrumented module
// through a temp .mjs file and dynamic import, attachTraceEvents puts
// the events so far on a thrown error. Exported as one plain object —
// not as functions — so extend() in src/index.js, which only copies
// functions, does not put them on the Iroh singleton.
export const runInternals = { createTraceRun, compileRunner, importTracedModule, attachTraceEvents };

// Async version of trace(): awaits the program's completion value before
// returning, so events from async continuations (await, promises) are
// included — and so top-level `await` in scripts works, via the async
// wrapper in compileRunner. The returned `result` is the awaited value.
// Written as a plain Promise chain (no async/await syntax) because the
// browser bundle is transpiled by buble, which cannot compile async
// functions.
export function traceAsync(code, options) {
  options = options || {};
  if (options.stageOptions && options.stageOptions.sourceType === "module") {
    return Promise.reject(new Error("Iroh.traceAsync() cannot run modules — use Iroh.traceModule()"));
  }
  // Top-level await needs allowAwaitOutsideFunction at parse time.
  let stageOptions = Object.assign({}, options.stageOptions, {
    allowAwaitOutsideFunction: true,
  });
  // createTraceRun throws synchronously for module code (and for
  // parse errors) — but traceAsync() returns a promise, so a sync
  // throw would escape assert.rejects and any .catch on the caller.
  // Reject instead.
  let run;
  try {
    run = createTraceRun(this, code, Object.assign({}, options, {
      stageOptions: stageOptions,
    }));
  } catch (e) {
    return Promise.reject(e);
  }
  let runner = compileRunner(this, run.stage, true);
  let result;
  try {
    result = runner(this);
  } catch (e) {
    attachTraceEvents(e, run.events);
    throw e;
  }
  let out = { events: run.events, result: result };
  if (result && typeof result.then === "function") {
    return result.then(
      (value) => {
        out.result = value;
        return out;
      },
      // Like the sync path, an async failure carries the events that
      // fired before it — otherwise the trace of a rejected program is
      // lost entirely.
      (err) => {
        attachTraceEvents(err, out.events);
        throw err;
      }
    );
  }
  return Promise.resolve(out);
};

// Whether this is Node.js. `process.versions.node` is the check — the
// cfg.js IS_NODE flag (module/require) is false in the ESM dist, so it
// cannot be used here. In a browser `process` is undefined.
function isNodeRuntime() {
  return (
    typeof process !== "undefined" &&
    process.versions !== void 0 &&
    process.versions !== null &&
    process.versions.node !== void 0
  );
}

// Dynamic import() without writing `import()` literally in src/:
// buble cannot parse import() syntax, so the import is built through
// new Function at runtime (the string is parsed by the engine, not by
// buble). Used to lazily load node: builtins only when traceModule()
// runs — a static `node:fs` import would break the browser (iife)
// rollup build, which cannot resolve it.
function nodeImport(specifier) {
  return new Function("s", "return import(s);")(specifier);
}

// How many traceModule() calls are in flight, and what
// `globalThis.__irohStages` was before the first of them. The
// generated module reads its stage through that registry (see
// below), and the registry must stay set until every in-flight
// module has been evaluated — so the pre-existing value is snapshotted
// only when the count goes 0 -> 1 (a later concurrent call would
// snapshot our own registry as "previous") and restored only once the
// count hits zero again.
let irohStagesUsers = 0;
let irohStagesHadPrevious = false;
let irohStagesPrevious = void 0;

// The import half of traceModule(), shared with directModule():
// write the instrumented module to a temp .mjs file and dynamic-
// import it, with the globalThis.__irohStages registry the generated
// module reads its stage through. Returns a Promise of { events,
// result } (result = the module namespace). Requires Node.js — in a
// browser it rejects with a clear error. `run` is a createTraceRun
// result; `options.filename` bases relative imports, as in
// traceModule().
function importTracedModule(iroh, run, options) {
  options = options || {};
  if (!isNodeRuntime()) {
    return Promise.reject(new Error(
      "Modules require Node.js — they run through a temp .mjs file and dynamic import()"
    ));
  }
  // The header rewrite: first occurrence of `Iroh.stages[` is the
  // generated header, the first statement of the script.
  let script = run.stage.script.replace(
    "Iroh.stages[",
    () => "globalThis.__irohStages["
  );
  return Promise.all([
    nodeImport("node:fs"),
    nodeImport("node:os"),
    nodeImport("node:path"),
    nodeImport("node:url"),
  ]).then(function(mods) {
    let fs = mods[0];
    let os = mods[1];
    let path = mods[2];
    let url = mods[3];
    let dir;
    let ownDir = false;
    if (options.filename) {
      dir = path.dirname(path.resolve(options.filename));
    } else {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-trace-"));
      ownDir = true;
    }
    let file = path.join(dir, ".iroh-trace-" + run.stage.key + ".mjs");
    fs.writeFileSync(file, script, "utf8");
    // Register the stages object for the generated module's header.
    // Snapshot whatever was there (normally nothing) only when this
    // is the first in-flight call; restore it once no call is in
    // flight any more.
    if (irohStagesUsers === 0) {
      irohStagesHadPrevious = Object.prototype.hasOwnProperty.call(globalThis, "__irohStages");
      irohStagesPrevious = globalThis.__irohStages;
    }
    irohStagesUsers += 1;
    globalThis.__irohStages = iroh.stages;
    function cleanup() {
      irohStagesUsers -= 1;
      if (irohStagesUsers <= 0) {
        irohStagesUsers = 0;
        if (irohStagesHadPrevious) {
          globalThis.__irohStages = irohStagesPrevious;
        } else {
          delete globalThis.__irohStages;
        }
      }
      try {
        fs.unlinkSync(file);
      } catch (e) {
        // Best effort: a missing temp file is not a trace failure.
      }
      if (ownDir) {
        try {
          fs.rmdirSync(dir);
        } catch (e) {
          // Best effort.
        }
      }
    }
    let fileUrl = url.pathToFileURL(file).href;
    return nodeImport(fileUrl).then(
      function(namespace) {
        cleanup();
        return { events: run.events, result: namespace };
      },
      function(err) {
        cleanup();
        attachTraceEvents(err, run.events);
        throw err;
      }
    );
  });
}

// One-shot tracing for ES modules. Returns a Promise of { events,
// result }: `events` is the list of plain event objects (same shape
// as trace()), `result` is the module namespace object — every export,
// named and default (as `.default`), live, not serialized.
//
// How it runs: the instrumented code is written to a temp `.mjs` file
// and dynamic-imported — Node 24's vm.SourceTextModule still needs
// --experimental-vm-modules, so it is not used. The generated script's
// header (`const $$STx1 = Iroh.stages[...]`) cannot name an `Iroh`
// binding in a module, so it is rewritten to a `globalThis.__irohStages`
// registry holding the same `Iroh.stages` object the _Stage wrapper
// registers into — instance identity is exact in both the CJS and ESM
// dists, and importing the dist from the generated module (which would
// give a second singleton in one of the two shapes) is avoided.
// Relative imports in the traced code resolve against `options.filename`
// when given (the temp file is written next to it); without it they
// resolve against a fresh temp directory under os.tmpdir() and will
// usually fail. `import.meta.url` in traced code is the temp file's
// URL. The temp file is deleted after the import settles.
//
// Options: events, onEvent, stageOptions (sourceType is forced to
// "module"), filename (base path for relative imports). A parse error
// rejects before running; a runtime error rejects with the events that
// fired before it attached as error.events. Requires Node.js — in a
// browser it rejects with a clear error.
export function traceModule(code, options) {
  options = options || {};
  let iroh = this;
  let stageOptions = Object.assign({}, options.stageOptions, {
    sourceType: "module",
  });
  let run;
  try {
    run = createTraceRun(iroh, code, Object.assign({}, options, {
      stageOptions: stageOptions,
    }));
  } catch (e) {
    return Promise.reject(e);
  }
  return importTracedModule(iroh, run, options);
};

export function greet() {
  if (
    IS_BROWSER &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().indexOf("chrome") > -1
  ) {
    console.log(`%c ☕ Iroh.js - ${VERSION} `, "background: #2e0801; color: #fff; padding:1px 0;");
  }
};
