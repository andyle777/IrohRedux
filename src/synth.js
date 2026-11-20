// Input synthesiser for IrohRedux — generate concrete inputs that
// drive a program down each branch, on the live wire:
//
//   Iroh.synthesize(code, { entry, seeds, maxRuns, onProgress })
//     -> { entry, inputs, coverage, runs, uncovered, findings, summary }
//
// Concolic-style, with no SMT solver available: run the program under
// trace with seed inputs, collect branch outcomes from the trace
// events, then solve for the inputs that flip each uncovered branch.
// The v1 solver is deliberately small and honest about it: for a
// numeric comparison it computes the boundary value (x > 10 -> 11 and
// 10), for equality it uses the observed constant (x === 7 -> 7), for
// a string equality the observed string, for && / || it targets each
// side, and for a bare parameter it uses truthy/falsy (1 / 0). Seeds
// plus guided mutation are the fallback. Every run counts against
// the budget (default 50), and a branch the solver cannot flip is
// reported with its reason — never hidden, never claimed.
//
// Live wire integration (src/live.js): each run streams through its
// own liveAnalyzer, so HOT_LOOP and friends fire mid-run and stream
// out through onProgress as live-finding events. The target list is
// the aggregate analyzer's ONE_SIDED_BRANCH findings: after each run
// the events of all runs so far are fed (hashes remapped to the
// branch site's source position, because the instrumenter's hashes
// are per-Stage) into a fresh liveAnalyzer, and finish() gives the
// one-sided branches — the branches that still need an input. Only
// the ONE_SIDED_BRANCH findings are taken from the aggregate: its
// other findings would conflate separate runs (loop iterations add
// up across runs). Capped loop-test flips (see below) are filtered
// out of the aggregate stream — they are the tool's intervention,
// not the program's behaviour.
//
// Runaway protection: a candidate input may make a loop never end.
// Each run caps every loop at loopCap true tests (default 10,000):
// the next LOOP_TEST is flipped to false, the run is marked capped,
// and the flipped test is NOT counted as branch coverage — the input
// did not cover the exit arm, the cap did. The flip uses the same
// mechanism as the director (src/direct.js): the DEBUG functions
// return the event's value after listeners fire, so mutating the raw
// event in rawOnEvent changes the running program.
//
// Limits (also in CHANGELOG.md): scripts only, synchronous entry
// functions (no top-level await, no modules, no async entry —
// traceAsync()/traceModule() have no synthesis hook in v1); seeds
// must be JSON values; the solver handles direct parameter-vs-literal
// comparisons, .length against a numeric literal, && / || / ! and
// bare parameters — compound expressions, calls, and anything that
// is not an input parameter are reported, not solved. Switch cases
// are covered in the same pass (see below).
//
// Branch model: a site is a condition evaluation point, keyed by its
// kind and the source position of its test. if / loop / ternary sites
// have two arms (true/false); a switch case has one arm (matched),
// and the default has one arm (reached). Coverage is arms covered /
// arms total, with the site count alongside — every number carries
// its denominator.

import { parse, safeValue } from "./utils";
import { liveAnalyzer } from "./live";
import { OP, INSTR } from "./labels";
import { evalBinaryExpression } from "./eval";
import { runInternals } from "./setup";

export const SYNTHESIZE_DEFAULTS = {
  maxRuns: 50,
  loopCap: 10000,
};

const SOLVER_DEPTH_LIMIT = 4;
const STATEMENT_PREVIEW_CHARS = 200;

// --- generic AST walk (same shape as analyze.js inspectSource) -------
function walk(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let ii = 0; ii < node.length; ++ii) walk(node[ii], visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  let keys = Object.keys(node);
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
    walk(node[key], visit);
  }
}

function sourceOf(program, node) {
  if (!node || typeof node.start !== "number" || typeof node.end !== "number") return null;
  return program.slice(node.start, node.end);
}

// --- entry function ----------------------------------------------------
// The function under test: a top-level function declaration, or a
// top-level const/let/var holding a function or arrow function.
function resolveEntry(ast, entry) {
  let body = ast.body || [];
  for (let ii = 0; ii < body.length; ++ii) {
    let st = body[ii];
    if (st.type === "FunctionDeclaration" && st.id && st.id.name === entry) {
      return st;
    }
    if (st.type === "VariableDeclaration") {
      for (let jj = 0; jj < st.declarations.length; ++jj) {
        let d = st.declarations[jj];
        if (
          d.id && d.id.name === entry && d.init &&
          (d.init.type === "FunctionExpression" || d.init.type === "ArrowFunctionExpression")
        ) {
          return d.init;
        }
      }
    }
  }
  return null;
}

function paramList(fnNode) {
  let params = [];
  for (let ii = 0; ii < fnNode.params.length; ++ii) {
    let p = fnNode.params[ii];
    if (p.type === "Identifier") params.push({ name: p.name, pattern: false });
    else params.push({ name: null, pattern: true });
  }
  return params;
}

function paramIndex(params, name) {
  for (let ii = 0; ii < params.length; ++ii) {
    if (!params[ii].pattern && params[ii].name === name) return ii;
  }
  return -1;
}

// --- switch map ----------------------------------------------------------
// From the source AST: every case, keyed the same way the trace maps
// it (case test start, or the case start for default), with the
// discriminant and the case value so the solver can target it.
function buildSwitchMap(ast) {
  let map = {};
  walk(ast, function(node) {
    if (node.type !== "SwitchStatement") return;
    for (let ii = 0; ii < node.cases.length; ++ii) {
      let cs = node.cases[ii];
      let key = cs.test ? "case:" + cs.test.start : "default:" + cs.start;
      map[key] = {
        discriminant: node.discriminant,
        caseValue: cs.test || null,
        caseNode: cs,
        isDefault: !cs.test,
      };
    }
  });
  return map;
}

// --- argument serialization ----------------------------------------------
// Seeds must be JSON values: the call is built as source text, so a
// function, symbol, bigint, or a nested undefined / non-finite number
// cannot be written down. Loud failure now, not a silently wrong call.
function validateJsonValue(value, where) {
  if (value === null) return;
  let t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("synthesize() seeds must be JSON values — " + where + " is " + String(value));
    }
    return;
  }
  if (t === "undefined") {
    throw new Error("synthesize() seeds must be JSON values — " + where + " is undefined (only a top-level argument may be undefined)");
  }
  if (Array.isArray(value)) {
    for (let ii = 0; ii < value.length; ++ii) validateJsonValue(value[ii], where + "[" + ii + "]");
    return;
  }
  if (t === "object") {
    let keys = Object.keys(value);
    for (let ii = 0; ii < keys.length; ++ii) validateJsonValue(value[keys[ii]], where + "." + keys[ii]);
    return;
  }
  throw new Error("synthesize() seeds must be JSON values — " + where + " is a " + t);
}

function serializeArg(value) {
  if (value === void 0) return "undefined";
  validateJsonValue(value, "seed value");
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

// --- solver: boundary values ----------------------------------------------
function differentValue(literal) {
  if (typeof literal === "number") return literal + 1;
  if (typeof literal === "string") return literal === "" ? "x" : "";
  if (typeof literal === "boolean") return !literal;
  if (literal === null) return 0;
  return 1;
}

// Values for the parameter that make `param <op> literal` come out
// `want`. Numbers only for the ordered comparisons; equality works
// for any literal type. Returns an array, or null when the operator
// cannot be solved for this literal.
function boundaryValues(operator, literal, want) {
  if (operator === ">" || operator === ">=" || operator === "<" || operator === "<=") {
    if (typeof literal !== "number") return null;
  }
  if (operator === ">") return want ? [literal + 1] : [literal];
  if (operator === ">=") return want ? [literal] : [literal - 1];
  if (operator === "<") return want ? [literal - 1] : [literal];
  if (operator === "<=") return want ? [literal] : [literal + 1];
  if (operator === "===" || operator === "==") return want ? [literal] : [differentValue(literal)];
  if (operator === "!==" || operator === "!=") return want ? [differentValue(literal)] : [literal];
  return null;
}

// String values whose .length makes `param.length <op> literal` come
// out `want`. Returns an array, or null when no string length can
// satisfy it (e.g. length < 0).
function lengthValues(operator, literal, want) {
  if (typeof literal !== "number" || literal < 0 || Math.floor(literal) !== literal) return null;
  let n;
  if (operator === ">") n = want ? literal + 1 : literal;
  else if (operator === ">=") n = want ? literal : literal - 1;
  else if (operator === "<") n = want ? literal - 1 : literal;
  else if (operator === "<=") n = want ? literal : literal + 1;
  else if (operator === "===" || operator === "==") n = want ? literal : literal + 1;
  else if (operator === "!==" || operator === "!=") n = want ? literal + 1 : literal;
  else return null;
  if (n < 0) return null;
  return ["a".repeat(n)];
}

function flipComparison(operator) {
  if (operator === "<") return ">";
  if (operator === ">") return "<";
  if (operator === "<=") return ">=";
  if (operator === ">=") return "<=";
  if (operator === "===" || operator === "==" || operator === "!==" || operator === "!=") return operator;
  return null;
}

const COMPARISON_OPS = [">", ">=", "<", "<=", "===", "==", "!==", "!="];

function isNondeterministic(node, program) {
  let found = false;
  walk(node, function(child) {
    if (found) return;
    if (child.type === "CallExpression" || child.type === "NewExpression") {
      let src = sourceOf(program, child);
      if (src && (/Date\.now/.test(src) || /Math\.random/.test(src) || /new Date/.test(src))) {
        found = true;
      }
    }
  });
  return found;
}

// Solve `testNode` for the outcome `want` (true/false), starting
// from `args` (the witness run's arguments). Returns
// { candidates: [argArray, ...] } or { reason: "..." }. A candidate
// is a full replacement argument list; the run verifies it — the
// solver proposes, the trace disposes.
function solveTest(node, want, args, params, counterStarts, program, depth) {
  if (depth > SOLVER_DEPTH_LIMIT) {
    return { reason: "condition nests deeper than the v1 solver follows (" + SOLVER_DEPTH_LIMIT + " levels)" };
  }
  if (!node) return { reason: "condition is missing" };
  if (isNondeterministic(node, program)) {
    return { reason: "condition depends on a nondeterministic source (" + sourceOf(program, node) + ") — no input can steer it" };
  }
  if (node.type === "Literal") {
    return { reason: "condition is the constant " + sourceOf(program, node) + " — no input can change it" };
  }
  if (node.type === "UnaryExpression" && node.operator === "!") {
    return solveTest(node.argument, !want, args, params, counterStarts, program, depth + 1);
  }
  if (node.type === "UnaryExpression") {
    return { reason: "condition is a unary '" + node.operator + "' expression — the v1 solver handles '!' only" };
  }
  if (node.type === "Identifier") {
    let idx = paramIndex(params, node.name);
    if (idx < 0) {
      return { reason: "condition reads '" + node.name + "', which is not an input parameter" };
    }
    // Truthiness works across types: any truthy value takes the true
    // arm, any falsy value the false arm.
    let next = args.slice();
    next[idx] = want ? 1 : 0;
    return { candidates: [next] };
  }
  if (node.type === "LogicalExpression") {
    if (node.operator === "&&") {
      if (want) {
        let left = solveTest(node.left, true, args, params, counterStarts, program, depth + 1);
        if (left.reason) return left;
        let right = solveTest(node.right, true, left.candidates[0], params, counterStarts, program, depth + 1);
        if (right.reason) return right;
        return { candidates: right.candidates };
      }
      let left = solveTest(node.left, false, args, params, counterStarts, program, depth + 1);
      let right = solveTest(node.right, false, args, params, counterStarts, program, depth + 1);
      let cands = [];
      if (left.candidates) cands = cands.concat(left.candidates);
      if (right.candidates) cands = cands.concat(right.candidates);
      if (cands.length > 0) return { candidates: cands };
      return { reason: left.reason || right.reason || "neither side of '&&' can be made false" };
    }
    if (node.operator === "||") {
      if (!want) {
        let left = solveTest(node.left, false, args, params, counterStarts, program, depth + 1);
        if (left.reason) return left;
        let right = solveTest(node.right, false, left.candidates[0], params, counterStarts, program, depth + 1);
        if (right.reason) return right;
        return { candidates: right.candidates };
      }
      let left = solveTest(node.left, true, args, params, counterStarts, program, depth + 1);
      let right = solveTest(node.right, true, args, params, counterStarts, program, depth + 1);
      let cands = [];
      if (left.candidates) cands = cands.concat(left.candidates);
      if (right.candidates) cands = cands.concat(right.candidates);
      if (cands.length > 0) return { candidates: cands };
      return { reason: left.reason || right.reason || "neither side of '||' can be made true" };
    }
    return { reason: "condition uses '" + node.operator + "' — the v1 solver handles '&&' and '||' only" };
  }
  if (node.type === "BinaryExpression") {
    return solveComparison(node, want, args, params, counterStarts, program);
  }
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    return { reason: "condition calls " + sourceOf(program, node) + " — the solver cannot invert calls" };
  }
  if (node.type === "MemberExpression") {
    return { reason: "condition reads " + sourceOf(program, node) + " — the solver handles direct parameter comparisons and .length only" };
  }
  return { reason: "condition has the form " + node.type + " — the v1 solver does not handle it" };
}

function solveComparison(node, want, args, params, counterStarts, program) {
  let op = node.operator;
  if (COMPARISON_OPS.indexOf(op) < 0) {
    if (op === "in" || op === "instanceof") {
      return { reason: "condition uses '" + op + "' — the v1 solver handles comparisons only" };
    }
    return { reason: "condition is a compound expression over inputs (" + sourceOf(program, node) + ") — v1 solves direct parameter-vs-literal comparisons only" };
  }
  let left = node.left;
  let right = node.right;
  let operator = op;
  // A loop counter with a known start value (for (let i = 0; ...) or
  // the nearest preceding literal assignment) reads as that value on
  // the first test, so `i < n` solves as `0 < n`.
  if (left.type === "Identifier" && counterStarts && counterStarts[left.name] !== void 0) {
    left = { type: "Literal", value: counterStarts[left.name] };
  } else if (right.type === "Identifier" && counterStarts && counterStarts[right.name] !== void 0) {
    right = { type: "Literal", value: counterStarts[right.name] };
    operator = flipComparison(operator);
    if (operator === null) return { reason: "cannot flip operator '" + op + "'" };
  }
  // param.length vs a numeric literal.
  if (
    left.type === "MemberExpression" && left.object.type === "Identifier" &&
    left.property && left.property.name === "length" && !left.computed
  ) {
    return solveLengthComparison(left.object.name, operator, right, want, args, params, program);
  }
  if (
    right.type === "MemberExpression" && right.object.type === "Identifier" &&
    right.property && right.property.name === "length" && !right.computed
  ) {
    let flipped = flipComparison(operator);
    if (flipped === null) return { reason: "cannot flip operator '" + op + "'" };
    return solveLengthComparison(right.object.name, flipped, left, want, args, params, program);
  }
  let paramSide = null;
  let litSide = null;
  let paramOnLeft = true;
  if (left.type === "Identifier" && right.type === "Literal") {
    paramSide = left;
    litSide = right;
    paramOnLeft = true;
  } else if (right.type === "Identifier" && left.type === "Literal") {
    paramSide = right;
    litSide = left;
    paramOnLeft = false;
  } else {
    if (left.type === "Identifier" && paramIndex(params, left.name) >= 0) {
      return { reason: "condition compares two inputs (" + sourceOf(program, node) + ") — v1 solves parameter-vs-literal comparisons only" };
    }
    if (right.type === "Identifier" && paramIndex(params, right.name) >= 0) {
      return { reason: "condition compares two inputs (" + sourceOf(program, node) + ") — v1 solves parameter-vs-literal comparisons only" };
    }
    if (left.type === "Identifier") {
      return { reason: "condition reads '" + left.name + "', which is not an input parameter" };
    }
    if (right.type === "Identifier") {
      return { reason: "condition reads '" + right.name + "', which is not an input parameter" };
    }
    return { reason: "condition is a compound expression over inputs (" + sourceOf(program, node) + ") — v1 solves direct parameter-vs-literal comparisons only" };
  }
  let idx = paramIndex(params, paramSide.name);
  if (idx < 0) {
    return { reason: "condition reads '" + paramSide.name + "', which is not an input parameter" };
  }
  if (!paramOnLeft) {
    operator = flipComparison(operator);
    if (operator === null) return { reason: "cannot flip operator '" + op + "'" };
  }
  let values = boundaryValues(operator, litSide.value, want);
  if (values === null) {
    return { reason: "condition compares a parameter with a non-numeric literal (" + sourceOf(program, node) + ") — v1 solves numeric bounds and equality only" };
  }
  let out = [];
  for (let ii = 0; ii < values.length; ++ii) {
    let next = args.slice();
    next[idx] = values[ii];
    out.push(next);
  }
  return { candidates: out };
}

function solveLengthComparison(paramName, operator, litNode, want, args, params, program) {
  let idx = paramIndex(params, paramName);
  if (idx < 0) {
    return { reason: "condition reads '" + paramName + ".length', and '" + paramName + "' is not an input parameter" };
  }
  if (!litNode || litNode.type !== "Literal" || typeof litNode.value !== "number") {
    return { reason: "condition compares .length with a non-literal (" + sourceOf(program, litNode) + ") — v1 solves .length against numeric literals only" };
  }
  let values = lengthValues(operator, litNode.value, want);
  if (values === null) {
    return { reason: "no string length satisfies " + paramName + ".length " + operator + " " + litNode.value + " for the wanted arm" };
  }
  let out = [];
  for (let ii = 0; ii < values.length; ++ii) {
    let next = args.slice();
    next[idx] = values[ii];
    out.push(next);
  }
  return { candidates: out };
}

// --- loop counter start values -------------------------------------------
// The value a loop counter starts with: the for-init, or the nearest
// preceding literal assignment to that name in the source. Only
// literal numbers count — anything else is not a start the solver
// can trust.
function counterStartsFor(loopNode, ast) {
  let best = {};
  function note(name, value, start) {
    if (!best[name] || start > best[name].start) {
      best[name] = { start: start, value: value };
    }
  }
  if (loopNode.type === "ForStatement" && loopNode.init) {
    let init = loopNode.init;
    if (init.type === "VariableDeclaration") {
      for (let ii = 0; ii < init.declarations.length; ++ii) {
        let d = init.declarations[ii];
        if (d.id && d.id.type === "Identifier" && d.init && d.init.type === "Literal" && typeof d.init.value === "number") {
          note(d.id.name, d.init.value, d.start);
        }
      }
    } else if (init.type === "AssignmentExpression" && init.operator === "=" &&
        init.left.type === "Identifier" && init.right.type === "Literal" && typeof init.right.value === "number") {
      note(init.left.name, init.right.value, init.start);
    }
  }
  walk(ast, function(node) {
    if (node.start >= loopNode.start) return;
    if (node.type === "VariableDeclaration") {
      for (let ii = 0; ii < node.declarations.length; ++ii) {
        let d = node.declarations[ii];
        if (d.id && d.id.type === "Identifier" && d.init && d.init.type === "Literal" && typeof d.init.value === "number") {
          note(d.id.name, d.init.value, d.start);
        }
      }
    }
    if (node.type === "AssignmentExpression" && node.operator === "=" &&
        node.left.type === "Identifier" && node.right.type === "Literal" && typeof node.right.value === "number") {
      note(node.left.name, node.right.value, node.start);
    }
  });
  let starts = {};
  let names = Object.keys(best);
  for (let ii = 0; ii < names.length; ++ii) starts[names[ii]] = best[names[ii]].value;
  return starts;
}

// --- guided mutation fallback ---------------------------------------------
// One small change per argument, in order. Tried once per site, after
// the solver gives up — a nudge that sometimes stumbles onto the
// arm the solver could not compute.
function mutations(args) {
  let out = [];
  for (let ii = 0; ii < args.length; ++ii) {
    let v = args[ii];
    if (typeof v === "number") {
      out.push(withArg(args, ii, v + 1));
      out.push(withArg(args, ii, v - 1));
      out.push(withArg(args, ii, 0));
    } else if (typeof v === "string") {
      out.push(withArg(args, ii, ""));
      out.push(withArg(args, ii, v + "x"));
    } else if (typeof v === "boolean") {
      out.push(withArg(args, ii, !v));
    } else if (v === null || v === void 0) {
      out.push(withArg(args, ii, 1));
      out.push(withArg(args, ii, ""));
    }
  }
  return out;
}

function withArg(args, index, value) {
  let next = args.slice();
  next[index] = value;
  return next;
}

// --- branch sites ----------------------------------------------------------
// A site is a condition evaluation point, keyed by kind and the source
// position of its test — positions are stable across runs (the entry
// call is appended after the code under test), while the
// instrumenter's hashes are per-Stage and are not.
function siteInfoForEvent(stage, event) {
  if (typeof event.hash !== "number" || !stage.nodes || !stage.nodes[event.hash]) return null;
  let node = stage.nodes[event.hash].node;
  if (!node) return null;
  if (event.event === "IF_TEST" && event.trigger === "test") {
    if (!node.test) return null;
    return { kind: "if", node: node, testNode: node.test, arm: event.value === true ? "true" : "false" };
  }
  if (event.event === "LOOP_TEST" && event.trigger === "test") {
    return { kind: "loop", node: node, testNode: node.test || null, arm: event.value === true ? "true" : "false" };
  }
  if (event.event === "TERNARY" && event.trigger === "fire") {
    if (!node.test) return null;
    return { kind: "ternary", node: node, testNode: node.test, arm: event.test === true ? "true" : "false" };
  }
  return null;
}

function siteInfoForCase(stage, event) {
  if (event.event !== "CASE_ENTER" || event.trigger !== "enter") return null;
  if (typeof event.hash !== "number" || !stage.nodes || !stage.nodes[event.hash]) return null;
  let node = stage.nodes[event.hash].node;
  if (!node) return null;
  return { kind: "case", node: node, testNode: node.test || null, arm: "matched" };
}

// Solve a switch-case target: the discriminant must equal the case
// value (or, for default, match no case value).
function solveCaseTarget(site, args, params) {
  if (site.isDefault) {
    let idx = paramIndex(params, site.discriminantName);
    if (idx < 0 || !site.caseLiterals) {
      return { reason: "default arm cannot be targeted: the discriminant is not a bare input parameter" };
    }
    let lits = site.caseLiterals;
    if (lits.length === 0) return { candidates: [args.slice()] };
    let allNumbers = true;
    let allStrings = true;
    for (let ii = 0; ii < lits.length; ++ii) {
      if (typeof lits[ii] !== "number") allNumbers = false;
      if (typeof lits[ii] !== "string") allStrings = false;
    }
    let next = args.slice();
    if (allNumbers) {
      let max = lits[0];
      for (let ii = 1; ii < lits.length; ++ii) if (lits[ii] > max) max = lits[ii];
      next[idx] = max + 1;
      return { candidates: [next] };
    }
    if (allStrings) {
      let candidate = "no-match";
      let n = 2;
      while (lits.indexOf(candidate) !== -1) candidate = "no-match-" + n++;
      next[idx] = candidate;
      return { candidates: [next] };
    }
    return { reason: "default arm cannot be targeted: the case values mix types, so no single non-matching value is evident" };
  }
  if (!site.discriminant || !site.caseValue) {
    return { reason: "switch case cannot be solved: no discriminant or case value recorded" };
  }
  // Bare parameter === literal case value.
  if (site.discriminant.type === "Identifier" && site.caseValue.type === "Literal") {
    let idx = paramIndex(params, site.discriminant.name);
    if (idx < 0) {
      return { reason: "switch discriminant reads '" + site.discriminant.name + "', which is not an input parameter" };
    }
    let next = args.slice();
    next[idx] = site.caseValue.value;
    return { candidates: [next] };
  }
  // param.length === numeric literal case value.
  if (
    site.discriminant.type === "MemberExpression" &&
    site.discriminant.object.type === "Identifier" &&
    site.discriminant.property && site.discriminant.property.name === "length" &&
    !site.discriminant.computed && site.caseValue.type === "Literal" &&
    typeof site.caseValue.value === "number"
  ) {
    let idx = paramIndex(params, site.discriminant.object.name);
    if (idx < 0) {
      return { reason: "switch discriminant reads '" + site.discriminant.object.name + ".length', which is not an input parameter" };
    }
    let next = args.slice();
    next[idx] = "a".repeat(site.caseValue.value);
    return { candidates: [next] };
  }
  return { reason: "switch case cannot be solved: the discriminant is not a bare parameter or .length against a literal case value" };
}

// --- the synthesiser ---------------------------------------------------------
export function synthesize(code, options) {
  let iroh = this;
  options = options || {};
  if (typeof code !== "string") {
    throw new Error("synthesize() needs the program as a string");
  }
  let entry = options.entry;
  if (typeof entry !== "string" || entry === "") {
    throw new Error("synthesize() needs options.entry — the name of the function under test");
  }
  let maxRuns = options.maxRuns === void 0 ? SYNTHESIZE_DEFAULTS.maxRuns : options.maxRuns;
  let loopCap = options.loopCap === void 0 ? SYNTHESIZE_DEFAULTS.loopCap : options.loopCap;
  if (typeof maxRuns !== "number" || maxRuns < 1 || Math.floor(maxRuns) !== maxRuns) {
    throw new Error("synthesize() maxRuns must be a positive integer, got " + maxRuns);
  }
  if (typeof loopCap !== "number" || loopCap < 1 || Math.floor(loopCap) !== loopCap) {
    throw new Error("synthesize() loopCap must be a positive integer, got " + loopCap);
  }
  let onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  let analyzeOptions = options.analyze || {};
  let liveThresholds = {};
  if (analyzeOptions.source === void 0) liveThresholds.source = code;
  else liveThresholds.source = analyzeOptions.source;
  if (analyzeOptions.hotLoopThreshold !== void 0) liveThresholds.hotLoopThreshold = analyzeOptions.hotLoopThreshold;
  if (analyzeOptions.deepRecursionThreshold !== void 0) liveThresholds.deepRecursionThreshold = analyzeOptions.deepRecursionThreshold;
  if (analyzeOptions.repeatSequenceMinOccurrences !== void 0) liveThresholds.repeatSequenceMinOccurrences = analyzeOptions.repeatSequenceMinOccurrences;
  if (analyzeOptions.oneSidedMinTests !== void 0) liveThresholds.oneSidedMinTests = analyzeOptions.oneSidedMinTests;

  let ast;
  try {
    ast = parse(code);
  } catch (e) {
    throw new Error("synthesize() cannot parse the code: " + e.message);
  }
  let entryNode = resolveEntry(ast, entry);
  if (!entryNode) {
    throw new Error("synthesize() entry \"" + entry + "\" not found as a top-level function in the code");
  }
  let params = paramList(entryNode);
  // Clean AST nodes by source span, for resolving a branch's test
  // expression. The stage's stored clones are NOT clean: the patch
  // stages run in the order 2, 7, 4, 5, 1, 3, 6, 8, and stage 1
  // wraps every literal in a DEBUG_LITERAL call — so a clone made in
  // stage 8 (ternary) already contains wrapped literals, while the
  // if/loop clones (stages 2/7) were made before the wrapping. The
  // positions are identical in both parses (the entry call is appended
  // after the code under test), so the span keys the clean node.
  let nodeBySpan = {};
  walk(ast, function(node) {
    if (typeof node.start !== "number" || typeof node.end !== "number") return;
    let key = node.start + ":" + node.end;
    if (!nodeBySpan[key]) nodeBySpan[key] = [];
    nodeBySpan[key].push(node);
  });
  function cleanNode(stageNode) {
    if (!stageNode || typeof stageNode.start !== "number" || typeof stageNode.end !== "number") return stageNode;
    let list = nodeBySpan[stageNode.start + ":" + stageNode.end];
    if (!list) return stageNode;
    for (let ii = 0; ii < list.length; ++ii) {
      if (list[ii].type === stageNode.type) return list[ii];
    }
    return list[0];
  }
  let switchMap = buildSwitchMap(ast);
  // Case literals per switch, for the default arm: the discriminant
  // values a non-matching input must avoid. Keyed by the switch's
  // discriminant start.
  let switchCases = {};
  walk(ast, function(node) {
    if (node.type !== "SwitchStatement") return;
    let lits = [];
    let discName = node.discriminant.type === "Identifier" ? node.discriminant.name : null;
    for (let ii = 0; ii < node.cases.length; ++ii) {
      if (node.cases[ii].test && node.cases[ii].test.type === "Literal") {
        lits.push(node.cases[ii].test.value);
      }
    }
    switchCases[node.discriminant.start] = { literals: lits, discriminantName: discName };
  });

  let seeds = options.seeds === void 0 ? [[]] : options.seeds;
  if (!Array.isArray(seeds)) {
    throw new Error("synthesize() seeds must be an array of argument arrays");
  }
  for (let ii = 0; ii < seeds.length; ++ii) {
    if (!Array.isArray(seeds[ii])) {
      throw new Error("synthesize() seed " + ii + " is not an array of arguments");
    }
    for (let jj = 0; jj < seeds[ii].length; ++jj) serializeArg(seeds[ii][jj]);
  }

  let sites = {};
  let siteOrder = [];
  let allRuns = [];
  let inputs = [];
  let tried = {};
  let agenda = [];
  for (let ii = 0; ii < seeds.length; ++ii) agenda.push({ args: seeds[ii].slice(), via: "seed" });
  let runIndex = 0;
  let synthesizedCount = 0;

  // A progress listener is observational: it must never break a run.
  function emit(ev) {
    if (!onProgress) return;
    try {
      onProgress(ev);
    } catch (e) {
      // Deliberate: progress is a report, not a control channel.
    }
  }

  function getOrCreateSite(info, program) {
    let key;
    if (info.kind === "case") {
      key = info.testNode ? "case:" + info.testNode.start : "default:" + info.node.start;
    } else {
      key = info.kind + ":" + (info.testNode ? info.testNode.start : info.node.start);
    }
    let site = sites[key];
    if (site) return site;
    let statement = sourceOf(program, info.node);
    if (statement && statement.length > STATEMENT_PREVIEW_CHARS) {
      statement = statement.slice(0, STATEMENT_PREVIEW_CHARS) + "…";
    }
    if (info.kind === "case") {
      let sw = switchMap[key];
      let condition = info.testNode
        ? "switch discriminant === " + sourceOf(program, info.testNode)
        : "switch default (no case matched)";
      let discInfo = null;
      if (sw && sw.discriminant) {
        discInfo = switchCases[sw.discriminant.start] || null;
      }
      site = {
        id: key,
        kind: "case",
        condition: condition,
        statement: statement,
        location: info.testNode
          ? { start: info.testNode.start, end: info.testNode.end }
          : { start: info.node.start, end: info.node.end },
        arms: ["matched"],
        counts: { matched: 0 },
        coveredBy: { matched: null },
        covered: false,
        witnessArgs: null,
        witnessRun: null,
        attempted: { matched: false },
        reasons: { matched: null },
        mutationTried: false,
        discriminant: sw ? sw.discriminant : null,
        caseValue: sw ? sw.caseValue : null,
        isDefault: sw ? sw.isDefault : !info.testNode,
        discriminantName: discInfo ? discInfo.discriminantName : null,
        caseLiterals: discInfo ? discInfo.literals : null,
      };
    } else {
      let condition = info.testNode
        ? sourceOf(program, info.testNode)
        : "true (no test)";
      site = {
        id: key,
        kind: info.kind,
        condition: condition,
        statement: statement,
        location: info.testNode
          ? { start: info.testNode.start, end: info.testNode.end }
          : { start: info.node.start, end: info.node.end },
        arms: ["true", "false"],
        counts: { "true": 0, "false": 0 },
        coveredBy: { "true": null, "false": null },
        covered: false,
        witnessArgs: null,
        witnessRun: null,
        attempted: { "true": false, "false": false },
        reasons: { "true": null, "false": null },
        mutationTried: false,
        // The clean test node (see cleanNode): the stage's stored
        // clone may contain patch-wrapped children, which the solver
        // cannot read.
        testNode: cleanNode(info.testNode),
        counterStarts: info.kind === "loop" ? counterStartsFor(info.node, ast) : {},
      };
    }
    sites[key] = site;
    siteOrder.push(key);
    return site;
  }

  function siteByLocationStart(start) {
    for (let ii = 0; ii < siteOrder.length; ++ii) {
      let site = sites[siteOrder[ii]];
      if (site.location && site.location.start === start) return site;
    }
    return null;
  }

  // The aggregate live analyzer's ONE_SIDED_BRANCH findings are the
  // target list. Hashes are remapped to the branch site's source
  // position first — the instrumenter's hashes are per-Stage, so the
  // same branch has a different hash in every run. Capped flips are
  // filtered out: they are the tool's intervention, not the program.
  // Only ONE_SIDED_BRANCH is taken from the aggregate — its other
  // findings would conflate separate runs (loop iterations add up).
  function remapEvent(line, stage) {
    if (line.event !== "IF_TEST" && line.event !== "LOOP_TEST" && line.event !== "TERNARY") return line;
    if (typeof line.hash !== "number" || !stage.nodes || !stage.nodes[line.hash]) return line;
    let node = stage.nodes[line.hash].node;
    if (!node) return line;
    let canonical = node.test && typeof node.test.start === "number" ? node.test.start : node.start;
    let copy = Object.assign({}, line);
    copy.hash = canonical;
    return copy;
  }

  function aggregateOneSided() {
    let agg = liveAnalyzer(liveThresholds);
    for (let rr = 0; rr < allRuns.length; ++rr) {
      let runRec = allRuns[rr];
      for (let ee = 0; ee < runRec.events.length; ++ee) {
        let line = runRec.events[ee];
        if (line.capped) continue;
        agg.feed(remapEvent(line, runRec.stage));
      }
    }
    let fin = agg.finish();
    let out = [];
    for (let ii = 0; ii < fin.findings.length; ++ii) {
      if (fin.findings[ii].code === "ONE_SIDED_BRANCH") out.push(fin.findings[ii]);
    }
    return out;
  }

  function runCandidate(args, runNo) {
    let program = code + "\n" + entry + "(" + args.map(serializeArg).join(", ") + ");";
    let live = liveAnalyzer(liveThresholds);
    let loopCounts = {};
    let capped = false;
    let run = runInternals.createTraceRun(iroh, program, {
      events: "ALL",
      rawOnEvent: function(raw, trigger, line) {
        if (raw.type === INSTR.LOOP_TEST && trigger === "test" && raw.value === true) {
          let key = String(raw.hash);
          loopCounts[key] = (loopCounts[key] || 0) + 1;
          if (loopCounts[key] > loopCap) {
            capped = true;
            raw.value = false;
            line.value = false;
            line.capped = true;
          }
        }
      },
      onEvent: function(line) {
        let fired = live.feed(line);
        for (let ii = 0; ii < fired.length; ++ii) {
          emit({ type: "live-finding", run: runNo, finding: fired[ii] });
        }
      },
    });
    let stage = run.stage;
    let runner = runInternals.compileRunner(iroh, stage, false);
    let result = void 0;
    let error = null;
    try {
      result = runner(iroh);
    } catch (e) {
      error = e;
      runInternals.attachTraceEvents(e, run.events);
    }
    let liveSummary = live.finish();
    return {
      run: runNo,
      args: args.slice(),
      program: program,
      stage: stage,
      events: run.events,
      result: result,
      error: error,
      capped: capped,
      liveFindings: liveSummary.findings,
    };
  }

  function updateSites(runRec) {
    let newly = [];
    let events = runRec.events;
    for (let ii = 0; ii < events.length; ++ii) {
      let ev = events[ii];
      if (ev.capped) continue;
      let info = null;
      let isCase = false;
      if (
        (ev.event === "IF_TEST" && ev.trigger === "test") ||
        (ev.event === "LOOP_TEST" && ev.trigger === "test") ||
        (ev.event === "TERNARY" && ev.trigger === "fire")
      ) {
        info = siteInfoForEvent(runRec.stage, ev);
      } else if (ev.event === "CASE_ENTER" && ev.trigger === "enter") {
        info = siteInfoForCase(runRec.stage, ev);
        isCase = info !== null;
      }
      if (!info) continue;
      let site = getOrCreateSite(info, runRec.program);
      let arm = info.arm;
      let before = site.counts[arm];
      site.counts[arm] += 1;
      if (before === 0) {
        site.coveredBy[arm] = runRec.run;
        newly.push({ branch: site.id, arm: arm });
        emit({ type: "branch-covered", branch: site.id, arm: arm, run: runRec.run, args: runRec.args.slice() });
      }
      site.witnessArgs = runRec.args.slice();
      site.witnessRun = runRec.run;
      if (isCase) {
        if (site.counts.matched > 0) site.covered = true;
      } else if (site.counts["true"] > 0 && site.counts["false"] > 0) {
        site.covered = true;
      }
    }
    return newly;
  }

  function solveForTarget(target) {
    let site = target.site;
    let witness = site.witnessArgs || [];
    let args = witness.slice();
    while (args.length < params.length) args.push(void 0);
    if (site.kind === "case") {
      return solveCaseTarget(site, args, params);
    }
    if (!site.testNode) {
      return { reason: "loop has no test expression — it always runs, so the exit arm cannot be covered by an input" };
    }
    return solveTest(site.testNode, target.arm === "true", args, params, site.counterStarts || {}, code, 0);
  }

  function pushAgenda(args, via) {
    let key = JSON.stringify(args);
    if (tried[key]) return false;
    for (let ii = 0; ii < agenda.length; ++ii) {
      if (JSON.stringify(agenda[ii].args) === key) return false;
    }
    agenda.push({ args: args.slice(), via: via });
    return true;
  }

  function pickTarget(oneSided) {
    for (let ii = 0; ii < oneSided.length; ++ii) {
      let f = oneSided[ii];
      let site = f.evidence && typeof f.evidence.hash === "number"
        ? siteByLocationStart(f.evidence.hash)
        : null;
      if (!site) continue;
      for (let aa = 0; aa < site.arms.length; ++aa) {
        let arm = site.arms[aa];
        if (site.counts[arm] === 0 && !site.attempted[arm]) return { site: site, arm: arm };
      }
    }
    // Fallback: a branch tested too few times for the analyzer to call
    // one-sided (fewer than oneSidedMinTests tests) is targeted from
    // the table directly.
    for (let ii = 0; ii < siteOrder.length; ++ii) {
      let site = sites[siteOrder[ii]];
      for (let aa = 0; aa < site.arms.length; ++aa) {
        let arm = site.arms[aa];
        if (site.counts[arm] === 0 && !site.attempted[arm]) return { site: site, arm: arm };
      }
    }
    return null;
  }

  // Register every switch case up front: a case no run ever matches
  // still counts as a branch. Without this the total would silently
  // shrink to the cases the seeds happened to hit.
  let switchKeys = Object.keys(switchMap);
  for (let ii = 0; ii < switchKeys.length; ++ii) {
    let sw = switchMap[switchKeys[ii]];
    getOrCreateSite({ kind: "case", node: sw.caseNode, testNode: sw.caseValue }, code);
  }

  // --- main loop -----------------------------------------------------------
  while (runIndex < maxRuns) {
    if (agenda.length === 0) {
      let oneSided = aggregateOneSided();
      let target = pickTarget(oneSided);
      if (!target) break;
      let solved = solveForTarget(target);
      if (solved.candidates && solved.candidates.length > 0) {
        let added = 0;
        for (let ii = 0; ii < solved.candidates.length; ++ii) {
          if (pushAgenda(solved.candidates[ii], "solver")) added += 1;
        }
        if (added === 0) {
          target.site.attempted[target.arm] = true;
          target.site.reasons[target.arm] = solved.reason || "the solver's candidates were already tried";
        }
      } else {
        target.site.attempted[target.arm] = true;
        target.site.reasons[target.arm] = solved.reason || "the solver produced no candidate";
        if (!target.site.mutationTried) {
          target.site.mutationTried = true;
          let muts = mutations(target.site.witnessArgs || []);
          for (let ii = 0; ii < muts.length; ++ii) pushAgenda(muts[ii], "mutation");
        }
      }
      continue;
    }
    let item = agenda.shift();
    let key = JSON.stringify(item.args);
    if (tried[key]) continue;
    tried[key] = true;
    let runRec = runCandidate(item.args, runIndex);
    runIndex += 1;
    allRuns.push(runRec);
    let newly = updateSites(runRec);
    let inputRec = {
      args: runRec.args.slice(),
      run: runRec.run,
      result: safeValue(runRec.result, 3, new Set()),
      error: runRec.error ? (runRec.error.message || String(runRec.error)) : null,
      capped: runRec.capped,
      covers: newly.map(function(n) { return n.branch + ":" + n.arm; }),
      via: item.via,
    };
    inputs.push(inputRec);
    if (item.via !== "seed") synthesizedCount += 1;
    emit({
      type: "run",
      run: runRec.run,
      args: runRec.args.slice(),
      result: inputRec.result,
      error: inputRec.error,
      capped: runRec.capped,
      newlyCovered: newly,
    });
  }

  // --- report ----------------------------------------------------------------
  let coveredArms = 0;
  let totalArms = 0;
  let branches = [];
  let uncovered = [];
  for (let ii = 0; ii < siteOrder.length; ++ii) {
    let site = sites[siteOrder[ii]];
    let publicArms = [];
    for (let aa = 0; aa < site.arms.length; ++aa) {
      let arm = site.arms[aa];
      totalArms += 1;
      let isCovered = site.counts[arm] > 0;
      if (isCovered) coveredArms += 1;
      publicArms.push({
        arm: arm,
        observed: site.counts[arm],
        covered: isCovered,
        coveredBy: site.coveredBy[arm],
      });
      if (!isCovered) {
        let reason = site.reasons[arm];
        if (!reason) {
          reason = "not targeted: the run budget of " + maxRuns + " was exhausted after " + runIndex + " runs";
        }
        uncovered.push({
          id: site.id,
          kind: site.kind,
          condition: site.condition,
          statement: site.statement,
          location: site.location,
          arm: arm,
          reason: reason,
          observed: site.counts[arm],
        });
      }
    }
    branches.push({
      id: site.id,
      kind: site.kind,
      condition: site.condition,
      statement: site.statement,
      location: site.location,
      arms: publicArms,
      covered: site.covered,
      reasons: site.reasons,
    });
  }

  // Findings: the final aggregate ONE_SIDED_BRANCH findings first
  // (they carry their branch), then the per-run live findings —
  // deduped by code + branch site + message. The site is canonical
  // (the condition's source position): a per-run finding's hash is
  // its own Stage's hash, so the same loop would otherwise appear
  // once per run that never entered it.
  function canonicalHash(stage, hash) {
    if (typeof hash !== "number" || !stage || !stage.nodes || !stage.nodes[hash]) return hash;
    let node = stage.nodes[hash].node;
    if (!node) return hash;
    return node.test && typeof node.test.start === "number" ? node.test.start : node.start;
  }
  function findingKey(f, stage) {
    let h = "";
    if (f.evidence) {
      if (typeof f.evidence.hash === "number") {
        h = String(canonicalHash(stage, f.evidence.hash));
      } else if (Array.isArray(f.evidence.hashes)) {
        let parts = [];
        for (let ii = 0; ii < f.evidence.hashes.length; ++ii) {
          parts.push(String(canonicalHash(stage, f.evidence.hashes[ii])));
        }
        h = parts.join(",");
      }
    }
    return f.code + "|" + h + "|" + f.message;
  }
  let findings = [];
  let seenFinding = {};
  function addFinding(f, stage) {
    let key = findingKey(f, stage);
    if (seenFinding[key]) return;
    seenFinding[key] = true;
    findings.push(f);
  }
  let finalOneSided = aggregateOneSided();
  for (let ii = 0; ii < finalOneSided.length; ++ii) {
    let f = finalOneSided[ii];
    let copy = Object.assign({}, f);
    let site = f.evidence && typeof f.evidence.hash === "number"
      ? siteByLocationStart(f.evidence.hash)
      : null;
    if (site) {
      copy.branch = site.id;
      copy.condition = site.condition;
    }
    // The aggregate hash is already canonical (a source position).
    addFinding(copy, null);
  }
  for (let rr = 0; rr < allRuns.length; ++rr) {
    let lf = allRuns[rr].liveFindings;
    for (let ii = 0; ii < lf.length; ++ii) addFinding(lf[ii], allRuns[rr].stage);
  }

  let coverage = {
    covered: coveredArms,
    total: totalArms,
    value: totalArms > 0 ? Math.round((coveredArms / totalArms) * 10000) / 10000 : 1,
    sites: siteOrder.length,
    branches: branches,
  };
  return {
    entry: entry,
    inputs: inputs,
    coverage: coverage,
    runs: { used: runIndex, budget: maxRuns },
    uncovered: uncovered,
    findings: findings,
    summary: {
      branchesCovered: coveredArms,
      branchesTotal: totalArms,
      sites: siteOrder.length,
      inputsRun: inputs.length,
      inputsSynthesized: synthesizedCount,
      runsUsed: runIndex,
      runsBudget: maxRuns,
      uncoveredBranches: uncovered.length,
    },
  };
}
