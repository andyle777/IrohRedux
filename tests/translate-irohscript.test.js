// Tests for the 1.0.1-rework translator upgrade: IrohScript and
// BASIC join the translation engine, both directions, plus two-hop
// legs (IrohScript/BASIC <-> Python/C++ via JavaScript) and CLI
// --translate for .iroh and .bas files. For every covered construct
// the translated program is actually run — IrohScript under the
// bootstrap runner, BASIC under basic.py, JavaScript under node,
// Python under python3 — and must produce the same output as the
// original program. Legs that need python3 are skipped (not failed)
// when it is absent.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");
const IROHSCRIPT_DIR = path.join(__dirname, "..", "irohscript");
const BASIC_SRC = path.join(IROHSCRIPT_DIR, "src");

function has(cmd) {
  try {
    execSync("command -v " + cmd, { stdio: "ignore", shell: true });
    return true;
  } catch (e) {
    return false;
  }
}
const HAS_PYTHON = has("python3");
const HAS_GPP = has("g++");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iroh-translate-iroh-"));
}
function runNode(code, input) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.js");
  fs.writeFileSync(file, code);
  let proc = spawnSync(process.execPath, [file], { input: input || "", encoding: "utf8" });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}
function runPython(code) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.py");
  fs.writeFileSync(file, code);
  let proc = spawnSync("python3", [file], { encoding: "utf8" });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}
function runIrohscript(code) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.iroh");
  fs.writeFileSync(file, code);
  let proc = spawnSync("python3", ["-m", "src.cli", "run", file], { cwd: IROHSCRIPT_DIR, encoding: "utf8" });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}
const BASIC_RUNNER = [
  "import sys",
  "sys.path.insert(0, " + JSON.stringify(BASIC_SRC) + ")",
  "from basic import BasicInterpreter, parse_program",
  "prog = parse_program(open(sys.argv[1]).read())",
  "it = BasicInterpreter()",
  "it.run(prog)",
  "sys.stdout.write(\"\\n\".join(it.output))",
  "sys.stdout.write(\"\\n\") if it.output else None",
].join("\n");
function runBasic(code, input) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.bas");
  fs.writeFileSync(file, code);
  let proc = spawnSync("python3", ["-c", BASIC_RUNNER, file], { input: input || "", encoding: "utf8" });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}
function runCpp(code) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.cpp");
  let bin = path.join(dir, "prog");
  fs.writeFileSync(file, code);
  let compile = spawnSync("g++", ["-std=c++17", "-o", bin, file], { encoding: "utf8" });
  if (compile.status !== 0) {
    return { status: compile.status, stdout: "", stderr: compile.stderr, compiled: false };
  }
  let proc = spawnSync(bin, [], { encoding: "utf8" });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr, compiled: true };
}
function cliTranslate(file, args) {
  let proc = spawnSync(process.execPath, [CLI, file].concat(args || []), { encoding: "utf8" });
  let lines = proc.stdout.split("\n").filter(function(l) { return l.trim() !== ""; });
  let parsed = lines.map(function(l) {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(function(x) { return x !== null; });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr, lines: parsed };
}
function writeTmp(name, code) {
  let dir = tmpDir();
  let file = path.join(dir, name);
  fs.writeFileSync(file, code);
  return file;
}

// ------------------------------------------------------------------
// JavaScript -> IrohScript
// ------------------------------------------------------------------

test("JS -> IrohScript: add function, round-trips to 30", { skip: !HAS_PYTHON }, () => {
  let src = "function add(a, b) { return a + b; }\nlet result = add(10, 20);\nconsole.log(result);";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /FUNCTION add/);
  assert.match(out.code, /PRINT result/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "30\n");
});

test("JS -> IrohScript: if/else and string concat round-trip", { skip: !HAS_PYTHON }, () => {
  let src = "let name = \"Ada\";\nif (name === \"Ada\") { console.log(\"hi \" + name); } else { console.log(\"who?\"); }";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /IF name == "Ada"/);
  assert.match(out.code, /END IF/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "hi Ada\n");
});

test("JS -> IrohScript: booleans use True/False", { skip: !HAS_PYTHON }, () => {
  let src = "let t = true;\nif (t) { console.log(\"yes\"); }";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LET t : Bool = True/);
  let run = runIrohscript(out.code);
  assert.equal(run.stdout, "yes\n");
});

test("JS -> IrohScript: a for-loop desugars into LET + conditional LOOP + increment and round-trips (Amendment A3)", { skip: !HAS_PYTHON }, () => {
  let src = "function f(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }\nconsole.log(f(5));";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LET i : Int = 0/);
  assert.match(out.code, /LOOP i < n/);
  assert.match(out.code, /s = s \+ i/);
  assert.match(out.code, /i = i \+ 1/);
  assert.match(out.code, /END LOOP/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "10\n");
});

test("JS -> IrohScript: the update runs after the body (a body that moves the loop variable changes what it adds to)", { skip: !HAS_PYTHON }, () => {
  let src = "for (let i = 0; i < 3; i++) { console.log(i); i += 1; }";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n2\n");
});

test("JS -> IrohScript: a zero-iteration for-loop emits a valid LOOP that never enters", { skip: !HAS_PYTHON }, () => {
  let src = 'for (let i = 5; i < 0; i++) { console.log("never"); }\nconsole.log("done");';
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "done\n");
});

test("JS -> IrohScript: a for-loop with a step update round-trips", { skip: !HAS_PYTHON }, () => {
  let src = "for (let i = 0; i < 10; i += 3) { console.log(i); }";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /i = i \+ 3/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n3\n6\n9\n");
});

test("JS -> IrohScript: a test-less for-loop lowers to LOOP True and still ends via RETURN", { skip: !HAS_PYTHON }, () => {
  let src = "function f() { for (;;) { return 42; } }\nconsole.log(f());";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LOOP True/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "42\n");
});

test("JS -> IrohScript: a while loop lowers to the conditional LOOP and round-trips (Amendment A2)", { skip: !HAS_PYTHON }, () => {
  let src = "let i = 0;\nwhile (i < 3) { console.log(i); i += 1; }";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LOOP i < 3/);
  assert.match(out.code, /END LOOP/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n1\n2\n");
});

test("JS -> IrohScript: a do-while lowers through a minted Bool flag and round-trips (Amendment A5)", { skip: !HAS_PYTHON }, () => {
  let src = "let i = 0;\ndo { i += 1; } while (i < 3);\nconsole.log(i);";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LET __do_while_flag_1 : Bool = TRUE/);
  assert.match(out.code, /LOOP __do_while_flag_1/);
  assert.match(out.code, /__do_while_flag_1 = i < 3/);
  assert.match(out.code, /END LOOP/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "3\n");
});

test("JS -> IrohScript: a do-while body runs once even when the test is already false (Amendment A5)", { skip: !HAS_PYTHON }, () => {
  let src = "let n = 0;\nlet i = 0;\ndo { n += 1; i += 1; } while (i > 9);\nconsole.log(n);";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "1\n");
});

test("JS -> IrohScript: the minted flag skips a colliding user name (Amendment A5)", { skip: !HAS_PYTHON }, () => {
  let src = "let __do_while_flag_1 = 5;\nlet i = 0;\ndo { i += 1; } while (i < 2);\nconsole.log(i + __do_while_flag_1);";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LET __do_while_flag_2 : Bool = TRUE/);
  assert.doesNotMatch(out.code, /LET __do_while_flag_1 : Bool/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "7\n");
});

test("JS -> IrohScript: nested do-while loops get distinct flags (Amendment A5)", { skip: !HAS_PYTHON }, () => {
  let src = "let total = 0;\nlet i = 0;\ndo { let j = 0; do { total += 1; j += 1; } while (j < 2); i += 1; } while (i < 3);\nconsole.log(total);";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /__do_while_flag_1/);
  assert.match(out.code, /__do_while_flag_2/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "6\n");
});

test("JS -> BASIC: a do-while lowers through the flag and WHILE/WEND and round-trips (Amendment A5)", { skip: !HAS_PYTHON }, () => {
  let src = "let i = 0;\ndo { i += 1; } while (i < 3);\nconsole.log(i);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LET __do_while_flag_1 = -1/);
  assert.match(out.code, /WHILE __do_while_flag_1/);
  assert.match(out.code, /WEND/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "3\n");
});

test("JS -> BASIC: a do-while body runs once even when the test is already false (Amendment A5)", { skip: !HAS_PYTHON }, () => {
  let src = "let n = 0;\nlet i = 0;\ndo { n += 1; i += 1; } while (i > 9);\nconsole.log(n);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "1\n");
});

test("JS -> BASIC: a call inside the do-while condition stays a loud stub", () => {
  let src = "let i = 0;\ndo { i += 1; } while (i < f());\nconsole.log(i);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "DoWhileStatement");
  assert.match(out.report.unsupported[0].message, /do-while condition/);
});

test("JS -> IrohScript: modulo on non-negative operands round-trips", { skip: !HAS_PYTHON }, () => {
  let src = "let r = 7 % 3;\nconsole.log(r);";
  let out = Iroh.translate(src, { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(out.report.assumptions.length, 1);
  assert.match(out.report.assumptions[0].what, /% truncates/);
  let run = runIrohscript(out.code);
  assert.equal(run.stdout, "1\n");
});

// ------------------------------------------------------------------
// JavaScript -> BASIC
// ------------------------------------------------------------------

test("JS -> BASIC: add function becomes a GOSUB subroutine, round-trips to 30", { skip: !HAS_PYTHON }, () => {
  let src = "function add(a, b) { return a + b; }\nlet result = add(10, 20);\nconsole.log(result);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /GOSUB 1000/);
  assert.match(out.code, /1000 LET a = __arg0/);
  assert.match(out.code, /RETURN/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "30\n");
});

test("JS -> BASIC: for-loop round-trips (0+1+2+3+4 = 10)", { skip: !HAS_PYTHON }, () => {
  let src = "function f(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }\nconsole.log(f(5));";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /FOR i = 0 TO n - 1/);
  assert.match(out.code, /NEXT i/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "10\n");
});

test("JS -> BASIC: arrays become DIM plus element assignments", { skip: !HAS_PYTHON }, () => {
  let src = "let xs = [1, 2, 3];\nconsole.log(xs[0] + xs[2]);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /DIM xs\(2\)/);
  assert.match(out.code, /xs\(0\) = 1/);
  let run = runBasic(out.code);
  assert.equal(run.stdout, "4\n");
});

test("JS -> BASIC: a recursive function is honestly unsupported", () => {
  let src = "function fact(n) { if (n <= 1) return 1; return n * fact(n - 1); }\nconsole.log(fact(5));";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "FunctionDeclaration");
  assert.match(out.report.unsupported[0].message, /recursive/);
});

test("JS -> BASIC: a while loop lowers to WHILE/WEND and round-trips (Amendment A4)", { skip: !HAS_PYTHON }, () => {
  let src = "let i = 0;\nwhile (i < 3) { i += 1; }\nconsole.log(i);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /WHILE i < 3/);
  assert.match(out.code, /WEND/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "3\n");
});

test("JS -> BASIC: a while loop that never enters runs zero iterations (test-first carries over)", { skip: !HAS_PYTHON }, () => {
  let src = 'let i = 5;\nwhile (i < 3) { i += 1; }\nconsole.log("done");';
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "done\n");
});

test("JS -> BASIC: a call inside a while condition is honestly unsupported (it re-tests every pass)", () => {
  let src = "function f() { return 1; }\nlet i = 0;\nwhile (f() < 0) { i += 1; }\nconsole.log(i);";
  let out = Iroh.translate(src, { to: "basic" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "WhileStatement");
  assert.match(out.report.unsupported[0].message, /call inside a while condition/);
});

// ------------------------------------------------------------------
// IrohScript -> JavaScript
// ------------------------------------------------------------------

test("IrohScript -> JS: add function round-trips to 30", { skip: !HAS_PYTHON }, () => {
  let src = "FUNCTION Add(a, b)\n  RETURN a + b\nEND FUNCTION\nLET result = Add(10, 20)\nPRINT result";
  let out = Iroh.translate(src, { from: "irohscript", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(out.report.staticOnly, true);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "30\n");
});

test("IrohScript -> JS: legacy enemy->defend becomes an ACTION call", { skip: !HAS_PYTHON }, () => {
  let src = "LET enemy : Bool = TRUE\n\nenemy -> defend";
  let out = Iroh.translate(src, { from: "irohscript", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /__iroh_action\("defend"\)/);
  let run = runNode(out.code);
  assert.equal(run.stdout, "defend\n");
});

test("IrohScript -> JS: the legacy bare LOOP is honestly unsupported (no exit rule)", { skip: !HAS_PYTHON }, () => {
  let src = "LOOP\n  PRINT \"again\"\nEND LOOP";
  let out = Iroh.translate(src, { from: "irohscript", to: "javascript" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "Loop");
});

test("IrohScript -> JS: the conditional LOOP lowers to a while loop (Amendment A2)", { skip: !HAS_PYTHON }, () => {
  let src = "LET i : Int = 0\nLOOP i < 3\n  PRINT i\n  i = i + 1\nEND LOOP";
  let out = Iroh.translate(src, { from: "irohscript", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /while \(i < 3\) \{/);
  assert.ok(out.report.clean.some(function(c) {
    return c.construct === "loops" && c.count === 1;
  }), "one loop in the clean report");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n1\n2\n");
});

test("IrohScript -> JS: a zero-iteration conditional LOOP emits a valid while loop", { skip: !HAS_PYTHON }, () => {
  let src = 'LET f : Bool = FALSE\nLOOP f\n  PRINT "never"\nEND LOOP\nPRINT "done"';
  let out = Iroh.translate(src, { from: "irohscript", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "done\n");
});

test("IrohScript -> JS: a program that does not compile fails clearly", { skip: !HAS_PYTHON }, () => {
  assert.throws(() => Iroh.translate("LET x = ", { from: "irohscript", to: "javascript" }), /CompileError/);
});

// ------------------------------------------------------------------
// BASIC -> JavaScript
// ------------------------------------------------------------------

test("BASIC -> JS: the shipped examples round-trip (add, hot loop, gosub)", { skip: !HAS_PYTHON }, () => {
  let add = fs.readFileSync(path.join(IROHSCRIPT_DIR, "examples", "add.bas"), "utf8");
  let out = Iroh.translate(add, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(runNode(out.code).stdout, "30\n");
  let hot = fs.readFileSync(path.join(IROHSCRIPT_DIR, "examples", "hotloop.bas"), "utf8");
  let outHot = Iroh.translate(hot, { from: "basic", to: "javascript" });
  assert.equal(outHot.report.ok, true, JSON.stringify(outHot.report.unsupported));
  assert.equal(runNode(outHot.code).stdout, "11325\n");
  let gosub = fs.readFileSync(path.join(IROHSCRIPT_DIR, "examples", "gosub.bas"), "utf8");
  let outGosub = Iroh.translate(gosub, { from: "basic", to: "javascript" });
  assert.equal(outGosub.report.ok, true, JSON.stringify(outGosub.report.unsupported));
  assert.equal(runNode(outGosub.code).stdout, "in the subroutine\nback\n");
});

test("BASIC -> JS: WHILE/WEND lowers to a while loop and round-trips (Amendment A4)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET I = 0\n20 WHILE I < 3\n30 PRINT I\n40 LET I = I + 1\n50 WEND";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /while \(I < 3\) \{/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n1\n2\n");
});

test("BASIC -> JS: a WEND without a matching WHILE is honestly unsupported", () => {
  let src = "10 LET X = 1\n20 WEND";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "WhileStatement");
  assert.match(out.report.unsupported[0].message, /WEND without a matching WHILE/);
});

test("BASIC -> JS: INPUT reads stdin and prints the prompt", { skip: !HAS_PYTHON }, () => {
  let src = "10 INPUT \"name? \"; N$\n20 PRINT \"hi \"; N$";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code, "Ada\n");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "name? hi Ada\n");
});

test("BASIC -> JS: GOTO lowers through the pc-dispatch machine (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET X = 1\n20 GOTO 40\n30 LET X = 2\n40 PRINT X";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  // The mainline is a __pcw while/switch on __pc; a GOTO is a jump
  // of __pc, and the case starts exactly at the target line's
  // slot, the way basic.py's interpreter walks _slots.
  assert.match(out.code, /__pcw: while \(true\) \{/);
  assert.match(out.code, /var __pc = 0;/);
  assert.match(out.code, /__pc = [0-9]+; continue __pcw;/);
  assert.match(out.report.notes.join(" "), /pc-dispatch machine|program-counter dispatch machine/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "1\n");
  // Parity: the interpreter agrees (the GOTO skips line 30).
  let basicRun = runBasic(src);
  assert.equal(basicRun.status, 0, basicRun.stderr);
  assert.equal(basicRun.stdout, "1\n");
});

test("BASIC -> JS: a GOTO loop (IF shortcut + backward jump) round-trips against the interpreter (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET S = 0\n20 LET I = 1\n30 IF I > 5 THEN GOTO 70\n40 LET S = S + I\n50 LET I = I + 1\n60 GOTO 30\n70 PRINT S";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "15\n");
  let basicRun = runBasic(src);
  assert.equal(basicRun.status, 0, basicRun.stderr);
  assert.equal(basicRun.stdout, "15\n");
});

test("BASIC -> JS: a GOTO chain jumps forward and backward through multiple cases (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOTO 50\n20 PRINT \"b\"\n30 END\n50 PRINT \"a\"\n60 GOTO 20";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "a\nb\n");
  let basicRun = runBasic(src);
  assert.equal(basicRun.status, 0, basicRun.stderr);
  assert.equal(basicRun.stdout, "a\nb\n");
});

test("BASIC -> JS: a GOTO escapes out of a FOR loop mid-body (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I = 1 TO 10\n20 IF I = 3 THEN GOTO 60\n30 NEXT I\n40 PRINT \"done\"\n60 PRINT \"escaped\"";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "escaped\n");
  let basicRun = runBasic(src);
  assert.equal(basicRun.status, 0, basicRun.stderr);
  assert.equal(basicRun.stdout, "escaped\n");
});

test("BASIC -> JS: a GOTO after a zero-pass FOR still fires (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I = 1 TO 0\n20 NEXT I\n30 GOTO 50\n40 PRINT \"skipped\"\n50 PRINT \"end\"";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "end\n");
  let basicRun = runBasic(src);
  assert.equal(basicRun.status, 0, basicRun.stderr);
  assert.equal(basicRun.stdout, "end\n");
});

test("BASIC -> JS: a GOTO on a multi-statement line jumps from mid-line (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT \"start\": GOTO 30\n20 PRINT \"hidden\"\n30 PRINT \"landed\"";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "start\nlanded\n");
  let basicRun = runBasic(src);
  assert.equal(basicRun.status, 0, basicRun.stderr);
  assert.equal(basicRun.stdout, "start\nlanded\n");
});

test("BASIC -> JS: a GOTO into a loop body stays a loud stub (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I = 1 TO 3\n20 PRINT I\n30 NEXT I\n40 GOTO 20\n50 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "GOTO");
  assert.match(out.report.unsupported[0].message, /inside a loop body in the v1 scope/);
});

test("BASIC -> JS: a GOTO targeting a GOSUB subroutine line stays a loud stub (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOSUB 40\n20 END\n40 PRINT \"sub\"\n50 RETURN\n60 GOTO 40";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "GOTO");
  assert.match(out.report.unsupported[0].message, /GOSUB subroutine lives there/);
});

test("BASIC -> JS: a GOTO inside a GOSUB subroutine stays a loud stub (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOSUB 30\n20 END\n30 PRINT \"s\"\n40 GOTO 20\n50 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "GOTO");
  assert.match(out.report.unsupported[0].message, /inside a GOSUB subroutine/);
});

test("BASIC -> JS: a GOTO to an undefined line stays a loud stub (A7)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOTO 999\n20 PRINT \"x\"";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, false);
  assert.equal(out.report.unsupported[0].construct, "GOTO");
  assert.match(out.report.unsupported[0].message, /GOTO line 999 does not exist/);
});

test("BASIC -> JS: a variable written in a GOSUB is visible to the mainline (single namespace, A8)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOSUB 100\n20 PRINT X\n30 END\n100 LET X = 42\n110 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var X = 0;\n/);
  assert.match(out.code, /  X = 42;\n  return;/);
  assert.ok(out.report.notes.some(function(n) { return /one program-wide variable namespace/.test(n); }), "the single-namespace note fires");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "42\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "42\n");
});

test("BASIC -> JS: a GOSUB counter persists across calls like the interpreter (A8)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I = 1 TO 3\n20 GOSUB 100\n30 NEXT I\n40 PRINT C\n50 END\n100 LET C = C + 1\n110 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var C = 0;\n/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "3\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "3\n");
});

test("BASIC -> JS: a mainline LET and a sub LET share one variable (A8)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET X = 1\n20 GOSUB 100\n30 PRINT X\n40 END\n100 LET X = 42\n110 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.ok(!/\blet X\b/.test(out.code), "no function-scoped let for the shared name");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "42\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "42\n");
});

test("BASIC -> JS: a string written in a GOSUB reads as empty before its first write (A8)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOSUB 100\n20 PRINT T$\n30 END\n100 LET T$ = T$ + \"a\"\n110 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var T\$ = "";\n/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "a\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "a\n");
});

test("BASIC -> JS: the pc-dispatch machine and a GOSUB share the program-wide namespace (A8)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET X = 1\n20 GOSUB 100\n30 GOTO 50\n40 PRINT \"skipped\"\n50 PRINT X\n60 END\n100 LET X = X + 1\n110 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /__pcw: while \(true\) \{/);
  assert.match(out.code, /var X = 0;\n/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "2\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "2\n");
});

test("BASIC -> JS: a GOSUB-free program keeps the legacy straight-line output (A8 guard)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET A = 1\n20 PRINT A\n30 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(out.code, "let A = 1;\nconsole.log(A);\nprocess.exit(0);\n");
  assert.equal(out.report.notes.some(function(n) { return /program-wide variable namespace/.test(n); }), false);
});

test("BASIC -> JS: a read of an unwritten variable prints 0 like the interpreter (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT C\n20 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var C = 0;\n/);
  assert.ok(out.report.notes.some(function(n) { return /reads variable 'C' before any assignment/.test(n); }), "the unwritten-read note names C");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "0\n");
});

test("BASIC -> JS: a self-referential first LET reads the unwritten value (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET A = A + 1\n20 PRINT A\n30 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.ok(!/\blet A\b/.test(out.code), "no TDZ-crashing let A in the output");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "1\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "1\n");
});

test("BASIC -> JS: an unwritten string reads as empty, like the interpreter (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET T$ = T$ + \"x\"\n20 PRINT T$\n30 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var T\$ = "";\n/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "x\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "x\n");
});

test("BASIC -> JS: an unwritten read in an IF condition works through the dispatch machine (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 IF Z < 1 THEN GOTO 30\n20 PRINT \"no\"\n30 PRINT Z\n40 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /__pcw: while \(true\) \{/);
  assert.match(out.code, /^var Z = 0;\n/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "0\n");
});

test("BASIC -> JS: a self-referential FOR bound runs like the interpreter, not zero passes (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I = I TO 2\n20 PRINT I\n30 NEXT I\n40 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.ok(!/\blet I\b/.test(out.code), "no undefined-valued let I in the output");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n1\n2\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "0\n1\n2\n");
});

test("BASIC -> JS: an unwritten read inside a GOSUB body defaults like the interpreter (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOSUB 100\n20 END\n100 PRINT V\n110 RETURN";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var V = 0;\n/);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "0\n");
});

test("BASIC -> JS: a read before the first write prints 0 then the written value (A9)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT A\n20 LET A = 5\n30 PRINT A\n40 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n5\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "0\n5\n");
});

test("BASIC -> JS: a numeric read never matches a string name (X vs X$, A9 guard)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET X$ = \"s\"\n20 LET X = 1\n30 PRINT X$ + X\n40 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(out.code, "let X$ = \"s\";\nlet X = 1;\nconsole.log(X$ + X);\nprocess.exit(0);\n");
  assert.equal(out.report.notes.length, 0);
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "s1\n");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(basic.stdout, "s1\n");
});

// ------------------------------------------------------------------
// Amendment A11 (2026-11-22): nested FOR flat-scope hoist. The
// adversarial battery caught the inner FOR's loop variable declared
// as a block-scoped `let` INSIDE the enclosing loop body, so a
// mainline read after the loops crashed with ReferenceError while
// basic.py's flat vars dict printed the value. Every case compares
// the emitted JavaScript's real output with the interpreter's.
// ------------------------------------------------------------------

test("BASIC -> JS: a nested FOR keeps its loop variable program-wide like the interpreter (A11)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I=1 TO 3\n20 FOR J=1 TO 2\n30 PRINT I; J\n40 NEXT J\n50 NEXT I\n60 PRINT I; J\n70 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var J = 0;/m, "the inner loop variable hoists program-level");
  assert.ok(!/^ {2}let J;/m.test(out.code), "no block-scoped let J inside the outer body");
  assert.ok(out.report.notes.some(function(n) { return /declares loop variable 'J' inside another loop's body/.test(n); }), "the for-namespace note names J");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a nested self-referential FOR bound runs the flat value (A11)", { skip: !HAS_PYTHON }, () => {
  // J keeps its value ACROSS outer iterations in the flat dict: the
  // first outer pass runs J = 0 TO 2, the second reads J = 3 and
  // runs zero passes. The hoisted program-level var is the only
  // lowering that can hold that state; the old block-scoped let
  // re-declared J undefined each pass.
  let src = "10 FOR I = 1 TO 2\n20 FOR J = J TO 2\n30 PRINT I; J\n40 NEXT J\n50 NEXT I\n60 PRINT I; J\n70 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a FOR inside a WHILE body keeps flat scope (A11)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET K = 0\n20 WHILE K < 2\n30 FOR J = 1 TO 2\n40 PRINT K; J\n50 NEXT J\n60 LET K = K + 1\n70 WEND\n80 PRINT K; J\n90 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var J = 0;/m, "the WHILE-nested loop variable hoists program-level");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: nested FORs keep flat scope through the GOTO dispatch machine (A11)", { skip: !HAS_PYTHON }, () => {
  let src = "10 GOTO 20\n20 FOR I = 1 TO 2\n30 FOR J = 1 TO 2\n40 PRINT I; J\n50 NEXT J\n60 NEXT I\n70 PRINT I; J\n80 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.ok(!out.report.notes.some(function(n) { return /for-namespace/.test(n); }), "the machine already hoists its FOR vars, no second hoist");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a single FOR keeps its shape (A11 guard)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR I = 1 TO 3\n20 PRINT I\n30 NEXT I\n40 PRINT I\n50 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(out.code, "let I;\nfor (I = 1; I <= 3; I += 1) {\n  console.log(I);\n}\nconsole.log(I);\nprocess.exit(0);\n");
  assert.equal(out.report.notes.length, 0, "no hoist note without a nested FOR");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

// ------------------------------------------------------------------
// Amendment A12 (2026-11-22): nested block flat-scope hoist. The
// same flat-namespace doctrine as A11, extended from FOR variables
// to every declaration that first appears inside a loop or IF body:
// LET, DIM and INPUT. A block-scoped `let` there died with a
// ReferenceError on any later mainline read while basic.py's single
// program-wide vars dict printed the value.
// ------------------------------------------------------------------

test("BASIC -> JS: a LET inside a FOR body keeps flat scope like the interpreter (A12)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR A = 1 TO 2\n20 LET X = A\n30 NEXT A\n40 PRINT X\n50 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var X = 0;/m, "the body-declared LET hoists program-level");
  assert.ok(!/^ {2}let X =/m.test(out.code), "no block-scoped let X inside the loop body");
  assert.ok(out.report.notes.some(function(n) { return /declares a variable inside a loop or IF body/.test(n); }), "the block-namespace note fires");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a DIM inside a FOR body keeps flat scope (A12)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR A = 1 TO 2\n20 DIM X(3)\n30 LET X(A) = A * 10\n40 NEXT A\n50 PRINT X(2)\n60 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var X = 0;/m, "the body-declared DIM hoists program-level");
  assert.ok(!/^ {2}let X =/m.test(out.code), "no block-scoped let X inside the loop body");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a LET inside an IF THEN branch keeps flat scope (A12)", { skip: !HAS_PYTHON }, () => {
  let src = "10 IF 1 < 2 THEN LET Y = 5 ELSE LET Y = 6\n20 PRINT Y\n30 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var Y = 0;/m, "the branch-declared LET hoists program-level");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a string LET inside a FOR body keeps flat scope (A12)", { skip: !HAS_PYTHON }, () => {
  let src = "10 FOR A = 1 TO 2\n20 LET T$ = \"n\" + A\n30 NEXT A\n40 PRINT T$\n50 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^var T\$ = "";$/m, "the body-declared string LET hoists program-level");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: mainline LET declarations keep their shape (A12 guard)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET S = 0\n20 FOR A = 1 TO 3\n30 LET S = S + A\n40 NEXT A\n50 PRINT S\n60 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /^let S = 0;/m, "a mainline LET stays a plain flat let");
  assert.ok(!out.report.notes.some(function(n) { return /inside a loop or IF body/.test(n); }), "no block-namespace note without a body declaration");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

// ------------------------------------------------------------------
// Amendment A13 (2026-11-22): BASIC print-parity pack. Boolean
// values print as 1/0 the way basic.py's format_value does (not
// JavaScript true/false); the ',' separator between PRINT values
// appends one space, not a tab; a trailing ';' or ',' holds the
// line open like the interpreter's pending buffer, and the buffer
// flushes at the next line-ending PRINT or at the end of the run.
// Glue joins of folded +/- items are parenthesized so JavaScript
// folds each item before string concatenation.
// ------------------------------------------------------------------

test("BASIC -> JS: a printed comparison prints 1 like the interpreter (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT 1 = 1\n20 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /\? 1 : 0\)/, "the comparison emits a ternary to 1/0, parenthesized as one value");
  assert.ok(!/true|false/.test(out.code.replace(/ ?1 : 0/g, "")), "no raw JavaScript boolean leaks into the print");
  assert.ok(out.report.notes.some(function(n) { return /print as 1\/0/.test(n); }), "the boolean 1/0 note fires");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: AND and OR of numeric operands print like the interpreter (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT 2 AND 3\n20 PRINT 2 AND 0\n30 PRINT 0 OR 5\n40 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a stored boolean concatenates as 1 like the interpreter (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET T$ = \"v\" + (1 = 1)\n20 PRINT T$\n30 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /\(\(\(1 === 1\) \? 1 : 0\)\)/, "the ternary is parenthesized so the + folds it as one value");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a comma between PRINT values separates with one space (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT 1, 2\n20 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /1 \+ " " \+ 2/, "the comma emits a one-space join");
  assert.ok(!out.code.includes("\\t"), "no tab separator remains");
  assert.ok(out.report.notes.some(function(n) { return /separates values with one space/.test(n); }), "the comma note fires");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a trailing ';' holds the line open until the run ends (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT \"a\";\n20 PRINT \"b\"\n30 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /__basic_tail = true;/, "the held line records the pending tail");
  assert.match(out.code, /__basic_tail = false;/, "the completing reset is emitted");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a trailing ',' at END flushes the pending line (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT \"e\",\n20 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /if \(__basic_tail\) process\.stdout\.write\("\\n"\);/, "the exit site flushes the pending newline");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a folded + item in a glued PRINT keeps its value (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 PRINT \"a\"; 1 + 2\n20 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /\(1 \+ 2\)/, "the folded item is parenthesized so it adds up before the concatenation");
  assert.ok(out.report.notes.some(function(n) { return /parenthesized so JavaScript folds it as one value/.test(n); }), "the glue precedence note fires");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "a3\n", "1 + 2 folds to 3 before gluing");
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: a trailing ';' inside a GOTO machine loop keeps the run-end flush (A13)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET N = 0\n20 PRINT \"n\";\n30 LET N = N + 1\n40 IF N < 2 THEN 20\n50 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /if \(__basic_tail\) process\.stdout\.write\("\\n"\);/, "the machine exit site carries the flush");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

test("BASIC -> JS: programs without held lines or printed booleans keep their emission (A13 guard)", { skip: !HAS_PYTHON }, () => {
  let src = "10 LET S = 0\n20 FOR A = 1 TO 3\n30 LET S = S + A\n40 NEXT A\n50 PRINT S\n60 IF S > 3 THEN PRINT \"big\"\n70 END";
  let out = Iroh.translate(src, { from: "basic", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.ok(!out.code.includes("__basic_tail"), "no pending-tail bookkeeping without a held line");
  assert.ok(!out.code.includes("? 1 : 0"), "no boolean ternary without a printed boolean value");
  assert.ok(!out.report.notes.some(function(n) { return /1\/0|one space|held|pending/.test(n); }), "no print-parity notes without the covered shapes");
  let run = runNode(out.code);
  assert.equal(run.status, 0, run.stderr);
  let basic = runBasic(src);
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(run.stdout, basic.stdout, "emitted output must match the interpreter byte for byte");
});

// ------------------------------------------------------------------
// Two-hop legs (via JavaScript)
// ------------------------------------------------------------------

test("IrohScript -> Python two-hop round-trips to 30", { skip: !HAS_PYTHON }, () => {
  let src = "FUNCTION Add(a, b)\n  RETURN a + b\nEND FUNCTION\nLET result = Add(10, 20)\nPRINT result";
  let out = Iroh.translate(src, { from: "irohscript", to: "python" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(out.report.from, "irohscript");
  assert.match(out.report.notes.join(" "), /two-hop/);
  let run = runPython(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "30\n");
});

test("Python -> IrohScript two-hop round-trips to 30", { skip: !HAS_PYTHON }, () => {
  let src = "def add(a, b):\n    return a + b\n\nresult = add(10, 20)\nprint(result)";
  let out = Iroh.translate(src, { from: "python", to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /FUNCTION add/);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "30\n");
});

test("BASIC -> Python two-hop round-trips (hot loop = 11325)", { skip: !HAS_PYTHON }, () => {
  let hot = fs.readFileSync(path.join(IROHSCRIPT_DIR, "examples", "hotloop.bas"), "utf8");
  let out = Iroh.translate(hot, { from: "basic", to: "python" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runPython(out.code);
  assert.equal(run.stdout, "11325\n");
});

test("Python -> C++ two-hop now works (was a usage error before 1.0.1 part 2)", { skip: !HAS_PYTHON }, () => {
  let src = "x = 1\nprint(x)";
  let out = Iroh.translate(src, { from: "python", to: "cpp" });
  assert.equal(out.report.from, "python");
  assert.equal(out.report.to, "cpp");
});

// ------------------------------------------------------------------
// Async + CLI
// ------------------------------------------------------------------

test("translateAsync: IrohScript -> JS works in the async path", { skip: !HAS_PYTHON }, async () => {
  let src = "FUNCTION Add(a, b)\n  RETURN a + b\nEND FUNCTION\nLET result = Add(10, 20)\nPRINT result";
  let out = await Iroh.translateAsync(src, { from: "irohscript", to: "javascript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.equal(runNode(out.code).stdout, "30\n");
});

test("CLI --translate: .iroh -> javascript and .js -> irohscript", { skip: !HAS_PYTHON }, () => {
  let irohFile = writeTmp("prog.iroh", "FUNCTION Add(a, b)\n  RETURN a + b\nEND FUNCTION\nLET result = Add(10, 20)\nPRINT result");
  let res = cliTranslate(irohFile, ["--translate", "javascript"]);
  assert.equal(res.status, 0, res.stderr);
  let line = res.lines.find(function(l) { return l.type === "translation"; });
  assert.ok(line);
  assert.equal(line.from, "irohscript");
  assert.equal(line.to, "javascript");
  assert.equal(runNode(line.code).stdout, "30\n");
  let jsFile = writeTmp("prog.js", "function add(a, b) { return a + b; }\nlet result = add(10, 20);\nconsole.log(result);");
  let res2 = cliTranslate(jsFile, ["--translate", "irohscript"]);
  assert.equal(res2.status, 0, res2.stderr);
  let line2 = res2.lines.find(function(l) { return l.type === "translation"; });
  assert.ok(line2);
  assert.match(line2.code, /FUNCTION add/);
  assert.equal(runIrohscript(line2.code).stdout, "30\n");
});

test("CLI --translate: .bas -> javascript", { skip: !HAS_PYTHON }, () => {
  let basFile = writeTmp("prog.bas", "10 LET X = 10\n20 LET Y = 20\n30 PRINT X + Y");
  let res = cliTranslate(basFile, ["--translate", "javascript"]);
  assert.equal(res.status, 0, res.stderr);
  let line = res.lines.find(function(l) { return l.type === "translation"; });
  assert.ok(line);
  assert.equal(line.from, "basic");
  assert.equal(runNode(line.code).stdout, "30\n");
});

test("BASIC with END translates cleanly to Python and C++ (no host kill, no .exit stub)", { skip: !HAS_PYTHON }, () => {
  // Translating a BASIC program with END used to kill the host
  // process silently: the BASIC leg emits process.exit(0), and the
  // evidence trace in the second hop ran it in-process. The evidence
  // run now stubs process.exit to a sentinel (evidence kept), and
  // the emitters translate it as program end: sys.exit in Python,
  // std::exit in C++.
  let bas = "10 LET A = 2\n20 LET B = 3\n30 PRINT A + B\n40 END";
  let py = Iroh.translate(bas, { from: "basic", to: "python", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(py.report.ok, true, JSON.stringify(py.report.unsupported));
  assert.match(py.code, /import sys/);
  assert.match(py.code, /sys\.exit\(0\)/);
  assert.equal(runPython(py.code).stdout, "5\n");
  let cpp = Iroh.translate(bas, { from: "basic", to: "cpp", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(cpp.report.ok, true, JSON.stringify(cpp.report.unsupported));
  assert.match(cpp.code, /#include <cstdlib>/);
  assert.match(cpp.code, /std::exit\(0\)/);
  // IrohScript has no program-end primitive, so that leg stays a
  // loud stub — honest, not a silent mistranslation.
  let iroh = Iroh.translate(bas, { from: "basic", to: "irohscript", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(iroh.report.ok, false);
  assert.ok(iroh.report.unsupported.some((u) => u.message.includes("process.exit")));
});

test("BASIC -> Python and -> IrohScript: a WHILE program rides both hops and round-trips (Amendment A4)", { skip: !HAS_PYTHON }, () => {
  // The while now lowers at every hop: BASIC WHILE/WEND -> JavaScript
  // while (Amendment A4), then JavaScript while -> Python while /
  // IrohScript LOOP (Amendment A2). The classic column lights up
  // end to end.
  let bas = "10 LET I = 0\n20 WHILE I < 3\n30 PRINT I\n40 LET I = I + 1\n50 WEND";
  let py = Iroh.translate(bas, { from: "basic", to: "python", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(py.report.ok, true, JSON.stringify(py.report.unsupported));
  assert.equal(runPython(py.code).stdout, "0\n1\n2\n");
  let iroh = Iroh.translate(bas, { from: "basic", to: "irohscript", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(iroh.report.ok, true, JSON.stringify(iroh.report.unsupported));
  assert.match(iroh.code, /LOOP I < 3/);
  let run = runIrohscript(iroh.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n1\n2\n");
});

test("BASIC -> Python and -> IrohScript: nested WHILE/WEND rides both hops and round-trips (A5 follow-up)", { skip: !HAS_PYTHON }, () => {
  // Depth-matching through two hops: the inner WHILE/WEND pair must
  // nest inside the outer one in the emitted JavaScript, and the
  // second hop lowers each while again (Python while / LOOP).
  let bas = "10 LET I = 0\n20 LET T = 0\n30 WHILE I < 3\n40 LET J = 0\n50 WHILE J < 2\n60 LET T = T + 1\n70 LET J = J + 1\n80 WEND\n90 LET I = I + 1\n100 WEND\n110 PRINT T";
  let py = Iroh.translate(bas, { from: "basic", to: "python", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(py.report.ok, true, JSON.stringify(py.report.unsupported));
  assert.equal(runPython(py.code).stdout, "6\n");
  let iroh = Iroh.translate(bas, { from: "basic", to: "irohscript", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(iroh.report.ok, true, JSON.stringify(iroh.report.unsupported));
  assert.match(iroh.code, /LOOP I < 3/);
  assert.match(iroh.code, /LOOP J < 2/);
  let run = runIrohscript(iroh.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "6\n");
});

test("BASIC -> C++: a WHILE program rides both hops and round-trips (A5 follow-up)", { skip: !HAS_GPP && "g++ not found on this box" }, () => {
  // The classic column's last runtime leg: the while lowers at every
  // hop, BASIC -> JavaScript -> C++ (compiled and run for real).
  let bas = "10 LET I = 0\n20 LET T = 0\n30 WHILE I < 5\n40 LET T = T + I\n50 LET I = I + 1\n60 WEND\n70 PRINT T";
  let cpp = Iroh.translate(bas, { from: "basic", to: "cpp", irohscriptHome: IROHSCRIPT_DIR });
  assert.equal(cpp.report.ok, true, JSON.stringify(cpp.report.unsupported));
  assert.match(cpp.code, /while \(I < 5\)/);
  let run = runCpp(cpp.code);
  assert.equal(run.compiled, true, "g++ failed: " + run.stderr + "\ncode:\n" + cpp.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "10\n");
});

// --- Amendment A6 (2026-11-22): for-of closes on the BASIC-family legs
// (and for-in stays a loud stub by design -- no target has an object
// surface). BASIC lowers for-of through DIM + FOR/NEXT with minted
// helpers; IrohScript unrolls literals (no array type exists).

test("BASIC: a for-of over an inline array literal lowers to DIM + FOR/NEXT and round-trips (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("let s = 0;\nfor (const x of [1, 2, 3]) { s += x; }\nconsole.log(s);", { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  // The literal is hoisted once through the declaration machinery
  // (minted array, then a minted index walks 0..n-1).
  assert.match(out.code, /DIM __for_of_arr_1\(2\)/);
  assert.match(out.code, /FOR __for_of_idx_2 = 0 TO 2/);
  assert.match(out.code, /LET x = __for_of_arr_1\(__for_of_idx_2\)/);
  assert.match(out.code, /NEXT __for_of_idx_2/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "6\n");
});

test("BASIC: a for-of over a variable declared with an array literal rides its DIM (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("const xs = [1, 2, 3];\nlet t = 0;\nfor (const x of xs) { t += x; }\nconsole.log(t);", { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /DIM xs\(2\)/);
  assert.match(out.code, /FOR __for_of_idx_1 = 0 TO 2/);
  assert.match(out.code, /LET x = xs\(__for_of_idx_1\)/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "6\n");
});

test("BASIC: a for-of over a string literal unrolls one pass per character (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("let s = \"\";\nfor (const c of \"hi\") { s += c; }\nconsole.log(s);", { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /c = "h"/);
  assert.match(out.code, /c = "i"/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "hi\n");
});

test("BASIC: a for-of over an empty array literal runs zero passes (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("let n = 0;\nfor (const x of []) { n += 1; }\nconsole.log(n);", { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.ok(!out.code.includes("FOR "), out.code);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n");
});

test("BASIC: nested for-of over inline literals mints distinct helpers and round-trips (A6)", { skip: !HAS_PYTHON }, () => {
  let js = "let n = 0;\nfor (const a of [1, 2]) { for (const b of [3, 4]) { n = n + 1; } }\nconsole.log(n);";
  let out = Iroh.translate(js, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /DIM __for_of_arr_1\(1\)/);
  assert.match(out.code, /DIM __for_of_arr_3\(1\)/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "4\n");
});

test("BASIC: a call inside an array literal rides the GOSUB lifts into the for-of (A6)", { skip: !HAS_PYTHON }, () => {
  let js = "function f(v) { return v + 1; }\nlet s = 0;\nfor (const x of [f(1), f(4)]) { s += x; }\nconsole.log(s);";
  let out = Iroh.translate(js, { to: "basic" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /GOSUB/);
  let run = runBasic(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "7\n");
});

test("BASIC: a for-of over a variable since reassigned stays a loud stub (A6)", () => {
  let js = "let xs = [1, 2];\nlet t = 0;\nxs = 5;\nfor (const x of xs) { t += x; }\nconsole.log(t);";
  let out = Iroh.translate(js, { to: "basic" });
  assert.equal(out.report.ok, false);
  assert.ok(out.report.unsupported.some(u => u.construct === "ForOfStatement"), JSON.stringify(out.report.unsupported));
  assert.ok(out.report.unsupported.some(u => /has no LEN at runtime/.test(u.message)), JSON.stringify(out.report.unsupported));
});

test("IrohScript: a for-of over an array literal unrolls one pass per item and round-trips (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("let s = 0;\nfor (const x of [5, 10]) { s += x; }\nconsole.log(s);", { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  // First pass declares, later passes assign: a flat-scope re-binding.
  assert.match(out.code, /LET x : Int = 5/);
  assert.match(out.code, /^x = 10$/m);
  assert.ok(!out.code.includes("LOOP"), out.code);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "15\n");
});

test("IrohScript: a for-of over a string literal unrolls per character and round-trips (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("let s = \"\";\nfor (const c of \"hi\") { s += c; }\nconsole.log(s);", { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  assert.match(out.code, /LET c : String = "h"/);
  assert.match(out.code, /^c = "i"$/m);
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "hi\n");
});

test("IrohScript: a for-of over an empty array literal runs zero passes (A6)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate("let n = 0;\nfor (const x of []) { n += 1; }\nconsole.log(n);", { to: "irohscript" });
  assert.equal(out.report.ok, true, JSON.stringify(out.report.unsupported));
  let run = runIrohscript(out.code);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n");
});

test("IrohScript: a for-of over a variable stays a loud stub (A6)", () => {
  let js = "let s = 0;\nconst xs = [1, 2];\nfor (const x of xs) { s += x; }\nconsole.log(s);";
  let out = Iroh.translate(js, { to: "irohscript" });
  assert.equal(out.report.ok, false);
  assert.ok(out.report.unsupported.some(u => u.construct === "ForOfStatement"), JSON.stringify(out.report.unsupported));
  assert.ok(out.report.unsupported.some(u => /no array type/.test(u.message)), JSON.stringify(out.report.unsupported));
});

test("for-in over an object stays a loud stub on both BASIC-family legs (A6)", () => {
  let js = "const o = { a: 1, b: 2 };\nlet n = 0;\nfor (const k in o) { n += 1; }\nconsole.log(n);";
  for (let to of ["irohscript", "basic"]) {
    let out = Iroh.translate(js, { to });
    assert.equal(out.report.ok, false, to);
    assert.ok(out.report.unsupported.some(u => u.construct === "ForInStatement"), to + ": " + JSON.stringify(out.report.unsupported));
  }
});
