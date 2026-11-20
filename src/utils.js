import { TEMP_VAR_BASE } from "./cfg";
import { INSTR, CATEGORY } from "./labels";

import { generate as gen } from "astring";
import { parseWithDecorators as prs } from "./decorators-plugin";

// unique temporary variable index
let utvidx = 1;
export function reserveTempVarId() {
  return (
    `${TEMP_VAR_BASE}${utvidx++}`
  );
};

// general unique index
let uidx = 1;
export function uid() {
  return uidx++;
};

// unique branch index
let ubidx = 1;
export function uBranchHash() {
  return ubidx++;
};

// Reset the patch counters at the start of a patch run (Stage.patch).
// They are module-level counters, so without this the hashes, temp
// variable names and $$ANON_ names in one trace depend on how many
// traces this process has already run — the same program traced twice
// in one process got different event hashes, and analyze() embeds
// those hashes in its findings, so its output was not byte-stable
// across calls in one process. Patching is synchronous, so no two
// patch runs can interleave and collide; every counter is consumed
// only inside one patch run (hashes, temp vars, anonymous-function
// names, frame and patcher uids), so resetting per run is safe.
export function resetPatchCounters() {
  utvidx = 1;
  uidx = 1;
  ubidx = 1;
};

export function parse(input, options) {
  // Same default as helpers.parse: Acorn 8 requires ecmaVersion.
  // "latest" + allowHashBang: see helpers.parse.
  return prs(input, Object.assign({ ecmaVersion: "latest", allowHashBang: true }, options));
};

export function generate() {
  return gen.apply(null, arguments);
};

// --- Event projection (shared by Iroh.trace() and the CLI) ---------------

// Event fields that are safe to copy onto a plain event object. Everything
// else on a RuntimeEvent (instance, node, location) is an internal
// reference and is never serialized.
const TRACE_EVENT_FIELDS = [
  "name", "value", "result", "return", "op", "test", "left", "right",
  "arguments", "object", "property", "context", "scope", "kind", "label",
  "prefix", "external", "sloppy", "isDefault", "default", "callee",
];

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

export function safeValue(value, depth, seen) {
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
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  let keys = Object.keys(value);
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    try {
      out[key] = safeValue(value[key], depth - 1, seen);
    } catch (e) {
      out[key] = "[Unserializable]";
    }
  }
  return out;
};

// Turn one RuntimeEvent into a plain, JSON-safe object:
// { type: "event", event: "FUNCTION_CALL", category: "CALL",
//   trigger: "before", hash, indent, ...event fields }.
// The CLI (cli/iroh.js) uses this too, so its JSON lines and
// Iroh.trace() events are the same shape.
export function eventToJSON(event, trigger) {
  let line = {
    type: "event",
    event: instructionName(event.type),
    category: categoryName(event.category),
    trigger: trigger,
    hash: event.hash,
    indent: event.indent,
  };
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < TRACE_EVENT_FIELDS.length; ++ii) {
    let field = TRACE_EVENT_FIELDS[ii];
    if (event[field] !== void 0 && event[field] !== null) {
      line[field] = safeValue(event[field], 3, new Set());
    }
  }
  return line;
};
