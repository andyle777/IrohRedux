// Async / await — 2026 fixture. Acorn 5 could not even parse `async`.
// The harness awaits the promise this fixture's last statement yields,
// so these asserts run before the harness reads Iroh.assertions.
async function fetchNumber() {
  let value = await Promise.resolve(42);
  Iroh.assert("await resolves", value === 42);
  return value;
}

async function fetchTwice() {
  let a = await Promise.resolve(1);
  let b = await Promise.resolve(2);
  Iroh.assert("sequential awaits", a + b === 3);
  return a + b;
}

async function fetchFails() {
  try {
    await Promise.reject(new Error("nope"));
    Iroh.assert("rejection reaches catch", false);
  } catch (e) {
    Iroh.assert("rejection reaches catch", e.message === "nope");
  }
  return "caught";
}

async function main() {
  let n = await fetchNumber();
  Iroh.assert("async function returns awaited value", n === 42);
  let s = await fetchTwice();
  Iroh.assert("async composition", s === 3);
  let c = await fetchFails();
  Iroh.assert("async try/catch", c === "caught");
  let all = await Promise.all([Promise.resolve(1), Promise.resolve(2)]);
  Iroh.assert("Promise.all inside async", all.join(",") === "1,2");
}

main();
