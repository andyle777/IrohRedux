import { TEMP_VAR_BASE } from "./cfg";

import { parse as prs } from "acorn";
import { generate as gen } from "astring";

// unique temporary variable index
let utvidx = 1;
export function reserveTempVarId() {
  return (
    `${TEMP_VAR_BASE}${utvidx++}`
  );
};

// general unique index
let uidx = 1;
export function uid() {
  return uidx++;
};

// unique branch index
let ubidx = 1;
export function uBranchHash() {
  return ubidx++;
};

export function parse(input, options) {
  // Same default as helpers.parse: Acorn 8 requires ecmaVersion.
  return prs(input, Object.assign({ ecmaVersion: 2022 }, options));
};

export function generate() {
  return gen.apply(null, arguments);
};
