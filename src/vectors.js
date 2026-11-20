// Vector refracting for IrohRedux 0.9.0 — a trace bent into a small,
// deterministic numeric spectrum an AI can compare without reading the
// raw events. "Refracting" because the trace is split into its
// component features, like light through a prism.
//
// These are FEATURE VECTORS, not LLM embeddings: no model, no vector
// database, no new dependencies, no randomness. The features are the
// 0.8.0 neuron layer's definitions (src/neurons.js) plus one honest
// extension — coverage, the share of event categories that fired.
// Same events -> same vector, always; identical traces have distance
// exactly 0 and cosine similarity exactly 1.
//
//   Iroh.toVector(events)              -> { features, vector, names }
//   Iroh.cosineSimilarity(a, b)        -> number in [-1, 1]
//   Iroh.euclideanDistance(a, b)       -> number >= 0
//   Iroh.compareVectors(a, b)          -> { cosine, euclidean }
//
// `a` and `b` may be plain number arrays or toVector() results.
// `features` carries the NAMED values (plus the raw event count, a
// plain count, not part of the normalized vector); `vector` is the
// ordered array of the six normalized [0, 1] features, in `names`
// order. The vector never carries the raw event count — an unnormalized
// count would dominate every distance.

import { reachableCategories } from "./labels";
import { extractFeatures, FEATURE_NAMES } from "./neurons";

export const VECTOR_FEATURE_NAMES = FEATURE_NAMES.concat(["coverage"]);

// Project a trace's events into a feature vector. `events` is the
// plain array Iroh.trace() returns (or the CLI's event lines, or a
// Python/C++ tracer's — the projection only reads event/category/
// trigger/hash/indent/value, so it works the same across languages).
// `options.language` (default "javascript") picks the reachable
// set for the coverage feature (1.1.1, F4): the coverage feature is
// fired / reachable, not fired / total, so a function-level C++
// trace is not penalised for the categories its tracer cannot emit.
export function toVector(events, options) {
  options = options || {};
  events = Array.isArray(events) ? events : [];
  let features = extractFeatures(events);
  let reachableList = reachableCategories(options.language || "javascript");
  let fired = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (events[ii].category) fired[events[ii].category] = true;
  }
  let firedCount = Object.keys(fired).length;
  let coverage = reachableList.length > 0
    ? Math.round((firedCount / reachableList.length) * 10000) / 10000
    : 0;
  let named = {
    calls: features.calls,
    depth: features.depth,
    repeat: features.repeat,
    imbalance: features.imbalance,
    mix: features.mix,
    coverage: coverage,
    events: events.length,
  };
  return {
    features: named,
    vector: [
      named.calls,
      named.depth,
      named.repeat,
      named.imbalance,
      named.mix,
      named.coverage,
    ],
    names: VECTOR_FEATURE_NAMES.slice(),
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.vector)) return value.vector;
  return null;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// Cosine similarity between two vectors: 1 for identical direction,
// 0 for orthogonal, -1 for opposite. Two empty (all-zero) vectors
// count as identical (1); an empty vector against a non-empty one is
// 0. Rounded to 4 decimals, so identical inputs give exactly 1.
export function cosineSimilarity(a, b) {
  let x = asArray(a);
  let y = asArray(b);
  if (!x || !y || x.length !== y.length) {
    throw new Error("cosineSimilarity needs two vectors of the same length");
  }
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let ii = 0; ii < x.length; ++ii) {
    dot += x[ii] * y[ii];
    nx += x[ii] * x[ii];
    ny += y[ii] * y[ii];
  }
  if (nx === 0 && ny === 0) return 1;
  if (nx === 0 || ny === 0) return 0;
  let sim = dot / (Math.sqrt(nx) * Math.sqrt(ny));
  if (sim > 1) sim = 1;
  if (sim < -1) sim = -1;
  return round4(sim);
}

// Euclidean distance between two vectors: 0 for identical vectors,
// growing as they differ. Rounded to 4 decimals, so identical inputs
// give exactly 0.
export function euclideanDistance(a, b) {
  let x = asArray(a);
  let y = asArray(b);
  if (!x || !y || x.length !== y.length) {
    throw new Error("euclideanDistance needs two vectors of the same length");
  }
  let sum = 0;
  for (let ii = 0; ii < x.length; ++ii) {
    let d = x[ii] - y[ii];
    sum += d * d;
  }
  return round4(Math.sqrt(sum));
}

// Both measures at once, for "find traces like this one".
export function compareVectors(a, b) {
  return {
    cosine: cosineSimilarity(a, b),
    euclidean: euclideanDistance(a, b),
  };
}
