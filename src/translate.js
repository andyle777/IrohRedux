// Hybrid translation engine for IrohRedux — JavaScript <-> Python /
// C++ / IrohScript / BASIC.
//
//   Iroh.translate(code, { from, to })      -> { code, report } (sync)
//   Iroh.translateAsync(code, { from, to }) -> Promise of the same
//
// `from` defaults to "javascript"; `to` is "python" | "cpp" |
// "javascript" | "irohscript" | "basic". The JavaScript-out leg is hybrid: the AST (static)
// plus trace evidence (dynamic — the program is run through the
// tracer first and the events resolve what static analysis can't:
// runtime types, values, which branches fired). The reverse legs
// (Python -> JS, C++ -> JS) are static-only — there is no tracer
// for Python or C++, and the report says so (staticOnly: true).
//
// The report shape is the same every leg:
//   { ok, from, to, staticOnly, clean, assumptions, unsupported, notes, verify }
// `ok` is false when anything was unsupported. Unsupported constructs
// are reported, never silently mistranslated: the emitted code
// raises/throws at that point, loudly, and the report names the
// construct. Assumptions cite their trace evidence.
//
// v1 construct scope (both directions): functions, arithmetic,
// loops, conditionals, arrays (lists / vectors), strings, console
// output (console.log / print / std::cout). No classes, no
// closures-as-objects, no async in v1.
//
// Python -> JS parses with Python's own `ast` module: a small
// stdlib-only Python helper (embedded below) is run through python3
// and emits the AST as JSON; the JS side translates that AST. No
// hand-rolled Python parser. C++ -> JS uses a scoped subset parser
// written here (src/translate.js) — anything outside the subset is
// reported unsupported, never guessed at.
//
// Buble: no async/await, no for...of in this file (browser bundle).
// The Python leg needs Node.js (child_process) + python3 on PATH;
// in the browser / ESM builds translate() throws a clear error and
// translateAsync() is the way in (it loads child_process by dynamic
// import).

import { parse } from "./utils";
import { runIrohscriptPython, IROHSCRIPT_AST_HELPER, getChildProcessSync, nodeImport } from "./irohscript-bridge";

// ------------------------------------------------------------------
// Report + shared helpers
// ------------------------------------------------------------------

function newReport(from, to, staticOnly) {
  return {
    ok: true,
    from: from,
    to: to,
    staticOnly: staticOnly,
    clean: [],
    assumptions: [],
    unsupported: [],
    notes: [],
  };
}

function markUnsupported(report, construct, message) {
  report.ok = false;
  report.unsupported.push({ construct: construct, message: message });
}

function recordAssumption(report, what, evidence) {
  report.assumptions.push({ what: what, evidence: evidence });
}

// 1.1.1 patch (Fix Spec 3.7): verify the emitted Python actually
// runs. `report.ok` answers "did I produce text"; every user reads
// it as "will this run". The verify block closes that gap: the
// emitted program is executed under python3 (fed on stdin as
// `python3 -`, 10 s cap) and the result is recorded on the report.
// ran: null is not ran: true — when no interpreter is present the
// block says attempted: false instead of omitting the field. When
// ran is false the interpreter's stderr is carried verbatim: the
// exact SyntaxError line is what lets a reader find the defect.
// The interpreter probe is cached per process (PATH does not change
// mid-process); the run itself is not cached — every translation is
// verified fresh. A translated program that reads stdin sees EOF:
// `python3 -` consumes stdin as the program itself.
let _pyVerifyProbe = null; // { cmd, version } | { missing: true, cmd }
function probePython(cp) {
  if (_pyVerifyProbe) return _pyVerifyProbe;
  let cmd = (typeof process !== "undefined" && process && process.env && process.env.IROH_PYTHON) || "python3";
  try {
    let p = cp.spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 10000 });
    if (p.status === 0) {
      let v = ((p.stdout || "") + (p.stderr || "")).trim().replace(/^Python /, "");
      _pyVerifyProbe = { cmd: cmd, version: v };
      return _pyVerifyProbe;
    }
  } catch (e) {
    // Fall through to missing.
  }
  _pyVerifyProbe = { missing: true, cmd: cmd };
  return _pyVerifyProbe;
}

function verifyEmittedPython(report, code, options) {
  if (options.verify === false) {
    report.verify = { attempted: false, ran: null, reason: "verify disabled (options.verify: false)" };
    return;
  }
  let cp = getChildProcessSync();
  if (!cp) {
    report.verify = { attempted: false, ran: null, reason: "no child_process (browser / ESM build without Node)" };
    return;
  }
  let probe = probePython(cp);
  if (probe.missing) {
    report.verify = { attempted: false, ran: null, reason: "no " + probe.cmd + " on PATH" };
    return;
  }
  let run;
  try {
    run = cp.spawnSync(probe.cmd, ["-"], { input: code, encoding: "utf8", timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: null, stderr: "verify spawn failed: " + (e.message || String(e)) };
    return;
  }
  if (run.error) {
    if (run.error.code === "ETIMEDOUT") {
      report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: null, stderr: "verify timed out after 10 s (emitted program did not finish)" };
    } else {
      report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: null, stderr: "verify spawn failed: " + (run.error.message || String(run.error)) };
    }
    return;
  }
  if (run.status === 0) {
    report.verify = { attempted: true, ran: true, interpreter: probe.version, exit: 0 };
  } else {
    report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: run.status, stderr: run.stderr || "" };
  }
}

// C++ type of a traced (safeValue-serialized) runtime value.
// Returns "int" | "double" | "std::string" | "bool" |
// "std::vector<T>" | null (unknown). safeValue markers ("[Function
// ...]", "[Object]", ...) are not real values.
function cppTypeOfValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "double";
  }
  if (typeof value === "string") {
    if (
      value.indexOf("[Function ") === 0 ||
      value === "[Object]" ||
      value === "[Circular]" ||
      value === "[Promise]" ||
      value === "[Unserializable]"
    ) {
      return null;
    }
    return "std::string";
  }
  if (typeof value === "boolean") return "bool";
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    let inner = cppTypeOfValue(value[0]);
    return inner ? "std::vector<" + inner + ">" : null;
  }
  return null;
}

function isIdentifierName(s) {
  return typeof s === "string" && /^[A-Za-z_$][\w$]*$/.test(s);
}

// Build the dynamic evidence environment from trace events:
//   vars:   name -> { value, type } from VAR_INIT / ASSIGN
//   funcs:  name -> { args, returns } from FUNCTION_CALL / FUNCTION_RETURN
//   called: names with at least one call
//   ifOutcomes: hash -> { trueCount, falseCount } from IF_TEST
function buildTraceEnv(events) {
  let env = { vars: {}, funcs: {}, called: {}, ifOutcomes: {} };
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "VAR_INIT" && e.name && e.value !== void 0) {
      if (!(e.name in env.vars)) {
        env.vars[e.name] = { value: e.value, type: cppTypeOfValue(e.value) };
      }
    } else if (
      e.event === "ASSIGN" &&
      isIdentifierName(e.object) &&
      e.value !== void 0
    ) {
      if (!(e.object in env.vars)) {
        env.vars[e.object] = { value: e.value, type: cppTypeOfValue(e.value) };
      }
    } else if (e.event === "FUNCTION_CALL" && e.trigger === "before" && e.name) {
      env.called[e.name] = true;
      if (!env.funcs[e.name]) {
        env.funcs[e.name] = { args: e.arguments || [], returns: null, calls: [], returnValues: [] };
      }
      // Every call's arguments, not just the first: a later call with
      // a different argument type must not silently reuse the first
      // call's signature (see the ctx seeding below).
      env.funcs[e.name].calls.push(e.arguments || []);
    } else if (e.event === "FUNCTION_RETURN" && e.name) {
      if (!env.funcs[e.name]) {
        env.funcs[e.name] = { args: null, returns: null, calls: [], returnValues: [] };
      }
      if (e.return !== void 0) {
        env.funcs[e.name].returnValues.push(e.return);
        if (env.funcs[e.name].returns === null) {
          env.funcs[e.name].returns = e.return;
        }
      }
    } else if (e.event === "IF_TEST") {
      let g = env.ifOutcomes[e.hash];
      if (!g) g = env.ifOutcomes[e.hash] = { trueCount: 0, falseCount: 0 };
      if (e.value === true) g.trueCount += 1;
      else if (e.value === false) g.falseCount += 1;
    }
  }
  return env;
}

// Static C++ type inference for an expression node, using the
// variable/function types known so far (ctx.vars / ctx.funcs map
// names to C++ type strings). Returns a type string or null.
function inferType(node, ctx) {
  if (!node || typeof node.type !== "string") return null;
  switch (node.type) {
    case "Literal": {
      if (typeof node.value === "number") {
        // Only a safe integer is a C++ int: JS numbers are doubles,
        // and a literal like 1e21 is integer-valued but cannot be a
        // C++ int (nor a long long) — String(1e21) must format as
        // "1e+21", not std::to_string's full digits.
        return Number.isSafeInteger(node.value) ? "int" : "double";
      }
      if (typeof node.value === "string") return "std::string";
      if (typeof node.value === "boolean") return "bool";
      return null;
    }
    case "Identifier":
      return ctx.vars[node.name] || null;
    case "ArrayExpression": {
      if (node.elements.length === 0) return null;
      let inner = inferType(node.elements[0], ctx);
      return inner ? "std::vector<" + inner + ">" : null;
    }
    case "TemplateLiteral":
      return "std::string";
    case "BinaryExpression":
    case "LogicalExpression": {
      let op = node.operator;
      if (op === "==" || op === "!=" || op === "===" || op === "!==" ||
          op === "<" || op === ">" || op === "<=" || op === ">=" ||
          op === "&&" || op === "||" || op === "in" || op === "instanceof") {
        return "bool";
      }
      if (op === "+") {
        let lt = inferType(node.left, ctx);
        let rt = inferType(node.right, ctx);
        if (lt === "std::string" || rt === "std::string") return "std::string";
      }
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      if (lt === null || rt === null) return null;
      if (lt === "double" || rt === "double") return "double";
      if (lt === "int" && rt === "int") return "int";
      return null;
    }
    case "UnaryExpression": {
      if (node.operator === "!") return "bool";
      if (node.operator === "-" || node.operator === "+") {
        return inferType(node.argument, ctx);
      }
      return null;
    }
    case "UpdateExpression":
      return inferType(node.argument, ctx);
    case "AssignmentExpression":
      return inferType(node.right, ctx);
    case "ConditionalExpression": {
      let t = inferType(node.consequent, ctx);
      let a = inferType(node.alternate, ctx);
      return t !== null && t === a ? t : null;
    }
    case "SequenceExpression":
      return inferType(node.expressions[node.expressions.length - 1], ctx);
    case "CallExpression": {
      if (node.callee.type === "Identifier") {
        let name = node.callee.name;
        if (ctx.funcs[name] && ctx.funcs[name].returns) {
          return ctx.funcs[name].returns;
        }
        if (name === "String") return "std::string";
        if (name === "Number" || name === "parseFloat") return "double";
        if (name === "parseInt") return "int";
        if (name === "Boolean") return "bool";
      }
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Math"
      ) {
        let prop = node.callee.property.name;
        if (prop === "floor" || prop === "ceil" || prop === "round" || prop === "trunc") {
          return "int";
        }
        if (prop === "pow" || prop === "sqrt" || prop === "abs" || prop === "max" || prop === "min") {
          return "double";
        }
      }
      return null;
    }
    case "MemberExpression": {
      if (
        node.property &&
        ((node.property.type === "Identifier" && node.property.name === "length") ||
          (node.property.type === "Literal" && node.property.value === "length"))
      ) {
        return "int";
      }
      return null;
    }
    default:
      return null;
  }
}

// Precedence table for parenthesization (higher binds tighter).
function precedence(node) {
  if (!node || typeof node.type !== "string") return 16;
  switch (node.type) {
    case "AssignmentExpression": return 1;
    case "ConditionalExpression": return 2;
    case "LogicalExpression":
      return node.operator === "||" ? 3 : 4;
    case "BinaryExpression": {
      let op = node.operator;
      if (op === "|") return 5;
      if (op === "^") return 6;
      if (op === "&") return 7;
      if (op === "==" || op === "!=" || op === "===" || op === "!==") return 8;
      if (op === "<" || op === ">" || op === "<=" || op === ">=" ||
          op === "in" || op === "instanceof") return 9;
      if (op === "<<" || op === ">>" || op === ">>>") return 10;
      if (op === "+" || op === "-") return 11;
      if (op === "*" || op === "/" || op === "%") return 12;
      if (op === "**") return 13;
      return 12;
    }
    case "UnaryExpression":
    case "UpdateExpression": return 14;
    case "CallExpression":
    case "MemberExpression": return 15;
    default: return 16;
  }
}

// ------------------------------------------------------------------
// JavaScript -> Python / C++ emitter
// ------------------------------------------------------------------

// Escape a message for embedding as a string literal (valid in both
// Python and C++).
function quotedMessage(msg) {
  return JSON.stringify(String(msg));
}

function makeJSEmitter(target, report, env, hints) {
  let isPy = target === "python";
  let lines = [];
  let indentLevel = 0;
  let needs = { math: false, random: false, cmath: false, algorithm: false, stdexcept: false, cstdlib: false, sysexit: false, vectorHelper: false, unsupportedHelper: false, cout: false, jsmod: false, jsnum: false, jsbool: false };
  let noted = {};
  function noteOnce(key, text) {
    if (!noted[key]) {
      noted[key] = true;
      report.notes.push(text);
    }
  }
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  // C++ type context: variable name -> C++ type string; function
  // name -> { params: [types], returns: type }.
  let ctx = { vars: {}, funcs: {} };
  // Seed the type context from trace evidence.
  let varNames = Object.keys(env.vars);
  for (let ii = 0; ii < varNames.length; ++ii) {
    let v = env.vars[varNames[ii]];
    if (v.type) ctx.vars[varNames[ii]] = v.type;
  }
  let funcNames = Object.keys(env.funcs);
  for (let ii = 0; ii < funcNames.length; ++ii) {
    let f = env.funcs[funcNames[ii]];
    let params = null;
    let paramsConflict = null;
    if (f.args) {
      params = [];
      for (let jj = 0; jj < f.args.length; ++jj) {
        params.push(cppTypeOfValue(f.args[jj]));
      }
      // A later call with a different argument type is a conflict,
      // not a reason to silently reuse the first call's signature.
      // cppSignature refuses the function when one is recorded.
      if (f.calls) {
        for (let jj = 0; jj < params.length; ++jj) {
          for (let kk = 1; kk < f.calls.length; ++kk) {
            let t = cppTypeOfValue(f.calls[kk][jj]);
            if (t !== null && params[jj] !== null && t !== params[jj]) {
              if (!paramsConflict) paramsConflict = [];
              paramsConflict.push({ index: jj, first: params[jj], other: t, call: kk });
              break;
            }
          }
        }
      }
    }
    // Same for returns: differing return types across calls.
    let returnsConflict = null;
    if (f.returnValues && f.returnValues.length > 1) {
      let first = cppTypeOfValue(f.returnValues[0]);
      for (let kk = 1; kk < f.returnValues.length; ++kk) {
        let t = cppTypeOfValue(f.returnValues[kk]);
        if (t !== null && first !== null && t !== first) {
          returnsConflict = { first: first, other: t, call: kk };
          break;
        }
      }
    }
    ctx.funcs[funcNames[ii]] = {
      params: params,
      returns: f.returns !== null && f.returns !== void 0 ? cppTypeOfValue(f.returns) : null,
      // Raw evidence, kept so assumptions can cite it.
      args: f.args || null,
      returnValue: f.returns !== null && f.returns !== void 0 ? f.returns : null,
      paramsFrom: params ? "trace" : null,
      returnsFrom: f.returns !== null && f.returns !== void 0 ? "trace" : null,
      paramsConflict: paramsConflict,
      returnsConflict: returnsConflict,
      callCount: f.calls ? f.calls.length : 0,
      returnCount: f.returnValues ? f.returnValues.length : 0,
    };
  }
  if (hints && hints.functions) {
    let hNames = Object.keys(hints.functions);
    for (let ii = 0; ii < hNames.length; ++ii) {
      let h = hints.functions[hNames[ii]];
      let entry = ctx.funcs[hNames[ii]] || { params: null, returns: null, args: null, returnValue: null, paramsFrom: null, returnsFrom: null };
      if (h.params) { entry.params = h.params.slice(); entry.paramsFrom = "hint"; }
      if (h.returns) { entry.returns = h.returns; entry.returnsFrom = "hint"; }
      ctx.funcs[hNames[ii]] = entry;
    }
  }
  if (hints && hints.variables) {
    let hNames = Object.keys(hints.variables);
    for (let ii = 0; ii < hNames.length; ++ii) {
      ctx.vars[hNames[ii]] = hints.variables[hNames[ii]];
    }
  }

  function indentStr() {
    if (isPy) return "    ".repeat(indentLevel);
    return "  ".repeat(indentLevel);
  }
  function emitLine(text) {
    lines.push(indentStr() + text);
  }
  function stubExpr(detail) {
    if (isPy) {
      needs.unsupportedHelper = true;
      return '_iroh_unsupported(' + quotedMessage(detail) + ')';
    }
    needs.stdexcept = true;
    return '(throw std::runtime_error(' + quotedMessage("IrohRedux: " + detail) + '))';
  }
  function stubStmt(detail) {
    if (isPy) {
      return 'raise NotImplementedError(' + quotedMessage("IrohRedux: " + detail) + ')';
    }
    needs.stdexcept = true;
    return 'throw std::runtime_error(' + quotedMessage("IrohRedux: " + detail) + ');';
  }
  function unsupportedExpr(detail, construct) {
    markUnsupported(report, construct, detail);
    return stubExpr(detail);
  }
  function unsupportedStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    emitLine(stubStmt(detail));
  }

  // Wrap a child expression in parens when its precedence is lower
  // than the parent context's.
  function paren(exprStr, childNode, parentPrec) {
    if (precedence(childNode) < parentPrec) return "(" + exprStr + ")";
    return exprStr;
  }

  function literalValue(node) {
    if (node.regex) return unsupportedExpr("regular expression literal", "Literal");
    if (node.value === null) {
      if (isPy) return "None";
      return unsupportedExpr("null literal has no C++ equivalent in v1", "Literal");
    }
    if (typeof node.value === "number") {
      if (Number.isNaN(node.value)) {
        if (!isPy) needs.cmath = true;
        return isPy ? "float('nan')" : "NAN";
      }
      if (node.value === Infinity) {
        if (!isPy) needs.cmath = true;
        return isPy ? "float('inf')" : "INFINITY";
      }
      if (node.value === -Infinity) {
        if (!isPy) needs.cmath = true;
        return isPy ? "float('-inf')" : "-INFINITY";
      }
      return String(node.value);
    }
    if (typeof node.value === "string") return JSON.stringify(node.value);
    if (typeof node.value === "boolean") return isPy ? (node.value ? "True" : "False") : (node.value ? "true" : "false");
    return unsupportedExpr("literal of unsupported type", "Literal");
  }

  // Python helper: render an expression as a string for concatenation.
  // Python "+" refuses str + number at runtime, so non-strings must be
  // converted — str() for ints, the JS "true"/"false" ternary for
  // bools, __iroh_jsnum for doubles (str() formats 1e16 as "1e+16",
  // where JS prints "10000000000000000").
  function pyStringOf(node) {
    let t = inferType(node, ctx);
    let s = expr(node, 16);
    if (t === "std::string") return s;
    if (t === "int") return "str(" + s + ")";
    if (t === "bool") return '("true" if ' + s + ' else "false")';
    if (t === "double") {
      needs.jsnum = true;
      return "__iroh_jsnum(" + s + ")";
    }
    if (t && t.indexOf("std::vector<") === 0) {
      return unsupportedExpr(
        "string concatenation of an array in Python (JS joins with commas; Python str() prints brackets)",
        "BinaryExpression"
      );
    }
    recordAssumption(
      report,
      "string concatenation operand assumed to be a string",
      "No static or trace type for the operand; emitted as-is"
    );
    return s;
  }

  // C++ helper: render an expression as a string for concatenation.
  // Every result must be a real std::string: a bare string literal is
  // const char*, and `"a" + const char*` is pointer arithmetic, not
  // concatenation — so literals and the bool ternary (whose arms are
  // literals) are wrapped in std::string(...).
  function cppStringOf(node) {
    let t = inferType(node, ctx);
    let s = expr(node, 16);
    if (t === "std::string") {
      if (node.type === "Literal" && typeof node.value === "string") return "std::string(" + s + ")";
      return s;
    }
    if (t === "int") return "std::to_string(" + s + ")";
    if (t === "bool") return "std::string(((" + s + ') ? "true" : "false"))';
    if (t === "double") {
      // JS Number -> string: the shortest decimal that round-trips,
      // formatted the way JS String(v) formats it (see __iroh_jsnum).
      needs.jsnum = true;
      return "__iroh_jsnum(" + s + ")";
    }
    recordAssumption(
      report,
      "string concatenation operand assumed to be a string",
      "No static or trace type for the operand; emitted as std::string(...)"
    );
    return "std::string(" + s + ")";
  }

  function templateLiteral(node) {
    if (isPy) {
      // 1.1.1 patch (Fix Spec 3.5 Option 1): concatenation, NOT an
      // f-string. Property P1 (spec 3.2): on Python before 3.12 a
      // replacement field cannot contain the delimiter quote, a
      // backslash, # or an unbalanced brace/colon — and every branch
      // that pushed a raw expression into {...} violated it in
      // principle (string literals, ternaries of strings, literal
      // text + a field all emitted SyntaxErrors on 3.9-3.11 while
      // the report said ok). Concatenation has no delimiter rules:
      // the expression sits in ordinary parentheses. Literal text
      // is emitted with JSON.stringify — a real serialiser, not the
      // hand-rolled regex chain (which missed newlines and other
      // control characters). One deviation from the spec's sketch:
      // ints go through str(), not bare — "a" + 5 is a TypeError in
      // Python, so the sketch's bare push for int would have traded
      // a SyntaxError for a runtime error.
      let parts = [];
      for (let ii = 0; ii < node.quasis.length; ++ii) {
        let q = node.quasis[ii];
        let raw = q.value.cooked !== void 0 && q.value.cooked !== null ? q.value.cooked : q.value.raw;
        if (raw !== "") parts.push(JSON.stringify(raw));
        if (ii < node.expressions.length) {
          let e = node.expressions[ii];
          let t = inferType(e, ctx);
          if (t === "std::string") {
            parts.push(expr(e, 16));
          } else if (t === "int") {
            parts.push("str(" + expr(e, 16) + ")");
          } else if (t === "bool") {
            // A bool interpolates as "true"/"false" (Python str()
            // would print "True"). Route through the helper, same
            // pattern as __iroh_jsnum for doubles.
            needs.jsbool = true;
            parts.push("__iroh_jsbool(" + expr(e, 16) + ")");
          } else if (t === "double") {
            needs.jsnum = true;
            parts.push("__iroh_jsnum(" + expr(e, 16) + ")");
          } else if (t && t.indexOf("std::vector<") === 0) {
            return unsupportedExpr(
              "template literal interpolation of an array in Python (JS joins with commas; Python str() prints brackets)",
              "TemplateLiteral"
            );
          } else {
            // Unknown type: str() is JS ToString's closest honest
            // neighbour (an object prints its repr, not
            // "[object Object]" — a recorded approximation, not a
            // syntax landmine).
            recordAssumption(
              report,
              "template literal interpolation coerced with str()",
              "No static or trace type for the interpolation"
            );
            parts.push("str(" + expr(e, 16) + ")");
          }
        }
      }
      return "(" + (parts.length ? parts.join(" + ") : '""') + ")";
    }
    // C++: "a" + std::to_string(x) + "b" — string/integral/double
    // interpolations; doubles go through __iroh_jsnum so they print
    // the way JS does (std::to_string would print 6 decimals).
    let parts = [];
    for (let ii = 0; ii < node.quasis.length; ++ii) {
      let q = node.quasis[ii];
      let raw = q.value.cooked !== void 0 && q.value.cooked !== null ? q.value.cooked : q.value.raw;
      if (raw !== "") parts.push("std::string(" + JSON.stringify(raw) + ")");
      if (ii < node.expressions.length) {
        let e = node.expressions[ii];
        let t = inferType(e, ctx);
        if (t === "std::string") parts.push(expr(e, 16));
        else if (t === "int") parts.push("std::to_string(" + expr(e, 16) + ")");
        else if (t === "bool") parts.push("((" + expr(e, 16) + ') ? "true" : "false")');
        else if (t === "double") {
          needs.jsnum = true;
          parts.push("__iroh_jsnum(" + expr(e, 16) + ")");
        } else {
          return unsupportedExpr(
            "template literal interpolation of non-string, non-integer, non-double value in C++",
            "TemplateLiteral"
          );
        }
      }
    }
    if (parts.length === 0) return 'std::string("")';
    return parts.join(" + ");
  }

  function memberExpr(node) {
    let obj = expr(node.object, 15);
    if (!node.computed) {
      let prop = node.property.name !== void 0 ? node.property.name : node.property.value;
      if (prop === "length") {
        if (isPy) return "len(" + obj + ")";
        return obj + ".size()";
      }
      return obj + "." + prop;
    }
    return obj + "[" + expr(node.property, 16) + "]";
  }

  function callExpr(node) {
    // console.log(...)
    if (
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.object.type === "Identifier" &&
      node.callee.object.name === "console" &&
      node.callee.property.name === "log"
    ) {
      counts.outputs += 1;
      if (isPy) {
        let args = [];
        for (let ii = 0; ii < node.arguments.length; ++ii) {
          let a = node.arguments[ii];
          if (a.type === "SpreadElement") {
            return unsupportedExpr("spread arguments to console.log", "CallExpression");
          }
          if (a.type === "Literal" && a.value === null) {
            args.push('"null"');
          } else if (a.type === "Literal" && typeof a.value === "boolean") {
            args.push(a.value ? '"true"' : '"false"');
          } else if (inferType(a, ctx) === "bool") {
            args.push('("true" if ' + expr(a, 16) + ' else "false")');
          } else if (inferType(a, ctx) === "double") {
            // print() uses str(), which formats 1e16 as "1e+16"
            // where JS prints "10000000000000000".
            needs.jsnum = true;
            args.push("__iroh_jsnum(" + expr(a, 16) + ")");
          } else {
            args.push(expr(a, 16));
          }
        }
        return "print(" + args.join(", ") + ")";
      }
      // C++ console.log is emitted as statements, not an expression.
      return unsupportedExpr(
        "console.log used as an expression (C++ emits it as statements)",
        "CallExpression"
      );
    }
    // Math.* / parseInt / String / Number
    if (node.callee.type === "MemberExpression" && !node.callee.computed &&
        node.callee.object.type === "Identifier" && node.callee.object.name === "Math") {
      let prop = node.callee.property.name;
      let mathFns = { floor: 1, ceil: 1, round: 1, trunc: 1, sqrt: 1, abs: 1, pow: 1, max: 1, min: 1 };
      if (prop === "random") {
        return unsupportedExpr("Math.random() has no deterministic equivalent in v1", "CallExpression");
      }
      if (!mathFns[prop]) {
        return unsupportedExpr("Math." + prop + " is not in the v1 scope", "CallExpression");
      }
      let args = node.arguments.map(function(a) { return expr(a, 16); }).join(", ");
      if (isPy) {
        // Python's math module has no max/min/round/abs — those are
        // builtins. Math.pow becomes `**` (math.pow returns a float,
        // JS Math.pow(2, 3) is 8). Math.round is banker's rounding in
        // Python but half-up in JS, so it is emulated, not mapped.
        if (prop === "max" || prop === "min" || prop === "abs") {
          return prop + "(" + args + ")";
        }
        if (prop === "pow") {
          if (node.arguments.length !== 2) {
            return unsupportedExpr("Math.pow with " + node.arguments.length + " argument(s) (v1 supports exactly 2)", "CallExpression");
          }
          return "(" + node.arguments.map(function(a) { return expr(a, 16); }).join(" ** ") + ")";
        }
        if (prop === "round") {
          if (node.arguments.length !== 1) {
            return unsupportedExpr("Math.round with " + node.arguments.length + " argument(s) (v1 supports exactly 1)", "CallExpression");
          }
          needs.math = true;
          noteOnce(
            "math-round",
            "Math.round is emulated as math.floor(x + 0.5) — Python's round() is banker's rounding, JS rounds half up."
          );
          return "math.floor(" + args + " + 0.5)";
        }
        needs.math = true;
        return "math." + prop + "(" + args + ")";
      }
      needs.cmath = true;
      if (prop === "max" || prop === "min") needs.algorithm = true;
      return "std::" + prop + "(" + args + ")";
    }
    if (node.callee.type === "Identifier") {
      let name = node.callee.name;
      if (name === "parseInt") {
        if (isPy) return "int(" + expr(node.arguments[0], 16) + ")";
        return "std::stoi(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "parseFloat") {
        if (isPy) return "float(" + expr(node.arguments[0], 16) + ")";
        return "std::stod(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "String") {
        if (isPy) {
          let at = inferType(node.arguments[0], ctx);
          if (at === "double") {
            // str() formats 1e16 as "1e+16"; JS prints "10000000000000000".
            needs.jsnum = true;
            return "__iroh_jsnum(" + expr(node.arguments[0], 16) + ")";
          }
          if (at === "bool") {
            // str(True) is "True"; JS String(true) is "true".
            return '("true" if ' + expr(node.arguments[0], 16) + ' else "false")';
          }
          if (at && at.indexOf("std::vector<") === 0) {
            return unsupportedExpr(
              "String() of an array in Python (JS joins with commas; Python str() prints brackets)",
              "CallExpression"
            );
          }
          return "str(" + expr(node.arguments[0], 16) + ")";
        }
        // std::to_string prints doubles with 6 decimals ("1.500000"),
        // unlike JS String(1.5) ("1.5") — route doubles through the
        // JS number formatter. std::to_string(true) is "1", not
        // "true" — bools get the ternary. Ints and strings keep
        // std::to_string.
        if (inferType(node.arguments[0], ctx) === "double") {
          needs.jsnum = true;
          return "__iroh_jsnum(" + expr(node.arguments[0], 16) + ")";
        }
        if (inferType(node.arguments[0], ctx) === "bool") {
          return "std::string(((" + expr(node.arguments[0], 16) + ') ? "true" : "false"))';
        }
        return "std::to_string(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "Number") {
        if (isPy) return "float(" + expr(node.arguments[0], 16) + ")";
        return "std::stod(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "Boolean") {
        if (isPy) return "bool(" + expr(node.arguments[0], 16) + ")";
        return unsupportedExpr("Boolean() has no direct C++ equivalent in v1", "CallExpression");
      }
      let args = [];
      for (let ii = 0; ii < node.arguments.length; ++ii) {
        let a = node.arguments[ii];
        if (a.type === "SpreadElement") {
          return unsupportedExpr("spread arguments", "CallExpression");
        }
        args.push(expr(a, 16));
      }
      return name + "(" + args.join(", ") + ")";
    }
    // Member calls: arr.push(x), str.toUpperCase(), ...
    if (node.callee.type === "MemberExpression") {
      let prop = node.callee.computed
        ? null
        : (node.callee.property.name !== void 0 ? node.callee.property.name : node.callee.property.value);
      // process.exit(code): the program ends. It only ever reaches
      // this emitter from a BASIC END/STOP (the BASIC leg emits it)
      // or from user JS calling it directly. Python gets sys.exit
      // (with an import), C++ gets std::exit (with <cstdlib>) — both
      // end the program in any context, so code after the call stays
      // unreachable exactly as in the source. No arg means code 0.
      if (node.callee.object.type === "Identifier" && node.callee.object.name === "process" && prop === "exit") {
        let code = node.arguments.length > 0 ? expr(node.arguments[0], 16) : "0";
        if (isPy) {
          needs.sysexit = true;
          return "sys.exit(" + code + ")";
        }
        needs.cstdlib = true;
        return "std::exit(" + code + ")";
      }
      let obj = expr(node.callee.object, 15);
      if (prop === "push") {
        let args = node.arguments.map(function(a) { return expr(a, 16); }).join(", ");
        if (isPy) return obj + ".append(" + args + ")";
        return obj + ".push_back(" + args + ")";
      }
      if (prop === "toUpperCase") {
        if (isPy) return obj + ".upper()";
        return unsupportedExpr("String.toUpperCase() has no stdlib one-liner in C++ v1", "CallExpression");
      }
      if (prop === "toLowerCase") {
        if (isPy) return obj + ".lower()";
        return unsupportedExpr("String.toLowerCase() has no stdlib one-liner in C++ v1", "CallExpression");
      }
      return unsupportedExpr("method call ." + prop + " is not in the v1 scope", "CallExpression");
    }
    return unsupportedExpr("call of computed or unusual callee", "CallExpression");
  }

  function binaryExpr(node, parentPrec) {
    let op = node.operator;
    if (op === "instanceof" || op === "in") {
      return unsupportedExpr("operator " + op + " is not in the v1 scope", "BinaryExpression");
    }
    if (op === "**") {
      if (isPy) {
        return paren(expr(node.left, 13), node.left, 13) + " ** " + paren(expr(node.right, 13), node.right, 13);
      }
      needs.cmath = true;
      return "std::pow(" + expr(node.left, 16) + ", " + expr(node.right, 16) + ")";
    }
    if (op === "%") {
      if (isPy) {
        // JS % is the truncated remainder; Python % is floored (it
        // takes the divisor's sign). math.fmod has the right sign but
        // returns a float, which would print "-2.0" where JS prints
        // "-2" — so use the truncating identity through a helper,
        // which keeps ints int and floats float.
        needs.jsmod = true;
        return "__iroh_jsmod(" + expr(node.left, 16) + ", " + expr(node.right, 16) + ")";
      }
      // C++ % is truncated like JS, but only for integers — % on
      // doubles does not compile. Route double operands through
      // std::fmod (also truncated, so the semantics match).
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      if (lt === "double" || rt === "double") {
        needs.cmath = true;
        return "std::fmod(" + expr(node.left, 16) + ", " + expr(node.right, 16) + ")";
      }
    }
    let outOp = op;
    if (op === "===") outOp = "==";
    else if (op === "!==") outOp = "!=";
    else if (op === "&&") outOp = isPy ? "and" : "&&";
    else if (op === "||") outOp = isPy ? "or" : "||";
    let myPrec = precedence(node);
    if (isPy && op === "+") {
      // String concatenation: either side a string (or a string
      // literal) makes the whole `+` a concat. Python refuses str +
      // number at runtime, so route non-strings through pyStringOf.
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      let leftIsStr = lt === "std::string" || (node.left.type === "Literal" && typeof node.left.value === "string");
      let rightIsStr = rt === "std::string" || (node.right.type === "Literal" && typeof node.right.value === "string");
      if (leftIsStr || rightIsStr) {
        return pyStringOf(node.left) + " + " + pyStringOf(node.right);
      }
    }
    if (!isPy && op === "+") {
      // String concatenation: either side a string (or a string
      // literal) makes the whole `+` a concat. A literal on its own
      // is const char*, so `"a" + 1` would compile as pointer
      // arithmetic — route everything through cppStringOf, which
      // wraps literals and bool ternaries in std::string(...).
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      let leftIsStr = lt === "std::string" || (node.left.type === "Literal" && typeof node.left.value === "string");
      let rightIsStr = rt === "std::string" || (node.right.type === "Literal" && typeof node.right.value === "string");
      if (leftIsStr || rightIsStr) {
        return cppStringOf(node.left) + " + " + cppStringOf(node.right);
      }
    }
    return (
      paren(expr(node.left, myPrec), node.left, myPrec) +
      " " + outOp + " " +
      paren(expr(node.right, myPrec), node.right, myPrec)
    );
  }

  function expr(node, parentPrec) {
    parentPrec = parentPrec === void 0 ? 0 : parentPrec;
    if (!node || typeof node.type !== "string") {
      return unsupportedExpr("missing expression", "Expression");
    }
    switch (node.type) {
      case "Literal":
        return literalValue(node);
      case "Identifier": {
        if (node.name === "undefined") {
          return unsupportedExpr("undefined has no equivalent in v1", "Identifier");
        }
        return node.name;
      }
      case "ArrayExpression": {
        if (node.elements.length === 0) {
          if (!isPy) {
            return unsupportedExpr(
              "empty array literal needs an element type in C++ (give a trace or a type hint)",
              "ArrayExpression"
            );
          }
          return "[]";
        }
        let parts = [];
        for (let ii = 0; ii < node.elements.length; ++ii) {
          let el = node.elements[ii];
          if (el === null) {
            parts.push(isPy ? "None" : unsupportedExpr("hole in array literal", "ArrayExpression"));
          } else if (el.type === "SpreadElement") {
            return unsupportedExpr("spread in array literal", "ArrayExpression");
          } else {
            parts.push(expr(el, 16));
          }
        }
        if (isPy) return "[" + parts.join(", ") + "]";
        let elemType = inferType(node.elements[0], ctx);
        if (!elemType) {
          return unsupportedExpr(
            "array literal element type could not be determined in C++",
            "ArrayExpression"
          );
        }
        return "std::vector<" + elemType + ">{" + parts.join(", ") + "}";
      }
      case "MemberExpression":
        return memberExpr(node);
      case "CallExpression":
        return callExpr(node);
      case "BinaryExpression":
      case "LogicalExpression":
        return binaryExpr(node, parentPrec);
      case "UnaryExpression": {
        if (node.operator === "typeof" || node.operator === "void" || node.operator === "delete") {
          return unsupportedExpr("unary operator " + node.operator + " is not in the v1 scope", "UnaryExpression");
        }
        let op = node.operator === "!" && isPy ? "not " : node.operator;
        let arg = expr(node.argument, 14);
        if (precedence(node.argument) < 14) arg = "(" + arg + ")";
        return op + arg;
      }
      case "UpdateExpression": {
        if (isPy) {
          return unsupportedExpr(
            "++ / -- as an expression (Python has no increment operator; use it as a statement)",
            "UpdateExpression"
          );
        }
        let arg = expr(node.argument, 16);
        return node.prefix ? node.operator + arg : arg + node.operator;
      }
      case "AssignmentExpression": {
        let op = node.operator;
        if (op === "**=" && !isPy) {
          return unsupportedExpr("**= has no C++ equivalent in v1", "AssignmentExpression");
        }
        if ((op === "||=" || op === "&&=" || op === "??=") && isPy) {
          return unsupportedExpr("logical assignment " + op + " has no Python equivalent", "AssignmentExpression");
        }
        if (op === "||=" || op === "&&=" || op === "??=") {
          return unsupportedExpr("logical assignment " + op + " has no C++ equivalent", "AssignmentExpression");
        }
        if (op === "<<=" || op === ">>=" || op === "&=" || op === "|=" || op === "^=") {
          // Exists in both languages.
        }
        let left = expr(node.left, 1);
        let right = expr(node.right, 1);
        return left + " " + op + " " + right;
      }
      case "ConditionalExpression": {
        if (isPy) {
          return expr(node.consequent, 2) + " if " + expr(node.test, 2) + " else " + expr(node.alternate, 2);
        }
        return expr(node.test, 2) + " ? " + expr(node.consequent, 2) + " : " + expr(node.alternate, 2);
      }
      case "TemplateLiteral":
        return templateLiteral(node);
      case "SequenceExpression": {
        if (isPy) {
          return unsupportedExpr("comma (sequence) expressions have no Python equivalent", "SequenceExpression");
        }
        let parts = node.expressions.map(function(e) { return expr(e, 16); });
        return "(" + parts.join(", ") + ")";
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return unsupportedExpr(
          "function value in expression position (v1 translates functions declared as statements only)",
          node.type
        );
      case "AwaitExpression":
      case "YieldExpression":
      case "NewExpression":
      case "ObjectExpression":
      case "ClassExpression":
      case "TaggedTemplateExpression":
        return unsupportedExpr(node.type + " is not in the v1 scope", node.type);
      default:
        return unsupportedExpr("expression " + node.type + " is not in the v1 scope", node.type);
    }
  }

  function paramList(params) {
    let out = [];
    for (let ii = 0; ii < params.length; ++ii) {
      let p = params[ii];
      if (p.type === "Identifier") {
        out.push(p.name);
      } else if (p.type === "AssignmentPattern") {
        out.push(p.left.name + " = " + expr(p.right, 16));
      } else if (p.type === "RestElement") {
        out.push(unsupportedExpr("rest parameters are not in the v1 scope", "RestElement"));
      } else {
        out.push(unsupportedExpr("parameter pattern is not in the v1 scope", p.type));
      }
    }
    return out;
  }

  // C++ signature for a function: { params: ["int n", ...], ret: "int" }.
  // Param types come from trace evidence, then type hints; return type
  // from static inference over the return values, then trace evidence,
  // then hints. A function with no value-return is void. Anything
  // untypeable is reported unsupported and the signature is null.
  function cppSignature(fnNode, fnName) {
    let sig = { params: [], ret: null };
    let traceFn = ctx.funcs[fnName];
    let paramsFromTrace = false;
    for (let ii = 0; ii < fnNode.params.length; ++ii) {
      let p = fnNode.params[ii];
      let pname = p.type === "Identifier" ? p.name : (p.left && p.left.name) || "?";
      let def = p.type === "AssignmentPattern" ? " = " + expr(p.right, 16) : "";
      let t = null;
      if (traceFn && traceFn.params && traceFn.params[ii]) {
        t = traceFn.params[ii];
        if (traceFn.paramsFrom === "trace") paramsFromTrace = true;
      }
      if (!t && hints && hints.functions && hints.functions[fnName] && hints.functions[fnName].params) {
        t = hints.functions[fnName].params[ii] || null;
      }
      if (!t) {
        markUnsupported(
          report,
          "FunctionDeclaration",
          "C++ parameter '" + pname + "' of '" + fnName +
            "' has no type: the function was never called in the trace and no type hint was given (pass types in options.types)"
        );
        return null;
      }
      // A conflict recorded across calls (trace types only — a hint
      // fills gaps but never overrides trace evidence, so it cannot
      // rescue a conflict). One C++ signature cannot cover two types.
      if (traceFn && traceFn.paramsFrom === "trace" && traceFn.paramsConflict) {
        for (let ci = 0; ci < traceFn.paramsConflict.length; ++ci) {
          let c = traceFn.paramsConflict[ci];
          if (c.index === ii) {
            markUnsupported(
              report,
              "FunctionDeclaration",
              "C++ parameter '" + pname + "' of '" + fnName + "' was called with conflicting types (" + c.first + " in the first call, " + c.other + " in call " + (c.call + 1) + ") — one C++ signature cannot cover both; split the function into one per argument type (a type hint cannot override trace evidence)"
            );
            return null;
          }
        }
      }
      sig.params.push(t + " " + pname + def);
    }
    if (paramsFromTrace) {
      let callCount = (traceFn && traceFn.callCount) || 1;
      recordAssumption(
        report,
        "parameter types of '" + fnName + "' (" + sig.params.join(", ") + ") taken from the trace (verified consistent across " + callCount + " call" + (callCount === 1 ? "" : "s") + ")",
        "FUNCTION_CALL '" + fnName + "' arguments " + JSON.stringify(traceFn.args || [])
      );
    }
    let ret = null;
    let retFromTrace = false;
    if (hints && hints.functions && hints.functions[fnName] && hints.functions[fnName].returns) {
      ret = hints.functions[fnName].returns;
    }
    if (!ret) {
      let rets = [];
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) {
          for (let ii = 0; ii < n.length; ++ii) walk(n[ii]);
          return;
        }
        if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
          return; // do not descend into nested functions
        }
        if (n.type === "ReturnStatement" && n.argument) rets.push(n.argument);
        let keys = Object.keys(n);
        for (let ii = 0; ii < keys.length; ++ii) walk(n[keys[ii]]);
      })(fnNode.body);
      if (rets.length === 0) {
        ret = "void";
      } else {
        let types = [];
        for (let ii = 0; ii < rets.length; ++ii) types.push(inferType(rets[ii], ctx));
        let first = types[0];
        let allSame = first !== null;
        for (let ii = 1; ii < types.length; ++ii) {
          if (types[ii] !== first) allSame = false;
        }
        if (allSame) ret = first;
        else if (traceFn && traceFn.returns) {
          // Conflicting return types across calls refuse, like params.
          if (traceFn.returnsConflict) {
            markUnsupported(
              report,
              "FunctionDeclaration",
              "C++ return type of '" + fnName + "' differs across calls (" + traceFn.returnsConflict.first + " in the first call, " + traceFn.returnsConflict.other + " in call " + (traceFn.returnsConflict.call + 1) + ") — one C++ signature cannot cover both; split the function into one per argument type (a type hint cannot override trace evidence)"
            );
            return null;
          }
          ret = traceFn.returns;
          if (traceFn.returnsFrom === "trace") retFromTrace = true;
        }
      }
    }
    if (retFromTrace) {
      let returnCount = (traceFn && traceFn.returnCount) || 1;
      recordAssumption(
        report,
        "return type of '" + fnName + "' (" + ret + ") taken from the trace (verified consistent across " + returnCount + " return" + (returnCount === 1 ? "" : "s") + ")",
        "FUNCTION_RETURN '" + fnName + "' value " + JSON.stringify(traceFn.returnValue)
      );
    }
    if (!ret) {
      markUnsupported(
        report,
        "FunctionDeclaration",
        "C++ return type of '" + fnName +
          "' could not be determined from the return values, the trace, or a type hint"
      );
      return null;
    }
    sig.ret = ret;
    return sig;
  }

  // Emit a function body (a BlockStatement's statements) at the
  // current indent. An empty body gets `pass` (Python) / nothing (C++
  // braces are emitted by the caller).
  function emitBody(block) {
    if (!block || block.body.length === 0) {
      if (isPy) emitLine("pass");
      return;
    }
    indentLevel += 1;
    for (let ii = 0; ii < block.body.length; ++ii) stmt(block.body[ii]);
    indentLevel -= 1;
  }

  function emitFunction(fnNode, fnName) {
    counts.functions += 1;
    if (isPy) {
      let params = paramList(fnNode.params);
      emitLine("def " + fnName + "(" + params.join(", ") + "):");
      emitBody(fnNode.body);
      return;
    }
    let sig = cppSignature(fnNode, fnName);
    if (!sig) {
      // Untypeable: emit a throwing stub so the gap is loud, not silent.
      emitLine("auto " + fnName + " = " + stubExpr("function '" + fnName + "' could not be typed for C++") + ";");
      return;
    }
    emitLine(sig.ret + " " + fnName + "(" + sig.params.join(", ") + ") {");
    emitBody(fnNode.body);
    emitLine("}");
  }

  function forLoopPattern(node) {
    // Classic numeric for: for (let i = A; i <op> B; update), or
    // for (i = A; i <op> B; update) with i declared earlier (the
    // BASIC leg emits the second form so the loop variable stays
    // visible after the loop, the way BASIC scoping works).
    let name = null;
    let start = null;
    if (node.init && node.init.type === "VariableDeclaration") {
      if (node.init.declarations.length !== 1) return null;
      let decl = node.init.declarations[0];
      if (decl.id.type !== "Identifier" || !decl.init) return null;
      name = decl.id.name;
      start = decl.init;
    } else if (node.init && node.init.type === "AssignmentExpression" && node.init.operator === "=" && node.init.left.type === "Identifier") {
      name = node.init.left.name;
      start = node.init.right;
    } else return null;
    if (!node.test || node.test.type !== "BinaryExpression") return null;
    let test = node.test;
    if (test.left.type !== "Identifier" || test.left.name !== name) return null;
    if (["<", "<=", ">", ">="].indexOf(test.operator) === -1) return null;
    let step = null;
    let upd = node.update;
    if (!upd) return null;
    if (upd.type === "UpdateExpression" && upd.argument.type === "Identifier" && upd.argument.name === name) {
      step = upd.operator === "++" ? 1 : -1;
    } else if (upd.type === "AssignmentExpression" && upd.left.type === "Identifier" && upd.left.name === name) {
      if (upd.operator === "+=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = upd.right.value;
      else if (upd.operator === "-=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = -upd.right.value;
      else return null;
    } else return null;
    return { name: name, start: start, op: test.operator, end: test.right, step: step };
  }

  function stmt(node) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "BlockStatement": {
        if (isPy) {
          for (let ii = 0; ii < node.body.length; ++ii) stmt(node.body[ii]);
        } else {
          emitLine("{");
          indentLevel += 1;
          for (let ii = 0; ii < node.body.length; ++ii) stmt(node.body[ii]);
          indentLevel -= 1;
          emitLine("}");
        }
        return;
      }
      case "VariableDeclaration": {
        for (let ii = 0; ii < node.declarations.length; ++ii) {
          let d = node.declarations[ii];
          counts.variables += 1;
          if (d.id.type !== "Identifier") {
            unsupportedStmt("destructuring declaration is not in the v1 scope", "VariableDeclaration");
            continue;
          }
          // Arrow function assigned to a variable: emit as a function.
          if (d.init && d.init.type === "ArrowFunctionExpression") {
            let fnNode = {
              type: "FunctionDeclaration",
              id: d.id,
              params: d.init.params,
              body: d.init.body.type === "BlockStatement"
                ? d.init.body
                : { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: d.init.body }] },
            };
            emitFunction(fnNode, d.id.name);
            continue;
          }
          if (isPy) {
            emitLine(d.id.name + " = " + (d.init ? expr(d.init, 16) : "None"));
          } else if (!d.init) {
            let t = ctx.vars[d.id.name] || null;
            if (!t) {
              markUnsupported(
                report,
                "VariableDeclaration",
                "C++ variable '" + d.id.name + "' declared without an initializer and no type evidence (no later assignment in the trace, no type hint)"
              );
              emitLine(stubStmt("variable '" + d.id.name + "' could not be typed for C++"));
            } else {
              emitLine(t + " " + d.id.name + ";");
            }
          } else if (d.init.type === "ArrayExpression") {
            let elemType = d.init.elements.length > 0 ? inferType(d.init.elements[0], ctx) : null;
            if (!elemType && ctx.vars[d.id.name]) {
              let vt = ctx.vars[d.id.name];
              let m = /^std::vector<(.+)>$/.exec(vt);
              if (m) elemType = m[1];
            }
            if (!elemType) {
              markUnsupported(
                report,
                "VariableDeclaration",
                "C++ array '" + d.id.name + "' element type could not be determined"
              );
              emitLine(stubStmt("array '" + d.id.name + "' could not be typed for C++"));
            } else {
              let parts = [];
              for (let jj = 0; jj < d.init.elements.length; ++jj) {
                parts.push(expr(d.init.elements[jj], 16));
              }
              emitLine("std::vector<" + elemType + "> " + d.id.name + " = {" + parts.join(", ") + "};");
            }
          } else {
            // `auto` deduces a string literal as const char*, which
            // breaks `+` concatenation — declare strings (and
            // vectors) with their real type.
            let t = inferType(d.init, ctx);
            if (t) ctx.vars[d.id.name] = t;
            let kind;
            if (t === "std::string") {
              kind = node.kind === "const" ? "const std::string " : "std::string ";
            } else if (t && t.indexOf("std::vector<") === 0) {
              kind = t + " ";
            } else {
              kind = node.kind === "const" ? "const auto " : "auto ";
            }
            emitLine(kind + d.id.name + " = " + expr(d.init, 16) + ";");
          }
        }
        return;
      }
      case "FunctionDeclaration": {
        emitFunction(node, node.id.name);
        return;
      }
      case "ReturnStatement": {
        if (isPy) emitLine(node.argument ? "return " + expr(node.argument, 16) : "return");
        else emitLine(node.argument ? "return " + expr(node.argument, 16) + ";" : "return;");
        return;
      }
      case "ExpressionStatement": {
        // console.log as a C++ statement: several cout lines.
        if (
          !isPy &&
          node.expression.type === "CallExpression" &&
          node.expression.callee.type === "MemberExpression" &&
          !node.expression.callee.computed &&
          node.expression.callee.object.type === "Identifier" &&
          node.expression.callee.object.name === "console" &&
          node.expression.callee.property.name === "log"
        ) {
          counts.outputs += 1;
          needs.cout = true;
          let args = node.expression.arguments;
          if (args.length === 0) {
            emitLine("std::cout << std::endl;");
            return;
          }
          for (let ii = 0; ii < args.length; ++ii) {
            let a = args[ii];
            if (a.type === "SpreadElement") {
              unsupportedStmt("spread arguments to console.log", "CallExpression");
              return;
            }
            let piece;
            if (a.type === "Literal" && a.value === null) piece = '"null"';
            else if (a.type === "Literal" && typeof a.value === "boolean") piece = a.value ? '"true"' : '"false"';
            else if (inferType(a, ctx) === "bool") piece = "((" + expr(a, 16) + ') ? "true" : "false")';
            else if (inferType(a, ctx) === "double") {
              // std::cout defaults to 6 significant digits ("0.3"
              // for 0.1 + 0.2); JS prints "0.30000000000000004".
              needs.jsnum = true;
              piece = "__iroh_jsnum(" + expr(a, 16) + ")";
            }
            else if (a.type === "ArrayExpression" || (inferType(a, ctx) || "").indexOf("std::vector<") === 0) {
              needs.vectorHelper = true;
              piece = null;
              emitLine("__iroh_print_vec(" + expr(a, 16) + ");");
            } else piece = expr(a, 16);
            if (piece !== null && piece !== void 0) {
              emitLine("std::cout << " + piece + ";");
            }
            if (ii < args.length - 1) emitLine('std::cout << " ";');
          }
          emitLine("std::cout << std::endl;");
          return;
        }
        let e = node.expression;
        if (isPy && e.type === "UpdateExpression") {
          emitLine(expr(e.argument, 16) + (e.operator === "++" ? " += 1" : " -= 1"));
          return;
        }
        if (isPy) {
          let s = expr(e, 16);
          // console.log in Python is a single print() expression.
          emitLine(s);
        } else {
          emitLine(expr(e, 16) + ";");
        }
        return;
      }
      case "IfStatement": {
        counts.conditionals += 1;
        if (isPy) {
          emitLine("if " + expr(node.test, 16) + ":");
          emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { type: "BlockStatement", body: [node.consequent] });
          let alt = node.alternate;
          while (alt) {
            if (alt.type === "IfStatement") {
              emitLine("elif " + expr(alt.test, 16) + ":");
              emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { type: "BlockStatement", body: [alt.consequent] });
              alt = alt.alternate;
            } else {
              emitLine("else:");
              emitBody(alt.type === "BlockStatement" ? alt : { type: "BlockStatement", body: [alt] });
              alt = null;
            }
          }
        } else {
          emitLine("if (" + expr(node.test, 16) + ") {");
          emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { type: "BlockStatement", body: [node.consequent] });
          emitLine("}");
          let alt = node.alternate;
          if (alt) {
            if (alt.type === "IfStatement") {
              // else-if: emit as `} else if (...) {` — simplest is to
              // re-enter with the alternate as an if, on the else line.
              lines[lines.length - 1] = indentStr() + "} else if (" + expr(alt.test, 16) + ") {";
              emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { type: "BlockStatement", body: [alt.consequent] });
              emitLine("}");
              if (alt.alternate) {
                lines[lines.length - 1] = indentStr() + "} else {";
                emitBody(alt.alternate.type === "BlockStatement" ? alt.alternate : { type: "BlockStatement", body: [alt.alternate] });
                emitLine("}");
              }
            } else {
              lines[lines.length - 1] = indentStr() + "} else {";
              emitBody(alt.type === "BlockStatement" ? alt : { type: "BlockStatement", body: [alt] });
              emitLine("}");
            }
          }
        }
        return;
      }
      case "ForStatement": {
        counts.loops += 1;
        if (isPy) {
          let pat = forLoopPattern(node);
          if (!pat) {
            unsupportedStmt("for loop is not a simple numeric loop (v1 supports for (let i = A; i <op> B; i++/i--/i+=k))", "ForStatement");
            return;
          }
          let start = expr(pat.start, 16);
          let end = expr(pat.end, 16);
          let rangeArgs = start + ", " + end;
          if (pat.op === "<=") rangeArgs = start + ", " + end + " + 1";
          else if (pat.op === ">=") rangeArgs = start + ", " + end + " - 1";
          if (pat.step !== 1 && pat.step !== -1) rangeArgs += ", " + pat.step;
          else if (pat.op === ">" || pat.op === ">=") rangeArgs += ", -1";
          emitLine("for " + pat.name + " in range(" + rangeArgs + "):");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        } else {
          let init = "";
          if (node.init) {
            if (node.init.type === "VariableDeclaration") {
              if (node.init.declarations.length !== 1) {
                unsupportedStmt("for loop with multiple init declarations (v1 supports one)", "ForStatement");
                return;
              }
              let d = node.init.declarations[0];
              if (!d.init) {
                unsupportedStmt("for loop with an uninitialised init variable", "ForStatement");
                return;
              }
              init = "auto " + d.id.name + " = " + expr(d.init, 16);
            } else init = expr(node.init, 16);
          }
          emitLine("for (" + init + "; " + (node.test ? expr(node.test, 16) : "") + "; " + (node.update ? expr(node.update, 16) : "") + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "ForOfStatement": {
        counts.loops += 1;
        let target = node.left.declarations ? node.left.declarations[0].id.name : (node.left.name || "?");
        if (isPy) {
          emitLine("for " + target + " in " + expr(node.right, 16) + ":");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        } else {
          emitLine("for (auto " + target + " : " + expr(node.right, 16) + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "ForInStatement":
        unsupportedStmt("for-in loops are not in the v1 scope", "ForInStatement");
        return;
      case "WhileStatement": {
        counts.loops += 1;
        if (isPy) {
          emitLine("while " + expr(node.test, 16) + ":");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        } else {
          emitLine("while (" + expr(node.test, 16) + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "DoWhileStatement": {
        counts.loops += 1;
        if (isPy) {
          emitLine("while True:");
          indentLevel += 1;
          let body = node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] };
          for (let ii = 0; ii < body.body.length; ++ii) stmt(body.body[ii]);
          emitLine("if not (" + expr(node.test, 16) + "):");
          indentLevel += 1;
          emitLine("break");
          indentLevel -= 2;
        } else {
          emitLine("do {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("} while (" + expr(node.test, 16) + ");");
        }
        return;
      }
      case "SwitchStatement": {
        counts.conditionals += 1;
        if (isPy) {
          // Only when every case ends with break/return/throw (no
          // fallthrough — Python has no fallthrough to mirror it with).
          let ok = true;
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            if (c.consequent.length === 0) { ok = false; break; }
            let last = c.consequent[c.consequent.length - 1];
            if (last.type !== "BreakStatement" && last.type !== "ReturnStatement" && last.type !== "ThrowStatement") {
              ok = false;
              break;
            }
          }
          if (!ok) {
            unsupportedStmt("switch with fallthrough cannot be translated to Python (no fallthrough in if/elif chains)", "SwitchStatement");
            return;
          }
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            let kw = ii === 0 ? "if" : "elif";
            if (c.test === null) {
              emitLine("else:");
            } else {
              emitLine(kw + " " + expr(node.discriminant, 16) + " == " + expr(c.test, 16) + ":");
            }
            indentLevel += 1;
            for (let jj = 0; jj < c.consequent.length; ++jj) {
              if (c.consequent[jj].type === "BreakStatement") continue; // no break in if/elif chains
              stmt(c.consequent[jj]);
            }
            indentLevel -= 1;
          }
        } else {
          emitLine("switch (" + expr(node.discriminant, 16) + ") {");
          indentLevel += 1;
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            if (c.test === null) emitLine("default:");
            else emitLine("case " + expr(c.test, 16) + ":");
            indentLevel += 1;
            for (let jj = 0; jj < c.consequent.length; ++jj) stmt(c.consequent[jj]);
            indentLevel -= 1;
          }
          indentLevel -= 1;
          emitLine("}");
        }
        return;
      }
      case "TryStatement": {
        if (isPy) {
          emitLine("try:");
          emitBody(node.block);
          if (node.handler) {
            if (node.handler.param) emitLine("except Exception as " + node.handler.param.name + ":");
            else emitLine("except Exception:");
            emitBody(node.handler.body);
          }
          if (node.finalizer) {
            emitLine("finally:");
            emitBody(node.finalizer);
          }
        } else {
          if (node.finalizer) {
            unsupportedStmt("try/finally has no C++ equivalent in v1 (C++ has no finally)", "TryStatement");
            return;
          }
          emitLine("try {");
          emitBody(node.block);
          emitLine("}");
          if (node.handler) {
            if (node.handler.param) emitLine("catch (const std::exception& " + node.handler.param.name + ") {");
            else emitLine("catch (const std::exception&) {");
            emitBody(node.handler.body);
            emitLine("}");
          }
        }
        return;
      }
      case "ThrowStatement": {
        if (node.argument && node.argument.type === "Literal" && typeof node.argument.value === "string") {
          if (isPy) emitLine("raise Exception(" + JSON.stringify(node.argument.value) + ")");
          else emitLine("throw std::runtime_error(" + JSON.stringify(node.argument.value) + ");");
        } else {
          unsupportedStmt("throw of a non-string value is not in the v1 scope", "ThrowStatement");
        }
        return;
      }
      case "BreakStatement":
        emitLine(isPy ? "break" : "break;");
        return;
      case "ContinueStatement":
        emitLine(isPy ? "continue" : "continue;");
        return;
      case "EmptyStatement":
      case "DebuggerStatement":
        return;
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        unsupportedStmt(node.type + " is not in the v1 scope (translate scripts, not modules)", node.type);
        return;
      case "ClassDeclaration":
      case "LabeledStatement":
        unsupportedStmt(node.type + " is not in the v1 scope", node.type);
        return;
      default:
        unsupportedStmt("statement " + node.type + " is not in the v1 scope", node.type);
        return;
    }
  }

  function run(ast) {
    // Hoist top-level function declarations first (JS hoisting):
    // a call before the textual declaration works in JS, so the
    // target must define the function first too.
    let fns = [];
    let rest = [];
    for (let ii = 0; ii < ast.body.length; ++ii) {
      let s = ast.body[ii];
      if (s.type === "FunctionDeclaration") fns.push(s);
      else rest.push(s);
    }
    if (isPy) {
      for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
      if (fns.length > 0 && rest.length > 0) lines.push("");
      for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
      // Imports/helpers must come first: rebuild with the header.
      let header = [];
      if (needs.math) header.push("import math");
      if (needs.random) header.push("import random");
      if (needs.sysexit) header.push("import sys");
      if (needs.jsmod) {
        // JS % is the truncated remainder; Python % is floored.
        // int(a / b) truncates toward zero, so this keeps ints int
        // and floats float, matching JS output exactly.
        header.push("def __iroh_jsmod(a, b):");
        header.push("    return a - int(a / b) * b");
        header.push("");
      }
      if (needs.jsbool) {
        // JS bool -> string: "true"/"false". A helper, not an inline
        // ternary, so the double quotes never sit inside an f-string
        // replacement field (SyntaxError on Python < 3.12, PEP 701).
        header.push("def __iroh_jsbool(v):");
        header.push("    return \"true\" if v else \"false\"");
        header.push("");
      }
      if (needs.jsnum) {
        // JS Number -> string: the shortest decimal that round-trips,
        // formatted the way JS String(v) formats it. Python repr is
        // already shortest, but it switches to exponential at 1e16
        // (JS waits until 1e21) and zero-pads exponents ("1e-07"
        // where JS prints "1e-7") — so take repr's digits and
        // exponent, then place the point per the ECMAScript
        // Number::toString rules (k = decimal exponent, n = digit
        // count): 0 < k <= n <= 21 writes the digits with the point
        // at k; n < k <= 21 appends zeros; -6 < k <= 0 writes "0."
        // with -k zeros; otherwise exponential with a bare exponent.
        header.push("def __iroh_jsnum(v):");
        header.push("    if v != v: return \"NaN\"");
        header.push("    if v == float(\"inf\"): return \"Infinity\"");
        header.push("    if v == float(\"-inf\"): return \"-Infinity\"");
        header.push("    if v == 0: return \"0\"");
        header.push("    neg = v < 0");
        header.push("    if neg: v = -v");
        header.push("    s = repr(v)");
        header.push("    if \"e\" in s:");
        header.push("        mant, exp = s.split(\"e\")");
        header.push("        k = int(exp) + 1");
        header.push("        digits = mant.replace(\".\", \"\")");
        header.push("    elif \".\" in s:");
        header.push("        ip, fp = s.split(\".\")");
        header.push("        k = len(ip)");
        header.push("        digits = ip + fp");
        header.push("    else:");
        header.push("        k = len(s)");
        header.push("        digits = s");
        header.push("    digits = digits.rstrip(\"0\") or \"0\"");
        header.push("    n = len(digits)");
        header.push("    if 0 < k <= n <= 21:");
        header.push("        out = digits[:k]");
        header.push("        if k < n: out += \".\" + digits[k:]");
        header.push("    elif n < k <= 21:");
        header.push("        out = digits + \"0\" * (k - n)");
        header.push("    elif -6 < k <= 0:");
        header.push("        out = \"0.\" + \"0\" * (-k) + digits");
        header.push("    else:");
        header.push("        out = digits[0]");
        header.push("        if n > 1: out += \".\" + digits[1:]");
        header.push("        out += \"e\" + (\"+\" if k - 1 >= 0 else \"-\") + str(abs(k - 1))");
        header.push("    return (\"-\" if neg else \"\") + out");
        header.push("");
      }
      if (needs.unsupportedHelper) {
        header.push("def _iroh_unsupported(msg):");
        header.push("    raise NotImplementedError(\"IrohRedux: \" + msg)");
        header.push("");
      }
      return { text: header.concat(lines).join("\n") + "\n", counts: counts, needs: needs };
    }
    // C++: headers, then functions, then main(). The body is emitted
    // first (into a temp array, at indent 1) because needs.cout — set
    // by console.log statements — decides the boolalpha line that
    // must come first inside main().
    let bodyLines = [];
    let savedLines = lines;
    lines = bodyLines;
    indentLevel = 1;
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    indentLevel = 0;
    lines = savedLines;
    for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
    if (fns.length > 0) lines.push("");
    lines.push("int main() {");
    if (needs.cout) lines.push("  std::cout << std::boolalpha;");
    for (let ii = 0; ii < bodyLines.length; ++ii) lines.push(bodyLines[ii]);
    lines.push("  return 0;");
    lines.push("}");
    let header = [];
    header.push("#include <iostream>");
    header.push("#include <string>");
    header.push("#include <vector>");
    if (needs.cmath) header.push("#include <cmath>");
    if (needs.algorithm) header.push("#include <algorithm>");
    if (needs.stdexcept) header.push("#include <stdexcept>");
    if (needs.cstdlib) header.push("#include <cstdlib>");
    if (needs.vectorHelper) {
      header.push("");
      header.push("template <typename T>");
      header.push("void __iroh_print_vec(const std::vector<T>& v) {");
      header.push("  std::cout << \"[\";");
      header.push("  for (size_t i = 0; i < v.size(); ++i) {");
      header.push("    if (i) std::cout << \", \";");
      header.push("    std::cout << v[i];");
      header.push("  }");
      header.push("  std::cout << \"]\";");
      header.push("}");
    }
    if (needs.jsnum) {
      // JS Number -> string: the shortest decimal that round-trips,
      // formatted the way JS String(v) formats it. std::to_string
      // prints 6 decimals and std::cout defaults to 6 significant
      // digits, neither of which matches JS — so find the shortest
      // digits that round-trip (via %e at increasing precision),
      // then place the point per the ECMAScript Number::toString
      // rules (k = decimal exponent, n = digit count): k <= n <= 21
      // writes the digits with the point at k; n < k <= 21 appends
      // zeros; -6 < k <= 0 writes "0." with -k zeros; otherwise
      // exponential with a bare exponent ("1e+21", "1e-7").
      header.push("");
      // __iroh_jsnum uses std::isnan / std::isinf, so it needs
      // <cmath> — but only if the main header did not already emit it
      // (a program that both uses Math and prints a Number used to get
      // the include twice).
      if (!needs.cmath) header.push("#include <cmath>");
      header.push("#include <cstdio>");
      header.push("#include <sstream>");
      header.push("std::string __iroh_jsnum(double v) {");
      header.push("  if (std::isnan(v)) return \"NaN\";");
      header.push("  if (std::isinf(v)) return v > 0 ? \"Infinity\" : \"-Infinity\";");
      header.push("  if (v == 0) return \"0\";");
      header.push("  bool neg = v < 0;");
      header.push("  if (neg) v = -v;");
      header.push("  std::string digits;");
      header.push("  int k = 0;");
      header.push("  char buf[64];");
      header.push("  for (int p = 1; p <= 17; ++p) {");
      header.push("    std::snprintf(buf, sizeof(buf), \"%.*e\", p - 1, v);");
      header.push("    std::string s(buf);");
      header.push("    size_t epos = s.find('e');");
      header.push("    int e = std::stoi(s.substr(epos + 1));");
      header.push("    std::string d;");
      header.push("    d += s[0];");
      header.push("    size_t dot = s.find('.');");
      header.push("    if (dot != std::string::npos) {");
      header.push("      for (size_t j = dot + 1; j < epos; ++j) d += s[j];");
      header.push("    }");
      header.push("    while (d.size() > 1 && d[d.size() - 1] == '0') d.pop_back();");
      header.push("    if (std::stod(s) == v) { digits = d; k = e + 1; break; }");
      header.push("  }");
      header.push("  if (digits.empty()) { std::ostringstream os; os << v; return os.str(); }");
      header.push("  int n = (int)digits.size();");
      header.push("  std::string out = neg ? \"-\" : \"\";");
      header.push("  if (k > 0 && k <= n && n <= 21) {");
      header.push("    out += digits.substr(0, k);");
      header.push("    if (k < n) { out += \".\"; out += digits.substr(k); }");
      header.push("  } else if (n < k && k <= 21) {");
      header.push("    out += digits;");
      header.push("    for (int i = 0; i < k - n; ++i) out += \"0\";");
      header.push("  } else if (k > -6 && k <= 0) {");
      header.push("    out += \"0.\";");
      header.push("    for (int i = 0; i < -k; ++i) out += \"0\";");
      header.push("    out += digits;");
      header.push("  } else {");
      header.push("    out += digits.substr(0, 1);");
      header.push("    if (n > 1) { out += \".\"; out += digits.substr(1); }");
      header.push("    out += \"e\";");
      header.push("    out += (k - 1 >= 0 ? \"+\" : \"-\");");
      header.push("    out += std::to_string(k - 1 >= 0 ? k - 1 : -(k - 1));");
      header.push("  }");
      header.push("  return out;");
      header.push("}");
    }
    header.push("");
    return { text: header.concat(lines).join("\n") + "\n", counts: counts, needs: needs };
  }

  return { run: run, counts: counts };
}

// ------------------------------------------------------------------
// JavaScript-out translation (translateFromJS)
// ------------------------------------------------------------------

function translateFromJS(iroh, code, to, options) {
  let report = newReport("javascript", to, false);
  let ast = null;
  try {
    ast = parse(code);
  } catch (e) {
    if (
      e instanceof SyntaxError &&
      (e.message.indexOf("may appear only with 'sourceType: module'") !== -1 ||
        e.message.indexOf("outside a module") !== -1)
    ) {
      try {
        ast = parse(code, { sourceType: "module" });
      } catch (e2) {
        throw e;
      }
    } else {
      throw e;
    }
  }
  // Dynamic evidence: run the program through the tracer (best
  // effort — a program that throws, awaits, or imports still
  // translates statically, and the report says the evidence was
  // unavailable). 1.1.1 (M6): options.evidence: "none" skips the run
  // entirely (static-only) — for programs with side effects, or when
  // the caller does not want the program executed at all. The report
  // says so, and types come from static inference or hints only.
  let evidenceMode = options.evidence === void 0 ? "trace" : options.evidence;
  if (evidenceMode !== "trace" && evidenceMode !== "none") {
    throw new Error("Iroh.translate: options.evidence must be 'trace' or 'none'");
  }
  let events = [];
  if (evidenceMode === "none") {
    report.notes.push("Dynamic trace evidence skipped (options.evidence: 'none'); types come from static inference or hints only.");
  } else {
  // The evidence trace must not leak the program's
  // output: translate() is a pure function, so the tracer's output
  // is silenced for the duration. Note the program's console.log
  // runs natively (the instrumenter does not rewrite it — Iroh.log
  // is only the fixtures' explicit print), so the global
  // console.log is swapped, not just Iroh.log.
  // process.exit is stubbed too, for the same reason: a translated
  // BASIC program ends with process.exit(0) (its END), and the
  // evidence trace runs the program in-process — without the stub,
  // translating a BASIC program with END killed the host process
  // silently (exit 0, no output, no error). The stub throws a
  // sentinel instead; trace() attaches the events gathered before
  // the END to the thrown error, so the evidence is kept and the
  // program ending is not mistaken for a failure. (In a browser
  // there is no process to stub, and a process.exit in the traced
  // code falls through to the evidence-unavailable path.)
  let originalLog = iroh.log;
  let originalConsoleLog = typeof console !== "undefined" ? console.log : null;
  let originalExit = (typeof process !== "undefined" && process && typeof process.exit === "function") ? process.exit : null;
  iroh.log = function() {};
  if (originalConsoleLog) console.log = function() {};
  if (originalExit) {
    process.exit = function(code) {
      let err = new Error("__iroh_end");
      err.__iroh_end = true;
      err.__iroh_exit_code = code;
      throw err;
    };
  }
  try {
    events = iroh.trace(code).events;
  } catch (e) {
    if (e && e.__iroh_end) {
      events = e.events || [];
    } else {
      report.notes.push(
        "Dynamic trace evidence unavailable (" + (e.message || String(e)) + "); types come from static inference or hints only."
      );
    }
  } finally {
    iroh.log = originalLog;
    if (originalConsoleLog) console.log = originalConsoleLog;
    if (originalExit) process.exit = originalExit;
  }
  }
  let env = buildTraceEnv(events);
  let emitter;
  if (to === "irohscript" || to === "basic") {
    emitter = makeIrohJSEmitter(to, report, env, options.types || null);
  } else {
    emitter = makeJSEmitter(to, report, env, options.types || null);
  }
  let out = emitter.run(ast);
  let c = out.counts;
  if (c.functions > 0) {
    report.clean.push({ construct: "functions", count: c.functions, detail: "function declarations translated" });
  }
  if (c.variables > 0) {
    report.clean.push({ construct: "variables", count: c.variables, detail: "variable declarations translated" });
  }
  if (c.loops > 0) {
    report.clean.push({ construct: "loops", count: c.loops, detail: "for / while / do-while loops translated" });
  }
  if (c.conditionals > 0) {
    report.clean.push({ construct: "conditionals", count: c.conditionals, detail: "if / switch statements translated" });
  }
  if (c.outputs > 0) {
    report.clean.push({ construct: "console-output", count: c.outputs, detail: "console.log calls translated" });
  }
  // Trace observations (informational, not assumptions): branch
  // outcomes and functions never called.
  let ifHashes = Object.keys(env.ifOutcomes);
  if (ifHashes.length > 0) {
    let oneSided = 0;
    for (let ii = 0; ii < ifHashes.length; ++ii) {
      let g = env.ifOutcomes[ifHashes[ii]];
      if (g.trueCount === 0 || g.falseCount === 0) oneSided += 1;
    }
    report.notes.push(
      ifHashes.length + " if-statement(s) evaluated in the trace; " + oneSided +
      " never took one arm (both arms were still translated statically)."
    );
  }
  let fnNames = [];
  for (let ii = 0; ii < ast.body.length; ++ii) {
    if (ast.body[ii].type === "FunctionDeclaration") fnNames.push(ast.body[ii].id.name);
  }
  let uncalled = [];
  for (let ii = 0; ii < fnNames.length; ++ii) {
    if (!env.called[fnNames[ii]]) uncalled.push(fnNames[ii]);
  }
  if (uncalled.length > 0) {
    if (to === "cpp") {
      report.notes.push(
        "Function(s) never called in the trace (" + uncalled.join(", ") +
        "): C++ parameter types for them came from a type hint, or the function was reported unsupported."
      );
    } else {
      report.notes.push(
        "Function(s) never called in the trace (" + uncalled.join(", ") +
        "): parameter types for them came from a type hint, or were omitted."
      );
    }
  }
  // 1.1.1 patch (Fix Spec 3.7): the verify block. Only the Python
  // leg is executed here; every other target records that
  // verification was not attempted, so a missing verify is never
  // mistaken for a pass (ran: null is not ran: true). A translation
  // that is not ok emits a loud stub, not runnable code, so it is
  // not executed either.
  if (to === "python") {
    if (report.ok) verifyEmittedPython(report, out.text, options);
    else {
      report.verify = { attempted: false, ran: null, reason: "translation incomplete (unsupported constructs); emitted code is a stub, not run" };
    }
  } else {
    report.verify = { attempted: false, ran: null, reason: "verify is only implemented for the Python leg" };
  }
  return { code: out.text, report: report };
}

// ------------------------------------------------------------------
// Python -> JavaScript (static-only)
// ------------------------------------------------------------------

// stdlib-only Python helper: reads source on stdin, parses with the
// `ast` module, writes the AST as JSON on stdout. No hand-rolled
// Python parser on the JS side.
const PYTHON_AST_HELPER = [
  "import ast, json, sys",
  "def conv(n):",
  "    if isinstance(n, ast.AST):",
  "        d = {'_type': type(n).__name__}",
  "        for f, v in ast.iter_fields(n):",
  "            d[f] = conv(v)",
  "        return d",
  "    if isinstance(n, list):",
  "        return [conv(x) for x in n]",
  "    if n is None or isinstance(n, (str, int, float, bool)):",
  "        return n",
  "    return {'_type': '_Value', 'value': str(n)}",
  "src = sys.stdin.read()",
  "tree = ast.parse(src)",
  "sys.stdout.write(json.dumps(conv(tree)))",
].join("\n");



function runPythonAst(code, childProcess) {
  let stdout;
  try {
    stdout = childProcess.execFileSync("python3", ["-c", PYTHON_AST_HELPER], {
      input: code,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error("Iroh.translate: python3 was not found on PATH (needed to parse Python source)");
    }
    let stderr = e.stderr ? String(e.stderr) : "";
    let lines = stderr.split("\n").filter(function(l) { return l.trim() !== ""; });
    let last = lines.length > 0 ? lines[lines.length - 1] : (e.message || String(e));
    throw new Error("Iroh.translate: Python parse failed: " + last);
  }
  return JSON.parse(stdout);
}

// Python AST (JSON) -> JavaScript. One function scope at a time:
// `declared` is the set of names already given a `let` in the
// current function (Python has no declarations — the first
// assignment to a name declares it); `globals` are names a `global`
// / `nonlocal` statement claimed, which never get a `let`.
function makePyJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let scopeStack = [];
  let noted = {};

  function noteOnce(key, text) {
    if (!noted[key]) {
      noted[key] = true;
      report.notes.push(text);
    }
  }
  function indentStr() {
    return "  ".repeat(indentLevel);
  }
  function emitLine(text) {
    lines.push(indentStr() + text);
  }
  function currentScope() {
    return scopeStack[scopeStack.length - 1];
  }
  function declareName(name) {
    let scope = currentScope();
    if (scope.globals[name] || scope.declared[name]) return "";
    scope.declared[name] = true;
    return "let ";
  }
  function stubExpr(detail) {
    markUnsupported(report, "Unsupported", detail);
    return '(function() { throw new Error(' + quotedMessage("IrohRedux: " + detail) + '); })()';
  }
  function opName(op) {
    // Python AST operator node -> { _type } string.
    return op && op._type ? op._type : "?";
  }

  function expr(node) {
    if (!node || typeof node._type !== "string") {
      return stubExpr("missing expression in Python source");
    }
    switch (node._type) {
      case "Constant": {
        let v = node.value;
        if (v === null) return "null";
        if (typeof v === "string") return JSON.stringify(v);
        if (typeof v === "number") return String(v);
        if (typeof v === "boolean") return v ? "true" : "false";
        return stubExpr("constant of unsupported type");
      }
      case "Name":
        return node.id;
      case "List":
      case "Tuple": {
        let parts = [];
        for (let ii = 0; ii < node.elts.length; ++ii) parts.push(expr(node.elts[ii]));
        return "[" + parts.join(", ") + "]";
      }
      case "BinOp": {
        let op = opName(node.op);
        let l = expr(node.left);
        let r = expr(node.right);
        if (op === "Add") return "(" + l + " + " + r + ")";
        if (op === "Sub") return "(" + l + " - " + r + ")";
        if (op === "Mult") return "(" + l + " * " + r + ")";
        if (op === "Div") return "(" + l + " / " + r + ")";
        if (op === "Mod") {
          // Python % is floored; JS % is truncated (it takes the
          // dividend's sign). The floored form below matches Python
          // for every sign combination, including negative divisors.
          return "((" + l + " % " + r + ") + " + r + ") % " + r;
        }
        if (op === "Pow") return "(" + l + " ** " + r + ")";
        if (op === "FloorDiv") return "Math.floor(" + l + " / " + r + ")";
        if (op === "BitAnd") return "(" + l + " & " + r + ")";
        if (op === "BitOr") return "(" + l + " | " + r + ")";
        if (op === "BitXor") return "(" + l + " ^ " + r + ")";
        if (op === "LShift") return "(" + l + " << " + r + ")";
        if (op === "RShift") return "(" + l + " >> " + r + ")";
        return stubExpr("binary operator " + op);
      }
      case "UnaryOp": {
        let op = opName(node.op);
        if (op === "USub") return "(-" + expr(node.operand) + ")";
        if (op === "UAdd") return "(+" + expr(node.operand) + ")";
        if (op === "Not") return "(!" + expr(node.operand) + ")";
        if (op === "Invert") return "(~" + expr(node.operand) + ")";
        return stubExpr("unary operator " + op);
      }
      case "BoolOp": {
        let op = opName(node.op);
        let joiner = op === "And" ? " && " : " || ";
        let parts = [];
        for (let ii = 0; ii < node.values.length; ++ii) parts.push(expr(node.values[ii]));
        return "(" + parts.join(joiner) + ")";
      }
      case "Compare": {
        let parts = [];
        let left = expr(node.left);
        for (let ii = 0; ii < node.ops.length; ++ii) {
          let op = opName(node.ops[ii]);
          let right = expr(node.comparators[ii]);
          let jsOp = { Eq: "==", NotEq: "!=", Lt: "<", LtE: "<=", Gt: ">", GtE: ">=" }[op];
          if (!jsOp) return stubExpr("comparison operator " + op);
          parts.push("(" + left + " " + jsOp + " " + right + ")");
          left = right;
        }
        return parts.join(" && ");
      }
      case "IfExp":
        return "(" + expr(node.test) + " ? " + expr(node.body) + " : " + expr(node.orelse) + ")";
      case "Call":
        return callExpr(node);
      case "Subscript": {
        let slice = node.slice;
        if (slice && slice._type === "Slice") {
          let lower = slice.lower ? expr(slice.lower) : "";
          let upper = slice.upper ? expr(slice.upper) : "";
          if (slice.step) return stubExpr("slice with a step");
          return expr(node.value) + ".slice(" + lower + (upper !== "" || lower !== "" ? ", " + upper : "") + ")";
        }
        return expr(node.value) + "[" + expr(slice) + "]";
      }
      case "Attribute":
        return expr(node.value) + "." + node.attr;
      case "JoinedStr": {
        let parts = ["`"];
        for (let ii = 0; ii < node.values.length; ++ii) {
          let v = node.values[ii];
          if (v._type === "Constant" && typeof v.value === "string") {
            parts.push(v.value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$"));
          } else if (v._type === "FormattedValue") {
            if (v.conversion === 115) parts.push("${String(" + expr(v.value) + ")}");
            else if (v.conversion === 114) return stubExpr("f-string !r conversion");
            else if (v.format_spec) return stubExpr("f-string format spec");
            else parts.push("${" + expr(v.value) + "}");
          } else {
            return stubExpr("f-string part");
          }
        }
        parts.push("`");
        return parts.join("");
      }
      case "Lambda": {
        let params = [];
        for (let ii = 0; ii < node.args.args.length; ++ii) params.push(node.args.args[ii].arg);
        return "(" + params.join(", ") + ") => " + expr(node.body);
      }
      case "Starred":
        return stubExpr("starred expression");
      case "Await":
      case "Yield":
      case "YieldFrom":
        return stubExpr(node._type + " (no async in v1)");
      case "Dict":
        return stubExpr("dict literal (no objects in the v1 scope)");
      case "NamedExpr":
        return stubExpr("walrus operator");
      default:
        return stubExpr("Python expression " + node._type);
    }
  }

  function callExpr(node) {
    let func = node.func;
    let args = [];
    for (let ii = 0; ii < node.args.length; ++ii) {
      let a = node.args[ii];
      if (a._type === "Starred") return stubExpr("starred call arguments");
      args.push(expr(a));
    }
    if (node.keywords && node.keywords.length > 0) {
      return stubExpr("keyword call arguments");
    }
    if (func._type === "Name") {
      let name = func.id;
      if (name === "print") return "console.log(" + args.join(", ") + ")";
      if (name === "len") return args[0] + ".length";
      if (name === "str") return "String(" + args[0] + ")";
      if (name === "int") return "Math.trunc(" + args[0] + ")";
      if (name === "float") return "Number(" + args[0] + ")";
      if (name === "bool") return "Boolean(" + args[0] + ")";
      if (name === "list") return "Array.from(" + args[0] + ")";
      if (name === "range") return stubExpr("range() outside a for loop (use it as the for target)");
      return name + "(" + args.join(", ") + ")";
    }
    if (func._type === "Attribute") {
      let obj = expr(func.value);
      let attr = func.attr;
      if (attr === "append") return obj + ".push(" + args.join(", ") + ")";
      if (attr === "upper") return obj + ".toUpperCase()";
      if (attr === "lower") return obj + ".toLowerCase()";
      if (attr === "split") return obj + ".split(" + args.join(", ") + ")";
      if (attr === "strip") return obj + ".trim()";
      if (attr === "join") return args[0] + ".join(" + obj + ")";
      return stubExpr("method ." + attr + " is not in the v1 scope");
    }
    return stubExpr("call of computed callee");
  }

  function assignTarget(target, value) {
    // Emits an assignment to `target` of the already-emitted `value`
    // string, declaring the name with `let` on first assignment in
    // this scope. Returns nothing; emits lines.
    if (target._type === "Name") {
      emitLine(declareName(target.id) + target.id + " = " + value + ";");
    } else if (target._type === "Tuple" || target._type === "List") {
      // `let [a, b] = ...` if any name is new to this scope.
      let plain = [];
      let anyNew = false;
      for (let ii = 0; ii < target.elts.length; ++ii) {
        let el = target.elts[ii];
        if (el._type !== "Name") {
          markUnsupported(report, "Assign", "destructuring assignment to non-name target");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: destructuring to non-name target") + ");");
          return;
        }
        plain.push(el.id);
        let scope = currentScope();
        if (!scope.globals[el.id] && !scope.declared[el.id]) {
          scope.declared[el.id] = true;
          anyNew = true;
        }
      }
      emitLine((anyNew ? "let " : "") + "[" + plain.join(", ") + "] = " + value + ";");
    } else if (target._type === "Subscript" || target._type === "Attribute") {
      emitLine(expr(target) + " = " + value + ";");
    } else {
      markUnsupported(report, "Assign", "assignment target " + target._type);
      emitLine("throw new Error(" + quotedMessage("IrohRedux: assignment target " + target._type) + ");");
    }
  }

  function emitBody(stmts) {
    if (!stmts || stmts.length === 0) {
      emitLine("// pass");
      return;
    }
    indentLevel += 1;
    for (let ii = 0; ii < stmts.length; ++ii) stmt(stmts[ii]);
    indentLevel -= 1;
  }

  function isRangeCall(node) {
    return (
      node &&
      node._type === "Call" &&
      node.func._type === "Name" &&
      node.func.id === "range" &&
      (!node.keywords || node.keywords.length === 0) &&
      node.args.length >= 1 &&
      node.args.length <= 3
    );
  }

  function stmt(node) {
    if (!node || typeof node._type !== "string") return;
    switch (node._type) {
      case "FunctionDef": {
        if (node.decorator_list && node.decorator_list.length > 0) {
          markUnsupported(report, "FunctionDef", "decorated function '" + node.name + "' (decorators are not in the v1 scope)");
          emitLine("function " + node.name + "() { throw new Error(" + quotedMessage("IrohRedux: decorated function " + node.name) + "); }");
          return;
        }
        if (node.args.vararg || node.args.kwarg || (node.args.kwonlyargs && node.args.kwonlyargs.length > 0)) {
          markUnsupported(report, "FunctionDef", "function '" + node.name + "' uses *args/**kwargs (not in the v1 scope)");
          emitLine("function " + node.name + "() { throw new Error(" + quotedMessage("IrohRedux: *args/**kwargs") + "); }");
          return;
        }
        let params = [];
        let defaults = node.args.defaults || [];
        let positional = node.args.args || [];
        let firstDefault = positional.length - defaults.length;
        for (let ii = 0; ii < positional.length; ++ii) {
          let p = positional[ii].arg;
          if (ii >= firstDefault) p += " = " + expr(defaults[ii - firstDefault]);
          params.push(p);
        }
        emitLine("function " + node.name + "(" + params.join(", ") + ") {");
        scopeStack.push({ declared: {}, globals: {} });
        emitBody(node.body);
        scopeStack.pop();
        emitLine("}");
        return;
      }
      case "AsyncFunctionDef":
        markUnsupported(report, "AsyncFunctionDef", "async function '" + node.name + "' (no async in v1)");
        emitLine("function " + node.name + "() { throw new Error(" + quotedMessage("IrohRedux: async function") + "); }");
        return;
      case "ClassDef":
        markUnsupported(report, "ClassDef", "class '" + node.name + "' (no classes in v1)");
        emitLine("class " + node.name + " { constructor() { throw new Error(" + quotedMessage("IrohRedux: class " + node.name) + "); } }");
        return;
      case "Return":
        emitLine(node.value ? "return " + expr(node.value) + ";" : "return;");
        return;
      case "Assign": {
        if (node.targets.length === 1) {
          assignTarget(node.targets[0], expr(node.value));
        } else {
          let value = expr(node.value);
          for (let ii = 0; ii < node.targets.length; ++ii) {
            assignTarget(node.targets[ii], value);
          }
        }
        return;
      }
      case "AnnAssign": {
        if (node.value) assignTarget(node.target, expr(node.value));
        else if (node.target._type === "Name") emitLine(declareName(node.target.id) + node.target.id + ";");
        else noteOnce("annassign", "Annotation-only assignment ignored (types are not carried into JS).");
        return;
      }
      case "AugAssign": {
        let op = opName(node.op);
        let map = { Add: "+=", Sub: "-=", Mult: "*=", Div: "/=", Mod: "%=", Pow: "**=", BitAnd: "&=", BitOr: "|=", BitXor: "^=", LShift: "<<=", RShift: ">>=" };
        if (op === "FloorDiv") {
          emitLine(expr(node.target) + " = Math.floor(" + expr(node.target) + " / " + expr(node.value) + ");");
          return;
        }
        if (!map[op]) {
          markUnsupported(report, "AugAssign", "augmented assignment " + op);
          emitLine("throw new Error(" + quotedMessage("IrohRedux: augmented assignment " + op) + ");");
          return;
        }
        emitLine(expr(node.target) + " " + map[op] + " " + expr(node.value) + ";");
        return;
      }
      case "Expr":
        emitLine(expr(node.value) + ";");
        return;
      case "If": {
        emitLine("if (" + expr(node.test) + ") {");
        emitBody(node.body);
        emitLine("}");
        let orelse = node.orelse || [];
        if (orelse.length === 1 && orelse[0]._type === "If") {
          lines[lines.length - 1] = indentStr() + "} else if (" + expr(orelse[0].test) + ") {";
          emitBody(orelse[0].body);
          emitLine("}");
          let rest = orelse[0].orelse || [];
          if (rest.length > 0) {
            lines[lines.length - 1] = indentStr() + "} else {";
            emitBody(rest);
            emitLine("}");
          }
        } else if (orelse.length > 0) {
          lines[lines.length - 1] = indentStr() + "} else {";
          emitBody(orelse);
          emitLine("}");
        }
        return;
      }
      case "For": {
        if (node.orelse && node.orelse.length > 0) {
          markUnsupported(report, "For", "for-else (the else runs only when the loop completes without break)");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: for-else") + ");");
          return;
        }
        if (isRangeCall(node.iter)) {
          let args = node.iter.args;
          let start = "0";
          let end;
          let step = "1";
          if (args.length === 1) end = expr(args[0]);
          else if (args.length === 2) { start = expr(args[0]); end = expr(args[1]); }
          else { start = expr(args[0]); end = expr(args[1]); step = expr(args[2]); }
          let target = node.target._type === "Name" ? node.target.id : null;
          if (!target) {
            markUnsupported(report, "For", "range() loop with non-name target");
            emitLine("throw new Error(" + quotedMessage("IrohRedux: range() target") + ");");
            return;
          }
          noteOnce("range", "range() loops translate to numeric for loops; Python's range() semantics (half-open, step) are preserved.");
          emitLine("for (" + declareName(target) + target + " = " + start + "; " + target + " < " + end + "; " + target + " += " + step + ") {");
          emitBody(node.body);
          emitLine("}");
          return;
        }
        if (node.target._type === "Name") {
          let name = node.target.id;
          let prefix = declareName(name);
          if (prefix) emitLine("let " + name + ";");
          noteOnce("forscope", "Python loop variables leak into the enclosing scope; the translation declares them before the loop to match.");
          emitLine("for (" + name + " of " + expr(node.iter) + ") {");
          emitBody(node.body);
          emitLine("}");
          return;
        }
        if (node.target._type === "Tuple") {
          let names = [];
          for (let ii = 0; ii < node.target.elts.length; ++ii) {
            if (node.target.elts[ii]._type !== "Name") {
              markUnsupported(report, "For", "for loop with non-name tuple target");
              emitLine("throw new Error(" + quotedMessage("IrohRedux: for tuple target") + ");");
              return;
            }
            names.push(node.target.elts[ii].id);
          }
          emitLine("for (const [" + names.join(", ") + "] of " + expr(node.iter) + ") {");
          emitBody(node.body);
          emitLine("}");
          return;
        }
        markUnsupported(report, "For", "for loop with target " + node.target._type);
        emitLine("throw new Error(" + quotedMessage("IrohRedux: for target") + ");");
        return;
      }
      case "While": {
        if (node.orelse && node.orelse.length > 0) {
          markUnsupported(report, "While", "while-else");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: while-else") + ");");
          return;
        }
        emitLine("while (" + expr(node.test) + ") {");
        emitBody(node.body);
        emitLine("}");
        return;
      }
      case "Break":
        emitLine("break;");
        return;
      case "Continue":
        emitLine("continue;");
        return;
      case "Pass":
        return;
      case "Try": {
        if (node.orelse && node.orelse.length > 0) {
          markUnsupported(report, "Try", "try-else");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: try-else") + ");");
          return;
        }
        emitLine("try {");
        emitBody(node.body);
        emitLine("}");
        for (let ii = 0; ii < (node.handlers || []).length; ++ii) {
          let h = node.handlers[ii];
          let isGeneric = !h.type || (h.type._type === "Name" && h.type.id === "Exception");
          if (!isGeneric) {
            markUnsupported(report, "Try", "except for a specific error type (only bare `except:` / `except Exception:` translate in v1)");
            emitLine("catch (e) {");
            indentLevel += 1;
            emitLine("throw new Error(" + quotedMessage("IrohRedux: specific except") + ");");
            indentLevel -= 1;
            emitLine("}");
            continue;
          }
          if (h.name) emitLine("catch (" + h.name + ") {");
          else emitLine("catch (e) {");
          emitBody(h.body);
          emitLine("}");
        }
        if (node.finalbody && node.finalbody.length > 0) {
          lines[lines.length - 1] = indentStr() + "} finally {";
          emitBody(node.finalbody);
          emitLine("}");
        }
        return;
      }
      case "Raise": {
        if (!node.exc) {
          markUnsupported(report, "Raise", "bare raise");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: bare raise") + ");");
          return;
        }
        if (node.exc._type === "Call" && node.exc.func._type === "Name") {
          emitLine("throw new Error(" + (node.exc.args.length > 0 ? expr(node.exc.args[0]) : '""') + ");");
          return;
        }
        emitLine("throw " + expr(node.exc) + ";");
        return;
      }
      case "Assert": {
        let msg = node.msg ? " + \": \" + " + expr(node.msg) : "";
        emitLine("if (!(" + expr(node.test) + ")) throw new Error(\"AssertionError\"" + msg + ");");
        return;
      }
      case "Global": {
        for (let ii = 0; ii < node.names.length; ++ii) currentScope().globals[node.names[ii]] = true;
        return;
      }
      case "Nonlocal": {
        noteOnce("nonlocal", "nonlocal is treated like global (assignments go to the enclosing declaration, no `let`).");
        for (let ii = 0; ii < node.names.length; ++ii) currentScope().globals[node.names[ii]] = true;
        return;
      }
      case "Import":
      case "ImportFrom": {
        let what = node._type === "Import"
          ? node.names.map(function(n) { return n.name; }).join(", ")
          : (node.module || "") + " import ...";
        markUnsupported(report, node._type, "import '" + what + "' (imports do not translate in v1)");
        emitLine("// IrohRedux: import '" + what + "' is not translated (v1 has no imports).");
        return;
      }
      case "Delete":
      case "With":
      case "AsyncFor":
      case "AsyncWith":
        markUnsupported(report, node._type, node._type + " is not in the v1 scope");
        emitLine("throw new Error(" + quotedMessage("IrohRedux: " + node._type) + ");");
        return;
      default:
        markUnsupported(report, node._type, "Python statement " + node._type + " is not in the v1 scope");
        emitLine("throw new Error(" + quotedMessage("IrohRedux: " + node._type) + ");");
        return;
    }
  }

  function run(ast) {
    scopeStack.push({ declared: {}, globals: {} });
    for (let ii = 0; ii < ast.body.length; ++ii) stmt(ast.body[ii]);
    scopeStack.pop();
    return lines.join("\n") + "\n";
  }

  return { run: run };
}

function translateFromPython(code, childProcess) {
  let report = newReport("python", "javascript", true);
  report.notes.push(
    "Static-only leg: there is no tracer for Python, so this translation uses the source alone — no runtime types, no branch evidence."
  );
  let ast = runPythonAst(code, childProcess);
  let emitter = makePyJSEmitter(report);
  let out = emitter.run(ast);
  report.clean.push({ construct: "statements", count: ast.body.length, detail: "top-level statements translated" });
  return { code: out, report: report };
}

// ------------------------------------------------------------------
// C++ -> JavaScript (static-only). A scoped subset parser for the
// v1 constructs only; anything outside the subset is reported
// unsupported, never guessed at.
// ------------------------------------------------------------------

function CppParseError(message) {
  this.name = "CppParseError";
  this.message = message;
}
CppParseError.prototype = Object.create(Error.prototype);

const CPP_MULTI_PUNCT = ["<<=", ">>=", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "->", "::"];

function tokenizeCpp(code) {
  let tokens = [];
  let includes = [];
  let ii = 0;
  function isDigit(c) { return c >= "0" && c <= "9"; }
  function isIdentStart(c) { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
  function isIdentChar(c) { return isIdentStart(c) || isDigit(c); }
  while (ii < code.length) {
    let c = code[ii];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { ii += 1; continue; }
    if (c === "/" && code[ii + 1] === "/") {
      while (ii < code.length && code[ii] !== "\n") ii += 1;
      continue;
    }
    if (c === "/" && code[ii + 1] === "*") {
      let end = code.indexOf("*/", ii + 2);
      if (end === -1) throw new CppParseError("unterminated block comment");
      ii = end + 2;
      continue;
    }
    if (c === "#") {
      // Preprocessor line: record and skip (includes are noted in
      // the report; the translation itself does not need them).
      let start = ii;
      while (ii < code.length && code[ii] !== "\n") ii += 1;
      let line = code.slice(start, ii).trim();
      if (line.indexOf("#include") === 0) includes.push(line);
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(code[ii + 1] || ""))) {
      let start = ii;
      while (ii < code.length && (isDigit(code[ii]) || code[ii] === ".")) ii += 1;
      if (code[ii] === "e" || code[ii] === "E") {
        ii += 1;
        if (code[ii] === "+" || code[ii] === "-") ii += 1;
        while (ii < code.length && isDigit(code[ii])) ii += 1;
      }
      // Suffixes (f, u, l, ll) are dropped — the value is what matters.
      while (ii < code.length && /[fFuUlL]/.test(code[ii])) ii += 1;
      tokens.push({ type: "number", value: code.slice(start, ii) });
      continue;
    }
    if (isIdentStart(c)) {
      let start = ii;
      while (ii < code.length && isIdentChar(code[ii])) ii += 1;
      tokens.push({ type: "ident", value: code.slice(start, ii) });
      continue;
    }
    if (c === '"') {
      let start = ii;
      ii += 1;
      let value = "";
      let closed = false;
      while (ii < code.length) {
        let ch = code[ii];
        if (ch === "\\") {
          let esc = code[ii + 1];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "r") value += "\r";
          else if (esc === '"') value += '"';
          else if (esc === "\\") value += "\\";
          else if (esc === "0") value += "\0";
          else value += esc || "";
          ii += 2;
          continue;
        }
        if (ch === '"') { ii += 1; closed = true; break; }
        if (ch === "\n") break;
        value += ch;
        ii += 1;
      }
      if (!closed) throw new CppParseError("unterminated string literal");
      tokens.push({ type: "string", value: value, raw: code.slice(start, ii) });
      continue;
    }
    if (c === "'") {
      ii += 1;
      let value = "";
      let closed = false;
      while (ii < code.length) {
        let ch = code[ii];
        if (ch === "\\") {
          let esc = code[ii + 1];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "'") value += "'";
          else if (esc === "\\") value += "\\";
          else if (esc === "0") value += "\0";
          else value += esc || "";
          ii += 2;
          continue;
        }
        if (ch === "'") { ii += 1; closed = true; break; }
        if (ch === "\n") break;
        value += ch;
        ii += 1;
      }
      if (!closed) throw new CppParseError("unterminated character literal");
      if (value.length !== 1) throw new CppParseError("multi-character literal is not in the v1 subset");
      tokens.push({ type: "char", value: value });
      continue;
    }
    let matched = false;
    for (let jj = 0; jj < CPP_MULTI_PUNCT.length; ++jj) {
      let p = CPP_MULTI_PUNCT[jj];
      if (code.indexOf(p, ii) === ii) {
        tokens.push({ type: "punct", value: p });
        ii += p.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    tokens.push({ type: "punct", value: c });
    ii += 1;
  }
  tokens.push({ type: "eof", value: "" });
  return { tokens: tokens, includes: includes };
}

function makeCppParser(code) {
  let scanned = tokenizeCpp(code);
  let tokens = scanned.tokens;
  let pos = 0;

  function peek(k) {
    return tokens[Math.min(pos + (k || 0), tokens.length - 1)];
  }
  function next() {
    let t = tokens[pos];
    if (pos < tokens.length - 1) pos += 1;
    return t;
  }
  function isPunct(v) {
    return peek().type === "punct" && peek().value === v;
  }
  function isIdent(v) {
    return peek().type === "ident" && (v === void 0 || peek().value === v);
  }
  function expectPunct(v) {
    if (!isPunct(v)) throw new CppParseError("expected '" + v + "' but found '" + peek().value + "'");
    next();
  }
  function expectIdent(what) {
    if (peek().type !== "ident") throw new CppParseError("expected " + (what || "identifier") + " but found '" + peek().value + "'");
    return next().value;
  }

  const CPP_KEYWORDS = ["auto", "void", "int", "long", "short", "double", "float", "bool", "char", "string", "unsigned", "signed", "const", "static", "size_t", "vector", "std"];

  function parseType() {
    // Returns a type string like "int", "std::string",
    // "std::vector<int>", or null if this is not a type.
    // Trailing `&`/`*` (references/pointers) are consumed and
    // dropped — types are not carried into JavaScript.
    let t = peek();
    if (t.type !== "ident") return null;
    let base = t.value;
    if (base === "const" || base === "static" || base === "unsigned" || base === "signed") {
      next();
      let inner = parseType();
      if (!inner) throw new CppParseError("expected a type after '" + base + "'");
      return inner; // qualifiers are dropped (int is int)
    }
    let result = null;
    if (base === "auto" || base === "void" || base === "int" || base === "long" || base === "short" ||
        base === "double" || base === "float" || base === "bool" || base === "char" || base === "size_t") {
      next();
      if (base === "long" || base === "short" || base === "size_t") result = "int";
      else if (base === "float") result = "double";
      else result = base;
    } else if (base === "string") { next(); result = "std::string"; }
    else if (base === "std") {
      next();
      if (!isPunct("::")) throw new CppParseError("expected '::' after std");
      next();
      let name = expectIdent("a std:: type name");
      if (name === "string") result = "std::string";
      else if (name === "exception") result = "std::exception";
      else if (name === "vector") {
        if (!isPunct("<")) throw new CppParseError("expected '<' after std::vector");
        next();
        let inner = parseType();
        if (!inner) throw new CppParseError("expected an element type in std::vector<...>");
        expectPunct(">");
        result = "std::vector<" + inner + ">";
      } else {
        throw new CppParseError("std::" + name + " is not in the v1 subset");
      }
    } else if (base === "vector") {
      next();
      if (!isPunct("<")) throw new CppParseError("expected '<' after vector");
      next();
      let inner = parseType();
      if (!inner) throw new CppParseError("expected an element type in vector<...>");
      expectPunct(">");
      result = "std::vector<" + inner + ">";
    } else {
      return null;
    }
    while (isPunct("&") || isPunct("*")) next();
    return result;
  }

  // Speculative type parse: parseType() throws on `std::cout` (a
  // value, not a type), so speculative call sites use this — a
  // failed type parse just means "not a declaration".
  function tryParseType() {
    let saved = pos;
    try {
      return parseType();
    } catch (e) {
      if (e instanceof CppParseError) {
        pos = saved;
        return null;
      }
      throw e;
    }
  }

  function parseQualifiedName() {
    // std::cout, std::pow, plain identifiers, a.b.c
    let name = expectIdent();
    while (isPunct("::")) {
      next();
      name += "::" + expectIdent();
    }
    return name;
  }

  function parsePrimary() {
    let t = peek();
    if (t.type === "number") {
      next();
      return { type: "Literal", value: Number(t.value), raw: t.value };
    }
    if (t.type === "string") {
      next();
      return { type: "Literal", value: t.value };
    }
    if (t.type === "char") {
      next();
      return { type: "Literal", value: t.value };
    }
    if (t.type === "ident") {
      if (t.value === "true") { next(); return { type: "Literal", value: true }; }
      if (t.value === "false") { next(); return { type: "Literal", value: false }; }
      if (t.value === "nullptr") { next(); return { type: "Literal", value: null }; }
      if (t.value === "new") throw new CppParseError("'new' is not in the v1 subset");
      let name = parseQualifiedName();
      if (isPunct("(")) {
        next();
        let args = [];
        if (!isPunct(")")) {
          // Arguments, not a comma sequence: parseAssignment stops
          // at the comma.
          args.push(parseAssignment());
          while (isPunct(",")) { next(); args.push(parseAssignment()); }
        }
        expectPunct(")");
        return { type: "CallExpression", callee: { type: "Identifier", name: name }, arguments: args };
      }
      return { type: "Identifier", name: name };
    }
    if (isPunct("(")) {
      next();
      let e = parseExpression();
      expectPunct(")");
      return e;
    }
    if (isPunct("{")) {
      // Initializer list {1, 2, 3}
      next();
      let elements = [];
      if (!isPunct("}")) {
        elements.push(parseAssignment());
        while (isPunct(",")) { next(); if (isPunct("}")) break; elements.push(parseAssignment()); }
      }
      expectPunct("}");
      return { type: "ArrayExpression", elements: elements };
    }
    throw new CppParseError("unexpected token '" + t.value + "' in expression");
  }

  function parsePostfix() {
    let e = parsePrimary();
    while (true) {
      if (isPunct(".")) {
        next();
        let prop = expectIdent("a member name");
        if (isPunct("(")) {
          next();
          let args = [];
          if (!isPunct(")")) {
            args.push(parseAssignment());
            while (isPunct(",")) { next(); args.push(parseAssignment()); }
          }
          expectPunct(")");
          e = { type: "CallExpression", callee: { type: "MemberExpression", object: e, property: { type: "Identifier", name: prop }, computed: false }, arguments: args };
          continue;
        }
        e = { type: "MemberExpression", object: e, property: { type: "Identifier", name: prop }, computed: false };
        continue;
      }
      if (isPunct("[")) {
        next();
        let idx = parseExpression();
        expectPunct("]");
        e = { type: "MemberExpression", object: e, property: idx, computed: true };
        continue;
      }
      if (isPunct("++") || isPunct("--")) {
        let op = next().value;
        e = { type: "UpdateExpression", operator: op, argument: e, prefix: false };
        continue;
      }
      break;
    }
    return e;
  }

  function parseUnary() {
    if (isPunct("-") || isPunct("+") || isPunct("!") || isPunct("~")) {
      let op = next().value;
      return { type: "UnaryExpression", operator: op, argument: parseUnary(), prefix: true };
    }
    if (isPunct("++") || isPunct("--")) {
      let op = next().value;
      return { type: "UpdateExpression", operator: op, argument: parseUnary(), prefix: true };
    }
    if (isIdent("sizeof")) throw new CppParseError("sizeof is not in the v1 subset");
    return parsePostfix();
  }

  const BIN_LEVELS = [
    ["*", "/", "%"],
    ["+", "-"],
    ["<<", ">>"],
    ["<", "<=", ">", ">="],
    ["==", "!="],
    ["&"],
    ["^"],
    ["|"],
    ["&&"],
    ["||"],
  ];

  function parseBinary(level) {
    if (level >= BIN_LEVELS.length) return parseUnary();
    let left = parseBinary(level + 1);
    let ops = BIN_LEVELS[level];
    while (peek().type === "punct" && ops.indexOf(peek().value) !== -1) {
      let op = next().value;
      let right = parseBinary(level + 1);
      left = { type: "BinaryExpression", operator: op, left: left, right: right };
    }
    return left;
  }

  function parseTernary() {
    let e = parseBinary(0);
    if (isPunct("?")) {
      next();
      let consequent = parseExpression();
      expectPunct(":");
      let alternate = parseTernary();
      return { type: "ConditionalExpression", test: e, consequent: consequent, alternate: alternate };
    }
    return e;
  }

  function parseAssignment() {
    let e = parseTernary();
    if (peek().type === "punct" && ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="].indexOf(peek().value) !== -1) {
      let op = next().value;
      let right = parseAssignment();
      return { type: "AssignmentExpression", operator: op, left: e, right: right };
    }
    return e;
  }

  function parseExpression() {
    let first = parseAssignment();
    if (!isPunct(",")) return first;
    let exprs = [first];
    while (isPunct(",")) { next(); exprs.push(parseAssignment()); }
    return { type: "SequenceExpression", expressions: exprs };
  }

  function parseBlock() {
    expectPunct("{");
    let body = [];
    while (!isPunct("}")) {
      if (peek().type === "eof") throw new CppParseError("unterminated block");
      body.push(parseStatement());
    }
    expectPunct("}");
    return { type: "BlockStatement", body: body };
  }

  function parseVarDeclRest(firstType, firstName) {
    // After `type name` in a statement: `= init`, `, name2 ...`, `;`.
    let decls = [];
    let init = null;
    if (isPunct("=")) {
      next();
      init = parseExpression();
    }
    decls.push({ type: "VariableDeclarator", id: { type: "Identifier", name: firstName }, init: init });
    while (isPunct(",")) {
      next();
      let name = expectIdent("a variable name");
      let vinit = null;
      if (isPunct("=")) { next(); vinit = parseExpression(); }
      decls.push({ type: "VariableDeclarator", id: { type: "Identifier", name: name }, init: vinit });
    }
    expectPunct(";");
    return { type: "VariableDeclaration", declarations: decls, kind: "let", cppType: firstType };
  }

  function parseStatement() {
    let t = peek();
    if (isPunct("{")) return parseBlock();
    if (isPunct(";")) { next(); return { type: "EmptyStatement" }; }
    if (isIdent("if")) {
      next();
      expectPunct("(");
      let test = parseExpression();
      expectPunct(")");
      let consequent = parseStatement();
      let alternate = null;
      if (isIdent("else")) {
        next();
        alternate = parseStatement();
      }
      return { type: "IfStatement", test: test, consequent: consequent, alternate: alternate };
    }
    if (isIdent("for")) {
      next();
      expectPunct("(");
      // Range-based for: for (type name : expr)
      let saved = pos;
      let rangeType = tryParseType();
      if (rangeType !== null && peek().type === "ident" && peek(1).value === ":") {
        let name = next().value;
        next(); // ':'
        let right = parseAssignment();
        expectPunct(")");
        let body = parseStatement();
        return {
          type: "ForOfStatement",
          left: { type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name: name }, init: null }], kind: "let" },
          right: right,
          body: body,
        };
      }
      pos = saved;
      // Classic for: for (init; test; update)
      let init = null;
      if (!isPunct(";")) {
        let it = tryParseType();
        if (it !== null) {
          let name = expectIdent("a loop variable name");
          let declInit = null;
          if (isPunct("=")) { next(); declInit = parseExpression(); }
          init = { type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name: name }, init: declInit }], kind: "let" };
        } else {
          init = parseExpression();
        }
      }
      expectPunct(";");
      let test = null;
      if (!isPunct(";")) test = parseExpression();
      expectPunct(";");
      let update = null;
      if (!isPunct(")")) update = parseExpression();
      expectPunct(")");
      let body = parseStatement();
      return { type: "ForStatement", init: init, test: test, update: update, body: body };
    }
    if (isIdent("while")) {
      next();
      expectPunct("(");
      let test = parseExpression();
      expectPunct(")");
      return { type: "WhileStatement", test: test, body: parseStatement() };
    }
    if (isIdent("do")) {
      next();
      let body = parseStatement();
      if (!isIdent("while")) throw new CppParseError("expected 'while' after do-while body");
      next();
      expectPunct("(");
      let test = parseExpression();
      expectPunct(")");
      expectPunct(";");
      return { type: "DoWhileStatement", test: test, body: body };
    }
    if (isIdent("return")) {
      next();
      let arg = null;
      if (!isPunct(";")) arg = parseExpression();
      expectPunct(";");
      return { type: "ReturnStatement", argument: arg };
    }
    if (isIdent("break")) { next(); expectPunct(";"); return { type: "BreakStatement" }; }
    if (isIdent("continue")) { next(); expectPunct(";"); return { type: "ContinueStatement" }; }
    if (isIdent("switch")) {
      next();
      expectPunct("(");
      let discriminant = parseExpression();
      expectPunct(")");
      expectPunct("{");
      let cases = [];
      while (!isPunct("}")) {
        if (peek().type === "eof") throw new CppParseError("unterminated switch");
        let test = null;
        if (isIdent("case")) {
          next();
          test = parseAssignment();
        } else if (isIdent("default")) {
          next();
        } else {
          throw new CppParseError("expected 'case' or 'default' in switch, found '" + peek().value + "'");
        }
        expectPunct(":");
        let consequent = [];
        while (!isPunct("}") && !(isIdent("case") || isIdent("default"))) {
          consequent.push(parseStatement());
        }
        cases.push({ type: "SwitchCase", test: test, consequent: consequent });
      }
      expectPunct("}");
      return { type: "SwitchStatement", discriminant: discriminant, cases: cases };
    }
    if (isIdent("try")) {
      next();
      let block = parseBlock();
      let handler = null;
      let finalizer = null;
      if (isIdent("catch")) {
        next();
        expectPunct("(");
        let param = null;
        let ctype = parseType();
        if (isPunct(".")) {
          // catch(...) — matches anything.
          next(); expectPunct("."); expectPunct(".");
        } else if (peek().type === "ident") {
          param = { type: "Identifier", name: next().value };
        }
        expectPunct(")");
        handler = { type: "CatchClause", param: param, body: parseBlock() };
      }
      if (isIdent("finally")) throw new CppParseError("C++ has no finally");
      if (!handler) throw new CppParseError("try without catch is not in the v1 subset");
      return { type: "TryStatement", block: block, handler: handler, finalizer: finalizer };
    }
    if (isIdent("throw")) {
      next();
      let arg = parseExpression();
      expectPunct(";");
      return { type: "ThrowStatement", argument: arg };
    }
    if (isIdent("using")) {
      // `using namespace std;` — noted, no JS equivalent needed.
      next();
      while (!isPunct(";")) {
        if (peek().type === "eof") throw new CppParseError("unterminated using declaration");
        next();
      }
      expectPunct(";");
      return { type: "EmptyStatement" };
    }
    // Variable declaration: `type name ... ;`
    let saved = pos;
    let ty = tryParseType();
    if (ty !== null && peek().type === "ident" && CPP_KEYWORDS.indexOf(peek().value) === -1) {
      let name = next().value;
      if (isPunct("(")) {
        // `type name(...)` at statement level is a function call with
        // a type cast — not in the subset.
        throw new CppParseError("function declaration inside a body is not in the v1 subset");
      }
      return parseVarDeclRest(ty, name);
    }
    pos = saved;
    // Expression statement.
    let e = parseExpression();
    expectPunct(";");
    return { type: "ExpressionStatement", expression: e };
  }

  function parseFunctionOrDecl() {
    let ty = tryParseType();
    if (ty === null) throw new CppParseError("expected a type at the top level, found '" + peek().value + "'");
    let name = expectIdent("a function or variable name");
    if (isPunct("(")) {
      // Function definition.
      next();
      let params = [];
      if (!isPunct(")")) {
        while (true) {
          let ptype = parseType();
          if (ptype === null) throw new CppParseError("expected a parameter type in '" + name + "'");
          if (isPunct(".")) {
            next(); expectPunct("."); expectPunct(".");
            throw new CppParseError("variadic parameters are not in the v1 subset");
          }
          let pname = expectIdent("a parameter name");
          let def = null;
          if (isPunct("=")) { next(); def = parseAssignment(); }
          params.push({ name: pname, cppType: ptype, default: def });
          if (isPunct(",")) { next(); continue; }
          break;
        }
      }
      expectPunct(")");
      let body = parseBlock();
      return { type: "FunctionDeclaration", id: { type: "Identifier", name: name }, params: params, body: body, cppReturn: ty };
    }
    // Global variable declaration.
    let decl = parseVarDeclRest(ty, name);
    decl.cppType = ty;
    return decl;
  }

  function parseProgram() {
    let body = [];
    while (peek().type !== "eof") {
      if (isIdent("using")) {
        // `using namespace std;` at the top level — noted, no JS
        // equivalent needed.
        while (!isPunct(";")) {
          if (peek().type === "eof") throw new CppParseError("unterminated using declaration");
          next();
        }
        expectPunct(";");
        continue;
      }
      body.push(parseFunctionOrDecl());
    }
    return { type: "Program", body: body, includes: scanned.includes };
  }

  return { parseProgram: parseProgram };
}

// C++ AST (Acorn-like) -> JavaScript. Types are dropped; `main` is
// unwrapped to top-level statements; `std::cout << a << b` becomes
// console.log(a, b).
function makeCppJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let declared = {};
  let noted = {};

  function noteOnce(key, text) {
    if (!noted[key]) {
      noted[key] = true;
      report.notes.push(text);
    }
  }
  function indentStr() {
    return "  ".repeat(indentLevel);
  }
  function emitLine(text) {
    lines.push(indentStr() + text);
  }
  function stubExpr(detail) {
    markUnsupported(report, "Unsupported", detail);
    return '(function() { throw new Error(' + quotedMessage("IrohRedux: " + detail) + '); })()';
  }
  function unsupportedStmt(detail) {
    markUnsupported(report, "Unsupported", detail);
    emitLine("throw new Error(" + quotedMessage("IrohRedux: " + detail) + ");");
  }

  function flattenCout(node) {
    // Returns [parts] if `node` is a `<<` chain rooted at cout,
    // else null. std::endl / std::boolalpha are dropped.
    let parts = [];
    let cur = node;
    while (cur.type === "BinaryExpression" && cur.operator === "<<") {
      let right = cur.right;
      if (right.type === "Identifier" && (right.name === "std::endl" || right.name === "endl" || right.name === "std::boolalpha")) {
        cur = cur.left;
        continue;
      }
      parts.unshift(right);
      cur = cur.left;
    }
    if (cur.type === "Identifier" && (cur.name === "std::cout" || cur.name === "cout")) return parts;
    return null;
  }

  function expr(node) {
    if (!node || typeof node.type !== "string") return stubExpr("missing expression in C++ source");
    switch (node.type) {
      case "Literal":
        if (node.value === null) return "null";
        if (typeof node.value === "string") return JSON.stringify(node.value);
        if (typeof node.value === "boolean") return node.value ? "true" : "false";
        return String(node.value);
      case "Identifier":
        if (node.name === "std::endl" || node.name === "endl") return stubExpr("std::endl outside a cout chain");
        if (node.name === "std::cin" || node.name === "cin") return stubExpr("std::cin (input is not in the v1 scope)");
        return node.name;
      case "ArrayExpression": {
        let parts = [];
        for (let ii = 0; ii < node.elements.length; ++ii) parts.push(expr(node.elements[ii]));
        return "[" + parts.join(", ") + "]";
      }
      case "BinaryExpression": {
        let l = expr(node.left);
        let r = expr(node.right);
        if (node.operator === "<<" || node.operator === ">>") {
          return stubExpr("stream operator '" + node.operator + "' outside a cout chain (std::cin is not in the v1 scope)");
        }
        return "(" + l + " " + node.operator + " " + r + ")";
      }
      case "UnaryExpression":
        return "(" + node.operator + expr(node.argument) + ")";
      case "UpdateExpression": {
        let a = expr(node.argument);
        return node.prefix ? "(" + node.operator + a + ")" : "(" + a + node.operator + ")";
      }
      case "AssignmentExpression":
        return expr(node.left) + " " + node.operator + " " + expr(node.right);
      case "ConditionalExpression":
        return "(" + expr(node.test) + " ? " + expr(node.consequent) + " : " + expr(node.alternate) + ")";
      case "MemberExpression": {
        let obj = expr(node.object);
        if (!node.computed && node.property.name === "size") return obj + ".length";
        if (!node.computed) return obj + "." + node.property.name;
        return obj + "[" + expr(node.property) + "]";
      }
      case "CallExpression": {
        let callee = node.callee;
        let args = [];
        for (let ii = 0; ii < node.arguments.length; ++ii) args.push(expr(node.arguments[ii]));
        if (callee.type === "Identifier") {
          if (callee.name === "std::pow") return "(" + args[0] + " ** " + args[1] + ")";
          if (callee.name === "std::to_string") return "String(" + args[0] + ")";
          if (callee.name === "std::stoi") return "parseInt(" + args[0] + ", 10)";
          if (callee.name === "std::stod" || callee.name === "std::stof") return "parseFloat(" + args[0] + ")";
          if (callee.name === "std::string") return args[0];
          if (callee.name === "std::abs") return "Math.abs(" + args[0] + ")";
          if (callee.name === "std::sqrt") return "Math.sqrt(" + args[0] + ")";
          if (callee.name === "std::max") return "Math.max(" + args.join(", ") + ")";
          if (callee.name === "std::min") return "Math.min(" + args.join(", ") + ")";
          // Exception constructors carry a message; the throw site
          // wraps it in `new Error(...)`, so the call itself is just
          // the message.
          if (callee.name === "std::runtime_error" || callee.name === "std::logic_error" ||
              callee.name === "std::invalid_argument" || callee.name === "std::out_of_range") {
            return args[0];
          }
          return callee.name + "(" + args.join(", ") + ")";
        }
        if (callee.type === "MemberExpression" && !callee.computed) {
          let obj = expr(callee.object);
          let method = callee.property.name;
          if (method === "push_back") return obj + ".push(" + args.join(", ") + ")";
          if (method === "size") return obj + ".length";
          if (method === "substr") return obj + ".substring(" + args.join(", ") + ")";
          return obj + "." + method + "(" + args.join(", ") + ")";
        }
        return stubExpr("call of computed callee");
      }
      case "SequenceExpression": {
        let parts = [];
        for (let ii = 0; ii < node.expressions.length; ++ii) parts.push(expr(node.expressions[ii]));
        return "(" + parts.join(", ") + ")";
      }
      default:
        return stubExpr("C++ expression " + node.type);
    }
  }

  function emitBody(block) {
    if (!block || !block.body || block.body.length === 0) return;
    indentLevel += 1;
    for (let ii = 0; ii < block.body.length; ++ii) stmt(block.body[ii]);
    indentLevel -= 1;
  }

  function stmt(node) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "EmptyStatement":
        return;
      case "BlockStatement":
        emitLine("{");
        emitBody(node);
        emitLine("}");
        return;
      case "VariableDeclaration": {
        for (let ii = 0; ii < node.declarations.length; ++ii) {
          let d = node.declarations[ii];
          let name = d.id.name;
          let prefix = declared[name] ? "" : "let ";
          declared[name] = true;
          emitLine(prefix + name + (d.init ? " = " + expr(d.init) : "") + ";");
        }
        return;
      }
      case "FunctionDeclaration": {
        let params = [];
        for (let ii = 0; ii < node.params.length; ++ii) {
          let p = node.params[ii];
          params.push(p.name + (p.default ? " = " + expr(p.default) : ""));
        }
        emitLine("function " + node.id.name + "(" + params.join(", ") + ") {");
        emitBody(node.body);
        emitLine("}");
        return;
      }
      case "ReturnStatement":
        emitLine(node.argument ? "return " + expr(node.argument) + ";" : "return;");
        return;
      case "ExpressionStatement": {
        let parts = flattenCout(node.expression);
        if (parts) {
          // C++ `<<` concatenates with no separator; JS console.log
          // joins multiple arguments with spaces — so join the parts
          // with `+` into a single argument instead.
          let args = [];
          for (let ii = 0; ii < parts.length; ++ii) args.push(expr(parts[ii]));
          emitLine("console.log(" + args.join(" + ") + ");");
          return;
        }
        emitLine(expr(node.expression) + ";");
        return;
      }
      case "IfStatement": {
        emitLine("if (" + expr(node.test) + ") {");
        emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { type: "BlockStatement", body: [node.consequent] });
        emitLine("}");
        let alt = node.alternate;
        while (alt) {
          if (alt.type === "IfStatement") {
            lines[lines.length - 1] = indentStr() + "} else if (" + expr(alt.test) + ") {";
            emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { type: "BlockStatement", body: [alt.consequent] });
            emitLine("}");
            alt = alt.alternate;
          } else {
            lines[lines.length - 1] = indentStr() + "} else {";
            emitBody(alt.type === "BlockStatement" ? alt : { type: "BlockStatement", body: [alt] });
            emitLine("}");
            alt = null;
          }
        }
        return;
      }
      case "ForStatement": {
        let init = "";
        if (node.init) {
          if (node.init.type === "VariableDeclaration") {
            let d = node.init.declarations[0];
            init = "let " + d.id.name + (d.init ? " = " + expr(d.init) : "");
            declared[d.id.name] = true;
          } else {
            init = expr(node.init);
          }
        }
        emitLine("for (" + init + "; " + (node.test ? expr(node.test) : "") + "; " + (node.update ? expr(node.update) : "") + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("}");
        return;
      }
      case "ForOfStatement": {
        let name = node.left.declarations[0].id.name;
        let prefix = declared[name] ? "" : "let ";
        if (prefix) declared[name] = true;
        noteOnce("forscope", "C++ range-for variables are loop-scoped; the translation declares them before the loop to match C++ scope (JS for-of would scope them to the loop).");
        emitLine(prefix + name + ";");
        emitLine("for (" + name + " of " + expr(node.right) + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("}");
        return;
      }
      case "WhileStatement":
        emitLine("while (" + expr(node.test) + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("}");
        return;
      case "DoWhileStatement":
        emitLine("do {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("} while (" + expr(node.test) + ");");
        return;
      case "SwitchStatement": {
        emitLine("switch (" + expr(node.discriminant) + ") {");
        indentLevel += 1;
        for (let ii = 0; ii < node.cases.length; ++ii) {
          let c = node.cases[ii];
          emitLine(c.test ? "case " + expr(c.test) + ":" : "default:");
          indentLevel += 1;
          for (let jj = 0; jj < c.consequent.length; ++jj) stmt(c.consequent[jj]);
          indentLevel -= 1;
        }
        indentLevel -= 1;
        emitLine("}");
        return;
      }
      case "TryStatement": {
        emitLine("try {");
        emitBody(node.block);
        emitLine("}");
        if (node.handler) {
          lines[lines.length - 1] = indentStr() + "} catch (" + (node.handler.param ? node.handler.param.name : "e") + ") {";
          emitBody(node.handler.body);
          emitLine("}");
        }
        return;
      }
      case "ThrowStatement":
        emitLine("throw new Error(" + expr(node.argument) + ");");
        return;
      case "BreakStatement":
        emitLine("break;");
        return;
      case "ContinueStatement":
        emitLine("continue;");
        return;
      default:
        unsupportedStmt("C++ statement " + node.type + " is not in the v1 scope");
        return;
    }
  }

  function run(ast) {
    for (let ii = 0; ii < ast.body.length; ++ii) {
      let item = ast.body[ii];
      if (item.type === "FunctionDeclaration" && item.id.name === "main") {
        noteOnce("main", "int main() is unwrapped: its body becomes the top-level program (its `return` is dropped).");
        for (let jj = 0; jj < item.body.body.length; ++jj) {
          let s = item.body.body[jj];
          if (s.type === "ReturnStatement") continue; // top-level return is not valid JS
          stmt(s);
        }
        continue;
      }
      stmt(item);
    }
    return lines.join("\n") + "\n";
  }

  return { run: run };
}

function translateFromCpp(code) {
  let report = newReport("cpp", "javascript", true);
  report.notes.push(
    "Static-only leg: there is no tracer for C++, so this translation uses the source alone — no runtime types, no branch evidence."
  );
  let parser = makeCppParser(code);
  let ast;
  try {
    ast = parser.parseProgram();
  } catch (e) {
    if (e instanceof CppParseError) {
      markUnsupported(report, "C++ subset parser", "could not parse the C++ source: " + e.message);
      return {
        code: 'throw new Error("IrohRedux: could not parse the C++ source: ' + e.message.replace(/"/g, "'") + '");\n',
        report: report,
      };
    }
    throw e;
  }
  if (ast.includes.length > 0) {
    report.notes.push("Preprocessor lines are skipped (they have no JS equivalent): " + ast.includes.join(", "));
  }
  let emitter = makeCppJSEmitter(report);
  let out = emitter.run(ast);
  let fnCount = 0;
  for (let ii = 0; ii < ast.body.length; ++ii) {
    if (ast.body[ii].type === "FunctionDeclaration") fnCount += 1;
  }
  if (fnCount > 0) report.clean.push({ construct: "functions", count: fnCount, detail: "function definitions translated" });
  return { code: out, report: report };
}

// ------------------------------------------------------------------
// Public entry points
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// IrohScript and BASIC (1.0.1 rework, part 2) — the translator learns
// the two new languages, both directions, and --translate accepts
// them. The design follows the 0.8.0 engine's rules: unsupported
// constructs are reported with a loud throwing stub, never silently
// mistranslated; every assumption cites its evidence.
//
// Legs:
//   IrohScript -> JavaScript: the IrohScript AST (from the bootstrap
//     compiler, via python3) is walked statically — the source's own
//     type annotations carry the types, so no trace is needed
//     (staticOnly: true).
//   BASIC -> JavaScript: the BASIC parse tree (from basic.py, via
//     python3) is walked statically (staticOnly: true). GOSUB
//     subroutines become functions; GOTO is not in the v1 scope and
//     is a loud stub (the pc-dispatch transform is the follow-up).
//   JavaScript -> IrohScript / BASIC: the JS emitter below walks the
//     Acorn AST with trace evidence, the way the Python/C++ legs do
//     (hybrid, staticOnly: false). IrohScript has no for-loop and no
//     arrays in v1, BASIC has no while loop and no real functions —
//     what cannot be expressed is a loud stub, not a guess.
//   Anything -> Python / C++ from IrohScript or BASIC, and
//     Python / C++ -> IrohScript or BASIC, go two-hop via JavaScript
//     (the JS leg in the middle is traced for its types, exactly as
//     the direct JS -> Python/C++ leg is). The report says so.
//   --direct stays JavaScript-only: the script tracers (Python, C++,
//     IrohScript, BASIC) run under spawnSync, so no directive can
//     reach them mid-run — the same limit Python/C++ already have.
//     Parity, not a gap introduced here.
// ------------------------------------------------------------------




// stdlib-only Python helper: reads BASIC source on stdin, parses it
// with basic.py's own parser, writes the parse tree as JSON on
// stdout (tuples become lists). No hand-rolled BASIC parser here.
const BASIC_AST_HELPER = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1] + '/src')",
  "from basic import parse_program",
  "def conv(v):",
  "    if isinstance(v, tuple):",
  "        return [conv(x) for x in v]",
  "    if isinstance(v, list):",
  "        return [conv(x) for x in v]",
  "    return v",
  "src = sys.stdin.read()",
  "try:",
  "    prog = parse_program(src)",
  "except Exception as exc:",
  "    sys.stderr.write('BasicError: %s\\n' % (exc,))",
  "    sys.exit(1)",
  "sys.stdout.write(json.dumps(conv(prog)))",
].join("\n");

// Default value for an IrohScript type (for LET with no initializer
// and for STRUCT field defaults). null means "a constructor call".
function irohTypeDefault(typeName) {
  if (typeName === "Int" || typeName === "Float") return "0";
  if (typeName === "String") return '""';
  if (typeName === "Bool") return "false";
  if (typeName && typeName.indexOf("Vector") === 0) return "[]";
  return null;
}

// IrohScript AST (JSON, node-tagged) -> JavaScript. Static-only: the
// source's type annotations carry the types, and the AST keeps the
// source's structure (Let/If/FunctionDef/Conditional/Action/Intent).
function makeIrohAstJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let needs = { pymod: false, action: false, intent: false };
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  let noted = {};
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  function noteOnce(key, text) {
    if (!noted[key]) { noted[key] = true; report.notes.push(text); }
  }
  function stubStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    emitLine("throw new Error(" + JSON.stringify("IrohRedux: " + detail) + ");");
  }
  let BIN_PREC = { OR: 1, AND: 2, EQ: 3, NEQ: 3, LT: 3, LE: 3, GT: 3, GE: 3, ADD: 4, SUB: 4, MUL: 5, DIV: 5, MOD: 5 };
  function exprPrec(node) {
    if (!node || typeof node !== "object") return 7;
    if (node.node === "BinOp") return BIN_PREC[node.op] || 1;
    if (node.node === "UnaryOp") return 6;
    return 7;
  }
  function expr(node, parentPrec) {
    if (!node || typeof node !== "object") return "undefined";
    let prec = exprPrec(node);
    let out = "";
    if (node.node === "Literal") {
      if (typeof node.value === "string") out = JSON.stringify(node.value);
      else if (typeof node.value === "number" || typeof node.value === "boolean") out = String(node.value);
      else if (node.value === null || node.value === void 0) out = "null";
      else out = JSON.stringify(node.value);
    } else if (node.node === "Name") {
      out = node.name;
    } else if (node.node === "BinOp") {
      if (node.op === "MOD") {
        needs.pymod = true;
        out = "__iroh_pymod(" + expr(node.left, 7) + ", " + expr(node.right, 7) + ")";
      } else {
        let map = { ADD: "+", SUB: "-", MUL: "*", DIV: "/", EQ: "===", NEQ: "!==", LT: "<", LE: "<=", GT: ">", GE: ">=", AND: "&&", OR: "||" };
        out = expr(node.left, prec) + " " + (map[node.op] || node.op) + " " + expr(node.right, prec + 1);
      }
    } else if (node.node === "UnaryOp") {
      out = (node.op === "NOT" ? "!" : "-") + expr(node.operand, 6);
    } else if (node.node === "Call") {
      out = expr(node.callee, 7) + "(" + node.args.map(function(a) { return expr(a, 0); }).join(", ") + ")";
    } else if (node.node === "MemberAccess") {
      out = expr(node.object, 7) + "." + node.member;
    } else {
      markUnsupported(report, node.node || "expression", "expression node '" + (node.node || "?") + "' is not in the v1 scope");
      out = "(function() { throw new Error(" + JSON.stringify("IrohRedux: expression '" + (node.node || "?") + "' is not in the v1 scope") + "); })()";
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function emitBlock(stmts) {
    indentLevel += 1;
    for (let ii = 0; ii < stmts.length; ++ii) stmt(stmts[ii]);
    indentLevel -= 1;
  }
  function stmt(node) {
    if (!node || typeof node.node !== "string") return;
    if (node.node === "Let" || node.node === "Const") {
      counts.variables += 1;
      let kw = node.node === "Const" ? "const " : "let ";
      if (node.value === null || node.value === void 0) {
        if (node.type) {
          let dflt = irohTypeDefault(node.type);
          if (dflt !== null) { emitLine(kw + node.name + " = " + dflt + ";"); return; }
          emitLine(kw + node.name + " = " + node.type + "();");
          return;
        }
        emitLine(kw + node.name + ";");
        return;
      }
      emitLine(kw + node.name + " = " + expr(node.value, 0) + ";");
      return;
    }
    if (node.node === "Assign") {
      emitLine(expr(node.target, 0) + " = " + expr(node.value, 0) + ";");
      return;
    }
    if (node.node === "Print") {
      counts.outputs += 1;
      emitLine("console.log(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "Action") {
      needs.action = true;
      emitLine("__iroh_action(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "If") {
      counts.conditionals += 1;
      emitLine("if (" + expr(node.cond, 0) + ") {");
      emitBlock(node.then);
      if (node.else && node.else.length > 0) {
        emitLine("} else {");
        emitBlock(node.else);
      }
      emitLine("}");
      return;
    }
    if (node.node === "Conditional") {
      counts.conditionals += 1;
      needs.action = true;
      emitLine("if (" + expr(node.condition, 0) + ") {");
      indentLevel += 1;
      emitLine("__iroh_action(" + expr(node.action, 0) + ");");
      indentLevel -= 1;
      emitLine("}");
      return;
    }
    if (node.node === "Loop") {
      // Amendment A2 (2026-11-21): the conditional LOOP <Bool-expr>
      // (Amendment A1) lowers to a while loop — same test-first
      // semantics. The legacy bare LOOP has no exit rule and stays
      // a loud stub.
      if (node.cond === null || node.cond === void 0) {
        stubStmt("the legacy bare IrohScript LOOP has no exit rule (Amendment A1 kept it a run-time error), so it cannot translate; the conditional LOOP <Bool-expr> form can", "Loop");
        return;
      }
      counts.loops += 1;
      emitLine("while (" + expr(node.cond, 0) + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "FunctionDef") {
      counts.functions += 1;
      let params = node.params.map(function(p) { return p.name; }).join(", ");
      emitLine("function " + node.name + "(" + params + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "Return") {
      emitLine(node.value ? "return " + expr(node.value, 0) + ";" : "return;");
      return;
    }
    if (node.node === "StructDef") {
      let fields = node.fields.map(function(f) {
        let dflt = irohTypeDefault(f.type);
        return f.name + ": " + (dflt !== null ? dflt : f.type + "()");
      }).join(", ");
      emitLine("function " + node.name + "() { return { " + fields + " }; }");
      return;
    }
    if (node.node === "EnumDef") {
      let members = node.members.map(function(m) { return m + ": " + JSON.stringify(m); }).join(", ");
      emitLine("var " + node.name + " = { " + members + " };");
      return;
    }
    if (node.node === "Import") {
      noteOnce("import-" + node.name, "IMPORT '" + node.name + "' has no runtime effect (namespaces are runtime extensions); the import was dropped.");
      return;
    }
    if (node.node === "Intent") {
      needs.intent = true;
      emitLine("__iroh_intent(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "Call") {
      emitLine(expr(node, 0) + ";");
      return;
    }
    stubStmt("statement node '" + node.node + "' is not in the v1 scope", node.node);
  }
  function run(ast) {
    let stmts = ast.statements || [];
    let fns = [];
    let rest = [];
    for (let ii = 0; ii < stmts.length; ++ii) {
      if (stmts[ii].node === "FunctionDef") fns.push(stmts[ii]);
      else rest.push(stmts[ii]);
    }
    for (let ii = 0; ii < fns.length; ++ii) stmt(fns[ii]);
    if (fns.length > 0 && rest.length > 0) lines.push("");
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    let header = [];
    if (needs.pymod) {
      header.push("function __iroh_pymod(a, b) { return ((a % b) + b) % b; }");
      header.push("");
    }
    if (needs.action) {
      header.push("var __iroh_actions = [];");
      header.push("function __iroh_action(v) { __iroh_actions.push(v); console.log(v); }");
      header.push("");
    }
    if (needs.intent) {
      header.push("var __iroh_intents = [];");
      header.push("function __iroh_intent(v) { __iroh_intents.push(v); }");
      header.push("");
    }
    return { text: header.concat(lines).join("\n") + "\n", counts: counts };
  }
  return { run: run, counts: counts };
}

// BASIC parse tree (JSON lists, from basic.py) -> JavaScript.
// Static-only. The program is flattened into slots in line order;
// GOSUB subroutines become hoisted functions, FOR/NEXT becomes a
// for loop, GOTO is not in the v1 scope (the pc-dispatch transform
// is the follow-up) and is a loud stub.
function makeBasicJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let needs = { pymod: false, input: false, dim: false };
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  let declared = {};
  let dimmed = {};
  let noted = {};
  let subTargets = [];
  let stepCounter = 0;
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  function noteOnce(key, text) {
    if (!noted[key]) { noted[key] = true; report.notes.push(text); }
  }
  function stubStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    emitLine("throw new Error(" + JSON.stringify("IrohRedux: " + detail) + ");");
  }
  let BIN_PREC = { OR: 1, AND: 2, "=": 3, "<>": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 };
  function exprPrec(node) {
    if (!node || !Array.isArray(node)) return 7;
    if (node[0] === "bin") return BIN_PREC[node[1]] || 1;
    if (node[0] === "un") return 6;
    return 7;
  }
  function expr(node, parentPrec) {
    if (!node || !Array.isArray(node)) return "undefined";
    let prec = exprPrec(node);
    let out = "";
    if (node[0] === "num" || node[0] === "str") {
      out = JSON.stringify(node[1]);
    } else if (node[0] === "var") {
      out = node[1];
    } else if (node[0] === "arr") {
      if (!dimmed[node[1]]) {
        markUnsupported(report, "ArrayExpression", "array '" + node[1] + "' is used without DIM");
        out = "(function() { throw new Error(" + JSON.stringify("IrohRedux: array '" + node[1] + "' is used without DIM") + "); })()";
      } else {
        out = node[1];
        for (let ii = 0; ii < node[2].length; ++ii) out += "[" + expr(node[2][ii], 0) + "]";
      }
    } else if (node[0] === "bin") {
      let op = node[1];
      if (op === "%") {
        needs.pymod = true;
        out = "__iroh_pymod(" + expr(node[2], 7) + ", " + expr(node[3], 7) + ")";
      } else {
        let map = { "=": "===", "<>": "!==", AND: "&&", OR: "||" };
        let jsOp = map[op] || op;
        out = expr(node[2], prec) + " " + jsOp + " " + expr(node[3], prec + 1);
      }
    } else if (node[0] === "un") {
      out = (node[1] === "NOT" ? "!" : "-") + expr(node[2], 6);
    } else {
      markUnsupported(report, "expression", "expression '" + node[0] + "' is not in the v1 scope");
      out = "(function() { throw new Error(" + JSON.stringify("IrohRedux: expression '" + node[0] + "' is not in the v1 scope") + "); })()";
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function emitPrint(items) {
    counts.outputs += 1;
    if (!items || items.length === 0) { emitLine("console.log();"); return; }
    let parts = [];
    let trailing = false;
    for (let ii = 0; ii < items.length; ++ii) {
      let item = items[ii];
      let sep = item.length > 1 ? item[1] : null;
      parts.push(expr(item[0], 0));
      if (sep === ";") { parts.push('""'); trailing = true; }
      else if (sep === ",") {
        noteOnce("print-zone", "PRINT with ',' moves to the next print zone (14 columns); translated as a tab.");
        parts.push('"\\t"');
        trailing = true;
      } else {
        trailing = false;
      }
    }
    let joined = parts.join(" + ");
    if (trailing) {
      noteOnce("print-trailing", "PRINT with a trailing separator writes without a newline (process.stdout.write, Node-only).");
      emitLine("process.stdout.write(" + joined + ");");
    } else {
      emitLine("console.log(" + joined + ");");
    }
  }
  // Emit a sequence of BASIC statements (a flat slot range, or one
  // IF branch list). `inSub` is true inside a GOSUB subroutine body;
  // `isFlat` is true when `items` is the program's flat slot array
  // (so subroutine ranges are skipped there, never inside a branch).
  function emitSeq(items, from, to, subRanges, inSub, isFlat) {
    let ii = from;
    while (ii < to) {
      if (isFlat) {
        let skipped = false;
        for (let kk = 0; kk < subTargets.length; ++kk) {
          let range = subRanges[subTargets[kk]];
          if (range && ii >= range.start && ii < range.end) { ii = range.end; skipped = true; break; }
        }
        if (skipped) continue;
      }
      let s = items[ii].stmt;
      let kind = s[0];
      if (kind === "rem") { ii += 1; continue; }
      if (kind === "let") {
        counts.variables += 1;
        if (!declared[s[1]]) { declared[s[1]] = true; emitLine("let " + s[1] + " = " + expr(s[2], 0) + ";"); }
        else emitLine(s[1] + " = " + expr(s[2], 0) + ";");
        ii += 1;
        continue;
      }
      if (kind === "setelem") {
        if (!dimmed[s[1]]) {
          stubStmt("array '" + s[1] + "' is assigned without DIM", "ArrayExpression");
          ii += 1;
          continue;
        }
        let target = s[1];
        for (let jj = 0; jj < s[2].length; ++jj) target += "[" + expr(s[2][jj], 0) + "]";
        emitLine(target + " = " + expr(s[3], 0) + ";");
        ii += 1;
        continue;
      }
      if (kind === "dim") {
        dimmed[s[1]] = true;
        needs.dim = true;
        let fill = s[1].charAt(s[1].length - 1) === "$" ? '""' : "0";
        let sizes = s[2].map(function(e) { return expr(e, 0); }).join(", ");
        if (!declared[s[1]]) { declared[s[1]] = true; emitLine("let " + s[1] + " = __basic_dim([" + sizes + "], " + fill + ");"); }
        else emitLine(s[1] + " = __basic_dim([" + sizes + "], " + fill + ");");
        ii += 1;
        continue;
      }
      if (kind === "print") { emitPrint(s[1]); ii += 1; continue; }
      if (kind === "input") {
        needs.input = true;
        for (let jj = 0; jj < s[2].length; ++jj) {
          let name = s[2][jj];
          let prompt = jj === 0 ? s[1] : null;
          let call = "__basic_input(" + (prompt === null ? "null" : JSON.stringify(prompt)) + ")";
          if (name.charAt(name.length - 1) === "$") {
            if (!declared[name]) { declared[name] = true; emitLine("let " + name + " = " + call + ";"); }
            else emitLine(name + " = " + call + ";");
          } else {
            if (!declared[name]) { declared[name] = true; emitLine("let " + name + " = Number(" + call + ");"); }
            else emitLine(name + " = Number(" + call + ");");
          }
        }
        noteOnce("input-lines", "INPUT reads one line per variable; a comma-separated line is not split (BASIC reads several values from one line).");
        ii += 1;
        continue;
      }
      if (kind === "if") {
        counts.conditionals += 1;
        emitLine("if (" + expr(s[1], 0) + ") {");
        indentLevel += 1;
        emitStmtList(s[2], subRanges, inSub);
        indentLevel -= 1;
        if (s[3] && s[3].length > 0) {
          emitLine("} else {");
          indentLevel += 1;
          emitStmtList(s[3], subRanges, inSub);
          indentLevel -= 1;
        }
        emitLine("}");
        ii += 1;
        continue;
      }
      if (kind === "for") {
        counts.loops += 1;
        let depth = 1;
        let nextIdx = -1;
        for (let jj = ii + 1; jj < to; ++jj) {
          if (items[jj].stmt[0] === "for") depth += 1;
          if (items[jj].stmt[0] === "next") {
            depth -= 1;
            if (depth === 0) { nextIdx = jj; break; }
          }
        }
        if (nextIdx === -1) {
          stubStmt("FOR '" + s[1] + "' has no matching NEXT in the v1 scope", "ForStatement");
          ii += 1;
          continue;
        }
        let varName = s[1];
        if (!declared[varName]) { declared[varName] = true; emitLine("let " + varName + ";"); }
        let stepExpr = s[4] === null || s[4] === void 0 ? "1" : expr(s[4], 0);
        let stepVal = s[4] === null || s[4] === void 0 ? 1 : (s[4][0] === "num" ? s[4][1] : null);
        let stepIsLiteral = stepVal !== null;
        let stepName = null;
        let test;
        if (stepIsLiteral && stepVal >= 0) test = varName + " <= " + expr(s[3], 0);
        else if (stepIsLiteral) test = varName + " >= " + expr(s[3], 0);
        else {
          stepCounter += 1;
          stepName = "__basic_step_" + stepCounter;
          test = "(" + stepName + " >= 0 ? " + varName + " <= " + expr(s[3], 0) + " : " + varName + " >= " + expr(s[3], 0) + ")";
        }
        if (!stepIsLiteral) emitLine("let " + stepName + " = " + stepExpr + ";");
        emitLine("for (" + varName + " = " + expr(s[2], 0) + "; " + test + "; " + varName + " += " + (stepIsLiteral ? stepExpr : stepName) + ") {");
        indentLevel += 1;
        emitSeq(items, ii + 1, nextIdx, subRanges, inSub, isFlat);
        indentLevel -= 1;
        emitLine("}");
        ii = nextIdx + 1;
        continue;
      }
      if (kind === "next") {
        stubStmt("NEXT without a matching FOR", "ForStatement");
        ii += 1;
        continue;
      }
      if (kind === "gosub") {
        if (!(s[1] in subRanges)) {
          stubStmt("GOSUB target line " + s[1] + " does not exist", "GOSUB");
        } else {
          emitLine("__gosub_" + s[1] + "();");
        }
        ii += 1;
        continue;
      }
      if (kind === "goto") {
        stubStmt("GOTO line " + s[1] + " is not in the v1 scope (the pc-dispatch transform is the follow-up)", "GOTO");
        ii += 1;
        continue;
      }
      if (kind === "return") {
        if (inSub) emitLine("return;");
        else stubStmt("RETURN outside a GOSUB subroutine", "RETURN");
        ii += 1;
        continue;
      }
      if (kind === "end" || kind === "stop") {
        emitLine("process.exit(0);");
        ii += 1;
        continue;
      }
      stubStmt("statement '" + kind + "' is not in the v1 scope", kind);
      ii += 1;
    }
    return ii;
  }
  function emitStmtList(stmts, subRanges, inSub) {
    let items = [];
    for (let ii = 0; ii < stmts.length; ++ii) items.push({ stmt: stmts[ii] });
    emitSeq(items, 0, items.length, subRanges, inSub, false);
  }
  function run(prog) {
    let flat = [];
    let lineMap = {};
    for (let ii = 0; ii < prog.length; ++ii) {
      let lineNo = prog[ii][0];
      let stmts = prog[ii][2] || [];
      if (lineNo !== null && lineNo !== void 0 && !(lineNo in lineMap)) lineMap[lineNo] = flat.length;
      for (let jj = 0; jj < stmts.length; ++jj) flat.push({ stmt: stmts[jj], line: lineNo });
    }
    let subRanges = {};
    let gosubTargets = [];
    for (let ii = 0; ii < flat.length; ++ii) {
      if (flat[ii].stmt[0] === "gosub") {
        let target = flat[ii].stmt[1];
        if (gosubTargets.indexOf(target) === -1) gosubTargets.push(target);
      }
    }
    for (let ii = 0; ii < gosubTargets.length; ++ii) {
      let target = gosubTargets[ii];
      let start = lineMap[target];
      if (start === void 0) continue;
      let end = flat.length;
      for (let jj = start; jj < flat.length; ++jj) {
        if (flat[jj].stmt[0] === "return") { end = jj + 1; break; }
        if (flat[jj].stmt[0] === "end" || flat[jj].stmt[0] === "stop") { end = jj; break; }
      }
      subRanges[target] = { start: start, end: end };
      counts.functions += 1;
    }
    for (let ii = 0; ii < gosubTargets.length; ++ii) {
      let target = gosubTargets[ii];
      let range = subRanges[target];
      if (!range) continue;
      emitLine("function __gosub_" + target + "() {");
      indentLevel += 1;
      emitSeq(flat, range.start, range.end, subRanges, true, false);
      indentLevel -= 1;
      emitLine("}");
    }
    if (gosubTargets.length > 0) lines.push("");
    subTargets = gosubTargets;
    // Mainline: one pass over the flat slots; emitSeq skips the
    // subroutine ranges itself.
    emitSeq(flat, 0, flat.length, subRanges, false, true);
    let header = [];
    if (needs.pymod) {
      header.push("function __iroh_pymod(a, b) { return ((a % b) + b) % b; }");
      header.push("");
    }
    if (needs.dim) {
      header.push("function __basic_dim(sizes, fill) {");
      header.push("  if (sizes.length === 0) return fill;");
      header.push("  var arr = new Array(sizes[0] + 1);");
      header.push("  for (var i = 0; i < arr.length; ++i) arr[i] = __basic_dim(sizes.slice(1), fill);");
      header.push("  return arr;");
      header.push("}");
      header.push("");
    }
    if (needs.input) {
      header.push("var __basic_input_lines = null;");
      header.push("var __basic_input_at = 0;");
      header.push("function __basic_input(prompt) {");
      header.push("  if (prompt) process.stdout.write(prompt);");
      header.push("  if (__basic_input_lines === null) {");
      header.push("    __basic_input_lines = require(\"fs\").readFileSync(0, \"utf8\").split(\"\\n\");");
      header.push("  }");
      header.push("  var line = __basic_input_at < __basic_input_lines.length ? __basic_input_lines[__basic_input_at++] : \"\";");
      header.push("  return line;");
      header.push("}");
      header.push("");
      noteOnce("input-node", "INPUT in translated JavaScript reads stdin with require(\"fs\") (Node-only).");
    }
    return { text: header.concat(lines).join("\n") + "\n", counts: counts };
  }
  return { run: run, counts: counts };
}

function translateFromIrohscript(code, childProcess, options) {
  let report = newReport("irohscript", "javascript", true);
  let ast = runIrohscriptPython(code, options, childProcess, IROHSCRIPT_AST_HELPER, "IrohScript");
  let emitter = makeIrohAstJSEmitter(report);
  let out = emitter.run(ast);
  finishSourceLeg(report, out.counts);
  return { code: out.text, report: report };
}

function translateFromBasic(code, childProcess, options) {
  let report = newReport("basic", "javascript", true);
  let prog = runIrohscriptPython(code, options, childProcess, BASIC_AST_HELPER, "BASIC");
  let emitter = makeBasicJSEmitter(report);
  let out = emitter.run(prog);
  finishSourceLeg(report, out.counts);
  return { code: out.text, report: report };
}

// Shared report tail for the static-only source legs: the same
// "clean" entries translateFromJS writes, so every leg reports the
// same way.
function finishSourceLeg(report, c) {
  if (c.functions > 0) {
    report.clean.push({ construct: "functions", count: c.functions, detail: "function declarations translated" });
  }
  if (c.variables > 0) {
    report.clean.push({ construct: "variables", count: c.variables, detail: "variable declarations translated" });
  }
  if (c.loops > 0) {
    report.clean.push({ construct: "loops", count: c.loops, detail: "loops translated" });
  }
  if (c.conditionals > 0) {
    report.clean.push({ construct: "conditionals", count: c.conditionals, detail: "if statements translated" });
  }
  if (c.outputs > 0) {
    report.clean.push({ construct: "console-output", count: c.outputs, detail: "print statements translated" });
  }
}

// Map a C++ type (the spelling buildTraceEnv / inferType produce)
// to the IrohScript type name. null means "no annotation".
function irohTypeOfCpp(cppType) {
  if (!cppType) return null;
  if (cppType === "int") return "Int";
  if (cppType === "double") return "Float";
  if (cppType === "std::string") return "String";
  if (cppType === "bool") return "Bool";
  let m = /^std::vector<(.+)>$/.exec(cppType);
  if (m) {
    let inner = irohTypeOfCpp(m[1]);
    return inner ? "Vector<" + inner + ">" : null;
  }
  return null;
}

// JavaScript AST (Acorn) -> IrohScript or BASIC. Hybrid like the
// Python/C++ legs: the caller traces the program first and env
// carries the evidence. v1 scope is the same as the other legs
// (functions, arithmetic, loops, conditionals, arrays, strings,
// console output) minus what the target language cannot express:
// IrohScript has no for-loop and no arrays; BASIC has no while loop
// and no real functions (they become GOSUB subroutines). What cannot
// be expressed is a loud stub, not a guess.
function makeIrohJSEmitter(target, report, env, hints) {
  let isIroh = target === "irohscript";
  let lines = [];
  let indentLevel = 0;
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  let declared = {};
  let noted = {};
  let ctx = { vars: {} };
  for (let k in env.vars) ctx.vars[k] = env.vars[k].type;
  if (hints && hints.variables) {
    for (let k in hints.variables) ctx.vars[k] = hints.variables[k];
  }
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  function noteOnce(key, text) {
    if (!noted[key]) { noted[key] = true; report.notes.push(text); }
  }
  function assumeOnce(key, what, evidence) {
    if (!noted[key]) {
      noted[key] = true;
      recordAssumption(report, what, evidence);
    }
  }
  function stubStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    if (isIroh) emitLine("__iroh_unsupported(" + JSON.stringify(detail) + ");");
    else {
      emitLine("PRINT " + basicQuote("IrohRedux: " + detail));
      emitLine("END");
    }
  }
  function stubExpr(detail, construct) {
    markUnsupported(report, construct, detail);
    if (isIroh) return "__iroh_unsupported(" + JSON.stringify(detail) + ")";
    return "(1 / 0)";
  }
  function basicQuote(s) {
    return '"' + String(s).replace(/"/g, '""') + '"';
  }
  function irohTypeOf(node) {
    let t = null;
    try { t = inferType(node, ctx); } catch (e) { t = null; }
    return irohTypeOfCpp(t);
  }
  function paramType(fnName, idx, node) {
    if (hints && hints.functions && hints.functions[fnName] && hints.functions[fnName].params) {
      let p = hints.functions[fnName].params[idx];
      if (p) return irohTypeOfCpp(p);
    }
    let f = env.funcs && env.funcs[fnName];
    if (f && f.args && idx < f.args.length) return irohTypeOfCpp(cppTypeOfValue(f.args[idx]));
    if (node) return irohTypeOf(node);
    return null;
  }
  function expr(node, parentPrec) {
    if (!node || typeof node.type !== "string") return "undefined";
    let prec = precedence(node);
    let out = "";
    if (node.type === "Literal") {
      if (typeof node.value === "string") out = isIroh ? JSON.stringify(node.value) : basicQuote(node.value);
      else if (typeof node.value === "number") out = String(node.value);
      else if (typeof node.value === "boolean") out = isIroh ? (node.value ? "True" : "False") : (node.value ? "-1" : "0");
      else if (node.value === null) {
        out = stubExpr("null has no equivalent in " + target, "Literal");
      } else {
        out = JSON.stringify(node.value);
      }
    } else if (node.type === "Identifier") {
      out = node.name;
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      let op = node.operator;
      if (op === "%") {
        assumeOnce("js-mod", "JavaScript % truncates toward zero; " + (isIroh ? "IrohScript" : "BASIC") + " % floors (Python-style); results differ when the left operand is negative", "IrohScript/BASIC % is Python-style floored modulo (bootstrap interpreter, basic.py); JavaScript % truncates toward zero");
        out = expr(node.left, prec) + " % " + expr(node.right, prec + 1);
      } else if (op === "**") {
        out = stubExpr("the ** operator has no equivalent in " + target, "BinaryExpression");
      } else if (op === "==" || op === "!=") {
        assumeOnce("loose-eq", "JavaScript loose equality (==/!=) is translated as strict equality (===/!==); values of different types compare differently", "no loose-equality operator exists in " + target);
        let jsOp = op === "==" ? (isIroh ? "==" : "=") : (isIroh ? "!=" : "<>");
        out = expr(node.left, prec) + " " + jsOp + " " + expr(node.right, prec + 1);
      } else if (op === "===" || op === "!==") {
        let jsOp = op === "===" ? (isIroh ? "==" : "=") : (isIroh ? "!=" : "<>");
        out = expr(node.left, prec) + " " + jsOp + " " + expr(node.right, prec + 1);
      } else if (op === "&&" || op === "||") {
        let jsOp = op === "&&" ? "AND" : "OR";
        out = expr(node.left, prec) + " " + jsOp + " " + expr(node.right, prec + 1);
      } else if (op === "instanceof" || op === "in") {
        out = stubExpr("the " + op + " operator has no equivalent in " + target, "BinaryExpression");
      } else {
        out = expr(node.left, prec) + " " + op + " " + expr(node.right, prec + 1);
      }
    } else if (node.type === "UnaryExpression") {
      if (node.operator === "!") out = "NOT " + expr(node.argument, 6);
      else if (node.operator === "-") out = "-" + expr(node.argument, 6);
      else {
        out = stubExpr("unary " + node.operator + " has no equivalent in " + target, "UnaryExpression");
      }
    } else if (node.type === "CallExpression") {
      let callee = node.callee;
      if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && callee.object.name === "console" && callee.property.name === "log") {
        out = stubExpr("console.log as a value (not a statement) has no equivalent in " + target, "CallExpression");
      } else if (callee.type === "Identifier") {
        out = callee.name + "(" + node.arguments.map(function(a) { return expr(a, 0); }).join(", ") + ")";
      } else if (callee.type === "MemberExpression" && !callee.computed) {
        if (!isIroh) {
          out = stubExpr("method calls have no equivalent in BASIC", "CallExpression");
        } else {
          out = expr(callee.object, 7) + "." + callee.property.name + "(" + node.arguments.map(function(a) { return expr(a, 0); }).join(", ") + ")";
          noteOnce("member-call", "a method call was translated as a dotted call; the callee must be a plain function at runtime");
        }
      } else {
        out = stubExpr("computed or indirect calls are not in the v1 scope", "CallExpression");
      }
    } else if (node.type === "MemberExpression") {
      if (calleeComputed(node)) {
        if (isIroh) {
          out = stubExpr("computed member access (arrays) has no equivalent in IrohScript v1", "MemberExpression");
        } else {
          out = expr(node.object, 7) + "(" + expr(node.property, 0) + ")";
        }
      } else {
        out = expr(node.object, 7) + "." + node.property.name;
      }
    } else if (node.type === "ArrayExpression") {
      out = stubExpr("array literals are only supported as a variable initializer for BASIC; use a variable declaration", "ArrayExpression");
    } else if (node.type === "ConditionalExpression") {
      out = stubExpr("the ?: operator has no equivalent in " + target, "ConditionalExpression");
    } else if (node.type === "TemplateLiteral") {
      out = stubExpr("template literals have no equivalent in " + target, "TemplateLiteral");
    } else if (node.type === "UpdateExpression") {
      out = stubExpr("++ / -- as a value has no equivalent in " + target + " (use it as a statement)", "UpdateExpression");
    } else {
      out = stubExpr("expression " + node.type + " is not in the v1 scope", node.type);
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function calleeComputed(node) { return !!node.computed; }
  function isConsoleLog(node) {
    return node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed &&
      node.callee.object.type === "Identifier" && node.callee.object.name === "console" &&
      node.callee.property.name === "log";
  }
  function isProcessExit(node) {
    return node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed &&
      node.callee.object.type === "Identifier" && node.callee.object.name === "process" &&
      node.callee.property.name === "exit";
  }
  // Classic numeric for (the same pattern the Python/C++ emitter
  // uses): for (let i = A; i <op> B; update). Returns null when the
  // loop is not in that shape.
  function forLoopPattern(node) {
    // Classic numeric for: for (let i = A; i <op> B; update), or
    // for (i = A; i <op> B; update) with i declared earlier (the
    // BASIC leg emits the second form so the loop variable stays
    // visible after the loop, the way BASIC scoping works).
    let name = null;
    let start = null;
    if (node.init && node.init.type === "VariableDeclaration") {
      if (node.init.declarations.length !== 1) return null;
      let decl = node.init.declarations[0];
      if (decl.id.type !== "Identifier" || !decl.init) return null;
      name = decl.id.name;
      start = decl.init;
    } else if (node.init && node.init.type === "AssignmentExpression" && node.init.operator === "=" && node.init.left.type === "Identifier") {
      name = node.init.left.name;
      start = node.init.right;
    } else return null;
    if (!node.test || node.test.type !== "BinaryExpression") return null;
    let test = node.test;
    if (test.left.type !== "Identifier" || test.left.name !== name) return null;
    if (["<", "<=", ">", ">="].indexOf(test.operator) === -1) return null;
    let step = null;
    let upd = node.update;
    if (!upd) return null;
    if (upd.type === "UpdateExpression" && upd.argument.type === "Identifier" && upd.argument.name === name) {
      step = upd.operator === "++" ? 1 : -1;
    } else if (upd.type === "AssignmentExpression" && upd.left.type === "Identifier" && upd.left.name === name) {
      if (upd.operator === "+=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = upd.right.value;
      else if (upd.operator === "-=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = -upd.right.value;
      else return null;
    } else return null;
    return { name: name, start: start, op: test.operator, end: test.right, step: step };
  }
  function emitBody(block) {
    if (!block || !block.body) return;
    indentLevel += 1;
    for (let ii = 0; ii < block.body.length; ++ii) stmt(block.body[ii]);
    indentLevel -= 1;
  }
  function emitFunction(fnNode, fnName) {
    counts.functions += 1;
    let params = fnNode.params.map(function(p, idx) {
      if (p.type !== "Identifier") return null;
      if (isIroh) {
        let t = paramType(fnName, idx, p);
        return t ? p.name + " : " + t : p.name;
      }
      return p.name;
    });
    if (params.indexOf(null) !== -1) {
      stubStmt("function '" + fnName + "' has non-identifier parameters, which are not in the v1 scope", "FunctionDeclaration");
      return;
    }
    if (isIroh) {
      emitLine("FUNCTION " + fnName + "(" + params.join(", ") + ")");
      emitBody(fnNode.body);
      emitLine("END FUNCTION");
      return;
    }
    // BASIC: a function becomes a GOSUB subroutine, emitted at the
    // end of the program (see run()). Its line number is assigned
    // here so calls anywhere — including before the declaration, the
    // way JS hoisting allows — resolve.
    if (!(fnName in subLines)) {
      subLines[fnName] = subLineBase;
      subLineBase += 1000;
    }
    if (callsItself(fnNode, fnName)) {
      markUnsupported(report, "FunctionDeclaration", "recursive function '" + fnName + "' cannot be a BASIC GOSUB subroutine (arguments and the return value share globals)");
      subroutines.push({ node: fnNode, name: fnName, params: params, stub: true });
      return;
    }
    subroutines.push({ node: fnNode, name: fnName, params: params });
  }
  let subroutines = [];
  let subLines = {};
  let subLineBase = 1000;
  let currentSub = null;
  function stmt(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "BlockStatement") {
      for (let ii = 0; ii < node.body.length; ++ii) stmt(node.body[ii]);
      return;
    }
    if (node.type === "EmptyStatement") return;
    if (node.type === "VariableDeclaration") {
      for (let ii = 0; ii < node.declarations.length; ++ii) {
        let d = node.declarations[ii];
        counts.variables += 1;
        if (d.id.type !== "Identifier") {
          stubStmt("destructuring declaration is not in the v1 scope", "VariableDeclaration");
          continue;
        }
        if (d.init && d.init.type === "ArrowFunctionExpression") {
          let fnNode = {
            type: "FunctionDeclaration",
            id: d.id,
            params: d.init.params,
            body: d.init.body.type === "BlockStatement"
              ? d.init.body
              : { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: d.init.body }] },
          };
          emitFunction(fnNode, d.id.name);
          continue;
        }
        if (!isIroh && d.init) {
          let lifted = liftExpr(d.init);
          emitLifts(lifted.lifts);
          d.init = lifted.expr;
        }
        if (!isIroh && d.init && d.init.type === "ArrayExpression") {
          let n = d.init.elements.length;
          if (n === 0) {
            stubStmt("an empty array has no BASIC DIM form", "ArrayExpression");
            continue;
          }
          let hasHole = false;
          for (let jj = 0; jj < n; ++jj) if (d.init.elements[jj] === null) hasHole = true;
          if (hasHole) {
            stubStmt("a hole in an array literal has no BASIC equivalent", "ArrayExpression");
            continue;
          }
          emitLine("DIM " + d.id.name + "(" + (n - 1) + ")");
          for (let jj = 0; jj < n; ++jj) {
            emitLine(d.id.name + "(" + jj + ") = " + expr(d.init.elements[jj], 0));
          }
          declared[d.id.name] = true;
          continue;
        }
        if (isIroh) {
          let ann = d.init ? irohTypeOf(d.init) : null;
          if (!ann && ctx.vars[d.id.name]) ann = irohTypeOfCpp(ctx.vars[d.id.name]);
          let kw = node.kind === "const" ? "CONST " : "LET ";
          emitLine(kw + d.id.name + (ann ? " : " + ann : "") + (d.init ? " = " + expr(d.init, 0) : ""));
        } else {
          emitLine("LET " + d.id.name + (d.init ? " = " + expr(d.init, 0) : " = 0"));
        }
        declared[d.id.name] = true;
        if (d.init) {
          let t = null;
          try { t = inferType(d.init, ctx); } catch (e) { t = null; }
          if (t) ctx.vars[d.id.name] = t;
        }
      }
      return;
    }
    if (node.type === "FunctionDeclaration") {
      emitFunction(node, node.id.name);
      return;
    }
    if (node.type === "ReturnStatement") {
      if (!isIroh && currentSub) {
        if (node.argument) {
          let lifted = liftExpr(node.argument);
          emitLifts(lifted.lifts);
          emitLine("LET __ret_" + currentSub + " = " + expr(lifted.expr, 0));
        }
        emitLine("RETURN");
        return;
      }
      if (!isIroh && !currentSub) {
        emitLine("END");
        return;
      }
      emitLine(node.argument ? "RETURN " + expr(node.argument, 0) : "RETURN");
      return;
    }
    if (node.type === "ExpressionStatement") {
      let e = node.expression;
      if (isConsoleLog(e)) {
        counts.outputs += 1;
        if (isIroh) {
          if (e.arguments.length === 0) emitLine("PRINT \"\"");
          else if (e.arguments.length === 1) emitLine("PRINT " + expr(e.arguments[0], 0));
          else {
            noteOnce("console-log-multi", "console.log with several arguments prints each on its own line in IrohScript (PRINT takes one value).");
            for (let ii = 0; ii < e.arguments.length; ++ii) emitLine("PRINT " + expr(e.arguments[ii], 0));
          }
        } else {
          let lifted = liftCalls(node);
          emitLifts(lifted.lifts);
          let le = lifted.node.expression;
          let parts = [];
          for (let ii = 0; ii < le.arguments.length; ++ii) {
            parts.push(expr(le.arguments[ii], 0));
            if (ii < le.arguments.length - 1) parts.push('""');
          }
          if (parts.length === 0) emitLine("PRINT");
          else if (parts.length === 1) emitLine("PRINT " + parts[0]);
          else emitLine("PRINT " + parts.join(" ; "));
        }
        return;
      }
      if (isProcessExit(e)) {
        // process.exit(code): the program ends. BASIC has END for
        // this (the exit code is dropped — BASIC END takes none).
        // IrohScript has no program-end primitive, so it is a loud
        // stub, not a silent `process.exit` that would fail later
        // with an undeclared-name error.
        if (!isIroh) { emitLine("END"); return; }
        stubStmt("process.exit (ending the program) has no equivalent in IrohScript — IrohScript has no program-end primitive", "CallExpression");
        return;
      }
      if (!isIroh) {
        let lifted = liftCalls(node);
        emitLifts(lifted.lifts);
        stmtExpr(lifted.node.expression);
        return;
      }
      stmtExpr(e);
      return;
    }
    if (node.type === "IfStatement") {
      counts.conditionals += 1;
      if (isIroh) {
        emitLine("IF " + expr(node.test, 0));
        emitBody(node.consequent);
        if (node.alternate) {
          emitLine("ELSE");
          if (node.alternate.type === "BlockStatement") emitBody(node.alternate);
          else stmt(node.alternate);
        }
        emitLine("END IF");
        return;
      }
      let lifted = liftExpr(node.test);
      emitLifts(lifted.lifts);
      let n = node;
      let thenStr = inlineBranch(n.consequent);
      let elseStr = n.alternate ? inlineBranch(n.alternate) : null;
      if (thenStr === null || (n.alternate && elseStr === null)) {
        stubStmt("an IF branch that cannot be written on one BASIC line (a loop, a return, a call, or a GOTO) is not in the v1 scope", "IfStatement");
        return;
      }
      let line = "IF " + expr(lifted.expr, 0) + " THEN " + thenStr;
      if (elseStr !== null) line += " ELSE " + elseStr;
      emitLine(line);
      return;
    }
    if (node.type === "ForStatement") {
      if (isIroh) {
        stubStmt("a for-loop is still out of scope for IrohScript v1 (Amendment A2 lowers while loops into the conditional LOOP; a numeric for-loop can be rewritten by hand as a LET plus a LOOP)", "ForStatement");
        return;
      }
      let pat = forLoopPattern(node);
      if (!pat) {
        stubStmt("only a classic numeric for-loop translates to BASIC FOR/NEXT", "ForStatement");
        return;
      }
      counts.loops += 1;
      let startNode = pat.start;
      let endNode = pat.end;
      let ls = liftExpr(pat.start);
      emitLifts(ls.lifts);
      startNode = ls.expr;
      let le = liftExpr(pat.end);
      emitLifts(le.lifts);
      endNode = le.expr;
      let endText;
      if (pat.op === "<") endText = simpleExprText(endNode) + " - 1";
      else if (pat.op === "<=") endText = expr(endNode, 0);
      else if (pat.op === ">") endText = simpleExprText(endNode) + " + 1";
      else endText = expr(endNode, 0);
      let stepText = pat.step === 1 ? "" : " STEP " + String(pat.step);
      emitLine("FOR " + pat.name + " = " + expr(startNode, 0) + " TO " + endText + stepText);
      emitBody(node.body);
      emitLine("NEXT " + pat.name);
      return;
    }
    if (node.type === "WhileStatement") {
      // Amendment A2 (2026-11-21): a JavaScript while lowers into
      // the conditional IrohScript LOOP (Amendment A1) — the same
      // test-first semantics. BASIC stays a loud stub.
      if (!isIroh) {
        stubStmt("a while loop has no equivalent in " + target + " v1", "WhileStatement");
        return;
      }
      counts.loops += 1;
      emitLine("LOOP " + expr(node.test, 0));
      emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
      emitLine("END LOOP");
      return;
    }
    if (node.type === "DoWhileStatement") {
      stubStmt("a do-while loop cannot be test-first (it runs its body before the first test), and " + target + " has no post-test loop", "DoWhileStatement");
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "LabeledStatement") {
      stubStmt(node.type + " is not in the v1 scope", node.type);
      return;
    }
    stubStmt("statement " + node.type + " is not in the v1 scope", node.type);
  }
  function simpleExprText(node) {
    if (node.type === "Literal" || node.type === "Identifier") return expr(node, 0);
    return "(" + expr(node, 0) + ")";
  }
  function stmtExpr(e) {
    if (e.type === "AssignmentExpression") {
      let target = e.left;
      if (target.type !== "Identifier" && target.type !== "MemberExpression") {
        stubStmt("assignment to a non-identifier target is not in the v1 scope", "AssignmentExpression");
        return;
      }
      let name = target.type === "Identifier" ? target.name : expr(target, 0);
      let right = e.right;
      if (!isIroh) {
        let lifted = liftExpr(e.right);
        emitLifts(lifted.lifts);
        right = lifted.expr;
      }
      if (e.operator === "=") {
        if (isIroh && !declared[name] && target.type === "Identifier") {
          let ann = irohTypeOf(right);
          emitLine("LET " + name + (ann ? " : " + ann : "") + " = " + expr(right, 0));
          declared[name] = true;
        } else {
          emitLine(name + " = " + expr(right, 0));
        }
        return;
      }
      let op = null;
      if (e.operator === "+=") op = "+";
      else if (e.operator === "-=") op = "-";
      else if (e.operator === "*=") op = "*";
      else if (e.operator === "/=") op = "/";
      else if (e.operator === "%=") op = "%";
      if (!op) {
        stubStmt("assignment operator " + e.operator + " is not in the v1 scope", "AssignmentExpression");
        return;
      }
      if (op === "%") {
        assumeOnce("js-mod", "JavaScript % truncates toward zero; " + (isIroh ? "IrohScript" : "BASIC") + " % floors (Python-style); results differ when the left operand is negative", "IrohScript/BASIC % is Python-style floored modulo (bootstrap interpreter, basic.py); JavaScript % truncates toward zero");
      }
      emitLine(name + " = " + name + " " + op + " " + expr(right, 0));
      return;
    }
    if (e.type === "UpdateExpression" && e.argument.type === "Identifier") {
      let delta = e.operator === "++" ? "1" : "-1";
      emitLine(e.argument.name + " = " + e.argument.name + " + " + delta);
      return;
    }
    if (e.type === "CallExpression") {
      emitLine(expr(e, 0));
      return;
    }
    stubStmt("expression statement " + e.type + " is not in the v1 scope", e.type);
  }
  // BASIC only: replace every plain function call in a cloned statement
  // with a temp, and return the GOSUB lifts to emit before it. Function
  // bodies are never descended into — their calls belong to the
  // subroutine, not to the statement that declares the function.
  function liftCalls(node) {
    let lifts = [];
    let tempCounter = { n: 0 };
    function walk(n) {
      if (!n || typeof n !== "object") return n;
      if (Array.isArray(n)) {
        for (let ii = 0; ii < n.length; ++ii) n[ii] = walk(n[ii]);
        return n;
      }
      if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
        return n;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier") {
        for (let ii = 0; ii < n.arguments.length; ++ii) n.arguments[ii] = walk(n.arguments[ii]);
        tempCounter.n += 1;
        let temp = "__tmp" + tempCounter.n;
        lifts.push({ fn: n.callee.name, args: n.arguments, temp: temp });
        return { type: "Identifier", name: temp };
      }
      let keys = Object.keys(n);
      for (let ii = 0; ii < keys.length; ++ii) {
        let v = n[keys[ii]];
        if (v && typeof v === "object") n[keys[ii]] = walk(v);
      }
      return n;
    }
    let cloned = JSON.parse(JSON.stringify(node));
    let out = walk(cloned);
    return { node: out, lifts: lifts };
  }
  // BASIC only: lift the calls out of one expression (not a whole
  // statement — a call inside an IF branch or a loop body must stay
  // where it executes, so those places lift just the expression they
  // always evaluate). Returns { expr, lifts }.
  function liftExpr(node) {
    let wrapped = { type: "ExpressionStatement", expression: node };
    let lifted = liftCalls(wrapped);
    return { expr: lifted.node.expression, lifts: lifted.lifts };
  }
  function emitLifts(lifts) {
    for (let ii = 0; ii < lifts.length; ++ii) {
      let lift = lifts[ii];
      if (!(lift.fn in subLines)) {
        stubStmt("call to '" + lift.fn + "' cannot be a GOSUB subroutine (the function was not declared in this program)", "CallExpression");
        continue;
      }
      for (let jj = 0; jj < lift.args.length; ++jj) {
        emitLine("LET __arg" + jj + " = " + expr(lift.args[jj], 0));
      }
      emitLine("GOSUB " + subLines[lift.fn]);
      emitLine("LET " + lift.temp + " = __ret_" + lift.fn);
    }
  }
  // BASIC only: does this statement contain a plain function call?
  // A call in an IF branch cannot be written on the one BASIC line
  // (GOSUB is not an IF-part statement), so such a branch is a loud
  // stub instead. Function bodies are not descended into.
  function hasPlainCall(node) {
    let found = false;
    function walk(n) {
      if (!n || typeof n !== "object" || found) return;
      if (Array.isArray(n)) {
        for (let ii = 0; ii < n.length; ++ii) walk(n[ii]);
        return;
      }
      if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
        return;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier") {
        found = true;
        return;
      }
      let keys = Object.keys(n);
      for (let ii = 0; ii < keys.length; ++ii) {
        let v = n[keys[ii]];
        if (v && typeof v === "object") walk(v);
      }
    }
    walk(node);
    return found;
  }
  // BASIC only: render one branch of an IF as a single line of
  // :-separated statements. Returns null when a statement cannot be
  // written on one line (a loop, a return, a GOTO).
  function inlineBranch(node) {
    let stmts = node.type === "BlockStatement" ? node.body : [node];
    let saved = lines;
    let parts = [];
    for (let ii = 0; ii < stmts.length; ++ii) {
      if (hasPlainCall(stmts[ii])) { lines = saved; return null; }
      lines = [];
      let before = report.unsupported.length;
      stmt(stmts[ii]);
      if (report.unsupported.length > before) {
        report.unsupported.length = before;
        lines = saved;
        return null;
      }
      if (lines.length === 0) continue;
      if (lines.length !== 1) { lines = saved; return null; }
      parts.push(lines[0].trim());
    }
    lines = saved;
    if (parts.length === 0) return "REM";
    return parts.join(" : ");
  }
  function run(ast) {
    let fns = [];
    let rest = [];
    for (let ii = 0; ii < ast.body.length; ++ii) {
      if (ast.body[ii].type === "FunctionDeclaration") fns.push(ast.body[ii]);
      else rest.push(ast.body[ii]);
    }
    if (isIroh) {
      for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
      if (fns.length > 0 && rest.length > 0) lines.push("");
      for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
      return { text: lines.join("\n") + "\n", counts: counts };
    }
    // BASIC: emit the mainline, then the GOSUB subroutines (their
    // line numbers were assigned as the functions were collected).
    for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    // The mainline falls through into the subroutines without this:
    // BASIC executes lines in order, so the program must stop before
    // the first GOSUB target.
    if (subroutines.length > 0) {
      let last = "";
      for (let ii = lines.length - 1; ii >= 0; --ii) {
        if (lines[ii].trim() !== "") { last = lines[ii].trim(); break; }
      }
      if (last !== "END" && last !== "STOP") lines.push("END");
    }
    for (let ii = 0; ii < subroutines.length; ++ii) {
      let sub = subroutines[ii];
      let startLine = subLines[sub.name];
      let saved = lines;
      lines = [];
      currentSub = sub.name;
      if (sub.stub) {
        emitLine("PRINT " + basicQuote("IrohRedux: recursive function '" + sub.name + "' cannot be a BASIC GOSUB subroutine"));
        emitLine("END");
      } else {
        for (let jj = 0; jj < sub.params.length; ++jj) {
          emitLine("LET " + sub.params[jj] + " = __arg" + jj);
        }
        emitBody(sub.node.body);
      }
      currentSub = null;
      let bodyLines = lines;
      lines = saved;
      lines.push("");
      for (let jj = 0; jj < bodyLines.length; ++jj) {
        lines.push(String(startLine + jj * 10) + " " + bodyLines[jj].trim());
      }
    }
    return { text: lines.join("\n") + "\n", counts: counts };
  }
  function callsItself(fnNode, fnName) {
    let found = false;
    function walk(n) {
      if (!n || typeof n !== "object" || found) return;
      if (Array.isArray(n)) {
        for (let ii = 0; ii < n.length; ++ii) walk(n[ii]);
        return;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === fnName) {
        found = true;
        return;
      }
      let keys = Object.keys(n);
      for (let ii = 0; ii < keys.length; ++ii) {
        let v = n[keys[ii]];
        if (v && typeof v === "object") walk(v);
      }
    }
    walk(fnNode.body);
    return found;
  }
  return { run: run, counts: counts };
}

export function translate(code, options) {
  options = options || {};
  let from = options.from || "javascript";
  let to = options.to;
  let languages = ["javascript", "python", "cpp", "irohscript", "basic"];
  if (languages.indexOf(to) === -1) {
    throw new Error("Iroh.translate: unknown target '" + to + "' — use 'python', 'cpp', 'javascript', 'irohscript' or 'basic'");
  }
  if (from === to) {
    throw new Error("Iroh.translate: from and to are both '" + from + "'");
  }
  if (languages.indexOf(from) === -1) {
    throw new Error("Iroh.translate: unknown source '" + from + "' — use 'javascript', 'python', 'cpp', 'irohscript' or 'basic'");
  }
  // Direct legs: JavaScript out of any source, or any target out of
  // JavaScript.
  if (from === "javascript") {
    return translateFromJS(this, code, to, options);
  }
  if (to === "javascript") {
    return translateToJS(this, code, from, options);
  }
  // Two-hop via JavaScript: the first leg produces JavaScript (which
  // the second leg then traces for its types, exactly as the direct
  // JavaScript leg does). The report says so, and the first leg's
  // assumptions and notes ride along.
  let first = translateToJS(this, code, from, options);
  if (!first.report.ok) {
    first.report.to = to;
    first.report.notes.push("two-hop via JavaScript stopped at the first leg (" + from + " -> JavaScript)");
    return first;
  }
  let out = translateFromJS(this, first.code, to, options);
  out.report.from = from;
  out.report.notes.push(
    options.evidence === "none"
      ? "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is NOT traced — evidence: 'none', so types come from static inference or hints only)."
      : "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is traced for its types, exactly as the direct JavaScript leg is)."
  );
  out.report.assumptions = first.report.assumptions.concat(out.report.assumptions);
  out.report.notes = first.report.notes.concat(out.report.notes);
  return out;
}

// Any source language -> JavaScript. The Python, IrohScript and
// BASIC legs need python3 (via child_process); the C++ leg is pure
// JS. `iroh` is only used for the error message's `this` — the legs
// themselves do not trace.
function translateToJS(iroh, code, from, options) {
  if (from === "python" || from === "irohscript" || from === "basic") {
    let cp = getChildProcessSync();
    if (!cp) {
      throw new Error(
        "Iroh.translate: " + from + " -> JavaScript needs the Node.js CJS build with python3 on PATH — use Iroh.translateAsync() in ESM; it is not supported in a browser"
      );
    }
    if (from === "python") return translateFromPython(code, cp);
    if (from === "irohscript") return translateFromIrohscript(code, cp, options);
    return translateFromBasic(code, cp, options);
  }
  if (from === "cpp") {
    return translateFromCpp(code);
  }
  throw new Error("Iroh.translate: unknown source '" + from + "'");
}

export function translateAsync(code, options) {
  options = options || {};
  let iroh = this;
  let from = options.from || "javascript";
  let to = options.to;
  if (from === "python" || from === "irohscript" || from === "basic") {
    // Load child_process by dynamic import so this works in the ESM
    // build too (no sync require there). The first leg runs with it;
    // the rest is synchronous (the second hop traces JavaScript,
    // which needs no child process).
    return nodeImport("node:child_process").then(
      function(cp) {
        let first = null;
        if (from === "python") first = translateFromPython(code, cp);
        else if (from === "irohscript") first = translateFromIrohscript(code, cp, options);
        else first = translateFromBasic(code, cp, options);
        if (to === "javascript" || !to) return first;
        if (!first.report.ok) {
          first.report.to = to;
          first.report.notes.push("two-hop via JavaScript stopped at the first leg (" + from + " -> JavaScript)");
          return first;
        }
        let out = translateFromJS(iroh, first.code, to, options);
        out.report.from = from;
        out.report.notes.push(
          options.evidence === "none"
            ? "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is NOT traced — evidence: 'none', so types come from static inference or hints only)."
            : "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is traced for its types, exactly as the direct JavaScript leg is)."
        );
        out.report.assumptions = first.report.assumptions.concat(out.report.assumptions);
        out.report.notes = first.report.notes.concat(out.report.notes);
        return out;
      },
      function() {
        throw new Error("Iroh.translateAsync: " + from + " -> JavaScript needs Node.js with python3 on PATH");
      }
    );
  }
  try {
    return Promise.resolve(translate.call(iroh, code, options));
  } catch (e) {
    return Promise.reject(e);
  }
}
