// Tiny neuron layer for IrohRedux 0.8.0 — a single perceptron over
// trace-window features, pure JavaScript, no dependencies.
//
// The scoring core (the dot product and the label) is IrohScript,
// compiled to JavaScript: irohscript/core/perceptron.iroh ->
// src/neurons-irohscript.js (regenerate with
// `npm run codegen:irohscript`). What stays here: feature extraction
// (it walks the event stream with a set — IrohScript 3.0 has no
// bounded loop and no dictionary yet), training (it loops over
// samples), and the four-decimal rounding, which is a presentation
// rule of this module, not the neuron's math.

import { PredictScore, PredictLabel, Features, Weights } from "./neurons-irohscript.js";
//
// The perceptron answers one question: is this trace window "hot"
// (a busy, repetitive, deeply-nested run) or "normal"? It is a
// heuristic, not a verdict — every classification ships with its
// feature values visible, so the neuron is inspectable, never a
// black box. It classifies hotness only: branch imbalance and
// exceptions are not hotness phenomena, so findings about them get
// no neuron label (see src/analyze.js).
//
// Features (all normalized to [0, 1]):
//   calls     — call volume: min(FUNCTION_CALL count / 50, 1)
//   depth     — call depth: min(max FUNCTION_ENTER indent / 20, 1)
//   repeat    — repetition: 1 - distinct (event,hash) pairs / total events
//   imbalance — branch imbalance: |true - false| / (true + false) over IF_TEST
//   mix       — busy share: (CALL + LOOP events) / total events
//
// The default weights were trained offline (see the training script
// in the 0.8.0 report) on 200 synthetic labeled feature vectors
// (deterministic LCG, seeds 12345/999): train 200/200, held-out
// 100/100. They are frozen constants here — no randomness at runtime.
// train() exists so the perceptron can be re-trained or checked in
// tests; it is deterministic (fixed order, fixed learning rate, no
// shuffling).

export const FEATURE_NAMES = ["calls", "depth", "repeat", "imbalance", "mix"];

// Frozen weights from the offline training run (200 synthetic samples,
// converged at epoch 1, 200/200 train, 100/100 held-out).
export const DEFAULT_WEIGHTS = [0.1218, 0.1037, 0.1217, -0.0253, 0.0328];
export const DEFAULT_BIAS = -0.1;

// Extract the five features from a trace's events array (the plain
// objects Iroh.trace() returns). An empty trace is all zeros.
export function extractFeatures(events) {
  let features = { calls: 0, depth: 0, repeat: 0, imbalance: 0, mix: 0 };
  if (!events || events.length === 0) return features;
  let total = events.length;
  let callCount = 0;
  let maxDepth = 0;
  let busyCount = 0;
  let trueCount = 0;
  let falseCount = 0;
  let seen = {};
  let distinct = 0;
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    let key = e.event + ":" + e.hash;
    if (!seen[key]) {
      seen[key] = true;
      distinct += 1;
    }
    if (e.event === "FUNCTION_CALL" && e.trigger === "before") {
      callCount += 1;
    }
    if (e.event === "FUNCTION_ENTER") {
      if (typeof e.indent === "number" && e.indent > maxDepth) {
        maxDepth = e.indent;
      }
    }
    if (e.category === "CALL" || e.category === "LOOP") {
      busyCount += 1;
    }
    if (e.event === "IF_TEST") {
      if (e.value === true) trueCount += 1;
      else if (e.value === false) falseCount += 1;
    }
  }
  features.calls = Math.min(callCount / 50, 1);
  features.depth = Math.min(maxDepth / 20, 1);
  features.repeat = total > 0 ? 1 - distinct / total : 0;
  let branchTotal = trueCount + falseCount;
  features.imbalance = branchTotal > 0
    ? Math.abs(trueCount - falseCount) / branchTotal
    : 0;
  features.mix = busyCount / total;
  return features;
}

function featuresToArray(features) {
  return [
    features.calls || 0,
    features.depth || 0,
    features.repeat || 0,
    features.imbalance || 0,
    features.mix || 0,
  ];
}

// A perceptron: score = dot(weights, x) + bias; label "hot" when the
// score is >= 0, else "normal". weights/bias default to the trained
// constants. train() runs the classic perceptron update over the
// samples in order (deterministic — no shuffling, no randomness);
// a sample is { x: [n, n, n, n, n] | { calls, depth, repeat,
// imbalance, mix }, y: 0 | 1 }. Returns the number of updates made.
export function createPerceptron(weights, bias) {
  let w = (weights || DEFAULT_WEIGHTS).slice();
  let b = bias === void 0 ? DEFAULT_BIAS : bias;
  function predict(features) {
    let x = Array.isArray(features) ? features : featuresToArray(features);
    // The scoring core is IrohScript, compiled to JavaScript
    // (irohscript/core/perceptron.iroh -> src/neurons-irohscript.js).
    // The label is read off the rounded score, exactly as before:
    // Predict's own label (from the raw score) is not used here, so a
    // raw -0.00001 still rounds to -0 and reads "hot", as it always did.
    let f = Features();
    f.calls = x[0] || 0;
    f.depth = x[1] || 0;
    f.repeat = x[2] || 0;
    f.imbalance = x[3] || 0;
    f.mix = x[4] || 0;
    let ww = Weights();
    ww.w0 = w[0];
    ww.w1 = w[1];
    ww.w2 = w[2];
    ww.w3 = w[3];
    ww.w4 = w[4];
    ww.bias = b;
    let score = Math.round(PredictScore(f, ww) * 10000) / 10000;
    return { score: score, label: PredictLabel(score) };
  }
  function train(samples, epochs, learningRate) {
    epochs = epochs === void 0 ? 100 : epochs;
    learningRate = learningRate === void 0 ? 0.1 : learningRate;
    let updates = 0;
    for (let ee = 0; ee < epochs; ++ee) {
      let errors = 0;
      for (let ii = 0; ii < samples.length; ++ii) {
        let s = samples[ii];
        let x = Array.isArray(s.x) ? s.x : featuresToArray(s.x);
        let result = predict(x);
        let pred = result.label === "hot" ? 1 : 0;
        if (pred !== s.y) {
          errors += 1;
          updates += 1;
          let d = s.y - pred;
          for (let jj = 0; jj < 5; ++jj) {
            w[jj] += learningRate * d * (x[jj] || 0);
          }
          b += learningRate * d;
        }
      }
      if (errors === 0) break;
    }
    return updates;
  }
  return {
    weights: w,
    get bias() { return b; },
    predict: predict,
    train: train,
  };
}

// The default, trained perceptron. classifyWindow() extracts the
// features from a trace and classifies it, returning the label, the
// score, and the features — the features are always visible, so the
// classification can be checked by hand.
export function classifyWindow(events) {
  let features = extractFeatures(events);
  let perceptron = createPerceptron();
  let result = perceptron.predict(features);
  return { label: result.label, score: result.score, features: features };
}
