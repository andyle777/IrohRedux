// Build the AI bundle (txt/ + py/ + json/ + manifest.json) from this
// tree into an output directory (default: ./ai-bundle).
//
//   node scripts/build-ai-bundle.mjs [out-dir]
//
// The bundle is a loadable package for AI consumers: the Python client
// as it is in this tree, the docs as raw text copies of the same
// markdown sources (so they cannot drift), and JSON states regenerated
// from the 1.0.1 engine — never copied from an older release. The
// manifest lists every file's SHA-256 plus the engine dist SHA, so a
// consumer can verify the bundle.
//
// 1.0.1 has no IrohScript sources, no translator verify block, no
// reachable categories, and no Stage.release — the bundle says so in
// txt/memory.md instead of pretending otherwise. py/ is the tracer
// client only.
//
// Sample programs (fixed, so the bundle is reproducible):
//   sample-scan.json  — library Iroh.scanTrace() on the 150-loop
//     program (let total = 0; for ...; total;): 763 events, HOT_LOOP
//     hot 0.0259. The library document has no "type" field; the CLI
//     --scan line adds type:"scan", so the bundle uses the library
//     form.
//   sample-events.jsonl — the first 15 lines of
//     `node cli/iroh.js <factorial> --events CALL,IF`, where the
//     program is the one-liner
//     `function factorial(n) { if (n === 0) return 1; return n *
//     factorial(n - 1); }; factorial(3);`
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || path.join(root, "ai-bundle"));

const SCAN_PROGRAM = "let total = 0;\nfor (let i = 0; i < 150; i++) {\n  total += i;\n}\ntotal;\n";
const EVENTS_PROGRAM = "function factorial(n) { if (n === 0) return 1; return n * factorial(n - 1); }; factorial(3);\n";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir, filter) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir).sort()) {
    if (filter && !filter(name)) continue;
    const src = path.join(srcDir, name);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(destDir, name));
  }
}

function run(command, args, opts) {
  const r = spawnSync(command, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " exited " + r.status + "\n" + (r.stderr || ""));
  }
  return r.stdout;
}

function main() {
  const dist = path.join(root, "dist", "iroh-node.js");
  if (!fs.existsSync(dist)) {
    throw new Error("dist/iroh-node.js is missing — run `npm run dist` first");
  }
  const distSha = sha256(fs.readFileSync(dist));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.version !== "1.0.1") throw new Error("package.json version is " + pkg.version + ", expected 1.0.1");

  fs.rmSync(out, { recursive: true, force: true });

  // py/: the Python tracer client, as in this tree. (1.0.1 has no
  // IrohScript sources to ship.)
  copyDir(path.join(root, "python", "iroh"), path.join(out, "py", "python-iroh"), (n) => n.endsWith(".py"));

  // txt/: raw copies of the same markdown sources (no re-rendering,
  // so the bundle text cannot drift from the repo docs).
  const txt = [
    ["API.md", "API.txt"],
    ["CHANGELOG.md", "CHANGELOG.txt"],
    ["README.md", "README.txt"],
    [path.join("docs", "memory.md"), "memory.md"],
  ];
  for (const [src, dest] of txt) copyFile(path.join(root, src), path.join(out, "txt", dest));

  // json/package.json: a copy of this tree's package.json.
  copyFile(path.join(root, "package.json"), path.join(out, "json", "package.json"));

  // json/sample-scan.json: regenerated from the 1.0.1 engine.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-bundle-"));
  try {
    const scanJs = "const Iroh = require(" + JSON.stringify(dist) + ");\n"
      + "const doc = Iroh.scanTrace(" + JSON.stringify(SCAN_PROGRAM) + ");\n"
      + "process.stdout.write(JSON.stringify(doc, null, 2) + \"\\n\");\n";
    const scanFile = path.join(tmp, "scan.js");
    fs.writeFileSync(scanFile, scanJs);
    const scanText = run(process.execPath, [scanFile]);
    const doc = JSON.parse(scanText);
    if (!doc.findings || doc.findings[0].code !== "HOT_LOOP" || doc.findings[0].neuron.score !== 0.0259) {
      throw new Error("sample scan did not come back HOT_LOOP 0.0259 — the engine changed under the bundle");
    }
    if (doc.summary.events !== 763) {
      throw new Error("sample scan has " + doc.summary.events + " events, expected 763");
    }
    if (doc.scores.coverage.total !== 30 || doc.scores.coverage.reachable !== undefined) {
      throw new Error("sample scan coverage is not the 1.0.1 fired/30 shape (no reachable field)");
    }
    fs.mkdirSync(path.join(out, "json"), { recursive: true });
    fs.writeFileSync(path.join(out, "json", "sample-scan.json"), scanText);

    // json/sample-events.jsonl: first 15 lines of the CLI event stream.
    const progFile = path.join(tmp, "fact.js");
    fs.writeFileSync(progFile, EVENTS_PROGRAM);
    const eventsText = run(process.execPath, [path.join(root, "cli", "iroh.js"), progFile, "--events", "CALL,IF"]);
    const lines = eventsText.split("\n").filter((l) => l.length > 0).slice(0, 15);
    if (lines.length !== 15) throw new Error("factorial event stream has " + lines.length + " lines, expected >= 15");
    fs.writeFileSync(path.join(out, "json", "sample-events.jsonl"), lines.join("\n") + "\n");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // manifest.json: per-file SHA-256 + engine dist SHA. The manifest
  // cannot hash itself, so it lists every file except itself.
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const rel = path.relative(out, p).split(path.sep).join("/");
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push({ path: rel, sha256: sha256(fs.readFileSync(p)) });
    }
  })(out);
  const manifest = {
    format: "iroh.ai-bundle.v1",
    engine: { version: "1.0.1", dist: "dist/iroh-node.js", distSha256: distSha },
    generated: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // The API.txt flag check, against the file just generated.
  run(process.execPath, [path.join(root, "scripts", "check-api-txt.mjs"), path.join(out, "txt", "API.txt")]);

  process.stdout.write("ai-bundle built in " + out + " (" + files.length + " files + manifest.json, dist " + distSha.slice(0, 12) + ")\n");
}

main();
