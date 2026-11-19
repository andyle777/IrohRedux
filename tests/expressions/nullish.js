// Nullish coalescing — 2026 fixture.
// Regression: before 0.4.0 `null ?? 7` evaluated to `null` because `??`
// was missing from the operator table and the logical handler.
Iroh.assert("null coalesces", (null ?? 7) === 7);
Iroh.assert("undefined coalesces", (undefined ?? 7) === 7);
Iroh.assert("zero does not coalesce", (0 ?? 7) === 0);
Iroh.assert("empty string does not coalesce", ("" ?? 7) === "");
Iroh.assert("false does not coalesce", (false ?? 7) === false);

let a = null;
let b = a ?? "fallback";
Iroh.assert("coalesce into variable", b === "fallback");

let chained = null ?? undefined ?? "last";
Iroh.assert("chained coalesce", chained === "last");

let x = null;
x ??= 9;
Iroh.assert("nullish assignment on null", x === 9);
let y = 5;
y ??= 9;
Iroh.assert("nullish assignment keeps value", y === 5);

let left = { a: null };
let right = left.a ?? left.b ?? 3;
Iroh.assert("coalesce with member access", right === 3);
