// Heap probe for the 1.1.1 memory fix (M1): trace a ~100k-event program,
// drop the result, force GC, and report the residual heap against the
// baseline taken before the trace. Before the fix the Stage stayed
// registered in Iroh.stages and its listener closures kept the whole
// trace alive (~137 bytes/event, ~13 MB here), so the residual was the
// full delta; after the fix the Stage is released and the residual is
// noise. Run with --expose-gc. Exits 0 when the residual is under the
// bound, 1 otherwise, 2 when GC is unavailable.
"use strict";
const Iroh = require("../dist/iroh-node.js");
const BOUND_BYTES = 3 * 1024 * 1024;
if (typeof global.gc !== "function") {
  console.log(JSON.stringify({ error: "global.gc unavailable — run with --expose-gc" }));
  process.exit(2);
}
global.gc();
let baseline = process.memoryUsage().heapUsed;
let out = Iroh.trace("let s = 0; for (let i = 0; i < 100000; i++) s += i; s;");
let events = out.events.length;
out = null;
global.gc();
global.gc();
let after = process.memoryUsage().heapUsed;
let residual = after - baseline;
console.log(JSON.stringify({ events: events, baseline: baseline, after: after, residual: residual, bound: BOUND_BYTES }));
process.exit(residual < BOUND_BYTES ? 0 : 1);
