// Shared Python bridge for the IrohScript bootstrap (the Level 0
// Python compiler in irohscript/). Used by the translator
// (src/translate.js) and the IrohScript -> JavaScript code generator
// (src/irohscript-codegen.js). Nothing in this file is wired onto the
// public Iroh object: src/index.js does not import it, so these
// helpers stay internal. The browser bundle has no python3 and no
// require: getChildProcessSync() returns null there and callers throw
// a clear error (see the async path for the ESM alternative).
//
// Division/modulo note: the AST helper compiles with the bootstrap,
// whose semantics are Python-style (7/2 = 3.5, -5 % 3 = 1). The code
// generator preserves that with __iroh_pymod for MOD and plain / for
// DIV (JavaScript / is float division, the same as Python's). If Andy
// ever calls C++-style (truncated) instead, the flip is one helper
// function in the code generator, not a change here.

// Locate the IrohScript sources (the Python bootstrap lives in the
// repo at irohscript/). Resolution order: options.irohscriptHome,
// IROHSCRIPT_HOME, <cwd>/irohscript, <cwd> itself when it already is
// the irohscript directory.
function irohscriptHomeCandidates(options) {
  let out = [];
  function push(h) {
    if (h && out.indexOf(h) === -1) out.push(h);
  }
  if (options && options.irohscriptHome) push(options.irohscriptHome);
  if (typeof process !== "undefined" && process.env && process.env.IROHSCRIPT_HOME) {
    push(process.env.IROHSCRIPT_HOME);
  }
  if (typeof process !== "undefined" && process.cwd) {
    try {
      push(process.cwd() + "/irohscript");
      push(process.cwd());
    } catch (e) {}
  }
  return out;
}

// Run one of the embedded Python helpers (below) against `code`.
// The helper gets the irohscript directory as argv[1] and the source
// on stdin, and prints JSON on stdout. Candidates are tried in order
// until one resolves the import; any other failure is the real error
// (a compile error in the source, or a broken helper).
export function runIrohscriptPython(code, options, childProcess, helper, what) {
  let candidates = irohscriptHomeCandidates(options);
  for (let ii = 0; ii < candidates.length; ++ii) {
    let stdout;
    try {
      stdout = childProcess.execFileSync("python3", ["-c", helper, candidates[ii]], {
        input: code,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e) {
      if (e.code === "ENOENT") {
        throw new Error("Iroh.translate: python3 was not found on PATH (needed to parse " + what + " source)");
      }
      let stderr = e.stderr ? String(e.stderr) : "";
      if (stderr.indexOf("ModuleNotFoundError") !== -1 || stderr.indexOf("No module named") !== -1) {
        continue;
      }
      let lines = stderr.split("\n").filter(function(l) { return l.trim() !== ""; });
      let last = lines.length > 0 ? lines[lines.length - 1] : (e.message || String(e));
      throw new Error("Iroh.translate: " + what + " failed: " + last);
    }
    return JSON.parse(stdout);
  }
  throw new Error("Iroh.translate: IrohScript sources not found (looked for irohscript/src/compiler.py) — run from the IrohRedux checkout, set IROHSCRIPT_HOME, or pass { irohscriptHome }");
}

// stdlib-only Python helper: reads IrohScript source on stdin,
// compiles it with the bootstrap compiler, writes the AST as JSON on
// stdout (warnings go to stderr). No hand-rolled IrohScript parser
// on the JS side — the bootstrap is the authority, the same way
// Python -> JS uses Python's own ast module. The AST JSON is
// ast_with_conds: to_dict() plus the Amendment A1 Loop ``cond``
// (golden to_dict stays cond-free; the translator needs the
// condition to lower the conditional LOOP).
export const IROHSCRIPT_AST_HELPER = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "from src.compiler import IrohCompiler",
  "from src.ast_nodes import ast_with_conds",
  "src = sys.stdin.read()",
  "try:",
  "    result = IrohCompiler().compile(src)",
  "except Exception as exc:",
  "    sys.stderr.write('CompileError: %s\\n' % (exc,))",
  "    sys.exit(1)",
  "for w in result.warnings:",
  "    sys.stderr.write('warning: %s\\n' % (w,))",
  "sys.stdout.write(json.dumps(ast_with_conds(result.ast)))",
].join("\n");

export function getChildProcessSync() {
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
export function nodeImport(specifier) {
  return new Function("s", "return import(s);")(specifier);
}
