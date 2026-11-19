// IrohRedux test suite — Node's built-in test runner, no extra dependencies.
// Run with: npm test
// The patched code is executed with eval() in this module's scope, where the
// `Iroh` binding is visible — that is how the library is meant to be used
// (see GETTING_STARTED.md). Each test creates its own Stage.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Iroh = require("../dist/iroh-node.js");

function run(code, setup) {
  const stage = new Iroh.Stage(code);
  if (setup) setup(stage);
  return eval(stage.script);
}

test("factorial trace: calls and if tests fire in order, result is 6", () => {
  const events = [];
  const result = run(
    `function factorial(n) {
      if (n === 0) return 1;
      return n * factorial(n - 1);
    };
    factorial(3);`,
    (stage) => {
      stage.addListener(Iroh.CALL).on("before", (e) => events.push(["call", e.name, [...e.arguments]]));
      stage.addListener(Iroh.CALL).on("after", (e) => events.push(["return", e.name, e.return]));
      stage.addListener(Iroh.IF).on("test", (e) => events.push(["if", e.value]));
    }
  );
  assert.equal(result, 6);
  assert.deepEqual(events, [
    ["call", "factorial", [3]], ["if", false],
    ["call", "factorial", [2]], ["if", false],
    ["call", "factorial", [1]], ["if", false],
    ["call", "factorial", [0]], ["if", true],
    ["return", "factorial", 1],
    ["return", "factorial", 1],
    ["return", "factorial", 2],
    ["return", "factorial", 6],
  ]);
});

test("VAR listener sees name and value before and after", () => {
  const seen = [];
  run(`let foo = 42;`, (stage) => {
    stage.addListener(Iroh.VAR)
      .on("before", (e) => seen.push(["before", e.name]))
      .on("after", (e) => seen.push(["after", e.name, e.value]));
  });
  assert.deepEqual(seen, [["before", "foo"], ["after", "foo", 42]]);
});

test("FUNCTION return listener can rewrite a return value (add -> 42)", () => {
  const result = run(
    `function add(a, b) { return a + b; };
     add(1, 2);`,
    (stage) => {
      stage.addListener(Iroh.FUNCTION).on("return", (e) => {
        if (e.name === "add") e.return = 42;
      });
    }
  );
  assert.equal(result, 42);
});

test("arrow function as a callback runs and returns its value", () => {
  // Regression: STAGE6 passed the generated arrow name as a bare identifier
  // to DEBUG_FUNCTION_ENTER, but astring never emits an id for arrows, so
  // `.map(x => x * 2)` threw `ReferenceError: $$ANON_ARROW_* is not defined`.
  // (A second bug hid behind it: expression-bodied arrows returned undefined.)
  const result = run(`let r = [1, 2, 3].map(x => x * 2); r;`);
  assert.deepEqual(result, [2, 4, 6]);
});

test("expression-bodied arrow returns its value; block-bodied arrow too", () => {
  assert.equal(run(`let f = (x) => x + 1; f(41);`), 42);
  assert.equal(run(`let f = (x) => { return x + 1; }; f(41);`), 42);
});

test("object methods and getters run", () => {
  // Regression: same unbound-$$ANON_* bug as arrows — astring emits method
  // shorthand (`m() {}` / `get v() {}`) and drops the artificial id.
  assert.equal(run(`let o = { m() { return 2; } }; o.m();`), 2);
  assert.equal(run(`let o = { get v() { return 9; } }; o.v;`), 9);
  assert.equal(run(`let f = function() { return 1; }; f();`), 1);
});

test("class methods run without printing to stdout", () => {
  // Regression: DEBUG_METHOD_ENTER/LEAVE printed "method"/"ctor" on every
  // class method call.
  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const result = run(`class A { m() { return 1; } } class B extends A {}; new B().m();`);
    assert.equal(result, 1);
  } finally {
    console.log = realLog;
  }
  assert.deepEqual(lines, []);
});

test("modern syntax: optional chaining, nullish, logical assignment", () => {
  assert.equal(run(`let o = { a: { b: 5 } }; o?.a?.b;`), 5);
  assert.equal(run(`let o = null; o?.a?.b;`), undefined);
  assert.equal(run(`let x = null ?? 7; x;`), 7);
  assert.equal(run(`let x = 0 ?? 7; x;`), 0);
  assert.equal(run(`let x = 1; x ||= 2; x;`), 1);
  assert.equal(run(`let x = 0; x ||= 2; x;`), 2);
});

test("modern syntax: async/await and promises", async () => {
  const result = run(`async function f() { return await Promise.resolve(42); }; f();`);
  assert.equal(await result, 42);
});

test("modern syntax: class fields and private fields", () => {
  assert.equal(run(`class C { x = 5; get() { return this.x; } }; new C().get();`), 5);
  // Regression: MemberExpression patch passed a bare `#x` identifier to
  // DEBUG_MEMBER_EXPR, which is invalid JS outside a member expression.
  assert.equal(run(`class C { #x = 5; get() { return this.#x; } }; new C().get();`), 5);
});

test("control flow: loops, switch, try/catch/finally", () => {
  assert.equal(run(`let i = 0; while (i < 3) i++; i;`), 3);
  assert.equal(run(`let s = 0; for (let v of [1, 2, 3]) s += v; s;`), 6);
  assert.equal(
    run(`let x = 2; let y; switch (x) { case 2: y = 'two'; break; default: y = 'other'; } y;`),
    "two"
  );
  assert.equal(
    run(`let x = 0; try { throw new Error('e'); } catch (e) { x = 1; } finally { x = 2; } x;`),
    2
  );
});

test("expressions: template literals, destructuring, spread, ternary, generators", () => {
  assert.equal(run("let n = 'world'; `hello ${n}`;"), "hello world");
  assert.equal(run(`let { a, b } = { a: 1, b: 2 }; a + b;`), 3);
  assert.equal(run(`let a = [1, 2]; let b = [...a, 3]; b.length;`), 3);
  assert.equal(run(`let x = 5; x > 2 ? 'big' : 'small';`), "big");
  assert.deepEqual(run(`function* g() { yield 1; yield 2; }; [...g()];`), [1, 2]);
});

test("uncaught throw propagates out of the patched code", () => {
  assert.throws(() => run(`throw new Error('boom');`), /boom/);
});

test("binary/assign/update/member/alloc/literal listeners fire", () => {
  const fired = new Set();
  run(`let o = { a: 1 }; let x = o.a + 2; x++; let y = x > 2 ? 'big' : 'small'; let z = [1, 2][0];`, (stage) => {
    for (const cat of ["BINARY", "UPDATE", "TERNARY", "MEMBER", "ALLOC", "LITERAL", "VAR"]) {
      stage.addListener(Iroh[cat]).on("fire", () => fired.add(cat));
      stage.addListener(Iroh[cat]).on("before", () => fired.add(cat));
      stage.addListener(Iroh[cat]).on("after", () => fired.add(cat));
    }
  });
  for (const cat of ["BINARY", "UPDATE", "TERNARY", "MEMBER", "ALLOC", "LITERAL", "VAR"]) {
    assert.ok(fired.has(cat), `${cat} listener never fired`);
  }
});

test("Iroh.parse and Iroh.generate round-trip modern syntax", () => {
  const ast = Iroh.parse(`let x = null ?? 7;`, { ecmaVersion: 2022 });
  assert.equal(ast.body[0].type, "VariableDeclaration");
  assert.ok(Iroh.generate(ast).includes("??"));
});
