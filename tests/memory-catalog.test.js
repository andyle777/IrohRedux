"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const Iroh = require("../dist/iroh-node.js");
const matrix = require("../personality-matrix.json");

test("personality matrix matches the runtime hotness perceptron", () => {
  const model = matrix.model;
  assert.equal(matrix.format, "iroh.personality-matrix.v1");
  assert.equal(model.featureNames.length, 5);
  assert.deepEqual(Object.keys(Iroh.extractFeatures([])), model.featureNames);
  assert.equal(model.weights.length, 1);
  assert.equal(model.weights[0].length, model.featureNames.length);
  assert.equal(model.bias.length, 1);

  const features = [0.2, 0.4, 0.6, 0.8, 1];
  const rawScore = model.bias[0] +
    model.weights[0].reduce((sum, weight, index) => sum + weight * features[index], 0);
  const score = Math.round(rawScore * 10000) / 10000;
  const result = Iroh.createPerceptron().predict(features);
  assert.equal(result.score, score);
  assert.equal(
    result.label,
    score >= model.decision.threshold
      ? model.labels.positive
      : model.labels.negative
  );
  assert.equal(
    require.resolve("iroh/personality-matrix.json"),
    path.join(__dirname, "..", "personality-matrix.json")
  );
  assert.equal(
    require.resolve("iroh/memory/iroh-memory.sqlite3"),
    path.join(__dirname, "..", "memory", "iroh-memory.sqlite3")
  );
});

test("offline memory catalog matches current documents and JSON artifacts", (t) => {
  const python = process.env.IROH_PYTHON || "python3";
  const result = spawnSync(
    python,
    [path.join(__dirname, "..", "scripts", "build-memory-catalog.py"), "--check"],
    { encoding: "utf8" }
  );
  if (result.error && result.error.code === "ENOENT") {
    t.skip("python3 is not installed");
    return;
  }
  assert.equal(result.status, 0, (result.stderr || "") + (result.stdout || ""));
  assert.match(result.stdout, /Offline memory catalog verified/);
});
