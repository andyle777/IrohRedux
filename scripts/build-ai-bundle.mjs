import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] || path.join(root, "ai-bundle"));
const require = createRequire(import.meta.url);

if (process.argv.length > 3) {
  throw new Error("Usage: npm run build:ai-bundle -- [output-directory]");
}
if (output === root || root.startsWith(output + path.sep)) {
  throw new Error("AI bundle output must not be the repository root or one of its parent directories");
}
if (output.startsWith(root + path.sep) && output !== path.join(root, "ai-bundle")) {
  throw new Error("AI bundle output inside the repository is reserved for ./ai-bundle");
}

const scanProgram = "let total = 0;\nfor (let i = 0; i < 150; i++) {\n  total += i;\n}\ntotal;\n";
const eventsProgram = "function factorial(n) { if (n === 0) return 1; return n * factorial(n - 1); }; factorial(3);\n";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyPythonFiles(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyPythonFiles(from, to);
    else if (entry.isFile() && entry.name.endsWith(".py")) copyFile(from, to);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " exited " + result.status + "\n" + (result.stderr || ""));
  }
  return result.stdout;
}

function listFiles(directory) {
  const files = [];
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("AI bundle contains a symbolic link: " + file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push(file);
      else throw new Error("AI bundle contains an unsupported file: " + file);
    }
  }
  walk(directory);
  return files;
}

function prepareOutput(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    return;
  }
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("AI bundle output must be a real directory: " + directory);
  }

  const existing = listFiles(directory);
  if (existing.length === 0) return;
  const manifestPath = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("AI bundle output is not empty and has no generated manifest: " + directory);
  }
  const previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (previous.format !== "iroh.ai-bundle.v1" || !Array.isArray(previous.files)) {
    throw new Error("Refusing to overwrite an unrecognized AI bundle: " + manifestPath);
  }

  const previousFiles = new Map();
  for (const entry of previous.files) {
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
  const existingPaths = new Set(existing.map((file) => path.relative(directory, file).split(path.sep).join("/")));
  const expectedPaths = new Set([...previousFiles.keys(), "manifest.json"]);
  if (existingPaths.size !== expectedPaths.size ||
      [...existingPaths].some((file) => !expectedPaths.has(file))) {
    throw new Error("AI bundle output contains files not owned by its manifest: " + directory);
  }
  for (const [relative, expectedHash] of previousFiles) {
    const file = path.join(directory, ...relative.split("/"));
    if (sha256(fs.readFileSync(file)) !== expectedHash) {
      throw new Error("Existing AI bundle file failed its manifest check: " + relative);
    }
  }
  for (const file of existing) fs.unlinkSync(file);
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const distPath = path.join(root, "dist", "iroh-node.js");
  if (!fs.existsSync(distPath)) throw new Error("dist/iroh-node.js is missing — run `npm run dist` first");
  const distHash = sha256(fs.readFileSync(distPath));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-ai-bundle-"));

  try {
    const textFiles = [
      ["API.md", "API.txt"],
      ["README.md", "README.txt"],
      ["CHANGELOG.md", "CHANGELOG.txt"],
      ["GETTING_STARTED.md", "GETTING_STARTED.txt"],
      ["SERVER.md", "SERVER.txt"],
      [path.join("docs", "memory.md"), "memory.md"],
    ];
    for (const [source, destination] of textFiles) {
      copyFile(path.join(root, source), path.join(stage, "txt", destination));
    }
    copyFile(path.join(root, "package.json"), path.join(stage, "json", "package.json"));
    copyFile(path.join(root, "generations.json"), path.join(stage, "json", "generations.json"));
    for (const name of fs.readdirSync(path.join(root, "schemas")).filter((entry) => entry.endsWith(".json")).sort()) {
      copyFile(path.join(root, "schemas", name), path.join(stage, "json", "schemas", name));
    }
    copyPythonFiles(path.join(root, "python", "iroh"), path.join(stage, "py", "python-iroh"));

    const Iroh = require(distPath);
    const scan = Iroh.scanTrace(scanProgram);
    if (scan.summary.language !== "javascript" || scan.summary.findingsTruncated !== 0 ||
        !scan.findings.some((finding) => finding.code === "HOT_LOOP") ||
        typeof scan.scores.coverage.reachable !== "number") {
      throw new Error("scan sample does not match the current engine contract");
    }
    writeText(path.join(stage, "json", "sample-scan.json"), JSON.stringify(scan, null, 2) + "\n");

    const eventOutput = run(process.execPath, [
      path.join(root, "cli", "iroh.js"),
      "--events", "CALL,IF",
      "--no-result",
    ], { input: eventsProgram });
    const eventLines = eventOutput.split(/\r?\n/).filter(Boolean);
    if (eventLines.length === 0) throw new Error("event sample is empty");
    for (const line of eventLines) {
      const event = JSON.parse(line);
      if (event.type !== "event" || event.language !== "javascript") {
        throw new Error("event sample does not include the CLI language field");
      }
    }
    writeText(path.join(stage, "json", "sample-events.jsonl"), eventLines.join("\n") + "\n");

    const apiCheck = run(process.execPath, [
      path.join(root, "scripts", "check-api-txt.mjs"),
      path.join(stage, "txt", "API.txt"),
    ]);

    const files = listFiles(stage).map((file) => ({
      path: path.relative(stage, file).split(path.sep).join("/"),
      sha256: sha256(fs.readFileSync(file)),
    }));
    const manifest = {
      format: "iroh.ai-bundle.v1",
      engine: {
        name: packageJson.name,
        version: packageJson.version,
        dist: "dist/iroh-node.js",
        distSha256: distHash,
      },
      files,
    };
    writeText(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    prepareOutput(output);
    for (const file of listFiles(stage)) {
      copyFile(file, path.join(output, path.relative(stage, file)));
    }
    process.stdout.write(
      "AI bundle built in " + output + " (" + files.length + " files plus manifest; dist " + distHash.slice(0, 12) + ")\n" +
      apiCheck
    );
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

main();
