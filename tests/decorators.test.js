// Tests for decorators (0.7.0): the TC39 stage-3 proposal, parsed by
// IrohRedux's own Acorn plugin (src/decorators-plugin.js) and desugared
// into plain calls (src/decorators.js) because Node cannot execute `@`
// syntax at all.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Iroh = require("../dist/iroh-node.js");

test("decorator: class decorator receives kind and name", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function log(cls, ctx) { seen.push(ctx.kind + ":" + ctx.name); return cls; }
    @log class Foo {}
    seen;
  `);
  assert.deepEqual(result, ["class:Foo"]);
});

test("decorator: class decorator returning a replacement wins", () => {
  let { result } = Iroh.trace(`
    function repl(cls, ctx) { return class Bar { hi() { return "replaced"; } }; }
    @repl class Foo { hi() { return "orig"; } }
    new Foo().hi();
  `);
  assert.equal(result, "replaced");
});

test("decorator: method decorator replaces the method", () => {
  let { result } = Iroh.trace(`
    function upper(m, ctx) { return function() { return m.call(this).toUpperCase(); }; }
    class C { @upper greet() { return "hello"; } }
    new C().greet();
  `);
  assert.equal(result, "HELLO");
});

test("decorator: method decorator sees kind, name, static and private", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function log(m, ctx) { seen.push([ctx.kind, ctx.name, ctx.static, ctx.private]); return m; }
    class C {
      @log m() { return 1; }
      @log static s() { return 2; }
    }
    new C().m(); C.s(); seen;
  `);
  assert.deepEqual(result, [
    ["method", "m", false, false],
    ["method", "s", true, false],
  ]);
});

test("decorator: field decorator initializer transforms the value", () => {
  let { result } = Iroh.trace(`
    function dbl(init, ctx) { return function(v) { return v * 2; }; }
    class C { @dbl x = 21; }
    new C().x;
  `);
  assert.equal(result, 42);
});

test("decorator: static field decorator initializer runs at definition", () => {
  let { result } = Iroh.trace(`
    function dbl(init, ctx) { return function(v) { return v * 2; }; }
    class C { @dbl static x = 21; }
    C.x;
  `);
  assert.equal(result, 42);
});

test("decorator: field decorator returning undefined keeps the value", () => {
  let { result } = Iroh.trace(`
    function noop(init, ctx) { return undefined; }
    class C { @noop x = 5; }
    new C().x;
  `);
  assert.equal(result, 5);
});

test("decorator: factory call fires CALL events for factory and decorator", () => {
  let { events, result } = Iroh.trace(`
    let calls = 0;
    function factory(tag) { calls++; return function(m, ctx) { return m; }; }
    class C { @factory("a") m() { return 1; } }
    new C().m() + calls;
  `, { events: ["CALL"] });
  assert.equal(result, 2);
  let names = events
    .filter((e) => e.event === "FUNCTION_CALL")
    .map((e) => e.name);
  assert.ok(names.includes("factory"), "factory() call traced: " + names);
  assert.ok(names.includes("m"), "decorated method call traced: " + names);
});

test("decorator: expressions evaluate in written order, apply in reverse", () => {
  // Per the proposal, decorator EXPRESSIONS evaluate in written
  // order (a's factory runs before b's), but the decorators
  // themselves APPLY in reverse (b first, then a). Observing the
  // applications alone would show ["b", "a"] — that is correct
  // application order, not an evaluation-order bug. So the test
  // watches the factories for evaluation order and the
  // applications for application order, separately.
  let { result } = Iroh.trace(`
    let evalOrder = [];
    let applyOrder = [];
    function factory(tag) {
      evalOrder.push(tag);
      return function(v, ctx) { applyOrder.push(tag); return v; };
    }
    class C { @factory("a") @factory("b") m() { return 1; } }
    new C().m();
    [evalOrder, applyOrder];
  `);
  assert.deepEqual(result, [["a", "b"], ["b", "a"]]);
});

test("decorator: element decorators apply before class decorators", () => {
  let { result } = Iroh.trace(`
    let order = [];
    function a(v, ctx) { order.push("class:" + ctx.kind); return v; }
    function b(v, ctx) { order.push("method:" + ctx.kind); return v; }
    @a class C { @b m() { return 1; } }
    order;
  `);
  assert.deepEqual(result, ["method:method", "class:class"]);
});

test("decorator: class expression form", () => {
  let { result } = Iroh.trace(`
    function tag(cls, ctx) { cls.tagged = true; return cls; }
    const C = @tag class { };
    C.tagged;
  `);
  assert.equal(result, true);
});

test("decorator: addInitializer runs static at definition, instance at construction", () => {
  let { result } = Iroh.trace(`
    let inits = [];
    function reg(v, ctx) { ctx.addInitializer(function() { inits.push("static:" + ctx.name); }); return v; }
    function regI(v, ctx) { ctx.addInitializer(function() { inits.push("instance:" + this.constructor.name); }); return v; }
    class C { @reg static s() { return 1; } @regI m() { return 2; } }
    new C().m(); inits;
  `);
  assert.deepEqual(result, ["static:s", "instance:C"]);
});

test("decorator: private method decorator applies through the class body", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function log(m, ctx) { seen.push(ctx.kind + ":" + ctx.name + ":" + ctx.private); return m; }
    class C { @log #m() { return 1; } get() { return this.#m(); } }
    [new C().get(), seen];
  `);
  assert.deepEqual(result, [1, ["method:#m:true"]]);
});

test("decorator: private field decorator initializer transforms the value", () => {
  let { result } = Iroh.trace(`
    function dbl(init, ctx) { return function(v) { return v * 2; }; }
    class C { @dbl #x = 21; get() { return this.#x; } }
    new C().get();
  `);
  assert.equal(result, 42);
});

test("decorator: access object reads and writes the member", () => {
  let { result } = Iroh.trace(`
    let acc;
    function grab(m, ctx) { acc = ctx.access; return m; }
    class C { @grab x = 7; }
    let c = new C();
    [acc.has(c), acc.get(c), (acc.set(c, 8), acc.get(c))];
  `);
  assert.deepEqual(result, [true, 7, 8]);
});

test("decorator: @ on a function is a parse error, not a silent drop", () => {
  assert.throws(
    () => Iroh.trace("@dec function f() {}"),
    (e) => e instanceof SyntaxError && /must precede a class/.test(e.message)
  );
});

test("decorator: accessor fields are not supported (parse error)", () => {
  assert.throws(
    () => Iroh.trace("class C { accessor x = 1; }"),
    { name: "SyntaxError" }
  );
});

test("decorator: public getter decorator replaces the getter", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function dbl(g, ctx) { seen.push(ctx.kind + ":" + ctx.name); return function() { return g.call(this) * 2; }; }
    class C { @dbl get x() { return 21; } }
    [new C().x, seen];
  `);
  assert.deepEqual(result, [42, ["getter:x"]]);
});

test("decorator: public setter decorator replaces the setter", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function rec(s, ctx) { seen.push(ctx.kind + ":" + ctx.name); return function(v) { this._v = v * 2; }; }
    class C { @rec set x(v) { this._v = v; } get x() { return this._v; } }
    let c = new C(); c.x = 21; [c.x, seen];
  `);
  assert.deepEqual(result, [42, ["setter:x"]]);
});

test("decorator: private getter decorator applies through the class body", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function dbl(g, ctx) { seen.push(ctx.kind + ":" + ctx.name + ":" + ctx.private); return function() { return g.call(this) * 2; }; }
    class C { @dbl get #x() { return 21; } get() { return this.#x; } }
    [new C().get(), seen];
  `);
  assert.deepEqual(result, [42, ["getter:#x:true"]]);
});

test("decorator: private setter decorator applies through the class body", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function rec(s, ctx) { seen.push(ctx.kind + ":" + ctx.name + ":" + ctx.private); return function(v) { this._v = v * 2; }; }
    class C { @rec set #x(v) { this._v = v; } set(v) { this.#x = v; } get() { return this._v; } }
    let c = new C(); c.set(21); [c.get(), seen];
  `);
  assert.deepEqual(result, [42, ["setter:#x:true"]]);
});

test("decorator: static private method decorator applies at definition", () => {
  let { result } = Iroh.trace(`
    let seen = [];
    function log(m, ctx) { seen.push(ctx.kind + ":" + ctx.name + ":" + ctx.static + ":" + ctx.private); return m; }
    class C { @log static #m() { return 1; } static get() { return C.#m(); } }
    [C.get(), seen];
  `);
  assert.deepEqual(result, [1, ["method:#m:true:true"]]);
});

test("decorator: private static field decorator initializer transforms the value", () => {
  let { result } = Iroh.trace(`
    function dbl(init, ctx) { return function(v) { return v * 2; }; }
    class C { @dbl static #x = 21; static get() { return C.#x; } }
    C.get();
  `);
  assert.equal(result, 42);
});

test("decorator: returning undefined keeps the original class and method", () => {
  // A decorator that merely observes and returns nothing must not
  // destroy the class or the method (the undefined guard).
  let { result } = Iroh.trace(`
    function log(v, ctx) { /* observes only, returns nothing */ }
    @log class C { @log m() { return 7; } }
    new C().m();
  `);
  assert.equal(result, 7);
});

test("decorator: decorating a constructor is a clear error", () => {
  assert.throws(
    () => Iroh.trace("class C { @dec constructor() {} }"),
    (e) => e instanceof Error && /can't be used with a constructor/.test(e.message)
  );
});

test("decorator: static field decorator may call addInitializer at definition", () => {
  // The decorator runs during class definition (its initializer is
  // inline), so the addInitializer array must already exist then.
  let { result } = Iroh.trace(`
    let inits = [];
    function reg(v, ctx) { ctx.addInitializer(function() { inits.push("static:" + ctx.name); }); return function(init) { return init; }; }
    class C { @reg static x = 1; }
    [C.x, inits];
  `);
  assert.deepEqual(result, [1, ["static:x"]]);
});
