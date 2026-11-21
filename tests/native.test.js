// Tests for the 0.9.0 native tracers through the CLI: --lang
// python|cpp (and extension inference), with Iroh.analyze() proving
// the cross-language claim — a Python hot loop analyzes to HOT_LOOP,
// a C++ deep recursion analyzes to DEEP_RECURSION. Requires the built
// dist, python3 and g++.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "cli", "iroh.js");

// g++-dependent tests skip (with a reason naming g++) on boxes
// without g++ — skipped, not failed, exactly like translate.test.js
// guards its compile-and-run cases with HAS_GPP.
function has(cmd) {
  try {
    execSync("command -v " + cmd, { stdio: "ignore", shell: true });
    return true;
  } catch (e) {
    return false;
  }
}
const cppOnBox = has("g++");

function runCliFile(file, args, input) {
  let proc = spawnSync(process.execPath, [CLI, file, ...(args || [])], {
    encoding: "utf8",
    input: input,
    // The CLI can stream megabytes of events (a 5000-deep recursion
    // is ~4 MB); spawnSync's 1 MiB default would kill it with ENOBUFS.
    maxBuffer: 512 * 1024 * 1024,
  });
  let lines = proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { proc, lines };
}

function writeTemp(dir, name, code) {
  let file = path.join(dir, name);
  fs.writeFileSync(file, code, "utf8");
  return file;
}

function analysisOf(lines) {
  return lines.find((l) => l.type === "analysis");
}

const PY_FACTORIAL =
  "def factorial(n):\n" +
  "    if n == 0:\n" +
  "        return 1\n" +
  "    return n * factorial(n - 1)\n" +
  "\n" +
  "factorial(3)\n";

const PY_HOT_LOOP = "total = 0\nfor i in range(150):\n    total += i\n";

const CPP_FACTORIAL =
  "#include <iostream>\n" +
  "int factorial(int n) {\n" +
  "  if (n == 0) return 1;\n" +
  "  return n * factorial(n - 1);\n" +
  "}\n" +
  "int main() { std::cout << factorial(3) << std::endl; return 0; }\n";

const CPP_DEEP =
  "int countdown(int n) {\n" +
  "  if (n == 0) return 0;\n" +
  "  return countdown(n - 1) + 1;\n" +
  "}\n" +
  "int main() { return countdown(30); }\n";

test("CLI --lang python traces factorial: calls, returns, depth", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "fact.py", PY_FACTORIAL);
    let { proc, lines } = runCliFile(file, ["--lang", "python"]);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.deepEqual(calls.map((c) => c.arguments), [[3], [2], [1], [0]]);
    assert.deepEqual(calls.map((c) => c.indent), [0, 1, 2, 3]);
    let returns = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL_END");
    assert.deepEqual(returns.map((r) => r.return), [1, 1, 2, 6]);
    let result = lines.find((l) => l.type === "result");
    assert.equal(result.value, null); // Python has no completion value
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI infers python from a .py file without --lang", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "fact.py", PY_FACTORIAL);
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.equal(calls.length, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python hot loop analyzes to HOT_LOOP through --analyze", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "hot.py", PY_HOT_LOOP);
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis, "expected an analysis line");
    let hot = analysis.findings.find((f) => f.code === "HOT_LOOP");
    assert.ok(hot, "expected HOT_LOOP, got " + JSON.stringify(analysis.findings.map((f) => f.code)));
    assert.equal(hot.evidence.iterations, 150);
    assert.equal(hot.evidence.tests, 151);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python caught exception analyzes to THROWING_PATH", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "caught.py",
      "try:\n    raise ValueError('boom')\nexcept ValueError:\n    x = 1\n");
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis.findings.find((f) => f.code === "THROWING_PATH"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python uncaught exception is an error line, exit 1", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "boom.py", "raise RuntimeError('kaboom')\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 1);
    let err = lines.find((l) => l.type === "error");
    assert.ok(err, "expected an error line");
    assert.equal(err.name, "RuntimeError");
    assert.equal(err.message, "kaboom");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --lang cpp traces factorial with resolved names", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "fact.cpp", CPP_FACTORIAL);
    let { proc, lines } = runCliFile(file, ["--lang", "cpp"]);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.deepEqual(calls.map((c) => c.name), ["main", "factorial(int)", "factorial(int)", "factorial(int)", "factorial(int)"]);
    assert.deepEqual(calls.map((c) => c.indent), [0, 1, 2, 3, 4]);
    // Every event carries a real address, never a faked name.
    for (let e of lines.filter((l) => l.type === "event")) {
      assert.match(e.address, /^0x[0-9a-f]+$/);
    }
    let result = lines.find((l) => l.type === "result");
    assert.equal(result.value, 0); // main returned 0
    assert.match(proc.stderr, /6/); // the program's own output, on stderr
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI infers cpp from a .cpp file without --lang", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "fact.cpp", CPP_FACTORIAL);
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.equal(calls.length, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ deep recursion analyzes to DEEP_RECURSION through --analyze", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "deep.cpp", CPP_DEEP);
    let { proc, lines } = runCliFile(file, ["--analyze"]);
    assert.equal(proc.status, 0, proc.stderr);
    let analysis = analysisOf(lines);
    assert.ok(analysis, "expected an analysis line");
    let deep = analysis.findings.find((f) => f.code === "DEEP_RECURSION");
    assert.ok(deep, "expected DEEP_RECURSION, got " + JSON.stringify(analysis.findings.map((f) => f.code)));
    assert.equal(deep.evidence.maxDepth, 31);
    assert.equal(deep.evidence.name, "countdown(int)");
    // Function-level only: coverage is honestly low (2 of 30).
    assert.equal(analysis.scores.coverage.fired, 2);
    assert.equal(analysis.scores.coverage.total, 30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ compile error is an error line, exit 1", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "bad.cpp", "int main() { return ; }\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 1);
    let err = lines.find((l) => l.type === "error");
    assert.ok(err, "expected an error line");
    assert.match(err.message, /Compilation failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ program that crashes keeps the events it emitted", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "crash.cpp",
      "#include <cstdlib>\n" +
      "int level1(int x) { return x * 2; }\n" +
      "int main() { level1(21); std::abort(); return 0; }\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 1);
    let err = lines.find((l) => l.type === "error");
    assert.ok(err, "expected an error line");
    assert.match(err.message, /Program killed by signal SIGABRT/);
    // The events before the crash are real evidence, not dropped.
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.deepEqual(calls.map((c) => c.name), ["main", "level1(int)"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ 5000-deep recursion stays paired past the old 4096 cap", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  // The runtime's emitted-stack used to be a fixed 4096 entries: past
  // it, exits popped the wrong frame's flag and pairing shifted. The
  // CLI's spawnSync maxBuffer (1 MiB) also killed the run with ENOBUFS
  // at ~4 MB of events. Both are exercised here: 5002 calls, 20008
  // events, all paired, exit 0.
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "deep5000.cpp",
      "int countdown(int n) {\n" +
      "  if (n == 0) return 0;\n" +
      "  return countdown(n - 1) + 1;\n" +
      "}\n" +
      "int main() { countdown(5000); return 0; }\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let events = lines.filter((l) => l.type === "event");
    assert.equal(events.length, 20008);
    let calls = events.filter((e) => e.event === "FUNCTION_CALL");
    let ends = events.filter((e) => e.event === "FUNCTION_CALL_END");
    assert.equal(calls.length, 5002);
    assert.equal(ends.length, 5002);
    // Simulated depth returns to zero and never goes negative.
    let depth = 0;
    let minDepth = 0;
    for (let e of events) {
      if (e.event === "FUNCTION_CALL") depth += 1;
      else if (e.event === "FUNCTION_CALL_END") depth -= 1;
      if (depth < minDepth) minDepth = depth;
    }
    assert.equal(depth, 0);
    assert.equal(minDepth, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ function taking std::string is traced, std internals are not", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  // The old filter dropped any name CONTAINING "std::" — every user
  // function taking or returning a std type vanished. The filter now
  // parses the mangled name's outermost qualifier.
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "overload.cpp",
      "#include <string>\n" +
      "#include <iostream>\n" +
      "int add(int a, int b) { return a + b; }\n" +
      "double add(double a, double b) { return a + b; }\n" +
      "std::string greet(std::string name) { return std::string(\"hi \") + name; }\n" +
      "int main() {\n" +
      "  std::cout << add(1, 2) << add(1.5, 2.5) << greet(\"x\") << std::endl;\n" +
      "  return 0;\n" +
      "}\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let names = lines
      .filter((l) => l.type === "event" && l.event === "FUNCTION_CALL")
      .map((c) => c.name);
    assert.ok(names.some((n) => n.startsWith("greet(")), "greet missing: " + names);
    assert.ok(names.includes("add(int, int)"));
    assert.ok(names.includes("add(double, double)"));
    assert.ok(names.includes("main"));
    assert.ok(!names.some((n) => n.startsWith("std::")),
      "std internals leaked: " + names.filter((n) => n.startsWith("std::")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ static, anonymous-namespace and lambda functions resolve by name", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  // dladdr only sees dynamic symbols, so local symbols resolved to
  // null; the runtime now falls back to the .symtab.
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "names.cpp",
      "static int helper(int x) { return x + 1; }\n" +
      "namespace { int anon_helper(int x) { return x + 2; } }\n" +
      "int main() {\n" +
      "  auto lam = [](int x) { return x * 2; };\n" +
      "  return helper(1) + anon_helper(1) + lam(1);\n" +
      "}\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    let calls = lines.filter((l) => l.type === "event" && l.event === "FUNCTION_CALL");
    assert.ok(calls.every((c) => typeof c.name === "string" && c.name),
      "a call resolved to null: " + JSON.stringify(calls.map((c) => c.name)));
    let names = calls.map((c) => c.name);
    assert.ok(names.includes("helper(int)"), "helper missing: " + names);
    assert.ok(names.includes("(anonymous namespace)::anon_helper(int)"));
    assert.ok(names.some((n) => n.includes("lambda") && n.includes("operator()")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C++ program reading stdin gets it, and its stderr is forwarded", { skip: !cppOnBox && "g++ not found on this box" }, () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "scanin.cpp",
      "#include <cstdio>\n" +
      "#include <iostream>\n" +
      "int f(int x) { std::cerr << \"log: f(\" << x << \")\\n\"; return x * 2; }\n" +
      "int main() { int x; if (scanf(\"%d\", &x) == 1) printf(\"%d\\n\", f(x)); return 0; }\n");
    let { proc, lines } = runCliFile(file, [], "21\n");
    assert.equal(proc.status, 0, proc.stderr);
    // stdin reached the program (21 * 2), and its stderr lines were
    // forwarded to the CLI's stderr instead of dropped silently.
    assert.match(proc.stderr, /42/);
    assert.match(proc.stderr, /log: f\(21\)/);
    assert.ok(lines.some((l) => l.type === "result" && l.value === 0));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python program reading stdin gets it", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "inp.py",
      "name = input('name? ')\nprint('hi', name)\n");
    let { proc, lines } = runCliFile(file, ["--lang", "python"], "21\n");
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stderr, /hi 21/);
    assert.ok(lines.some((l) => l.type === "result" && l.value === null));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python program importing a sibling module works under the CLI", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    writeTemp(dir, "helper.py", "def answer():\n    return 42\n");
    let file = writeTemp(dir, "main.py",
      "from helper import answer\nprint(answer())\n");
    let { proc, lines } = runCliFile(file, []);
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stderr, /42/);
    assert.ok(lines.some((l) => l.type === "result"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Unknown --lang is a usage error, exit 2", () => {
  let { proc } = runCliFile("x.js", ["--lang", "rust"]);
  assert.equal(proc.status, 2);
});

test("Python --events filter keeps only the requested categories", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "fact.py", PY_FACTORIAL);
    let { proc, lines } = runCliFile(file, ["--events", "CALL"]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.ok(lines.every((l) => l.type !== "event" || l.category === "CALL"));
    assert.ok(lines.some((l) => l.event === "FUNCTION_CALL"));
    assert.ok(!lines.some((l) => l.event === "FUNCTION_ENTER"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python tracer emits ASSIGN events for simple Name targets", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "assign.py",
      "x = 1\nx += 2\ny = x * 3\n");
    let { proc, lines } = runCliFile(file, ["--events", "ASSIGN"]);
    assert.equal(proc.status, 0, proc.stderr);
    let assigns = lines.filter((l) => l.event === "ASSIGN");
    assert.deepEqual(
      assigns.map((a) => [a.name, a.value, a.op]),
      [["x", 1, "="], ["x", 3, "+="], ["y", 9, "="]]
    );
    assert.ok(assigns.every((a) => a.object === a.name));
    assert.ok(assigns.every((a) => a.result === a.value));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python ASSIGN skips tuple, attribute and subscript targets, and failed assignments", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "assign2.py",
      "a, b = 1, 2\no = {}\no['k'] = 9\nx = 1\ntry:\n    z = 1 / 0\nexcept ZeroDivisionError:\n    pass\n");
    let { proc, lines } = runCliFile(file, ["--events", "ASSIGN"]);
    assert.equal(proc.status, 0, proc.stderr);
    let assigns = lines.filter((l) => l.event === "ASSIGN");
    assert.deepEqual(
      assigns.map((a) => [a.name, a.value]),
      [["o", {}], ["x", 1]]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Python ASSIGN fires inside functions with the post-assignment value", () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-native-"));
  try {
    let file = writeTemp(dir, "assign3.py",
      "def f():\n    w = 42\n    return w\nprint(f())\n");
    let { proc, lines } = runCliFile(file, ["--events", "ASSIGN"]);
    assert.equal(proc.status, 0, proc.stderr);
    let assigns = lines.filter((l) => l.event === "ASSIGN");
    assert.deepEqual(assigns.map((a) => [a.name, a.value]), [["w", 42]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
