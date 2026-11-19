// Destructuring and spread — 2026 fixture.
let { a, b } = { a: 1, b: 2 };
Iroh.assert("object destructuring", a === 1 && b === 2);

let { x: renamed = 10 } = {};
Iroh.assert("destructuring with default", renamed === 10);

let [first, second, ...rest] = [1, 2, 3, 4];
Iroh.assert("array destructuring with rest", first === 1 && second === 2 && rest.join(",") === "3,4");

let arr = [1, 2];
let extended = [...arr, 3, 4];
Iroh.assert("spread in array literal", extended.join(",") === "1,2,3,4");

let base = { p: 1 };
let merged = { ...base, q: 2 };
Iroh.assert("spread in object literal", merged.p === 1 && merged.q === 2);

function sum3(a, b, c) { return a + b + c; }
Iroh.assert("spread in call", sum3(...[1, 2, 3]) === 6);

let nested = { deep: { value: 42 } };
let { deep: { value } } = nested;
Iroh.assert("nested destructuring", value === 42);

let swappedA = 1;
let swappedB = 2;
[swappedA, swappedB] = [swappedB, swappedA];
Iroh.assert("destructuring swap", swappedA === 2 && swappedB === 1);
