// Tests for the 0.8.0 hybrid translation engine: JavaScript ->
// Python / C++ (static + trace evidence), Python -> JavaScript and
// C++ -> JavaScript (static-only). For every covered construct the
// translated program is actually run — Python under python3, C++
// compiled with g++, JavaScript under node — and must produce the
// same output as the original program. The Python and C++ legs are
// skipped (not failed) when their toolchain is absent.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "iroh-translate-"));
}
function runNode(code) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.js");
  fs.writeFileSync(file, code);
  let proc = spawnSync(process.execPath, [file], { encoding: "utf8" });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}
function runPython(code) {
  let dir = tmpDir();
  let file = path.join(dir, "prog.py");
  fs.writeFileSync(file, code);
  let proc = spawnSync("python3", [file], { encoding: "utf8" });
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

// JS -> Python and JS -> C++ for one program: the translated output
// must match the original JS program's output, in both languages.
function checkBothWays(name, js, expected) {
  test("JS -> Python: " + name, { skip: !HAS_PYTHON }, () => {
    let out = Iroh.translate(js, { to: "python" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    assert.equal(out.report.staticOnly, false);
    let run = runPython(out.code);
    assert.equal(run.status, 0, "python failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.stdout, expected);
  });
  test("JS -> C++: " + name, { skip: !HAS_GPP }, () => {
    let out = Iroh.translate(js, { to: "cpp" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    assert.equal(out.report.staticOnly, false);
    let run = runCpp(out.code);
    assert.equal(run.compiled, true, "g++ failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.status, 0, "program failed: " + run.stderr);
    assert.equal(run.stdout, expected);
  });
  test("JS original: " + name, () => {
    let run = runNode(js);
    assert.equal(run.status, 0, "original JS failed: " + run.stderr);
    assert.equal(run.stdout, expected);
  });
}

checkBothWays(
  "functions and arithmetic",
  "function add(a, b) { return a + b; } console.log(add(2, 3));",
  "5\n"
);
checkBothWays(
  "for loop with a sum",
  "let s = 0; for (let i = 1; i <= 5; i++) { s += i; } console.log(s);",
  "15\n"
);
checkBothWays(
  "while loop",
  "let i = 0; let s = 0; while (i < 4) { s += i; i++; } console.log(s);",
  "6\n"
);
checkBothWays(
  "if / else if / else",
  "function sign(n) { if (n > 0) { return 1; } else if (n < 0) { return -1; } else { return 0; } } " +
  "console.log(sign(5)); console.log(sign(-2)); console.log(sign(0));",
  "1\n-1\n0\n"
);
checkBothWays(
  "arrays and for-of",
  "let xs = [3, 1, 2]; let s = 0; for (let x of xs) { s += x; } console.log(s); console.log(xs.length);",
  "6\n3\n"
);
checkBothWays(
  "strings and concatenation",
  'let name = "world"; console.log("hello " + name);',
  "hello world\n"
);
checkBothWays(
  "multiple console.log arguments",
  "console.log(1, 2, 3);",
  "1 2 3\n"
);
checkBothWays(
  "Math functions",
  "console.log(Math.max(3, 7)); console.log(Math.min(3, 7)); console.log(Math.pow(2, 3)); " +
  "console.log(Math.round(2.5)); console.log(Math.abs(-4)); console.log(Math.floor(3.7));",
  "7\n3\n8\n3\n4\n3\n"
);
checkBothWays(
  "a combined program",
  "function total(xs) { let s = 0; for (let x of xs) { s += x; } return s; } " +
  "let nums = [1, 2, 3, 4]; " +
  "if (total(nums) > 5) { console.log('big'); } else { console.log('small'); } " +
  "console.log(total(nums));",
  "big\n10\n"
);

// --- Report shape -------------------------------------------------------

test("JS -> C++ report cites trace evidence for parameter types", () => {
  let out = Iroh.translate("function add(a, b) { return a + b; } console.log(add(2, 3));", { to: "cpp" });
  assert.equal(out.report.ok, true);
  assert.equal(out.report.from, "javascript");
  assert.equal(out.report.to, "cpp");
  assert.equal(out.report.staticOnly, false);
  assert.ok(out.report.assumptions.length > 0, "expected trace-based assumptions");
  let params = out.report.assumptions.find((a) => a.what.indexOf("parameter types of 'add'") !== -1);
  assert.ok(params, "expected a parameter-type assumption for add");
  assert.match(params.evidence, /FUNCTION_CALL 'add' arguments \[2,3\]/);
  assert.ok(out.report.clean.some((c) => c.construct === "functions"));
  assert.deepEqual(out.report.unsupported, []);
});

test("JS -> Python report lists clean constructs and no assumptions when none were needed", () => {
  let out = Iroh.translate("let s = 0; for (let i = 0; i < 3; i++) { s += i; } console.log(s);", { to: "python" });
  assert.equal(out.report.ok, true);
  assert.deepEqual(out.report.unsupported, []);
  assert.ok(out.report.clean.some((c) => c.construct === "loops"));
  assert.ok(out.report.clean.some((c) => c.construct === "console-output"));
});

// --- 1.1.1 patch: template literals emit concatenation, not f-strings -
// (Fix Spec 3.5 Option 1). On Python before 3.12 an f-string
// replacement field cannot hold a quote, so the old emitter produced
// a SyntaxError on 3.9-3.11 while the report said ok. The emitted
// code must contain no f-string at all, must run, and must match
// node's output. (The 3.9-3.11 leg of this is covered by the
// execution-matrix gate, tools/check-translate-matrix.sh — the suite
// only has the local python3.)
const TEMPLATE_CASES = [
  ["string literal in a field", 'console.log(`a=${"lit"}`);', "a=lit\n"],
  ["ternary of strings", 'const ok=true;console.log(`a=${ok ? "yes" : "no"}`);', "a=yes\n"],
  ["literal text and a field", 'console.log(`pre${"x"}post`);', "prexpost\n"],
  ["bool (fixed in 1.1.1)", "const b=true;console.log(`b=${b}`);", "b=true\n"],
  ["double", "console.log(`n=${1e16}`);", "n=10000000000000000\n"],
  ["quote inside a quote", 'console.log(`s=${"a\\"b"}`);', 's=a"b\n'],
  ["int interpolation", "console.log(`n=${41 + 1}`);", "n=42\n"],
];
for (const [name, js, expected] of TEMPLATE_CASES) {
  test("template literal -> Python concatenation: " + name, { skip: !HAS_PYTHON }, () => {
    let out = Iroh.translate(js, { to: "python" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    assert.ok(!/(^|[^\w])f["']/.test(out.code),
      "emitted code must not use an f-string:\n" + out.code);
    let run = runPython(out.code);
    assert.equal(run.status, 0, "python failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.stdout, expected);
    // The verify block (3.7) already ran the emitted program.
    assert.equal(out.report.verify.attempted, true);
    assert.equal(out.report.verify.ran, true);
    assert.equal(out.report.verify.exit, 0);
  });
}

test("1.1.1 patch: translate report carries a verify block (Fix Spec 3.7)", { skip: !HAS_PYTHON }, () => {
  let out = Iroh.translate('console.log(`a=${"lit"}`);', { to: "python" });
  assert.equal(out.report.ok, true);
  assert.equal(out.report.verify.attempted, true);
  assert.equal(out.report.verify.ran, true);
  assert.equal(out.report.verify.exit, 0);
  assert.match(out.report.verify.interpreter, /^\d+\.\d+\.\d+$/);
  // Other legs record that verification was not attempted — ran: null
  // is not ran: true.
  let cpp = Iroh.translate("console.log(1);", { to: "cpp" });
  assert.equal(cpp.report.verify.attempted, false);
  assert.equal(cpp.report.verify.ran, null);
  assert.ok(cpp.report.verify.reason.length > 0);
  // Opt-out via options.verify: false.
  let off = Iroh.translate("console.log(1);", { to: "python", verify: false });
  assert.equal(off.report.verify.attempted, false);
  assert.equal(off.report.verify.ran, null);
  // ran: false carries the interpreter's stderr verbatim. The program
  // below is the probe: JS `%` yields NaN on a zero divisor, the
  // emitted Python raises ZeroDivisionError — a known semantic gap,
  // and the verify block's job is to report it, not hide it.
  let div = Iroh.translate("console.log(10 % 0);", { to: "python" });
  assert.equal(div.report.verify.attempted, true);
  assert.equal(div.report.verify.ran, false);
  assert.equal(div.report.verify.exit, 1);
  assert.match(div.report.verify.stderr, /ZeroDivisionError/);
});

test("unsupported constructs are reported, never silently mistranslated", () => {
  let out = Iroh.translate("class A { m() { return 1; } } let a = new A(); console.log(a.m());", { to: "python" });
  assert.equal(out.report.ok, false);
  assert.ok(out.report.unsupported.length > 0);
  assert.ok(out.report.unsupported.some((u) => u.message.indexOf("Class") !== -1));
  // The emitted code raises loudly at the unsupported point.
  let run = runPython(out.code);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /NotImplementedError/);

  let outCpp = Iroh.translate("class A { m() { return 1; } } let a = new A(); console.log(a.m());", { to: "cpp" });
  assert.equal(outCpp.report.ok, false);
  assert.ok(outCpp.report.unsupported.length > 0);
});

test("a function never called in the trace needs a type hint for C++", () => {
  let out = Iroh.translate("function add(a, b) { return a + b; }", { to: "cpp" });
  assert.equal(out.report.ok, false);
  assert.ok(out.report.unsupported.some((u) => u.message.indexOf("no type") !== -1));

  let hinted = Iroh.translate("function add(a, b) { return a + b; } console.log(add(2, 3));", {
    to: "cpp",
    types: { functions: { add: { params: ["int", "int"], returns: "int" } } },
  });
  assert.equal(hinted.report.ok, true);
  assert.match(hinted.code, /int add\(int a, int b\)/);
});

test("translate() rejects bad targets and same-language translation", () => {
  assert.throws(() => Iroh.translate("1;", { to: "rust" }), /unknown target/);
  assert.throws(() => Iroh.translate("1;", { to: "javascript" }), /both 'javascript'/);
  // Two-hop via JavaScript: Python -> C++ no longer throws (it went
  // through JavaScript in 1.0.1 part 2); the same-source rule still does.
  assert.equal(Iroh.translate("x = 1", { from: "python", to: "cpp" }).report.from, "python");
  assert.throws(() => Iroh.translate("1;", { from: "ruby", to: "javascript" }), /unknown source/);
});

test("translateAsync mirrors translate for the JS-out legs", async () => {
  let out = await Iroh.translateAsync("function add(a, b) { return a + b; } console.log(add(2, 3));", { to: "python" });
  assert.equal(out.report.ok, true);
  assert.match(out.code, /def add/);
});

// --- Python -> JavaScript (static-only) ---------------------------------

function checkPyToJs(name, py, expected) {
  test("Python -> JS: " + name, () => {
    let out = Iroh.translate(py, { from: "python", to: "javascript" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    assert.equal(out.report.staticOnly, true);
    let run = runNode(out.code);
    assert.equal(run.status, 0, "translated JS failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.stdout, expected);
  });
  test("Python original: " + name, { skip: !HAS_PYTHON }, () => {
    let run = runPython(py);
    assert.equal(run.status, 0, "original Python failed: " + run.stderr);
    assert.equal(run.stdout, expected);
  });
}

checkPyToJs(
  "functions and arithmetic",
  "def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n",
  "5\n"
);
checkPyToJs(
  "range() loop with a sum",
  "s = 0\nfor i in range(1, 6):\n    s += i\nprint(s)\n",
  "15\n"
);
checkPyToJs(
  "while loop and if/elif/else",
  "def sign(n):\n    if n > 0:\n        return 1\n    elif n < 0:\n        return -1\n    else:\n        return 0\n\nprint(sign(5))\nprint(sign(-2))\nprint(sign(0))\n",
  "1\n-1\n0\n"
);
checkPyToJs(
  "lists and for-over-list",
  "xs = [3, 1, 2]\ns = 0\nfor x in xs:\n    s += x\nprint(s)\nprint(len(xs))\n",
  "6\n3\n"
);
checkPyToJs(
  "strings, f-strings and methods",
  "name = \"world\"\nprint(f\"hello {name}\")\nprint(name.upper())\n",
  "hello world\nWORLD\n"
);
checkPyToJs(
  "try/except",
  "try:\n    raise Exception(\"boom\")\nexcept Exception as e:\n    print(\"caught\")\n",
  "caught\n"
);
checkPyToJs(
  "tuple unpacking",
  "a, b = 1, 2\nprint(a + b)\n",
  "3\n"
);

test("Python -> JS reports unsupported imports and classes", () => {
  let imp = Iroh.translate("import math\nprint(math.sqrt(4))\n", { from: "python", to: "javascript" });
  assert.equal(imp.report.ok, false);
  assert.ok(imp.report.unsupported.some((u) => u.message.indexOf("import") !== -1));
  assert.equal(imp.report.staticOnly, true);

  let cls = Iroh.translate("class A:\n    pass\n", { from: "python", to: "javascript" });
  assert.equal(cls.report.ok, false);
  assert.ok(cls.report.unsupported.some((u) => u.message.indexOf("class") !== -1));
});

test("Python -> JS works through translateAsync", async () => {
  let out = await Iroh.translateAsync("def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n", {
    from: "python",
    to: "javascript",
  });
  assert.equal(out.report.ok, true);
  assert.equal(runNode(out.code).stdout, "5\n");
});

test("Python -> JS rejects a syntax error with a clear message", () => {
  assert.throws(
    () => Iroh.translate("def broken(:\n", { from: "python", to: "javascript" }),
    /Python parse failed/
  );
});

// --- C++ -> JavaScript (static-only) ------------------------------------

function checkCppToJs(name, cpp, expected) {
  test("C++ -> JS: " + name, () => {
    let out = Iroh.translate(cpp, { from: "cpp", to: "javascript" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    assert.equal(out.report.staticOnly, true);
    let run = runNode(out.code);
    assert.equal(run.status, 0, "translated JS failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.stdout, expected);
  });
  test("C++ original: " + name, { skip: !HAS_GPP }, () => {
    let run = runCpp(cpp);
    assert.equal(run.compiled, true, "original C++ failed to compile: " + run.stderr);
    assert.equal(run.stdout, expected);
  });
}

checkCppToJs(
  "functions and arithmetic",
  "#include <iostream>\nint add(int a, int b) { return a + b; }\nint main() { std::cout << add(2, 3) << std::endl; return 0; }\n",
  "5\n"
);
checkCppToJs(
  "for loop with a sum",
  "#include <iostream>\nint main() { int s = 0; for (int i = 1; i <= 5; i++) { s += i; } std::cout << s << std::endl; return 0; }\n",
  "15\n"
);
checkCppToJs(
  "while loop and if/else if/else",
  "#include <iostream>\nint sign(int n) { if (n > 0) { return 1; } else if (n < 0) { return -1; } else { return 0; } }\nint main() { std::cout << sign(5) << std::endl; std::cout << sign(-2) << std::endl; std::cout << sign(0) << std::endl; return 0; }\n",
  "1\n-1\n0\n"
);
checkCppToJs(
  "vectors and range-for",
  "#include <iostream>\n#include <vector>\nint main() { std::vector<int> xs = {3, 1, 2}; int s = 0; for (int x : xs) { s += x; } std::cout << s << std::endl; std::cout << xs.size() << std::endl; return 0; }\n",
  "6\n3\n"
);
checkCppToJs(
  "strings and cout chains",
  "#include <iostream>\n#include <string>\nint main() { std::string name = \"world\"; std::cout << \"hello \" << name << std::endl; return 0; }\n",
  "hello world\n"
);
checkCppToJs(
  "std::pow and std::to_string",
  "#include <iostream>\n#include <cmath>\n#include <string>\nint main() { std::cout << std::pow(2, 3) << std::endl; std::cout << std::to_string(42) << std::endl; return 0; }\n",
  "8\n42\n"
);
checkCppToJs(
  "try/catch",
  "#include <iostream>\n#include <stdexcept>\nint main() { try { throw std::runtime_error(\"boom\"); } catch (const std::exception& e) { std::cout << \"caught\" << std::endl; } return 0; }\n",
  "caught\n"
);

test("C++ -> JS reports code outside the subset instead of guessing", () => {
  let out = Iroh.translate("#include <iostream>\nint main() { int* p = new int(3); std::cout << *p << std::endl; return 0; }\n", {
    from: "cpp",
    to: "javascript",
  });
  assert.equal(out.report.ok, false);
  assert.ok(out.report.unsupported.length > 0);
  assert.equal(out.report.staticOnly, true);
});

// --- CLI --translate ------------------------------------------------------

function runCli(code, args) {
  let proc = spawnSync(process.execPath, [CLI, ...(args || [])], {
    input: code,
    encoding: "utf8",
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

test("CLI --translate javascript->python prints one translation line, exit 0", () => {
  let { proc, lines } = runCli("function add(a, b) { return a + b; } console.log(add(2, 3));", ["--translate", "python"]);
  assert.equal(proc.status, 0);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, "translation");
  assert.equal(lines[0].from, "javascript");
  assert.equal(lines[0].to, "python");
  assert.match(lines[0].code, /def add/);
  assert.equal(lines[0].report.ok, true);
});

test("CLI --translate exits 1 when the report lists unsupported constructs", () => {
  let { proc, lines } = runCli("class A { m() { return 1; } }", ["--translate", "python"]);
  assert.equal(proc.status, 1);
  assert.equal(lines[0].type, "translation");
  assert.equal(lines[0].report.ok, false);
  assert.ok(lines[0].report.unsupported.length > 0);
});

test("CLI --translate infers --from from a .py file", () => {
  let dir = tmpDir();
  let file = path.join(dir, "prog.py");
  fs.writeFileSync(file, "def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n");
  let proc = spawnSync(process.execPath, [CLI, file, "--translate", "javascript"], { encoding: "utf8" });
  assert.equal(proc.status, 0);
  let lines = proc.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines[0].from, "python");
  assert.equal(lines[0].to, "javascript");
  assert.match(lines[0].code, /function add/);
});

// --- 1.0.1 fixes: remainder, number formatting, string conversion,
// and cross-call type consistency -------------------------------------

checkBothWays(
  "remainder with negative operands (JS % semantics)",
  "console.log(-5 % 3); console.log(5 % -3); console.log(5 % 3); console.log(-5.5 % 2);",
  "-2\n2\n2\n-1.5\n"
);

checkBothWays(
  "string + double concatenation",
  'console.log("x" + 1.5); console.log("y" + 0.1);',
  "x1.5\ny0.1\n"
);

checkBothWays(
  "string + boolean concatenation",
  'console.log("b" + true); console.log("c" + false);',
  "btrue\ncfalse\n"
);

checkBothWays(
  "number formatting matches JS (no early exponential, no padded exponent)",
  "console.log(10000000000000000); console.log(1000000000000000000000); console.log(0.0000001); console.log(0.000001); console.log(0.1 + 0.2);",
  "10000000000000000\n1e+21\n1e-7\n0.000001\n0.30000000000000004\n"
);

checkBothWays(
  "String() of a double and a boolean",
  "console.log(String(1.5)); console.log(String(true)); console.log(String(1000000000000000000000));",
  "1.5\ntrue\n1e+21\n"
);

checkBothWays(
  "template literal interpolating a double and a boolean",
  "console.log(`v=${1.5} b=${true}`);",
  "v=1.5 b=true\n"
);

// --- D1: a bool in a template literal must not emit an f-string that
// only parses on Python 3.12+ ---------------------------------------
// The old emitter wrote print(f"b={("true" if b else "false")}"),
// nesting the f-string's own delimiter inside a replacement field.
// That is legal only on Python 3.12+ (PEP 701); on 3.9-3.11 it is
// SyntaxError, and the report still said ok with zero unsupported
// entries — a clean-looking scan hiding a dead artifact. The fix
// routes the bool through a __iroh_jsbool(v) helper, so the field
// holds a call, not a quote. The value tests below run on this box
// (Python 3.12), which accepts the old code too, so they do not by
// themselves prove the 3.9 claim. The compat test is the one that
// enforces it — and it is a textual scan, not ast.parse: on Python
// 3.12.3, ast.parse(src, feature_version=(3, 9)) ACCEPTS the old
// buggy output (the 3.12 tokenizer is PEP 701-aware whatever
// feature_version says), so that check would pass the broken build.
// The scan below enforces the actual 3.9-3.11 rule instead: no "
// inside any {...} replacement field of an f"..." string.
function assertFStringFieldsHaveNoDoubleQuotes(code) {
  let i = 0;
  while (i < code.length) {
    let isFString = code[i] === "f" && code[i + 1] === '"' &&
      !(i > 0 && /[A-Za-z0-9_]/.test(code[i - 1]));
    if (!isFString) { i++; continue; }
    let j = i + 2;
    let inField = false;
    let depth = 0;
    while (j < code.length) {
      let c = code[j];
      if (!inField) {
        if (c === "\\") { j += 2; continue; }
        if (c === '"') break; // end of the f-string
        if (c === "{" && code[j + 1] === "{") { j += 2; continue; }
        if (c === "}" && code[j + 1] === "}") { j += 2; continue; }
        if (c === "{") { inField = true; depth = 0; j++; continue; }
        j++;
      } else {
        // Inside a {...} field: any " is illegal before Python 3.12.
        assert.notEqual(c, '"',
          "double quote inside an f-string replacement field — breaks Python < 3.12 (PEP 701): " +
          JSON.stringify(code.slice(i, j + 1)));
        if (c === "(" || c === "[" || c === "{") depth++;
        if (c === ")" || c === "]") depth--;
        if (c === "}") {
          if (depth === 0) { inField = false; j++; continue; }
          depth--;
        }
        j++;
      }
    }
    i = j;
  }
}

test("D1: template literal bool runs and prints true/false (value)", { skip: !HAS_PYTHON }, () => {
  for (let [js, expected] of [
    ["const b = true; console.log(`b=${b}`);", "b=true\n"],
    ["const b = false; console.log(`b=${b}`);", "b=false\n"],
    ["console.log(`v=${1.5} b=${true}`);", "v=1.5 b=true\n"],
  ]) {
    let out = Iroh.translate(js, { to: "python" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    let run = runPython(out.code);
    assert.equal(run.status, 0, "python failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.stdout, expected);
  }
});

test("D1: template literal bool emits no double quote inside an f-string field (3.9 compat)", () => {
  for (let js of [
    "const b = true; console.log(`b=${b}`);",
    "const b = false; console.log(`b=${b}`);",
    "console.log(`v=${1.5} b=${true}`);",
  ]) {
    let out = Iroh.translate(js, { to: "python" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    assert.match(out.code, /__iroh_jsbool\(/);
    assertFStringFieldsHaveNoDoubleQuotes(out.code);
  }
});

test("D1: bool string concat and String(bool) stay 3.9-safe (no f-string quotes)", { skip: !HAS_PYTHON }, () => {
  for (let [js, expected] of [
    ['let b = true; console.log("x=" + b);', "x=true\n"],
    ["console.log(String(true));", "true\n"],
    ["console.log(String(false));", "false\n"],
  ]) {
    let out = Iroh.translate(js, { to: "python" });
    assert.equal(out.report.ok, true, "report: " + JSON.stringify(out.report.unsupported));
    // These emit a standalone ternary, not an f-string field, so they
    // are legal on 3.9+ as written — but the scan still applies, in
    // case a future change nests one inside an f-string.
    assertFStringFieldsHaveNoDoubleQuotes(out.code);
    let run = runPython(out.code);
    assert.equal(run.status, 0, "python failed: " + run.stderr + "\ncode:\n" + out.code);
    assert.equal(run.stdout, expected);
  }
});

checkPyToJs(
  "remainder is floored (Python % semantics)",
  "print(-5 % 3)\nprint(5 % -3)\nprint(5 % 3)\nprint(-5.5 % 2)\n",
  "1\n-1\n2\n0.5\n"
);

test("C++ refuses a function called with conflicting argument types", () => {
  let out = Iroh.translate(
    'function f(a) { return a; } console.log(f(1)); console.log(f("a"));',
    { to: "cpp" }
  );
  assert.equal(out.report.ok, false);
  assert.match(out.report.unsupported[0].message, /conflicting types/);
  assert.match(out.report.unsupported[0].message, /cannot override trace evidence/);
});

test("C++ accepts a function called with consistent types across calls", () => {
  let out = Iroh.translate(
    "function f(a) { return a; } console.log(f(1)); console.log(f(2));",
    { to: "cpp" }
  );
  assert.equal(out.report.ok, true);
  assert.match(out.report.assumptions[0].what, /verified consistent across 2 calls/);
});

test("C++ refuses a function whose return type differs across calls", () => {
  let out = Iroh.translate(
    'function f(a) { if (a) { return 1; } return "s"; } console.log(f(true)); console.log(f(false));',
    { to: "cpp" }
  );
  assert.equal(out.report.ok, false);
  assert.match(out.report.unsupported[0].message, /differs across calls/);
});

test("JS -> C++ emits <cmath> exactly once when Math and number printing combine", () => {
  // A program that both uses Math (needs.cmath) and prints a Number
  // (needs.jsnum, whose helper also needs <cmath>) used to get the
  // include twice. Duplicate includes are harmless in C++, but the
  // emitted header should still say it once.
  let r = Iroh.translate("let x = Math.sqrt(2); console.log(x); console.log(1.5);", { to: "cpp" });
  assert.equal(r.report.ok, true);
  assert.equal((r.code.match(/#include <cmath>/g) || []).length, 1);
});

test("process.exit translates as program end: sys.exit in Python, std::exit in C++, END in BASIC", () => {
  let js = "let x = 1;\nconsole.log(x);\nprocess.exit(0);";
  let py = Iroh.translate(js, { to: "python" });
  assert.equal(py.report.ok, true);
  assert.match(py.code, /import sys/);
  assert.match(py.code, /sys\.exit\(0\)/);
  let cpp = Iroh.translate(js, { to: "cpp" });
  assert.equal(cpp.report.ok, true);
  assert.match(cpp.code, /#include <cstdlib>/);
  assert.match(cpp.code, /std::exit\(0\)/);
  let bas = Iroh.translate(js, { to: "basic" });
  assert.equal(bas.report.ok, true);
  assert.ok(bas.code.split("\n").includes("END"));
  // The evidence trace runs the program in-process and keeps the
  // evidence gathered before the exit: the call's types still come
  // from the trace, not from static inference.
  let typed = Iroh.translate("function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\nprocess.exit(0);", { to: "cpp" });
  assert.equal(typed.report.ok, true);
  assert.match(typed.code, /int add\(int a, int b\)/);
  assert.ok(typed.report.assumptions.some((a) => a.what.includes("taken from the trace")));
});

test("translate() with evidence 'none' never runs the program (static-only)", () => {
  global.__iroh_evidence_probe = 0;
  let code = "global.__iroh_evidence_probe = (global.__iroh_evidence_probe || 0) + 1; function add(a, b) { return a + b; } add(2, 3);";
  let traced = Iroh.translate(code, { to: "python" });
  assert.equal(global.__iroh_evidence_probe, 1, "the default evidence run executes the program once");
  assert.ok(traced.code.indexOf("def add") !== -1);
  global.__iroh_evidence_probe = 0;
  let staticOnly = Iroh.translate(code, { to: "python", evidence: "none" });
  assert.equal(global.__iroh_evidence_probe, 0, "evidence 'none' must not execute the program");
  assert.ok(staticOnly.code.indexOf("def add") !== -1, "it still translates");
  assert.ok(
    staticOnly.report.notes.some((n) => n.indexOf("evidence skipped") !== -1 && n.indexOf("options.evidence: 'none'") !== -1),
    "the report says the evidence was skipped by request"
  );
  delete global.__iroh_evidence_probe;
});

test("translate() with a bad evidence value throws a clear error", () => {
  assert.throws(
    () => Iroh.translate("function add(a, b) { return a + b; }", { to: "python", evidence: "sometimes" }),
    /options\.evidence must be 'trace' or 'none'/
  );
});

test("translateAsync() with evidence 'none' never runs the program", async () => {
  global.__iroh_evidence_probe = 0;
  let code = "global.__iroh_evidence_probe = (global.__iroh_evidence_probe || 0) + 1; function add(a, b) { return a + b; } add(2, 3);";
  let out = await Iroh.translateAsync(code, { to: "python", evidence: "none" });
  assert.equal(global.__iroh_evidence_probe, 0);
  assert.ok(out.code.indexOf("def add") !== -1);
  delete global.__iroh_evidence_probe;
});
