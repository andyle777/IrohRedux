import { CATEGORY, INSTR, OP } from "./labels";
import { VERSION, IS_BROWSER } from "./cfg";

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

// One-shot tracing — the modern SDK entry point. Runs `code` through a
// Stage and returns { events, result }: `events` is the list of plain
// event objects (same shape as the CLI's JSON lines — see
// Iroh.eventToJSON), `result` is the program's completion value, live
// (not serialized). Options:
//   events: "ALL" (default), an array of category names (["CALL","IF"]),
//           or a comma string ("CALL,IF").
//   onEvent(event): called for every event as it fires.
// A parse error throws before running; a runtime error throws with the
// events that fired before it attached as error.events.
export function trace(code, options) {
  options = options || {};
  let stage = new this.Stage(code, options.stageOptions || {});
  let events = [];
  let onEvent = options.onEvent;
  let names = resolveTraceCategories(this, options.events);
  // Indexed loops, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let listener = stage.addListener(this[names[ii]]);
    for (let jj = 0; jj < TRACE_TRIGGERS.length; ++jj) {
      let trigger = TRACE_TRIGGERS[jj];
      listener.on(trigger, (event) => {
        let line = this.eventToJSON(event, trigger);
        events.push(line);
        if (onEvent) onEvent(line);
      });
    }
  }
  // The generated script starts with `const $$STx1 = Iroh.stages[...]` —
  // it needs an `Iroh` binding in scope that is this instance. eval()
  // inside the library has no such binding (the class is named Iroh, the
  // instance is not), so run the script through a fresh Function with the
  // instance passed in as its `Iroh` parameter. The function is strict,
  // matching the eval-based usage, and returns $$frameValue — the
  // program's completion value, the same value eval() returns.
  let run;
  try {
    run = new Function("Iroh", '"use strict";\n' + stage.script + "\n; return $$frameValue;");
  } catch (e) {
    // A program that declares its own top-level `Iroh` collides with
    // the Function parameter of the same name ("Identifier 'Iroh' has
    // already been declared"). Retry with the instance under a
    // $$-prefixed name and rewrite the generated header to match; the
    // user's own Iroh then works as their variable.
    if (e instanceof SyntaxError && e.message.indexOf("'Iroh' has already been declared") !== -1) {
      // Replace via a function: in a replacement string "$$" means a
      // literal "$", so "$$Iroh" would come out as "$Iroh".
      let renamed = stage.script.replace("Iroh.stages[", () => "$$Iroh.stages[");
      run = new Function("$$Iroh", '"use strict";\n' + renamed + "\n; return $$frameValue;");
    } else {
      throw e;
    }
  }
  let result;
  try {
    result = run(this);
  } catch (e) {
    attachTraceEvents(e, events);
    throw e;
  }
  return { events: events, result: result };
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

// Async version of trace(): awaits the program's completion value before
// returning, so events from async continuations (await, promises) are
// included. The returned `result` is the awaited value. Written as a
// plain Promise chain (no async/await syntax) because the browser bundle
// is transpiled by buble, which cannot compile async functions.
export function traceAsync(code, options) {
  let out = this.trace(code, options);
  if (out.result && typeof out.result.then === "function") {
    return out.result.then(
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

export function greet() {
  if (
    IS_BROWSER &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().indexOf("chrome") > -1
  ) {
    console.log(`%c ☕ Iroh.js - ${VERSION} `, "background: #2e0801; color: #fff; padding:1px 0;");
  }
};
