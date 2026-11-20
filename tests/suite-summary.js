// Suite-summary parsing (1.1.1, F2): one machine-readable summary
// line per leg, so a skipped leg can never read like a passing one.
// Shared by the test runner (tests/index.js, which writes the
// summary to test-results/suite-summary.json and prints it) and the
// CLI (`iroh doctor`, which reads the recorded summary and adds
// live toolchain versions and the dist hash).
//
// Leg shape (the brief's exact shape):
//   {"leg":"node","ran":425,"failed":0,"skipped":0,"skips":[]}
// A leg that did not run at all (missing toolchain) reports
// ran 0, failed 0, skipped 0, and skips naming the reason — the
// non-empty skips array is what makes "did not run" visible, since
// a bare 0/0/0 would read as a clean pass.
//
// The Node leg is parsed from `node --test` output in BOTH reporter
// formats, because the reporter differs by Node version: Node 24
// uses the spec reporter (summary lines `ℹ tests N`, skipped tests
// as `﹣ <name> (<ms>) # <reason>`), Node 22 uses TAP (summary
// lines `# tests N`, skipped tests as
// `not ok N - <name> # SKIP <reason>`). The Python legs are parsed
// from unittest output (`Ran N tests`, `OK` / `FAILED (...)`,
// skipped tests as `... skipped 'reason'`). The C++ leg has no test
// framework — `make test` runs two binaries that print three pass
// lines (client, native tracer, filter); the documented group count
// is 9 (5 client groups + 3 native-tracer groups + 1 filter group),
// reported when all three pass lines are present.

const CPP_GROUPS = 9;

function parseNodeOutput(text) {
  let ran = 0;
  let failed = 0;
  let skipped = 0;
  let skips = [];
  let lines = text.split("\n");
  for (let line of lines) {
    let m;
    // Spec reporter (Node 24): `ℹ tests 425`, `ℹ pass 425`, ...
    if ((m = line.match(/^ℹ tests (\d+)/))) ran = Number(m[1]);
    else if ((m = line.match(/^ℹ fail (\d+)/))) failed = Number(m[1]);
    else if ((m = line.match(/^ℹ skipped (\d+)/))) skipped = Number(m[1]);
    // TAP reporter (Node 22): `# tests 425`, `# pass 425`, ...
    else if ((m = line.match(/^# tests (\d+)/))) ran = Number(m[1]);
    else if ((m = line.match(/^# fail (\d+)/))) failed = Number(m[1]);
    else if ((m = line.match(/^# skipped (\d+)/))) skipped = Number(m[1]);
    // Spec reporter skip: `﹣ <name> (<ms>) # <reason>`
    else if ((m = line.match(/^\uFE63 (.+?) \([\d.]+ms\) # (.*)$/))) {
      skips.push(m[1] + " — " + m[2]);
    }
    // TAP skip: `not ok N - <name> # SKIP <reason>`
    else if ((m = line.match(/^not ok \d+ - (.+?) # SKIP (.*)$/))) {
      skips.push(m[1] + " — " + m[2]);
    }
  }
  return { leg: "node", ran: ran, failed: failed, skipped: skipped, skips: skips };
}

function parseUnittestOutput(text, leg) {
  let ran = 0;
  let failed = 0;
  let skipped = 0;
  let skips = [];
  let lines = text.split("\n");
  for (let line of lines) {
    let m;
    if ((m = line.match(/^Ran (\d+) tests?/))) ran = Number(m[1]);
    else if ((m = line.match(/^OK(?: \((.*)\))?$/))) {
      // "OK" or "OK (skipped=N)" — a clean run, or a clean run with
      // skips. The parenthesised part uses the same key=value shape
      // as FAILED (...), so parse it the same way.
      failed = 0;
      if (m[1]) {
        for (let part of m[1].split(", ")) {
          let kv = part.match(/^skipped=(\d+)$/);
          if (kv) skipped = Number(kv[1]);
        }
      }
    } else if ((m = line.match(/^FAILED \((.*)\)/))) {
      let parts = m[1].split(", ");
      for (let part of parts) {
        let kv = part.match(/^(failures|errors|skipped)=(\d+)$/);
        if (!kv) continue;
        if (kv[1] === "skipped") skipped = Number(kv[2]);
        else failed += Number(kv[2]);
      }
    } else if ((m = line.match(/^(\S+) \([^)]+\) \.\.\. skipped '(.*)'$/))) {
      skips.push(m[1] + " — " + m[2]);
    }
  }
  return { leg: leg, ran: ran, failed: failed, skipped: skipped, skips: skips };
}

function parseCppOutput(text) {
  let passLines = 0;
  if (text.indexOf("All C++ client tests passed.") !== -1) passLines++;
  if (text.indexOf("All C++ native tracer tests passed.") !== -1) passLines++;
  if (text.indexOf("test_filter: all classify_mangled checks passed") !== -1) passLines++;
  if (passLines === 3) {
    return { leg: "cpp", ran: CPP_GROUPS, failed: 0, skipped: 0, skips: [] };
  }
  return {
    leg: "cpp",
    ran: 0,
    failed: 1,
    skipped: 0,
    skips: ["make test failed (" + passLines + " of 3 pass lines present)"],
  };
}

function skippedLeg(leg, reason) {
  return { leg: leg, ran: 0, failed: 0, skipped: 0, skips: [reason + " — leg did not run"] };
}

function summary(legs) {
  return { type: "suite-summary", legs: legs };
}

module.exports = {
  CPP_GROUPS,
  parseNodeOutput,
  parseUnittestOutput,
  parseCppOutput,
  skippedLeg,
  summary,
};
