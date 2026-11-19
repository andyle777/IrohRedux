// Class fields — 2026 fixture. Acorn 5 could not parse field declarations.
class Point {
  x = 0;
  y = 0;
  label = "point";
  static origin = "0,0";
  static count = 0;
  constructor(x, y) {
    this.x = x;
    this.y = y;
    Point.count++;
  }
  describe() {
    return this.label + " " + this.x + "," + this.y;
  }
}

let p = new Point(3, 4);
Iroh.assert("public field defaults then constructor sets", p.x === 3 && p.y === 4);
Iroh.assert("field initializer", p.label === "point");
Iroh.assert("method reads fields", p.describe() === "point 3,4");
Iroh.assert("static field", Point.origin === "0,0");
Iroh.assert("static field mutated in constructor", Point.count === 1);
let q = new Point(0, 0);
Iroh.assert("static field shared across instances", Point.count === 2 && q.x === 0);

class WithComputed {
  base = 10;
  doubled = this.base * 2;
}
Iroh.assert("field initializer reads another field", new WithComputed().doubled === 20);
