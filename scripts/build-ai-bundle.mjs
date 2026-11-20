// Build the AI bundle (txt/ + py/ + json/ + manifest.json) from this
// tree into an output directory (default: ./ai-bundle).
//
//   node scripts/build-ai-bundle.mjs [out-dir]
//
// The bundle is a loadable package for AI consumers: the Python client
// and the IrohScript sources as they are in this tree, the docs as raw
// text copies of the same markdown sources (so they cannot drift),
// and JSON states regenerated from the PATCHED engine — never copied
// from an older release. The manifest lists every file's SHA-256 plus
// the engine dist SHA, so a consumer can verify the bundle.
//
// Sample programs (fixed, so the bundle is reproducible):
//   sample-scan.json  — library Iroh.scanTrace() on the 150-loop
//     program (let total = 0; for ...; total;): 763 events, HOT_LOOP
//     hot 0.0259. The library document has no "type" field; the CLI
//     --scan line adds type:"scan", so the bundle uses the library
//     form. It does NOT match the 1.1.1 bundle byte for byte: the
//     1.1.0 scan has no `unclosedFrames` in summary and no
//     `reachable` in coverage (those are 1.1.1 work).
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
if (out === root || root.startsWith(out + path.sep)) {
  throw new Error("AI bundle output must not be the repository root or one of its parent directories");
}
if (out.startsWith(root + path.sep) && out !== path.join(root, "ai-bundle")) {
  throw new Error("AI bundle output inside the repository is reserved for ./ai-bundle");
}

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

function listFiles(dir) {
  let files = [];
  function walk(current) {
    for (let name of fs.readdirSync(current).sort()) {
      let file = path.join(current, name);
      let stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("AI bundle contains a symbolic link: " + file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push(file);
      else throw new Error("AI bundle contains an unsupported file: " + file);
    }
  }
  walk(dir);
  return files;
}

function prepareOutput(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  let stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("AI bundle output must be a real directory: " + dir);
  }
  let existing = listFiles(dir);
  if (existing.length === 0) return;
  let manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("AI bundle output is not empty and has no generated manifest: " + dir);
  }
  let previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (previous.format !== "iroh.ai-bundle.v1" || !Array.isArray(previous.files)) {
    throw new Error("Refusing to overwrite an unrecognized AI bundle: " + manifestPath);
  }
  let previousFiles = new Map();
  for (let entry of previous.files) {
    if (!entry || typeof entry.path !== "string" ||
        entry.path.includes("\\") || /^[A-Za-z]:/.test(entry.path) ||
        path.posix.isAbsolute(entry.path) ||
        entry.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
        entry.path === "manifest.json" ||
        typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Invalid file entry in existing AI bundle manifest");
    }
    previousFiles.set(entry.path, entry.sha256);
  }
  let existingPaths = new Set(existing.map((file) => path.relative(dir, file).split(path.sep).join("/")));
  let expectedPaths = new Set([...previousFiles.keys(), "manifest.json"]);
  if (existingPaths.size !== expectedPaths.size ||
      [...existingPaths].some((file) => !expectedPaths.has(file))) {
    throw new Error("AI bundle output contains files not owned by its manifest: " + dir);
  }
  for (let [relative, expectedHash] of previousFiles) {
    let file = path.join(dir, ...relative.split("/"));
    if (sha256(fs.readFileSync(file)) !== expectedHash) {
      throw new Error("Existing AI bundle file failed its manifest check: " + relative);
    }
  }
  for (let file of existing) fs.unlinkSync(file);
}

function run(command, args, opts) {
  const r = spawnSync(command, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
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
  if (pkg.version !== "1.1.0") throw new Error("package.json version is " + pkg.version + ", expected 1.1.0");

  prepareOutput(out);

  // py/: the Python client and the IrohScript sources, as in this tree.
  copyDir(path.join(root, "python", "iroh"), path.join(out, "py", "python-iroh"), (n) => n.endsWith(".py"));
  copyDir(path.join(root, "irohscript", "src"), path.join(out, "py", "irohscript-src"), (n) => n.endsWith(".py"));

  // txt/: raw copies of the same markdown sources (no re-rendering,
  // so the bundle text cannot drift from the repo docs).
  const txt = [
    ["API.md", "API.txt"],
    ["CHANGELOG.md", "CHANGELOG.txt"],
    ["README.md", "README.txt"],
    [path.join("docs", "memory.md"), "memory.md"],
    [path.join("docs", "offline-memory-catalog.md"), "offline-memory-catalog.md"],
    [path.join("irohscript", "irohscript-3.0-spec.md"), "irohscript-3.0-spec.txt"],
    [path.join("irohscript", "README.md"), "irohscript-README.txt"],
  ];
  for (const [src, dest] of txt) copyFile(path.join(root, src), path.join(out, "txt", dest));

  run("python3", [
    path.join(root, "scripts", "build-memory-catalog.py"),
    "--check",
  ], { cwd: root });
  // json/package.json: a copy of this tree's package.json.
  copyFile(path.join(root, "package.json"), path.join(out, "json", "package.json"));
  copyFile(path.join(root, "generations.json"), path.join(out, "json", "generations.json"));
  copyFile(path.join(root, "personality-matrix.json"), path.join(out, "json", "personality-matrix.json"));
  copyFile(
    path.join(root, "memory", "iroh-memory.sqlite3"),
    path.join(out, "sqlite", "iroh-memory.sqlite3")
  );
  copyDir(path.join(root, "schemas"), path.join(out, "json", "schemas"), (n) => n.endsWith(".json"));

  // json/sample-scan.json: regenerated from the patched engine.
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
    fs.mkdirSync(path.join(out, "json"), { recursive: true });
    fs.writeFileSync(path.join(out, "json", "sample-scan.json"), scanText);

    // json/sample-events.jsonl: first 15 lines of the CLI event stream.
    const progFile = path.join(tmp, "fact.js");
    fs.writeFileSync(progFile, EVENTS_PROGRAM);
    const eventsText = run(process.execPath, [path.join(root, "cli", "iroh.js"), progFile, "--events", "CALL,IF", "--no-result"]);
    const lines = eventsText.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) throw new Error("factorial event stream is empty");
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.type !== "event" || event.language !== "javascript") {
        throw new Error("factorial event stream is missing the language field");
      }
    }
    fs.writeFileSync(path.join(out, "json", "sample-events.jsonl"), lines.join("\n") + "\n");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // manifest.json: per-file SHA-256 + engine dist SHA. The manifest
  // cannot hash itself, so it lists every file except itself.
  const files = [];
  for (const file of listFiles(out)) {
    files.push({
      path: path.relative(out, file).split(path.sep).join("/"),
      sha256: sha256(fs.readFileSync(file)),
    });
  }
  const manifest = {
    format: "iroh.ai-bundle.v1",
    engine: { version: "1.1.0", dist: "dist/iroh-node.js", distSha256: distSha },
    generated: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // The API.txt flag check, against the file just generated.
  run(process.execPath, [path.join(root, "scripts", "check-api-txt.mjs"), path.join(out, "txt", "API.txt")]);

  process.stdout.write("ai-bundle built in " + out + " (" + files.length + " files + manifest.json, dist " + distSha.slice(0, 12) + ")\n");
}

main();
