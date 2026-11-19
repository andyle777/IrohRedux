// Fixture suite — runs every file in tests/expressions/ and tests/other/
// through a Stage and checks its Iroh.assert() calls.
//
// These fixtures date from 2017 and were written against an `Iroh.assert`
// / `Iroh.log` API that was never implemented, so nothing ever ran them.
// 0.4.0 added that API to the library (see src/setup.js) and fixed the
// one fixture that failed on its own merits (toString interception).
//
// Each fixture runs isolated in its own Function scope (fresh var/let/
// const bindings), sharing only the Iroh singleton. Assertions are reset
// before each run and must all pass; a fixture with no assertions at all
// fails loudly instead of passing silently. If a fixture's last statement
// yields a promise (async fixtures), the run awaits it.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Iroh = require("../dist/iroh-node.js");

const FIXTURE_DIRS = [
  path.join(__dirname, "expressions"),
  path.join(__dirname, "other"),
];

function fixtureFiles() {
  const files = [];
  for (const dir of FIXTURE_DIRS) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(".js")) files.push(path.join(dir, name));
    }
  }
  return files;
}

async function runFixture(file) {
  const code = fs.readFileSync(file, "utf8");
  const stage = new Iroh.Stage(code);
  Iroh.resetAssertions();
  // vm gives the fixture its own scope and, unlike `new Function`,
  // returns the script's completion value — the program frame value,
  // which is a promise for async fixtures — so the run can be awaited.
  const result = vm.runInNewContext(stage.script, { Iroh, console });
  if (result && typeof result.then === "function") await result;
  const assertions = [...Iroh.assertions];
  const failed = assertions.filter((a) => !a.passed);
  return { assertions, failed };
}

for (const file of fixtureFiles()) {
  const name = path.relative(path.join(__dirname, ".."), file);
  test(`fixture ${name}`, async () => {
    const { assertions, failed } = await runFixture(file);
    assert.ok(
      assertions.length > 0,
      `${name} ran but made no Iroh.assert() calls — it proves nothing`
    );
    assert.deepEqual(
      failed.map((a) => a.name),
      [],
      `${name} has failing assertions`
    );
  });
}
