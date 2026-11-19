// Hybrid translation engine for IrohRedux 0.8.0 — JavaScript ->
// Python / C++, Python -> JavaScript, C++ -> JavaScript.
//
//   Iroh.translate(code, { from, to })      -> { code, report } (sync)
//   Iroh.translateAsync(code, { from, to }) -> Promise of the same
//
// `from` defaults to "javascript"; `to` is "python" | "cpp" |
// "javascript". The JavaScript-out leg is hybrid: the AST (static)
// plus trace evidence (dynamic — the program is run through the
// tracer first and the events resolve what static analysis can't:
// runtime types, values, which branches fired). The reverse legs
// (Python -> JS, C++ -> JS) are static-only — there is no tracer
// for Python or C++, and the report says so (staticOnly: true).
//
// The report shape is the same every leg:
//   { ok, from, to, staticOnly, clean, assumptions, unsupported, notes }
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
        env.funcs[e.name] = { args: e.arguments || [], returns: null };
      }
    } else if (e.event === "FUNCTION_RETURN" && e.name) {
      if (!env.funcs[e.name]) {
        env.funcs[e.name] = { args: null, returns: null };
      }
      if (env.funcs[e.name].returns === null && e.return !== void 0) {
        env.funcs[e.name].returns = e.return;
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
        return Number.isInteger(node.value) ? "int" : "double";
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
  let needs = { math: false, random: false, cmath: false, algorithm: false, stdexcept: false, vectorHelper: false, unsupportedHelper: false, cout: false };
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
    if (f.args) {
      params = [];
      for (let jj = 0; jj < f.args.length; ++jj) {
        params.push(cppTypeOfValue(f.args[jj]));
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

  // C++ helper: render an expression as a string for concatenation.
  function cppStringOf(node) {
    let t = inferType(node, ctx);
    let s = expr(node, 16);
    if (t === "std::string") return s;
    if (t === "int") return "std::to_string(" + s + ")";
    if (t === "bool") return "((" + s + ') ? "true" : "false")';
    if (t === "double") {
      return unsupportedExpr(
        "string concatenation of a double value in C++ (std::to_string prints 6 decimals, unlike JS)",
        "BinaryExpression"
      );
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
      let parts = ['f"'];
      for (let ii = 0; ii < node.quasis.length; ++ii) {
        let q = node.quasis[ii];
        let raw = q.value.cooked !== void 0 && q.value.cooked !== null ? q.value.cooked : q.value.raw;
        parts.push(raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/{/g, "{{").replace(/}/g, "}}"));
        if (ii < node.expressions.length) {
          parts.push("{" + expr(node.expressions[ii], 16) + "}");
        }
      }
      parts.push('"');
      return parts.join("");
    }
    // C++: "a" + std::to_string(x) + "b" — only string/integral
    // interpolations; doubles would print with 6 decimals via
    // std::to_string, which does not match JS output.
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
        else {
          return unsupportedExpr(
            "template literal interpolation of non-string, non-integer value in C++ (std::to_string would print doubles with 6 decimals, unlike JS)",
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
        if (isPy) return "str(" + expr(node.arguments[0], 16) + ")";
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
    let outOp = op;
    if (op === "===") outOp = "==";
    else if (op === "!==") outOp = "!=";
    else if (op === "&&") outOp = isPy ? "and" : "&&";
    else if (op === "||") outOp = isPy ? "or" : "||";
    let myPrec = precedence(node);
    if (!isPy && op === "+") {
      // String concatenation: either side a string (or a string
      // literal) makes the whole `+` a concat. A literal on its own
      // is const char*, so `"a" + 1` would compile as pointer
      // arithmetic — route everything through cppStringOf, and wrap
      // two literals so the left one is a real std::string.
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      let leftIsStr = lt === "std::string" || (node.left.type === "Literal" && typeof node.left.value === "string");
      let rightIsStr = rt === "std::string" || (node.right.type === "Literal" && typeof node.right.value === "string");
      if (leftIsStr || rightIsStr) {
        let l = cppStringOf(node.left);
        let r = cppStringOf(node.right);
        if (node.left.type === "Literal" && typeof node.left.value === "string" &&
            node.right.type === "Literal" && typeof node.right.value === "string") {
          l = "std::string(" + l + ")";
        }
        return l + " + " + r;
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
      sig.params.push(t + " " + pname + def);
    }
    if (paramsFromTrace) {
      recordAssumption(
        report,
        "parameter types of '" + fnName + "' (" + sig.params.join(", ") + ") taken from the trace (first call only — later calls with different argument types would break the translation)",
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
          ret = traceFn.returns;
          if (traceFn.returnsFrom === "trace") retFromTrace = true;
        }
      }
    }
    if (retFromTrace) {
      recordAssumption(
        report,
        "return type of '" + fnName + "' (" + ret + ") taken from the trace (first return only)",
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
    // Classic numeric for: for (let i = A; i <op> B; update)
    if (!node.init || node.init.type !== "VariableDeclaration") return null;
    if (node.init.declarations.length !== 1) return null;
    let decl = node.init.declarations[0];
    if (decl.id.type !== "Identifier" || !decl.init) return null;
    if (!node.test || node.test.type !== "BinaryExpression") return null;
    let test = node.test;
    if (test.left.type !== "Identifier" || test.left.name !== decl.id.name) return null;
    if (["<", "<=", ">", ">="].indexOf(test.operator) === -1) return null;
    let step = null;
    let upd = node.update;
    if (!upd) return null;
    if (upd.type === "UpdateExpression" && upd.argument.type === "Identifier" && upd.argument.name === decl.id.name) {
      step = upd.operator === "++" ? 1 : -1;
    } else if (upd.type === "AssignmentExpression" && upd.left.type === "Identifier" && upd.left.name === decl.id.name) {
      if (upd.operator === "+=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = upd.right.value;
      else if (upd.operator === "-=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = -upd.right.value;
      else return null;
    } else return null;
    return { name: decl.id.name, start: decl.init, op: test.operator, end: test.right, step: step };
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
  // unavailable). The evidence trace must not leak the program's
  // output: translate() is a pure function, so the tracer's output
  // is silenced for the duration. Note the program's console.log
  // runs natively (the instrumenter does not rewrite it — Iroh.log
  // is only the fixtures' explicit print), so the global
  // console.log is swapped, not just Iroh.log.
  let events = [];
  let originalLog = iroh.log;
  let originalConsoleLog = typeof console !== "undefined" ? console.log : null;
  iroh.log = function() {};
  if (originalConsoleLog) console.log = function() {};
  try {
    events = iroh.trace(code).events;
  } catch (e) {
    report.notes.push(
      "Dynamic trace evidence unavailable (" + (e.message || String(e)) + "); types come from static inference or hints only."
    );
  } finally {
    iroh.log = originalLog;
    if (originalConsoleLog) console.log = originalConsoleLog;
  }
  let env = buildTraceEnv(events);
  let emitter = makeJSEmitter(to, report, env, options.types || null);
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
    report.notes.push(
      "Function(s) never called in the trace (" + uncalled.join(", ") +
      "): C++ parameter types for them came from a type hint, or the function was reported unsupported."
    );
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

function getChildProcessSync() {
  // `require` is the CJS bundle's module require; in the ESM and
  // browser bundles it is undefined, so this safely returns null
  // there (the Python leg then throws a clear error — see
  // translateAsync for the ESM path).
  if (typeof require === "function") {
    try {
      return require("node:child_process");
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Dynamic import() without writing `import()` literally in src/:
// buble cannot parse import() syntax (same pattern as setup.js).
function nodeImport(specifier) {
  return new Function("s", "return import(s);")(specifier);
}

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
          noteOnce("mod", "Python % and JS % differ for negative operands (Python takes the divisor's sign).");
          return "(" + l + " % " + r + ")";
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

export function translate(code, options) {
  options = options || {};
  let from = options.from || "javascript";
  let to = options.to;
  if (to !== "python" && to !== "cpp" && to !== "javascript") {
    throw new Error("Iroh.translate: unknown target '" + to + "' — use 'python', 'cpp' or 'javascript'");
  }
  if (from === "javascript") {
    if (to === "javascript") {
      throw new Error("Iroh.translate: from and to are both 'javascript'");
    }
    return translateFromJS(this, code, to, options);
  }
  if (to !== "javascript") {
    throw new Error("Iroh.translate: only JavaScript is a target for from='" + from + "' in v1");
  }
  if (from === "python") {
    let cp = getChildProcessSync();
    if (!cp) {
      throw new Error(
        "Iroh.translate: Python -> JavaScript needs the Node.js CJS build with python3 on PATH — use Iroh.translateAsync() in ESM; it is not supported in a browser"
      );
    }
    return translateFromPython(code, cp);
  }
  if (from === "cpp") {
    return translateFromCpp(code);
  }
  throw new Error("Iroh.translate: unknown source '" + from + "' — use 'javascript', 'python' or 'cpp'");
}

export function translateAsync(code, options) {
  options = options || {};
  let iroh = this;
  let from = options.from || "javascript";
  if (from !== "python") {
    try {
      return Promise.resolve(translate.call(iroh, code, options));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  // Python leg: load child_process by dynamic import so this works
  // in the ESM build too (no sync require there).
  return nodeImport("node:child_process").then(
    function(cp) {
      return translateFromPython(code, cp);
    },
    function() {
      throw new Error("Iroh.translateAsync: Python -> JavaScript needs Node.js with python3 on PATH");
    }
  );
}
