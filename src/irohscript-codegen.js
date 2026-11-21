// IrohScript -> JavaScript code generator: the compiler backend for
// IrohRedux's own core (part 3 of the 1.0.1 rework). This is NOT the
// translator (src/translate.js): the translator reports what it could
// and could not translate and emits loud stubs for the rest; this
// compiler either emits clean, runnable JavaScript or throws a clear
// error naming the construct it cannot compile. The compiled output
// is the real code IrohRedux runs — the first component compiled this
// way is the perceptron's scoring core (irohscript/core/perceptron.iroh
// -> src/neurons-irohscript.js).
//
// The frontend is the bootstrap compiler: source is compiled by
// IrohCompiler (Python, via the shared bridge in
// src/irohscript-bridge.js) and the AST JSON is walked here. No
// hand-rolled IrohScript parser on the JS side.
//
// Semantics are the bootstrap's, Python-style (7/2 = 3.5, -5 % 3 = 1):
// DIV emits plain JavaScript / (float division, the same as Python's)
// and MOD emits __iroh_pymod (floored). If Andy ever calls C++-style
// (truncated) division instead, the flip is that one helper function.
// Division and modulo are the one open question from the MVP that
// this compiler touches; everything else it emits is semantics-free
// (names, struct fields, calls, arithmetic, comparisons).
//
// The emitted code is ES2015-only (no async/await, no for...of): it
// lives in src/ and ships in the browser bundle, which buble
// transpiles. It is deterministic: same source, same bytes, so the
// checked-in generated file can be verified against a fresh compile
// (see tests/irohscript-codegen.test.js, the drift check).
//
// In a browser there is no python3 and no require: the sync entry
// throws a clear error pointing at the async entry, which works in
// ESM Node via dynamic import (same split as the translator).

import { runIrohscriptPython, IROHSCRIPT_AST_HELPER, getChildProcessSync, nodeImport } from "./irohscript-bridge";

function compileError(detail) {
  return new Error("Iroh.compileIrohscript: " + detail);
}

// Default value for an IrohScript type (for LET with no initializer
// and for STRUCT field defaults). Same table as the translator's:
// Int/Float -> 0, String -> "", Bool -> false, Vector -> [], a struct
// type -> a call to its factory function.
function irohTypeDefault(typeName) {
  if (typeName === "Int" || typeName === "Float") return "0";
  if (typeName === "String") return '""';
  if (typeName === "Bool") return "false";
  if (typeName && typeName.indexOf("Vector") === 0) return "[]";
  return null;
}

function makeCodegenEmitter() {
  let lines = [];
  let indentLevel = 0;
  let needsPymod = false;
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  let BIN_PREC = { OR: 1, AND: 2, EQ: 3, NEQ: 3, LT: 3, LE: 3, GT: 3, GE: 3, ADD: 4, SUB: 4, MUL: 5, DIV: 5, MOD: 5 };
  function exprPrec(node) {
    if (!node || typeof node !== "object") return 7;
    if (node.node === "BinOp") return BIN_PREC[node.op] || 1;
    if (node.node === "UnaryOp") return 6;
    return 7;
  }
  function expr(node, parentPrec) {
    if (!node || typeof node !== "object") throw compileError("missing expression");
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
        needsPymod = true;
        out = "__iroh_pymod(" + expr(node.left, 7) + ", " + expr(node.right, 7) + ")";
      } else {
        let map = { ADD: "+", SUB: "-", MUL: "*", DIV: "/", EQ: "===", NEQ: "!==", LT: "<", LE: "<=", GT: ">", GE: ">=", AND: "&&", OR: "||" };
        if (!map[node.op]) throw compileError("binary operator '" + node.op + "' is not in the v1 scope");
        out = expr(node.left, prec) + " " + map[node.op] + " " + expr(node.right, prec + 1);
      }
    } else if (node.node === "UnaryOp") {
      out = (node.op === "NOT" ? "!" : "-") + expr(node.operand, 6);
    } else if (node.node === "Call") {
      out = expr(node.callee, 7) + "(" + node.args.map(function(a) { return expr(a, 0); }).join(", ") + ")";
    } else if (node.node === "MemberAccess") {
      out = expr(node.object, 7) + "." + node.member;
    } else {
      throw compileError("expression node '" + (node.node || "?") + "' is not in the v1 scope");
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
    if (!node || typeof node.node !== "string") throw compileError("missing statement");
    if (node.node === "Let" || node.node === "Const") {
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
      emitLine("console.log(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "If") {
      emitLine("if (" + expr(node.cond, 0) + ") {");
      emitBlock(node.then);
      if (node.else && node.else.length > 0) {
        emitLine("} else {");
        emitBlock(node.else);
      }
      emitLine("}");
      return;
    }
    if (node.node === "FunctionDef") {
      let params = node.params.map(function(p) { return p.name; }).join(", ");
      emitLine("export function " + node.name + "(" + params + ") {");
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
      emitLine("export function " + node.name + "() { return { " + fields + " }; }");
      return;
    }
    if (node.node === "EnumDef") {
      let members = node.members.map(function(m) { return m + ": " + JSON.stringify(m); }).join(", ");
      emitLine("export const " + node.name + " = { " + members + " };");
      return;
    }
    if (node.node === "Call") {
      emitLine(expr(node, 0) + ";");
      return;
    }
    if (node.node === "Loop") {
      // Amendment A2 (2026-11-21): the conditional LOOP <Bool-expr>
      // (Amendment A1) lowers to a while loop. The legacy bare LOOP
      // still throws: the compiler never emits a loop it cannot end.
      if (node.cond === null || node.cond === void 0) {
        throw compileError("LOOP has no defined exit condition in IrohScript 3.0 (spec section 6 shows the form but not the termination rule) — the compiler cannot emit a loop it cannot end; write the conditional form LOOP <Bool-expr> (Amendment A1) instead");
      }
      emitLine("while (" + expr(node.cond, 0) + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "Action") {
      throw compileError("ACTION is a program behaviour (record + print), not core library code — the compiler does not emit it");
    }
    if (node.node === "Intent") {
      throw compileError("INTENT is a program behaviour (record in the intent graph), not core library code — the compiler does not emit it");
    }
    if (node.node === "Conditional") {
      throw compileError("the legacy Conditional form ('enemy -> defend') is a program behaviour, not core library code — write an IF statement instead");
    }
    if (node.node === "Import") {
      throw compileError("IMPORT '" + (node.name || "?") + "' has no runtime effect (namespaces are runtime extensions) — core code must not import what it cannot use");
    }
    throw compileError("statement node '" + node.node + "' is not in the v1 scope");
  }
  function run(ast) {
    let stmts = ast.statements || [];
    let defs = [];
    let rest = [];
    for (let ii = 0; ii < stmts.length; ++ii) {
      if (stmts[ii].node === "FunctionDef" || stmts[ii].node === "StructDef" || stmts[ii].node === "EnumDef") defs.push(stmts[ii]);
      else rest.push(stmts[ii]);
    }
    for (let ii = 0; ii < defs.length; ++ii) stmt(defs[ii]);
    if (defs.length > 0 && rest.length > 0) lines.push("");
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    let header = [];
    if (needsPymod) {
      header.push("function __iroh_pymod(a, b) { return ((a % b) + b) % b; }");
      header.push("");
    }
    return header.concat(lines).join("\n") + "\n";
  }
  return { run: run };
}

// Compile IrohScript source to a JavaScript module string. Throws on
// a compile error in the source or on a construct the compiler cannot
// emit. options.irohscriptHome names the directory holding the
// irohscript package (the CLI and the build script pass the in-repo
// copy); otherwise IROHSCRIPT_HOME, <cwd>/irohscript, or <cwd>.
export function compileIrohscript(source, options) {
  let cp = getChildProcessSync();
  if (!cp) {
    throw new Error(
      "Iroh.compileIrohscript: compiling IrohScript needs the Node.js CJS build with python3 on PATH — use Iroh.compileIrohscriptAsync() in ESM; it is not supported in a browser"
    );
  }
  return compileWithChildProcess(source, options, cp);
}

// The async version: loads child_process by dynamic import so it
// works in the ESM build too (no sync require there).
export function compileIrohscriptAsync(source, options) {
  return nodeImport("node:child_process").then(
    function(cp) {
      return compileWithChildProcess(source, options, cp);
    },
    function() {
      throw new Error("Iroh.compileIrohscriptAsync: compiling IrohScript needs Node.js with python3 on PATH");
    }
  );
}

function compileWithChildProcess(source, options, cp) {
  let ast;
  try {
    ast = runIrohscriptPython(source, options, cp, IROHSCRIPT_AST_HELPER, "IrohScript");
  } catch (e) {
    // The shared bridge reports translator-flavoured errors; the
    // compiler re-labels them so a failure names the compiler.
    let message = e && e.message ? e.message : String(e);
    if (message.indexOf("Iroh.translate: ") === 0) {
      message = "Iroh.compileIrohscript: " + message.slice("Iroh.translate: ".length);
    }
    throw new Error(message);
  }
  let emitter = makeCodegenEmitter();
  return emitter.run(ast);
}
