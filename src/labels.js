import { DEBUG_KEY } from "./cfg";

export let OP = {};
export let INSTR = {};
export let CATEGORY = {};

(() => {
  let ii = 0;
  INSTR.PROGRAM = ii++;

  INSTR.FUNCTION_RETURN = ii++;
  INSTR.FUNCTION_CALL = ii++;
  INSTR.FUNCTION_CALL_END = ii++;
  INSTR.FUNCTION_ENTER = ii++;
  INSTR.FUNCTION_LEAVE = ii++;

  INSTR.LOOP_TEST = ii++;
  INSTR.LOOP_ENTER = ii++;
  INSTR.LOOP_LEAVE = ii++;

  INSTR.BREAK = ii++;
  INSTR.CONTINUE = ii++;

  INSTR.SWITCH_TEST = ii++;
  INSTR.SWITCH_ENTER = ii++;
  INSTR.SWITCH_LEAVE = ii++;

  INSTR.CASE_TEST = ii++;
  INSTR.CASE_ENTER = ii++;
  INSTR.CASE_LEAVE = ii++;

  INSTR.IF_TEST = ii++;
  INSTR.IF_ENTER = ii++;
  INSTR.IF_LEAVE = ii++;

  INSTR.ELSE_ENTER = ii++;
  INSTR.ELSE_LEAVE = ii++;

  INSTR.VAR_INIT = ii++;
  INSTR.VAR_DECLARE = ii++;

  INSTR.OP_NEW = ii++;
  INSTR.OP_NEW_END = ii++;

  INSTR.UNARY = ii++;
  INSTR.UPDATE = ii++;

  INSTR.SUPER = ii++;

  INSTR.THIS = ii++;

  INSTR.LITERAL = ii++;
  INSTR.IDENTIFIER = ii++;

  INSTR.BINARY = ii++;
  INSTR.LOGICAL = ii++;
  INSTR.TERNARY = ii++;
  INSTR.ASSIGN = ii++;

  INSTR.METHOD_ENTER = ii++;
  INSTR.METHOD_LEAVE = ii++;

  INSTR.TRY_ENTER = ii++;
  INSTR.TRY_LEAVE = ii++;

  INSTR.CATCH_ENTER = ii++;
  INSTR.CATCH_LEAVE = ii++;

  INSTR.FINAL_ENTER = ii++;
  INSTR.FINAL_LEAVE = ii++;

  INSTR.ALLOC = ii++;

  INSTR.MEMBER_EXPR = ii++;

  INSTR.BLOCK_ENTER = ii++;
  INSTR.BLOCK_LEAVE = ii++;

  INSTR.AWAIT = ii++;

  INSTR.PROGRAM_FRAME_VALUE = ii++;
  INSTR.PROGRAM_ENTER = ii++;
  INSTR.PROGRAM_LEAVE = ii++

})();

(() => {
  let ii = 0;
  CATEGORY.THIS = ii++;
  CATEGORY.UNARY = ii++;
  CATEGORY.UPDATE = ii++;
  CATEGORY.BINARY = ii++;
  CATEGORY.LOGICAL = ii++;
  CATEGORY.TERNARY = ii++;
  CATEGORY.ASSIGN = ii++;
  CATEGORY.ALLOC = ii++;
  CATEGORY.MEMBER = ii++;
  CATEGORY.LITERAL = ii++;
  CATEGORY.IDENTIFIER = ii++;
  CATEGORY.TRY = ii++;
  CATEGORY.CATCH = ii++;
  CATEGORY.FINALLY = ii++;
  CATEGORY.OP_NEW = ii++;
  CATEGORY.VAR = ii++;
  CATEGORY.IF = ii++;
  CATEGORY.ELSE = ii++;
  CATEGORY.SWITCH = ii++;
  CATEGORY.CASE = ii++;
  CATEGORY.BREAK = ii++;
  CATEGORY.CONTINUE = ii++;
  CATEGORY.LOOP = ii++;
  CATEGORY.CALL = ii++;
  CATEGORY.FUNCTION = ii++;
  CATEGORY.BLOCK = ii++;
  CATEGORY.PROGRAM = ii++;
  CATEGORY.METHOD = ii++;
  CATEGORY.SUPER = ii++;
  CATEGORY.AWAIT = ii++;
})();

(() => {
  let ii = 0;
  OP["="] = ii++;
  OP["+"] = ii++;
  OP["-"] = ii++;
  OP["*"] = ii++;
  OP["/"] = ii++;
  OP["%"] = ii++;
  OP["**"] = ii++;
  OP["<<"] = ii++;
  OP[">>"] = ii++;
  OP[">>>"] = ii++;
  OP["&"] = ii++;
  OP["^"] = ii++;
  OP["|"] = ii++;
  OP["!"] = ii++;
  OP["~"] = ii++;
  OP["in"] = ii++;
  OP["void"] = ii++;
  OP["typeof"] = ii++;
  OP["delete"] = ii++;
  OP["instanceof"] = ii++;
  OP["&&"] = ii++;
  OP["||"] = ii++;
  OP["??"] = ii++;
  OP["=="] = ii++;
  OP["==="] = ii++;
  OP["!="] = ii++;
  OP["!=="] = ii++;
  OP[">"] = ii++;
  OP[">="] = ii++;
  OP["<"] = ii++;
  OP["<="] = ii++;
  OP["++"] = ii++;
  OP["--"] = ii++;

})();

// Reachable categories per tracer (1.1.1, F4): the categories each
// tracer CAN emit, read from the tracer's own emit sites — not from
// one program's run, which might not exercise them all. A C++ trace
// firing 2 categories is complete for its tracer (2 of 2 reachable),
// not 28 short (2 of 30). The sets are:
//   javascript: the Stage emits all 30 (the full engine).
//   python: python/iroh/trace.py _emit sites — ASSIGN, CATCH, CALL,
//     FUNCTION, IF, LOOP.
//   cpp: cpp/iroh_trace_rt.cpp emit sites — CALL, FUNCTION only
//     (function-level by design; no loop/branch instrumentation).
//   irohscript: irohscript/src/tracer.py sink.emit sites — ASSIGN,
//     CALL, FUNCTION, IF.
//   basic: irohscript/src/basic_trace.py sink.emit sites — ASSIGN,
//     CALL, FUNCTION, IF, LOOP.
// A language not listed here (or an unknown one) falls back to all
// 30, which is the JavaScript default — and that fallback is the
// reason a consumer must never treat a missing `reachable` field as
// `total`: it would read a non-JS trace as if it were JS.
export const REACHABLE_CATEGORIES = {
  javascript: null, // null = all categories (the full engine)
  python: ["ASSIGN", "CATCH", "CALL", "FUNCTION", "IF", "LOOP"],
  cpp: ["CALL", "FUNCTION"],
  irohscript: ["ASSIGN", "CALL", "FUNCTION", "IF"],
  basic: ["ASSIGN", "CALL", "FUNCTION", "IF", "LOOP"],
};

export function reachableCategories(language) {
  let list = REACHABLE_CATEGORIES[language];
  if (list === void 0 || list === null) return Object.keys(CATEGORY);
  return list.slice();
}
