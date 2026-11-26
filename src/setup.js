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
  // 1.1.1 (M4): an opt-in cap on recorded events. No timeout exists by
  // design, so this is the patch answer to a runaway: once the cap is
  // passed the listener throws, the run stops, and the error carries
  // the partial events (same shape as the director's stop). A program
  // that catches every thrown value can defeat the stop the same way
  // it defeats a director stop — the next event throws again, so it
  // cannot make progress past an instrumented point without catching.
  let maxEvents = options.maxEvents;
  if (maxEvents !== void 0 && maxEvents !== null) {
    if (typeof maxEvents !== "number" || maxEvents <= 0 || maxEvents !== Math.floor(maxEvents)) {
      throw new Error("options.maxEvents must be a positive integer");
    }
  }
  // Indexed loops, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let listener = stage.addListener(iroh[names[ii]]);
    for (let jj = 0; jj < TRACE_TRIGGERS.length; ++jj) {
      let trigger = TRACE_TRIGGERS[jj];
      listener.on(trigger, (event) => {
        let line = iroh.eventToJSON(event, trigger);
        events.push(line);
        if (maxEvents !== void 0 && maxEvents !== null && events.length > maxEvents) {
          let err = new Error("Trace stopped: maxEvents (" + maxEvents + ") reached after " + events.length + " events");
          err.maxEvents = maxEvents;
          throw err;
        }
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
    releaseTraceRun(this, run);
    throw e;
  }
  releaseTraceRun(this, run);
  return { events: run.events, result: result };
};

// Release a trace run's Stage after the run has settled: detach its
// listeners and drop it from the Iroh stages registry. Before 1.1.1
// every Stage stayed registered forever, and the listener closures
// kept the whole recorded trace alive — ~137 bytes/event retained
// after the caller dropped the result, unbounded in a long-lived
// process tracing varied programs. The returned events array is the
// same object the caller already holds, so output is unchanged; only
// retention changes. Idempotent: safe to call twice (module runs
// release in importTracedModule's cleanup and again in the director's
// finish). A Stage is only needed while its program runs — the
// generated script reads it through the registry during evaluation,
// never after.
function releaseTraceRun(iroh, run) {
  if (!run || !run.stage) return;
  if (typeof run.stage.release === "function") run.stage.release();
  if (iroh && iroh.stages) delete iroh.stages[run.stage.key];
}

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
export const runInternals = { createTraceRun, compileRunner, importTracedModule, attachTraceEvents, releaseTraceRun };

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
    releaseTraceRun(this, run);
    throw e;
  }
  let out = { events: run.events, result: result };
  if (result && typeof result.then === "function") {
    // The run is not over until the promise settles: async
    // continuations may still fire events. Release only then.
    let iroh = this;
    return result.then(
      (value) => {
        out.result = value;
        releaseTraceRun(iroh, run);
        return out;
      },
      // Like the sync path, an async failure carries the events that
      // fired before it — otherwise the trace of a rejected program is
      // lost entirely.
      (err) => {
        attachTraceEvents(err, out.events);
        releaseTraceRun(iroh, run);
        throw err;
      }
    );
  }
  releaseTraceRun(this, run);
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

// Temp-file sequence for traceModule()/directModule(): never reset.
// Stage keys repeat across traces in one process (resetPatchCounters
// restores the uid counter per patch, for byte-stable hashes), so a
// temp filename built from the stage key alone repeats too — and
// Node's ESM loader caches modules by URL, so a repeat returns the
// FIRST trace's module without executing the new code (a later trace
// of the same file then "succeeds" with 0 events). The sequence keeps
// every temp file URL unique while the stage key stays deterministic.
let tracedModuleSeq = 0;

// traceModule import-specifier rewriting (1.1.1): Node's ESM loader
// rejects extensionless relative imports and JSON imports without
// `with { type: "json" }`, and a JSON module only provides a default
// export — so a traced module (or anything it imports) using those
// forms fails at link time, even though the code is valid in the
// bundler's eyes. The self-scan scratch copy fixed this by
// hand-rewriting all 109 extensionless imports in the src tree;
// traceModule now does the same rewrite itself, in the temp copy
// only — the original files are never touched. The rewrite covers
// the whole reachable graph, not just the traced file: a dependency
// is loaded by Node as-is, so its own extensionless imports would
// fail at the second hop. When nothing in the graph needs rewriting,
// the current single-temp-file path is used unchanged. The rewrite
// is best-effort: a file that does not parse is left alone, and the
// trace then fails exactly as it would without the rewrite — never
// a new failure mode.

// Resolve a relative import specifier against the real filesystem:
// "./foo" -> ./foo.js if that file exists, else ./foo/index.js.
// Already-suffixed specifiers resolve as-is. Returns the absolute
// path, or null when nothing on disk matches.
function resolveRelativeTarget(fs, path, baseDir, spec) {
  let candidate = path.resolve(baseDir, spec);
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  } catch (e) { /* fall through to the .js / index.js tries */ }
  let withJs = candidate + ".js";
  try {
    if (fs.existsSync(withJs) && fs.statSync(withJs).isFile()) return withJs;
  } catch (e) { /* fall through */ }
  let indexJs = path.join(candidate, "index.js");
  try {
    if (fs.existsSync(indexJs) && fs.statSync(indexJs).isFile()) return indexJs;
  } catch (e) { /* fall through */ }
  return null;
}

// Resolve a bare specifier (a package name) to an absolute file path
// through Node's own resolution, for use inside the mirror — the
// mirror has no node_modules of its own. Returns null when it does
// not resolve, or when it resolves to a builtin (which needs no
// rewriting). Only used when a mirror is being built.
function resolveBareSpecifier(ctx, baseDir, spec) {
  try {
    let req = ctx.createRequire(ctx.path.join(baseDir, "package.json"));
    let resolved = req.resolve(spec);
    if (typeof resolved !== "string" || !ctx.path.isAbsolute(resolved)) return null;
    return resolved;
  } catch (e) {
    return null;
  }
}

// The relative specifier from one file's directory to another,
// always in ./x form so it stays relative in the mirror (the mirror
// preserves absolute paths, so relative imports between mirrored
// files resolve exactly as in the real tree).
function relativeSpecifier(path, baseDir, absPath) {
  let rel = path.relative(baseDir, absPath);
  rel = rel.split(path.sep).join("/");
  if (rel.charAt(0) !== ".") rel = "./" + rel;
  return rel;
}

// Recursive AST walk: visit every node object. Acorn ASTs are trees
// (no parent pointers), so plain recursion is safe. `loc` is skipped:
// it only holds numbers.
function walkAstNodes(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let ii = 0; ii < node.length; ++ii) walkAstNodes(node[ii], visit);
    return;
  }
  visit(node);
  let keys = Object.keys(node);
  for (let ii = 0; ii < keys.length; ++ii) {
    if (keys[ii] === "loc" || keys[ii] === "range") continue;
    walkAstNodes(node[keys[ii]], visit);
  }
}

// Does this parsed module use module-only syntax — a static import
// or export, import.meta, or a top-level await? Node's format
// detection (containsModuleSyntax) counts exactly these: a dynamic
// import() alone does not count, and neither does an await inside a
// function. Used to decide whether a mirrored .js file must be
// renamed to .mjs (see buildModuleMirror).
function hasModuleSyntax(ast) {
  let found = false;
  function visit(node, inFunction) {
    if (found || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let ii = 0; ii < node.length; ++ii) visit(node[ii], inFunction);
      return;
    }
    let t = node.type;
    if (t === "ImportDeclaration" || t === "ExportNamedDeclaration" ||
        t === "ExportDefaultDeclaration" || t === "ExportAllDeclaration") {
      found = true;
      return;
    }
    if (t === "MetaProperty" && node.meta && node.meta.name === "import" &&
        node.property && node.property.name === "meta") {
      found = true;
      return;
    }
    if (t === "AwaitExpression" && !inFunction) {
      found = true;
      return;
    }
    let childInFunction = inFunction ||
      t === "FunctionDeclaration" || t === "FunctionExpression" ||
      t === "ArrowFunctionExpression";
    let keys = Object.keys(node);
    for (let ii = 0; ii < keys.length; ++ii) {
      if (keys[ii] === "loc" || keys[ii] === "range") continue;
      visit(node[keys[ii]], childInFunction);
    }
  }
  visit(ast, false);
  return found;
}

// The mirrored path of a resolved file: renamed to .mjs when the
// mirror renames it (see buildModuleMirror), else itself. Only used
// when a mirror is being built (ctx.rename is set); bare specifiers
// resolve outside the mirror and never map.
function mirroredPath(ctx, resolved) {
  if (ctx.rename && ctx.rename[resolved]) return ctx.rename[resolved];
  return resolved;
}

// Is `node` the DEBUG-literal wrapper the patcher puts around a
// dynamic import's specifier in generated code —
// `import($$STx1.$30(10, "./dyn"))`? The wrapper is always a call
// `<stage>.$<n>(<id>, <literal>)`: a member call with a numeric id
// first and the literal second. Returns the inner string literal, or
// null. The match is on the shape, not on which DEBUG number it is,
// so it does not depend on the instruction table.
function debugLiteralArg(node) {
  if (!node || node.type !== "CallExpression") return null;
  let callee = node.callee;
  if (!callee || callee.type !== "MemberExpression") return null;
  if (!callee.object || callee.object.type !== "Identifier") return null;
  let prop = callee.property;
  let isDebugProp = false;
  if (prop && prop.type === "Identifier" && /^\$\d+$/.test(prop.name)) isDebugProp = true;
  if (prop && prop.type === "Literal" && typeof prop.value === "string" && /^\$\d+$/.test(prop.value)) isDebugProp = true;
  if (!isDebugProp) return null;
  if (!node.arguments || node.arguments.length !== 2) return null;
  if (!node.arguments[0] || node.arguments[0].type !== "Literal" || typeof node.arguments[0].value !== "number") return null;
  let lit = node.arguments[1];
  if (!lit || lit.type !== "Literal" || typeof lit.value !== "string") return null;
  return lit;
}

// A name in an import/export specifier: an Identifier's name, or a
// Literal's string value (string export names).
function specifierName(n) {
  if (!n) return "";
  if (n.type === "Literal") return String(n.value);
  return n.name || "";
}

// One entry of a destructuring pattern binding an imported JSON
// member: shorthand when the names match and the name is a bindable
// identifier (never "default" — `const { default } = x` is a
// SyntaxError), otherwise `"name": local`.
function destructureEntry(importedName, localName) {
  if (importedName === localName && importedName !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(importedName)) {
    return importedName;
  }
  return JSON.stringify(importedName) + ": " + localName;
}

// A member access on a JSON object for a member name: dot form for
// plain identifiers, bracket form otherwise.
function jsonMemberAccess(name) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return "." + name;
  return "[" + JSON.stringify(name) + "]";
}

// A fresh `__iroh_json_<n>` binding name that does not occur in
// `source`, for the default import a named-JSON rewrite introduces.
function freshJsonName(source, state) {
  let name;
  do {
    name = "__iroh_json_" + (state.jsonCounter++);
  } while (source.indexOf(name) !== -1);
  return name;
}

function hasImportAttributes(node) {
  if (node.attributes && node.attributes.length > 0) return true;
  if (node.assertions && node.assertions.length > 0) return true;
  return false;
}

// Plan the edit for a static import/export statement whose source
// resolves to a JSON file. `newSpec` is the rewritten specifier.
// Returns nothing; appends to `edits` and sets the state flags when
// an edit is made. Named imports become a default import plus a
// destructure; namespace imports become a default import plus an
// alias; export-from forms become an import plus re-exports of temp
// bindings (which handles string export names and `as default`
// uniformly); a default-only or side-effect import just gains the
// `with { type: "json" }` attribute.
function planJsonEdit(node, newSpec, source, state, edits) {
  let quoted = JSON.stringify(newSpec);
  let attr = hasImportAttributes(node) ? "" : ' with { type: "json" }';
  if (node.type === "ImportDeclaration") {
    let specs = node.specifiers || [];
    let hasNamed = false;
    let hasNamespace = false;
    let defaultLocal = null;
    let nsLocal = null;
    for (let ii = 0; ii < specs.length; ++ii) {
      if (specs[ii].type === "ImportSpecifier") hasNamed = true;
      else if (specs[ii].type === "ImportNamespaceSpecifier") { hasNamespace = true; nsLocal = specs[ii].local.name; }
      else if (specs[ii].type === "ImportDefaultSpecifier") defaultLocal = specs[ii].local.name;
    }
    if (!hasNamed && !hasNamespace) {
      if (attr === "" && quoted === JSON.stringify(node.source.value)) return;
      edits.push({ start: node.source.start, end: node.source.end, text: quoted + attr });
      state.needed = true;
      state.relativeNeeded = true;
      return;
    }
    let importLocal = defaultLocal !== null ? defaultLocal : freshJsonName(source, state);
    let parts = ["import " + importLocal + " from " + quoted + ' with { type: "json" };'];
    if (hasNamed) {
      let entries = [];
      for (let ii = 0; ii < specs.length; ++ii) {
        if (specs[ii].type !== "ImportSpecifier") continue;
        entries.push(destructureEntry(specifierName(specs[ii].imported), specs[ii].local.name));
      }
      parts.push("const { " + entries.join(", ") + " } = " + importLocal + ";");
    }
    if (hasNamespace) {
      parts.push("const " + nsLocal + " = " + importLocal + ";");
    }
    edits.push({ start: node.start, end: node.end, text: parts.join(" ") });
    state.needed = true;
    state.relativeNeeded = true;
    return;
  }
  if (node.type === "ExportNamedDeclaration") {
    let specs = node.specifiers || [];
    if (specs.length === 0) {
      if (attr === "" && quoted === JSON.stringify(node.source.value)) return;
      edits.push({ start: node.source.start, end: node.source.end, text: quoted + attr });
      state.needed = true;
      state.relativeNeeded = true;
      return;
    }
    let jsonName = freshJsonName(source, state);
    let parts = ["import " + jsonName + " from " + quoted + ' with { type: "json" };'];
    let exportList = [];
    for (let ii = 0; ii < specs.length; ++ii) {
      let local = specifierName(specs[ii].local);
      let exported = specifierName(specs[ii].exported);
      let temp = jsonName + "_e" + ii;
      parts.push("const " + temp + " = " + jsonName + jsonMemberAccess(local) + ";");
      // `export { x as "default" }` is valid syntax, so "default" as
      // the exported name goes through the same list, quoted.
      exportList.push(temp + " as " + (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exported) && exported !== "default" ? exported : JSON.stringify(exported)));
    }
    parts.push("export { " + exportList.join(", ") + " };");
    edits.push({ start: node.start, end: node.end, text: parts.join(" ") });
    state.needed = true;
    state.relativeNeeded = true;
    return;
  }
  if (node.type === "ExportAllDeclaration") {
    let jsonName = freshJsonName(source, state);
    let text = "import " + jsonName + " from " + quoted + ' with { type: "json" };';
    // `export * from` a JSON module re-exports nothing (the default
    // is excluded), so the import alone is equivalent. `export * as
    // ns from` keeps the namespace as an alias of the default.
    if (node.exported) {
      text += " export const " + specifierName(node.exported) + " = " + jsonName + ";";
    }
    edits.push({ start: node.start, end: node.end, text: text });
    state.needed = true;
    state.relativeNeeded = true;
    return;
  }
}

// Plan the edit for one static import/export statement. `node.source`
// is the specifier literal. Appends to `edits` when the specifier
// changes, records the resolved absolute path in `state.edges` for
// the graph walk, and sets the state flags.
function planStaticEdit(node, spec, baseDir, ctx, source, state, edits) {
  if (spec.charAt(0) === ".") {
    let resolved = resolveRelativeTarget(ctx.fs, ctx.path, baseDir, spec);
    if (resolved === null) return;
    state.edges.push(resolved);
    let newSpec = relativeSpecifier(ctx.path, baseDir, mirroredPath(ctx, resolved));
    if (/\.json$/i.test(resolved)) {
      planJsonEdit(node, newSpec, source, state, edits);
    } else if (newSpec !== spec) {
      edits.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(newSpec) });
      state.needed = true;
      state.relativeNeeded = true;
    }
    return;
  }
  if (ctx.forMirror && spec.indexOf("node:") !== 0 && spec.charAt(0) !== "/") {
    let resolved = resolveBareSpecifier(ctx, baseDir, spec);
    if (resolved === null) return;
    let newSpec = ctx.url.pathToFileURL(resolved).href;
    if (/\.json$/i.test(resolved)) {
      planJsonEdit(node, newSpec, source, state, edits);
    } else if (newSpec !== spec) {
      edits.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(newSpec) });
      state.needed = true;
    }
    return;
  }
}

// Plan the edit for a dynamic import(). The specifier is the literal
// argument — or, in generated code, the literal inside the
// DEBUG-literal wrapper around it. A JSON target keeps the wrapper
// and gains the attribute as the second import() argument; any other
// target rewrites just the literal, keeping the instrumentation.
function planDynamicEdit(node, baseDir, ctx, source, state, edits) {
  let arg = node.source;
  if (!arg) return;
  let lit = null;
  if (arg.type === "Literal" && typeof arg.value === "string") {
    lit = arg;
  } else {
    lit = debugLiteralArg(arg);
  }
  if (lit === null) return;
  let spec = lit.value;
  let newSpec = null;
  let isJson = false;
  if (spec.charAt(0) === ".") {
    let resolved = resolveRelativeTarget(ctx.fs, ctx.path, baseDir, spec);
    if (resolved === null) return;
    state.edges.push(resolved);
    newSpec = relativeSpecifier(ctx.path, baseDir, mirroredPath(ctx, resolved));
    isJson = /\.json$/i.test(resolved);
  } else if (ctx.forMirror && spec.indexOf("node:") !== 0 && spec.charAt(0) !== "/") {
    let resolved = resolveBareSpecifier(ctx, baseDir, spec);
    if (resolved === null) return;
    newSpec = ctx.url.pathToFileURL(resolved).href;
    isJson = /\.json$/i.test(resolved);
  } else {
    return;
  }
  if (isJson) {
    // Keep the DEBUG wrapper (if any) on the specifier: in generated
    // code the specifier literal sits inside a DEBUG_LITERAL call,
    // and replacing the whole import() dropped it — so no LITERAL
    // event fired for this import. The attribute is added as the
    // second import() argument instead, and it is always synthesized:
    // the code generator drops import options, so the generated code
    // never carries any to preserve.
    let argText;
    if (arg.type === "Literal") {
      argText = JSON.stringify(newSpec);
    } else {
      let text = source.slice(arg.start, arg.end);
      argText = text.slice(0, lit.start - arg.start) + JSON.stringify(newSpec) + text.slice(lit.end - arg.start);
    }
    edits.push({ start: node.start, end: node.end, text: "import(" + argText + ', { with: { type: "json" } })' });
    state.needed = true;
    state.relativeNeeded = true;
  } else if (newSpec !== spec) {
    edits.push({ start: lit.start, end: lit.end, text: JSON.stringify(newSpec) });
    state.needed = true;
    state.relativeNeeded = true;
  }
}

// Rewrite the import specifiers in one module's source so Node's ESM
// loader accepts it. `baseDir` is the directory the specifiers
// resolve against (the file's real directory); `ctx` carries the
// node builtins (`fs`, `path`, `url`, `createRequire`) and
// `forMirror` — bare specifiers are only resolved when a mirror is
// being built, since in place they already resolve through
// node_modules. Returns { code, needed, relativeNeeded, edges,
// moduleSyntax, parseFailed }: `needed` is true when any specifier changed,
// `relativeNeeded` when a relative or JSON specifier changed (the
// part that forces a mirror — a bare-only change never does),
// `edges` lists the absolute paths of the relative imports, for the
// graph walk, and `moduleSyntax` is true when the source uses
// module-only syntax (a static import or export, import.meta, or a
// top-level await).
function rewriteModuleSource(source, baseDir, ctx) {
  let ast;
  try {
    ast = parse(source, { locations: true, sourceType: "module", ecmaVersion: "latest" });
  } catch (e) {
    return { code: source, needed: false, relativeNeeded: false, edges: [], moduleSyntax: false, parseFailed: true };
  }
  let state = { needed: false, relativeNeeded: false, edges: [], jsonCounter: 0 };
  let edits = [];
  walkAstNodes(ast, function(node) {
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      if (!node.source || node.source.type !== "Literal" || typeof node.source.value !== "string") return;
      planStaticEdit(node, node.source.value, baseDir, ctx, source, state, edits);
    } else if (node.type === "ImportExpression") {
      planDynamicEdit(node, baseDir, ctx, source, state, edits);
    }
  });
  edits.sort(function(a, b) { return b.start - a.start; });
  let code = source;
  for (let ii = 0; ii < edits.length; ++ii) {
    let edit = edits[ii];
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  }
  return { code: code, needed: state.needed, relativeNeeded: state.relativeNeeded, edges: state.edges, moduleSyntax: hasModuleSyntax(ast), parseFailed: false };
}

// Build a rewritten mirror of the module graph reachable from the
// traced entry, when any file in the graph needs a specifier rewrite.
// `entryScript` is the generated script (post header rewrite);
// `entryAbsPath` is the entry file's absolute path. Returns null
// when nothing needs rewriting (the caller then uses the current
// single-temp-file path), else { root, entryDir, entryCode }: `root`
// is the temp mirror dir (the caller deletes it after the import
// settles), `entryDir` is the mirrored directory of the entry file,
// `entryCode` is the rewritten generated script to write there. The
// mirror preserves absolute paths (root + absPath), so relative
// imports between mirrored files resolve exactly as in the real
// tree. JSON and other non-JS files are copied verbatim; bare
// specifiers are resolved to absolute file URLs at rewrite time,
// because the mirror has no node_modules of its own. Two phases: the
// first decides whether a mirror is needed at all (bare specifiers
// left alone, so a bare-only module keeps today's path); the second
// rewrites everything for the mirror.
//
// Mirrored .js files with module-only syntax are renamed to .mjs:
// Node warns [MODULE_TYPELESS_PACKAGE_JSON] when such a file is
// loaded from a scope whose package.json has no "type" — and the
// mirror copies the package.json in (a JSON import can pull it into
// the graph), so the warning fired for mirrored traces. The .mjs
// extension is unconditionally ESM, so no package.json lookup happens
// and no warning fires. CJS files stay .js and keep loading as CJS,
// so mixed graphs are unaffected; forcing "type": "module" on the
// mirror would have broken them instead. A rename is skipped when
// the .mjs path is itself a graph file — the warning may remain for
// that rare file, but the graph stays intact.
function buildModuleMirror(fs, os, path, url, createRequire, entryScript, entryAbsPath) {
  let ctx1 = { fs: fs, path: path, url: url, createRequire: createRequire, forMirror: false };
  let entry = rewriteModuleSource(entryScript, path.dirname(entryAbsPath), ctx1);
  if (entry.parseFailed) return null;
  let files = {};
  let pending = [];
  let seen = {};
  let anyNeeded = entry.relativeNeeded;
  function enqueue(absPath) {
    if (!seen[absPath]) {
      seen[absPath] = true;
      pending.push(absPath);
    }
  }
  for (let ii = 0; ii < entry.edges.length; ++ii) enqueue(entry.edges[ii]);
  for (let qi = 0; qi < pending.length; ++qi) {
    let absPath = pending[qi];
    let source;
    try {
      source = fs.readFileSync(absPath, "utf8");
    } catch (e) {
      continue; // Unreadable: left out; the import fails as today.
    }
    if (!/\.m?js$/i.test(absPath)) {
      files[absPath] = { source: source, needed: false, edges: [], moduleSyntax: false };
      continue;
    }
    let rewritten = rewriteModuleSource(source, path.dirname(absPath), ctx1);
    if (rewritten.parseFailed) {
      files[absPath] = { source: source, needed: false, edges: [], moduleSyntax: false };
      continue;
    }
    files[absPath] = { source: source, needed: rewritten.relativeNeeded, edges: rewritten.edges, moduleSyntax: rewritten.moduleSyntax };
    if (rewritten.relativeNeeded) anyNeeded = true;
    for (let jj = 0; jj < rewritten.edges.length; ++jj) enqueue(rewritten.edges[jj]);
  }
  if (!anyNeeded) return null;
  let rename = {};
  let allPaths = Object.keys(files);
  for (let ii = 0; ii < allPaths.length; ++ii) {
    let absPath = allPaths[ii];
    if (!/\.js$/i.test(absPath)) continue;
    if (!files[absPath].moduleSyntax) continue;
    let renamed = absPath.replace(/\.js$/i, ".mjs");
    if (files[renamed] !== undefined) continue;
    rename[absPath] = renamed;
  }
  let ctx2 = { fs: fs, path: path, url: url, createRequire: createRequire, forMirror: true, rename: rename };
  let root = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-trace-graph-"));
  let entry2 = rewriteModuleSource(entryScript, path.dirname(entryAbsPath), ctx2);
  let paths = Object.keys(files);
  for (let ii = 0; ii < paths.length; ++ii) {
    let absPath = paths[ii];
    let content = files[absPath].source;
    if (/\.m?js$/i.test(absPath)) {
      let rewritten = rewriteModuleSource(content, path.dirname(absPath), ctx2);
      if (!rewritten.parseFailed) content = rewritten.code;
    }
    let writePath = rename[absPath] || absPath;
    let mirrored = path.join(root, writePath);
    fs.mkdirSync(path.dirname(mirrored), { recursive: true });
    fs.writeFileSync(mirrored, content, "utf8");
  }
  let entryDir = path.dirname(path.join(root, entryAbsPath));
  fs.mkdirSync(entryDir, { recursive: true });
  return { root: root, entryDir: entryDir, entryCode: entry2.code };
}

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
    nodeImport("node:module"),
  ]).then(function(mods) {
    let fs = mods[0];
    let os = mods[1];
    let path = mods[2];
    let url = mods[3];
    let createRequire = mods[4].createRequire;
    // Rewrite the specifiers when the traced module (or anything it
    // imports) uses extensionless relative imports or JSON imports:
    // buildModuleMirror returns null when nothing needs rewriting,
    // and the current single-temp-file path below is used unchanged.
    // A build failure inside it also falls back to that path — the
    // rewrite is best-effort, never a new failure mode.
    let mirror = null;
    if (options.filename) {
      try {
        mirror = buildModuleMirror(fs, os, path, url, createRequire, script, path.resolve(options.filename));
      } catch (e) {
        mirror = null;
      }
    }
    let dir;
    let ownDir = false;
    if (mirror) {
      dir = mirror.entryDir;
    } else if (options.filename) {
      dir = path.dirname(path.resolve(options.filename));
    } else {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-trace-"));
      ownDir = true;
    }
    let file = path.join(dir, ".iroh-trace-" + run.stage.key + "-" + (tracedModuleSeq++) + ".mjs");
    fs.writeFileSync(file, mirror ? mirror.entryCode : script, "utf8");
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
      // The import has settled: the generated module has read its
      // stage through the registry, and nothing reads it after.
      // Release it here (1.1.1) — this covers traceModule and
      // directModule alike.
      releaseTraceRun(iroh, run);
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
      if (mirror) {
        // The temp file sits inside the mirror; remove the whole
        // mirrored graph now that the import has settled.
        try {
          fs.rmSync(mirror.root, { recursive: true, force: true });
        } catch (e) {
          // Best effort: a leftover temp mirror is not a trace failure.
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
// Import-specifier rewriting (1.1.1): extensionless relative imports
// (`./foo` -> `./foo.js` or `./foo/index.js`) and JSON imports
// (named imports become a default import, and the `with
// { type: "json" }` attribute is added where missing) are rewritten
// in the temp copy — across the whole reachable graph, since a
// dependency is loaded by Node as-is. The original files are never
// touched; when nothing needs rewriting the plain temp-file path
// above is used. A dynamic JSON import keeps its DEBUG wrapper (the
// attribute is added as the second import() argument), and mirrored
// .js files with module-only syntax are renamed to .mjs, so no
// typeless-package warning fires (CJS files stay .js).
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
