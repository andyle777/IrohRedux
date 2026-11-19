// Logical assignment — 2026 fixture. Acorn 5 could not parse `||=`.
let a = 1;
a ||= 2;
Iroh.assert("||= keeps truthy", a === 1);

let b = 0;
b ||= 2;
Iroh.assert("||= assigns falsy", b === 2);

let c = 1;
c &&= 2;
Iroh.assert("&&= assigns truthy", c === 2);

let d = 0;
d &&= 2;
Iroh.assert("&&= keeps falsy", d === 0);

let e = null;
e ??= 9;
Iroh.assert("??= assigns null", e === 9);

let f = 5;
f ??= 9;
Iroh.assert("??= keeps value", f === 5);

let obj = { x: 0 };
obj.x ||= 7;
Iroh.assert("||= on member", obj.x === 7);

let g = "";
g ||= "default";
Iroh.assert("||= on empty string", g === "default");
