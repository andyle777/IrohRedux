// Private fields and methods — 2026 fixture.
// Regression: before 0.4.0 `this.#x` crashed the patcher, which passed a
// bare `#x` identifier into the member-expression debug call.
class Counter {
  #count = 0;
  #step = 2;
  increment() {
    this.#count += this.#step;
    return this.#count;
  }
  #reset() {
    this.#count = 0;
  }
  restart() {
    this.#reset();
    return this.#count;
  }
  get value() {
    return this.#count;
  }
}

let c = new Counter();
Iroh.assert("private field starts at zero", c.value === 0);
Iroh.assert("private field updates", c.increment() === 2);
Iroh.assert("private field updates again", c.increment() === 4);
Iroh.assert("private method resets", c.restart() === 0);

class Named {
  #name;
  constructor(name) {
    this.#name = name;
  }
  greet() {
    return "hello " + this.#name;
  }
}
Iroh.assert("private field set in constructor", new Named("Ada").greet() === "hello Ada");
