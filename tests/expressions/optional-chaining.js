// Optional chaining — 2026 fixture. Acorn 5 could not even parse `?.`.
let user = { name: "Ada", address: { city: "London" } };
Iroh.assert("deep optional chain", user?.address?.city === "London");
Iroh.assert("missing property short-circuits", user?.missing?.deep === undefined);

let nobody = null;
Iroh.assert("null short-circuits", nobody?.address?.city === undefined);

let undef;
Iroh.assert("undefined short-circuits", undef?.anything === undefined);

let greeter = { hello() { return "hi"; } };
Iroh.assert("optional call present", greeter?.hello?.() === "hi");
Iroh.assert("optional call absent", greeter?.goodbye?.() === undefined);

let arr = [10, 20];
Iroh.assert("optional element access", arr?.[1] === 20);
Iroh.assert("optional element access on null", nobody?.[0] === undefined);

let count = 0;
let maybe = { get() { count++; return 5; } };
let v = maybe?.get?.();
Iroh.assert("optional call evaluates once", v === 5 && count === 1);
