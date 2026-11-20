// GENERATED — do not edit by hand. Source: irohscript/core/perceptron.iroh
// Regenerate with: npm run codegen:irohscript
// (IrohScript -> JavaScript, src/irohscript-codegen.js; division/modulo are Python-style.)
export function Features() { return { calls: 0, depth: 0, repeat: 0, imbalance: 0, mix: 0 }; }
export function Weights() { return { w0: 0, w1: 0, w2: 0, w3: 0, w4: 0, bias: 0 }; }
export function Result() { return { score: 0, label: "" }; }
export function PredictScore(f, w) {
  return w.bias + w.w0 * f.calls + w.w1 * f.depth + w.w2 * f.repeat + w.w3 * f.imbalance + w.w4 * f.mix;
}
export function PredictLabel(score) {
  if (score >= 0) {
    return "hot";
  } else {
    return "normal";
  }
}
export function Predict(f, w) {
  let r = Result();
  r.score = PredictScore(f, w);
  r.label = PredictLabel(r.score);
  return r;
}
