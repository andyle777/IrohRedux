import { createRequire } from "node:module";
import config from "./rollup.config.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export default {
  ...config,
  output: {
    file: pkg.main,
    format: "cjs",
    paths: { "acorn-walk": "acorn-walk" },
    strict: false
  }
};
