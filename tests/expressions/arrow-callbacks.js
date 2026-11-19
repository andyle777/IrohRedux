// Arrow functions as callbacks — 2026 fixture.
// Regression: before 0.4.0 every one of these threw
// `ReferenceError: $$ANON_ARROW_* is not defined`, and expression-bodied
// arrows returned undefined instead of their value.
let doubled = [1, 2, 3].map(x => x * 2);
Iroh.assert("map with expression-bodied arrow", doubled.join(",") === "2,4,6");

let evens = [1, 2, 3, 4].filter(x => x % 2 === 0);
Iroh.assert("filter with arrow", evens.join(",") === "2,4");

let sum = [1, 2, 3].reduce((a, b) => a + b, 0);
Iroh.assert("reduce with arrow", sum === 6);

let block = [1, 2].map(x => { return x + 10; });
Iroh.assert("block-bodied arrow returns", block.join(",") === "11,12");

let obj = {
  factor: 3,
  scale(values) {
    return values.map(v => v * this.factor);
  }
};
Iroh.assert("arrow keeps lexical this", obj.scale([1, 2]).join(",") === "3,6");

let nested = [1, 2].map(x => [x].map(y => y * 2)[0]);
Iroh.assert("nested arrows", nested.join(",") === "2,4");

let f = (x) => x + 1;
Iroh.assert("standalone arrow", f(41) === 42);
