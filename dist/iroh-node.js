var astring = require('astring');
var acorn = require('acorn');
var acornWalk = require('acorn-walk');

/**
 * @param {Class} cls
 * @param {Array} prot
 */
var extend = function(cls, prot) {
  for (let key in prot) {
    if (prot[key] instanceof Function) {
      if (cls.prototype[key] instanceof Function) {
        console.log(`Warning: Overwriting ${cls.name}.prototype.${key}`);
      }
      cls.prototype[key] = prot[key];
    }
  }
};

var version = "0.7.0";

// indent factor
const INDENT_FACTOR = 1;

// minimal debug commands start with this
const DEBUG_KEY = `$`;

// temp variable start with this
const TEMP_VAR_BASE = `Iroh$$x`;

// log all errors, logs also internal errors


// clean or minimal debug command related output
const CLEAN_DEBUG_INJECTION = false;

// detect environment
const IS_NODE = (
  (typeof module !== "undefined" && module.exports) &&
  (typeof require !== "undefined")
);
const IS_BROWSER = !IS_NODE;

const VERSION = version;

let OP = {};
let INSTR = {};
let CATEGORY = {};

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
  INSTR.PROGRAM_LEAVE = ii++;

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

// Acorn plugin for the TC39 decorators proposal (stage 3).
//
// Acorn core only implements stage-4 (finalized) syntax, so a bare
// `@` is an "Unexpected character" without this plugin. There is no
// maintained decorator plugin on npm for Acorn 8 — `acorn-decorators`
// does not exist, and `acorn-es7` targets Acorn 5/6 and the abandoned
// 2016 proposal — so IrohRedux carries its own, written against
// Acorn 8.19's Parser API: a plugin is a function that takes a Parser
// class and returns an extended class (Parser.extend), with the
// overridden methods calling super.
//
// What it parses (current proposal grammar):
//   - `@expr` before a class declaration or expression, where expr is
//     a LeftHandSideExpression (identifier, member chain, call, ...).
//     Class expressions cover `const C = @dec class {}` and
//     `export default @dec class {}` as well as `@dec class C {}`
//     as a statement.
//   - `@expr` before class elements: methods, fields, static members.
//   - `@expr` before `export` / `export default` of a class.
// What it does NOT parse:
//   - `accessor` fields — the `accessor` keyword is part of the same
//     proposal but needs its own element kind and runtime support.
//     `accessor x = 1` fails at parse time with Acorn's own error.
//   - Decorators on anything but classes and class elements.
//     `@dec function f() {}` raises "Decorators must precede a class
//     declaration".
//
// The plugin only changes parsing. It produces `Decorator` nodes
// (type "Decorator", with an `expression`) attached as `decorators`
// arrays on ClassDeclaration, ClassExpression, MethodDefinition and
// PropertyDefinition nodes. A patch stage (src/decorators.js)
// desugars them into plain calls, because Node cannot execute `@`
// syntax at all — verified on Node v24.22.1, even with the
// --js-decorators V8 flag — so decorated code is rewritten, never
// emitted with `@` in it.
//
// Written ES2015-only (no async/await, no for...of): this file is
// bundled into the browser build by buble.
const atToken = new acorn.TokenType("@", { startsExpr: true });

function decoratorsPlugin(BaseParser) {
  return class extends BaseParser {
    // Tokenize `@` (code 64). Acorn's own getTokenFromCode falls
    // through to "Unexpected character '@'" for it.
    getTokenFromCode(code) {
      if (code === 64) {
        this.pos += 1;
        return this.finishToken(atToken);
      }
      return super.getTokenFromCode(code);
    }

    // Parse one or more `@expr` decorators. The expression is a
    // LeftHandSideExpression: parseExprSubscripts parses an atom plus
    // member/call chains, and stops before binary operators, so
    // `@a + b` is a decorator `@a` followed by `+ b` (a later error),
    // while `@(a + b)` and `@factory()` parse as written.
    parseDecorators() {
      let decorators = [];
      while (this.type === atToken) {
        let node = this.startNode();
        this.next();
        node.expression = this.parseExprSubscripts(null, false);
        decorators.push(this.finishNode(node, "Decorator"));
      }
      return decorators;
    }

    // `@dec class C {}`, `@dec export class C {}`,
    // `@dec export default class C {}`. The decorators are collected
    // first, then the statement is parsed normally and they are
    // attached to the class inside it (the declaration of an export,
    // or the class itself). Anything else raises a clear error.
    parseStatement(context, topLevel, exports) {
      if (this.type !== atToken) {
        return super.parseStatement(context, topLevel, exports);
      }
      let decorators = this.parseDecorators();
      let result = super.parseStatement(context, topLevel, exports);
      let target = result;
      if (
        target.type === "ExportNamedDeclaration" ||
        target.type === "ExportDefaultDeclaration"
      ) {
        target = target.declaration;
      }
      if (
        !target ||
        (target.type !== "ClassDeclaration" && target.type !== "ClassExpression")
      ) {
        this.raise(decorators[0].start, "Decorators must precede a class declaration");
      }
      target.decorators = decorators;
      return result;
    }

    // `@dec` before a class element. Static blocks cannot be
    // decorated; a decorator before `;` (an empty element) is an
    // error rather than a silently dropped decorator.
    parseClassElement(constructorAllowsSuper) {
      if (this.type !== atToken) {
        return super.parseClassElement(constructorAllowsSuper);
      }
      let decorators = this.parseDecorators();
      let el = super.parseClassElement(constructorAllowsSuper);
      if (!el) {
        this.raise(decorators[0].start, "Decorators must precede a class element");
      }
      if (el.type === "StaticBlock") {
        this.raise(decorators[0].start, "Static blocks cannot have decorators");
      }
      el.decorators = decorators;
      return el;
    }

    // `@dec` before a class expression: `const C = @dec class {}` or
    // `export default @dec class {}`. The statement-level hook above
    // only sees `@` at the start of a statement, so an expression in
    // the middle of one needs this. Anything that is not a class
    // expression raises a clear error.
    parseExprAtom(refDestructuringErrors) {
      if (this.type !== atToken) {
        return super.parseExprAtom(refDestructuringErrors);
      }
      let decorators = this.parseDecorators();
      let node = super.parseExprAtom(refDestructuringErrors);
      if (!node || node.type !== "ClassExpression") {
        this.raise(decorators[0].start, "Decorators must precede a class expression");
      }
      node.decorators = decorators;
      return node;
    }
  };
}

const DecoratorParser = acorn.Parser.extend(decoratorsPlugin);

function parseWithDecorators(input, options) {
  return DecoratorParser.parse(input, options);
}

// unique temporary variable index
let utvidx = 1;
function reserveTempVarId() {
  return (
    `${TEMP_VAR_BASE}${utvidx++}`
  );
}

// general unique index
let uidx = 1;
function uid() {
  return uidx++;
}

// unique branch index
let ubidx = 1;
function uBranchHash() {
  return ubidx++;
}

function parse$1(input, options) {
  // Same default as helpers.parse: Acorn 8 requires ecmaVersion.
  // "latest" + allowHashBang: see helpers.parse.
  return parseWithDecorators(input, Object.assign({ ecmaVersion: "latest", allowHashBang: true }, options));
}

function generate$1() {
  return astring.generate.apply(null, arguments);
}

// --- Event projection (shared by Iroh.trace() and the CLI) ---------------

// Event fields that are safe to copy onto a plain event object. Everything
// else on a RuntimeEvent (instance, node, location) is an internal
// reference and is never serialized.
const TRACE_EVENT_FIELDS = [
  "name", "value", "result", "return", "op", "test", "left", "right",
  "arguments", "object", "property", "context", "scope", "kind", "label",
  "prefix", "external", "sloppy", "isDefault", "default", "callee",
];

function instructionName(type) {
  for (let key in INSTR) {
    if (INSTR[key] === type) return key;
  }
  return String(type);
}

function categoryName(category) {
  for (let key in CATEGORY) {
    if (CATEGORY[key] === category) return key;
  }
  return String(category);
}

function safeValue(value, depth, seen) {
  if (value === null) return null;
  switch (typeof value) {
    case "undefined": return null;
    case "function": return "[Function " + (value.name || "anonymous") + "]";
    case "bigint": return value.toString() + "n";
    case "symbol": return value.toString();
    case "string":
    case "number":
    case "boolean":
      return value;
  }
  if (value instanceof Error) return { error: value.message };
  if (typeof value.then === "function") return "[Promise]";
  if (depth <= 0) return "[Object]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => safeValue(v, depth - 1, seen));
  }
  let out = {};
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  let keys = Object.keys(value);
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    try {
      out[key] = safeValue(value[key], depth - 1, seen);
    } catch (e) {
      out[key] = "[Unserializable]";
    }
  }
  return out;
}

// Turn one RuntimeEvent into a plain, JSON-safe object:
// { type: "event", event: "FUNCTION_CALL", category: "CALL",
//   trigger: "before", hash, indent, ...event fields }.
// The CLI (cli/iroh.js) uses this too, so its JSON lines and
// Iroh.trace() events are the same shape.
function eventToJSON(event, trigger) {
  let line = {
    type: "event",
    event: instructionName(event.type),
    category: categoryName(event.category),
    trigger: trigger,
    hash: event.hash,
    indent: event.indent,
  };
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < TRACE_EVENT_FIELDS.length; ++ii) {
    let field = TRACE_EVENT_FIELDS[ii];
    if (event[field] !== void 0 && event[field] !== null) {
      line[field] = safeValue(event[field], 3, new Set());
    }
  }
  return line;
}


var _utils = Object.freeze({
	reserveTempVarId: reserveTempVarId,
	uid: uid,
	uBranchHash: uBranchHash,
	parse: parse$1,
	generate: generate$1,
	safeValue: safeValue,
	eventToJSON: eventToJSON
});

function instructionToString(n) {
  for (let key in INSTR) {
    let value = INSTR[key];
    if (value === n) return key;
  }
  console.warn(`Unexpected instruction value ${n}`);
  return "";
}

function injectPatchIntoNode(node, patch, end) {
  let body = null;
  let type = node.type;
  if (type === "Program") body = node.body;
  else if (type === "BlockStatement") body = node.body;
  else if (type === "ForStatement") body = node.body.body;
  else if (isLoopStatement(type)) body = node.body.body;
  else if (isFunctionNode(type)) {
    body = node.body.body;
  }
  else console.error(`Invalid patch node type ${type}`);
  console.assert(body instanceof Array);
  // force patches to be magic
  patch.magic = true;
  if (end) body.push(patch);
  else body.unshift(patch);
}

function resolveCallee(node) {
  let type = node.type;
  if (node.type === "MemberExpression") {
    return node.object;
  }
  return node;
}

function isFunctionNode(type) {
  return (
    type === "FunctionExpression" ||
    type === "FunctionDeclaration" ||
    type === "ArrowFunctionExpression"
  );
}



function isStatement(type) {
  return (
    type === "BlockStatement" ||
    type === "BreakStatement" ||
    type === "ContinueStatement" ||
    type === "DebuggerStatement" ||
    type === "DoWhileStatement" ||
    type === "EmptyStatement" ||
    type === "ExpressionStatement" ||
    type === "ForInStatement" ||
    type === "ForStatement" ||
    type === "IfStatement" ||
    type === "LabeledStatement" ||
    type === "ReturnStatement" ||
    type === "SwitchStatement" ||
    type === "ThrowStatement" ||
    type === "TryStatement" ||
    type === "VariableDeclaration" ||
    type === "WhileStatement" ||
    type === "WithStatement"
  );
}

function isLoopStatement(type) {
  return (
    type === "ForStatement" ||
    type === "ForInStatement" ||
    type === "ForOfStatement" ||
    type === "WhileStatement" ||
    type === "DoWhileStatement"
  );
}

function isSwitchStatement(type) {
  return (
    type === "SwitchStatement"
  );
}

function isTryStatement(type) {
  return (
    type === "TryStatement"
  );
}

function isLabeledStatement(type) {
  return (
    type === "LabeledStatement"
  );
}







function isLoopFrameType(type) {
  return (
    type === INSTR.LOOP_ENTER
  );
}

function isSwitchFrameType(type) {
  return (
    type === INSTR.SWITCH_ENTER
  );
}

function isSwitchCaseFrameType(type) {
  return (
    type === INSTR.CASE_ENTER
  );
}

function isFunctionFrameType(type) {
  return (
    type === INSTR.FUNCTION_CALL
  );
}

function isMethodFrameType(type) {
  return (
    type === INSTR.METHOD_ENTER
  );
}

function isReturnableFrameType(type) {
  return (
    isMethodFrameType(type) ||
    isFunctionFrameType(type)
  );
}

function isBreakableFrameType(type) {
  return (
    isLoopFrameType(type) ||
    isSwitchFrameType(type)
  );
}

function isContinuableFrameType(type) {
  return (
    isLoopFrameType(type)
  );
}

function isTryStatementFrameType(type) {
  return (
    type === INSTR.TRY_ENTER
  );
}

function isCatchClauseFrameType(type) {
  return (
    type === INSTR.CATCH_ENTER
  );
}

function isFinalClauseFrameType(type) {
  return (
    type === INSTR.FINAL_ENTER
  );
}

function isInstantiationFrameType(type) {
  return (
    type === INSTR.OP_NEW
  );
}

function isValidFrameInstruction(frame) {
  console.assert(typeof frame.cleanType === "string");
  let type = frame.cleanType;
  return (
    INSTR[type] >= 0
  );
}

function operatorToString(op) {
  for (let key in OP) {
    if (OP[key] === op) return key;
  }
  return "undefined";
}

function processLabels(node) {
  let labels = [];
  // we can have multiple labels in js
  // *universe collapses*
  while (true) {
    if (node.type === "LabeledStatement") {
      labels.push(node.label.name);
    } else if (isStatement(node.type)) {
      node.labels = labels;
      break;
    }
    node = node.body;
  }
  return node;
}



function getCallee(callee, call) {
  if (call === null) {
    return callee.name;
  }
  return call;
}



function cloneNode(node) {
  let clone = JSON.parse(JSON.stringify(node));
  return clone;
}

function deepMagicPatch(node) {
  // magic patch the whole ast
  acornWalk.full(node, function(child) {
    child.magic = true;
  });
}

function parse$2(input, options) {
  // Acorn 8 requires ecmaVersion; default it so every internal
  // parseExpression/parseExpressionStatement call parses modern syntax
  // instead of warning and falling back to ES2020. "latest" tracks the
  // newest syntax Acorn supports (ES2025 RegExp modifiers, `using`
  // declarations, import attributes); allowHashBang lets traced scripts
  // start with a #! line. Callers may still override ecmaVersion via
  // options.
  return parseWithDecorators(input, Object.assign({ ecmaVersion: "latest", allowHashBang: true }, options));
}

function generate$2() {
  return astring.generate.apply(null, arguments);
}

function parseExpression(input) {
  let node = parse$2(input);
  let result = node.body[0].expression;
  deepMagicPatch(result);
  return result;
}

function parseExpressionStatement(input) {
  let node = parse$2(input);
  let result = node.body[0];
  deepMagicPatch(result);
  return result;
}

function getCategoryFromInstruction(type) {
  type = type | 0;
  switch (type) {
    case INSTR.THIS:
      return CATEGORY.THIS | 0;
    case INSTR.UNARY:
      return CATEGORY.UNARY | 0;
    case INSTR.UPDATE:
      return CATEGORY.UPDATE | 0;
    case INSTR.BINARY:
      return CATEGORY.BINARY | 0;
    case INSTR.LOGICAL:
      return CATEGORY.LOGICAL | 0;
    case INSTR.TERNARY:
      return CATEGORY.TERNARY | 0;
    case INSTR.ASSIGN:
      return CATEGORY.ASSIGN | 0;
    case INSTR.ALLOC:
      return CATEGORY.ALLOC | 0;
    case INSTR.MEMBER_EXPR:
      return CATEGORY.MEMBER | 0;
    case INSTR.AWAIT:
      return CATEGORY.AWAIT | 0;
    case INSTR.LITERAL:
      return CATEGORY.LITERAL | 0;
    case INSTR.IDENTIFIER:
      return CATEGORY.IDENTIFIER | 0;
    case INSTR.TRY_ENTER:
    case INSTR.TRY_LEAVE:
      return CATEGORY.TRY | 0;
    case INSTR.CATCH_ENTER:
    case INSTR.CATCH_LEAVE:
      return CATEGORY.CATCH | 0;
    case INSTR.FINAL_ENTER:
    case INSTR.FINAL_LEAVE:
      return CATEGORY.FINALLY | 0;
    case INSTR.OP_NEW:
    case INSTR.OP_NEW_END:
      return CATEGORY.OP_NEW | 0;
    case INSTR.VAR_INIT:
    case INSTR.VAR_DECLARE:
      return CATEGORY.VAR | 0;
    case INSTR.IF_TEST:
    case INSTR.IF_ENTER:
    case INSTR.IF_LEAVE:
      return CATEGORY.IF | 0;
    case INSTR.ELSE_ENTER:
    case INSTR.ELSE_LEAVE:
      return CATEGORY.ELSE | 0;
    case INSTR.SWITCH_TEST:
    case INSTR.SWITCH_ENTER:
    case INSTR.SWITCH_LEAVE:
      return CATEGORY.SWITCH | 0;
    case INSTR.CASE_TEST:
    case INSTR.CASE_ENTER:
    case INSTR.CASE_LEAVE:
      return CATEGORY.CASE | 0;
    case INSTR.BREAK:
      return CATEGORY.BREAK | 0;
    case INSTR.CONTINUE:
      return CATEGORY.CONTINUE | 0;
    case INSTR.LOOP_TEST:
    case INSTR.LOOP_ENTER:
    case INSTR.LOOP_LEAVE:
      return CATEGORY.LOOP | 0;
    case INSTR.FUNCTION_CALL:
    case INSTR.FUNCTION_CALL_END:
      return CATEGORY.CALL | 0;
    case INSTR.FUNCTION_ENTER:
    case INSTR.FUNCTION_LEAVE:
    case INSTR.FUNCTION_RETURN:
      return CATEGORY.FUNCTION | 0;
    case INSTR.BLOCK_ENTER:
    case INSTR.BLOCK_LEAVE:
      return CATEGORY.BLOCK | 0;
    case INSTR.PROGRAM:
    case INSTR.PROGRAM_ENTER:
    case INSTR.PROGRAM_LEAVE:
    case INSTR.PROGRAM_FRAME_VALUE:
      return CATEGORY.PROGRAM | 0;
    case INSTR.METHOD_ENTER:
    case INSTR.METHOD_LEAVE:
      return CATEGORY.METHOD | 0;
    case INSTR.SUPER:
      return CATEGORY.SUPER | 0;
  }
  return -1;
}

function forceLoopBodyBlocked(node) {
  if (node.body.type !== "BlockStatement") {
    node.body = {
      magic: true,
      type: "BlockStatement",
      body: [node.body]
    };
  }
}

class Frame {
  constructor(type, hash) {
    this.uid = uid();
    this.hash = hash;
    this.type = type;
    this.isSloppy = false;
    this.isBreakable = false;
    this.isReturnable = false;
    this.isCatchClause = false;
    this.isFinalClause = false;
    this.isTryStatement = false;
    this.isSwitchDefault = false;
    this.isInstantiation = false;
    this.cleanType = instructionToString(type);
    this.parent = null;
    this.values = [];
    this.children = [];
    // apply frame flow kinds
    this.isBreakable = isBreakableFrameType(type);
    this.isSwitchCase = isSwitchCaseFrameType(type);
    this.isReturnable = isReturnableFrameType(type);
    this.isCatchClause = isCatchClauseFrameType(type);
    this.isFinalClause = isFinalClauseFrameType(type);
    this.isContinuable = isContinuableFrameType(type);
    this.isTryStatement = isTryStatementFrameType(type);
    this.isInstantiation = isInstantiationFrameType(type);
  }
  isGlobal() {
    return (
      this.parent === null &&
      this.type === INSTR.PROGRAM
    );
  }
  getGlobal() {
    let frame = this;
    while (true) {
      if (frame.isGlobal()) break;
      frame = frame.parent;
    }
    return frame;
  }
  getDepth() {
    let depth = 0;
    let frame = this;
    while (true) {
      if (frame.isGlobal()) break;
      frame = frame.parent;
      depth++;
    }
    return depth;
  }
  equals(frame) {
    return (
      this.uid === frame.uid
    );
  }
}

class Scope {
  constructor(node) {
    this.uid = uid();
    this.isLoop = false;
    this.isReturnable = false;
    if (isFunctionNode(node.type)) {
      this.isReturnable = true;
    }
    else if (isLoopStatement(node.type)) {
      this.isLoop = true;
    }
    this.node = node;
    this.parent = null;
  }
  getReturnContext() {
    let ctx = this;
    while (true) {
      if (ctx.isReturnable) break;
      ctx = ctx.parent;
    }
    return ctx;
  }
  getLoopContext() {
    let ctx = this;
    while (true) {
      if (ctx.isLoop) break;
      ctx = ctx.parent;
    }
    return ctx;
  }
}

let STAGE1 = {};

STAGE1.Program = function(node, patcher) {
  //if (node.magic) return;
  node.magic = true;
  patcher.pushScope(node);
  patcher.stage.BlockStatement(node, patcher, patcher.stage);
  if (patcher.stage === STAGE1) {
    let hash = uBranchHash();
    // create node link
    patcher.nodes[hash] = {
      hash: hash,
      node: cloneNode(node)
    };
    // program frame value id
    let frameValueId = "$$frameValue";
    // patch program frame value debug
    // The completion value of the program is the value of its last
    // expression statement — but a bare block as the last statement
    // used to be skipped, so `{ 1; }` returned undefined instead of 1.
    // Scan backwards for the last expression statement, recursing into
    // trailing blocks (and nested blocks) to find one. Other last
    // statements (declarations, ifs, loops) have an empty completion,
    // so they are skipped the same way the old scan skipped them.
    function lastExpressionStatement(body) {
      for (let ii = body.length - 1; ii >= 0; --ii) {
        let child = body[ii];
        if (child.type === "ExpressionStatement" && !child.magic) return child;
        if (child.type === "BlockStatement") {
          let inner = lastExpressionStatement(child.body);
          if (inner !== null) return inner;
        }
      }
      return null;
    }
    let last = lastExpressionStatement(node.body);
    // only patch the very last expr statement
    if (last !== null) {
      last.expression = {
        magic: true,
        type: "CallExpression",
        callee: {
          magic: true,
          type: "Identifier",
          name: patcher.instance.getLink("DEBUG_PROGRAM_FRAME_VALUE")
        },
        arguments: [
          {
            magic: true,
            type: "AssignmentExpression",
            operator: "=",
            left: parseExpression(frameValueId),
            right: last.expression
          }
        ]
      };
    }
    let end = {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_PROGRAM_LEAVE")
      },
      arguments: [
        parseExpression(hash)
      ]
    };
    let start = {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_PROGRAM_ENTER")
      },
      arguments: [
        parseExpression(hash)
      ]
    };
    let frame = parseExpressionStatement(`var ${frameValueId} = void 0;`);
    end.arguments.push(
      parseExpression(frameValueId)
    );
    node.body.push(end);
    node.body.unshift(start);
    node.body.unshift(frame);
    node.body.unshift(parseExpressionStatement(
      `const ${patcher.instance.key} = Iroh.stages["${patcher.instance.key}"];`
    ));
  }
  patcher.popScope();
};

STAGE1.BlockStatement = function(node, patcher) {
  let body = node.body;
  for (let ii = 0; ii < body.length; ++ii) {
    let child = body[ii];
    //if (child.magic) continue;
    patcher.walk(child, patcher, patcher.stage);
    // Intercept toString for function declarations: a patched function is
    // a different function object than the one the user wrote, so without
    // this `fn.toString()` leaks the instrumented source. Redefine it to
    // return the original source text (taken from the input via the node's
    // original start/end positions).
    // The assignment and member nodes are marked magic so the injection
    // itself stays invisible in traces (no CALL/MEMBER/ASSIGN events for
    // code the user never wrote). The replacement function itself is NOT
    // magic, so it gets the normal treatment — an id, a wrapped return,
    // ENTER/LEAVE — and its frame stays balanced.
    // Covers declarations that are direct children of a block or of the
    // program; declarations used as a bare `if` consequent and function
    // expressions are not covered yet.
    // Guard: STAGE1.BlockStatement is aliased by stages 2, 4, 5, 6 and 8,
    // so this runs once per stage pass — inject the override only once.
    if (child.type === "FunctionDeclaration" && child.id && !child.toStringIntercepted) {
      child.toStringIntercepted = true;
      let original = patcher.instance.input.slice(child.start, child.end);
      let override = {
        type: "ExpressionStatement",
        expression: {
          magic: true,
          type: "AssignmentExpression",
          operator: "=",
          left: {
            magic: true,
            type: "MemberExpression",
            object: { type: "Identifier", name: child.id.name },
            property: { type: "Identifier", name: "toString" },
            computed: false
          },
          right: {
            type: "FunctionExpression",
            id: null,
            params: [],
            body: {
              type: "BlockStatement",
              body: [{
                type: "ReturnStatement",
                argument: { magic: true, type: "Literal", value: original }
              }]
            }
          }
        }
      };
      body.splice(ii + 1, 0, override);
      ii++;
    }
  }
};

STAGE1.MethodDefinition = function(node, patcher) {
  patcher.pushScope(node);
  patcher.walk(node.key, patcher, patcher.stage);
  patcher.walk(node.value, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.FunctionDeclaration = function(node, patcher) {
  // dont touch
  if (node.magic) {
    patcher.pushScope(node);
    // just walk
    patcher.walk(node.id, patcher, patcher.stage);
    node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
    patcher.walk(node.body, patcher, patcher.stage);
    patcher.popScope();
    return;
  }
  node.magic = true;
  patcher.pushScope(node);
  let name = node.id.name;
  patcher.symbols[name] = cloneNode(node);
  patcher.walk(node.id, patcher, patcher.stage);
  node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.FunctionExpression = function(node, patcher) {
  // dont touch
  if (node.magic) {
    patcher.pushScope(node);
    // just walk
    if (node.id !== null) patcher.walk(node.id, patcher, patcher.stage);
    node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
    patcher.walk(node.body, patcher, patcher.stage);
    patcher.popScope();
    return;
  }
  node.magic = true;
  patcher.pushScope(node);
  let name = "$$ANON_" + uid();
  if (node.id === null) {
    node.id = {
      magic: true,
      type: "Identifier",
      name: name
    };
  }
  name = node.id.name;
  patcher.symbols[name] = cloneNode(node);
  patcher.walk(node.id, patcher, patcher.stage);
  node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.ArrowFunctionExpression = function(node, patcher) {
  // dont touch
  if (node.magic) {
    // just walk
    patcher.pushScope(node);
    node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
    patcher.walk(node.body, patcher, patcher.stage);
    patcher.popScope();
    return;
  }
  node.magic = true;
  patcher.pushScope(node);
  let name = "$$ANON_ARROW_" + uid();
  patcher.symbols[name] = cloneNode(node);
  node.id = {
    magic: true,
    type: "Identifier",
    name: name
  };
  // Arrow functions with an expression body implicitly return it. Convert
  // to a block with a real ReturnStatement so the value is actually
  // returned — and let the normal ReturnStatement handler wrap it with
  // DEBUG_FUNCTION_RETURN, like every other function.
  // (The old code built a DEBUG_FUNCTION_RETURN call into the dead
  // `node.argument` field and left the expression bare in the block, so
  // `x => x * 2` ran but always returned undefined.)
  if (node.body.type !== "BlockStatement") {
    node.expression = false;
    node.body = {
      magic: true,
      type: "BlockStatement",
      body: [{
        type: "ReturnStatement",
        argument: node.body
      }]
    };
  }
  node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.CallExpression = function(node, patcher) {
  // patched in node, ignore
  if (node.magic) {
    patcher.walk(node.callee, patcher, patcher.stage);
    node.arguments.map((arg) => {
      patcher.walk(arg, patcher, patcher.stage);
    });
    return;
  }
  node.magic = true;
  patcher.walk(node.callee, patcher, patcher.stage);
  node.arguments.map((arg) => {
    patcher.walk(arg, patcher, patcher.stage);
  });
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let callee = resolveCallee(node.callee);
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_FUNCTION_CALL")
    },
    arguments: [
      parseExpression(hash),
      parseExpression("this"),
      callee,
      (() => {
        if (node.callee.type === "MemberExpression") {
          let property = node.callee.property;
          // identifier
          if (property.type === "Identifier") {
            if (node.callee.computed) {
              return {
                magic: true,
                type: "Identifier",
                name: property.name
              };
            }
            return ({
              magic: true,
              type: "Literal",
              value: property.name
            });
          }
          // private method call (`this.#reset()`): the method cannot be
          // looked up by string — `this["reset"]` is undefined, private
          // members only exist behind `#`. Pass the member expression
          // itself as the callee, so DEBUG_FUNCTION_CALL receives the
          // actual function. (Plain private *reads* use the literal
          // path in the MemberExpression handler instead.)
          if (property.type === "PrivateIdentifier") {
            return node.callee;
          }
          return property;
        }
        return parseExpression("null");
      })(),
      {
        magic: true,
        type: "ArrayExpression",
        elements: [...node.arguments]
      }
    ]
  };
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.ReturnStatement = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  let arg = cloneNode(node.argument);
  if (arg !== null) patcher.walk(arg, patcher, patcher.stage);
  let scope = patcher.scope.getReturnContext();
  let name = parseExpression(`"${scope.node.id.name}"`);
  node.argument = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_FUNCTION_RETURN")
    },
    arguments: [
      parseExpression(hash),
      name
    ]
  };
  if (arg !== null) {
    node.argument.arguments.push(arg);
  }
};

STAGE1.BreakStatement = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let label = parseExpression(
    node.label ? `"${node.label.name}"` : "null"
  );
  let expr = {
    magic: true,
    start: 0, end: 0,
    type: "IfStatement",
    test: {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_BREAK")
      },
      arguments: [
        parseExpression(hash),
        label,
        parseExpression("this")
      ]
    },
    consequent: {
      magic: true,
      type: "BreakStatement",
      label: node.label
    },
    alternate: null
  };
  for (let key in expr) {
    if (!expr.hasOwnProperty(key)) continue;
    node[key] = expr[key];
  }
  node.magic = true;
};

STAGE1.ContinueStatement = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  if (node.label) patcher.walk(node.label, patcher, patcher.stage);
  let label = parseExpression(
    node.label ? `"${node.label.name}"` : "null"
  );
  let expr = {
    magic: true,
    start: 0, end: 0,
    type: "IfStatement",
    test: {
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_CONTINUE")
      },
      arguments: [
        parseExpression(hash),
        label,
        parseExpression("this")
      ]
    },
    consequent: {
      magic: true,
      type: "ContinueStatement",
      label: node.label
    },
    alternate: null
  };
  for (let key in expr) {
    if (!expr.hasOwnProperty(key)) continue;
    node[key] = expr[key];
  }
  node.magic = true;
};

STAGE1.VariableDeclaration = function(node, patcher) {
  if (node.magic) return;
  let ihash = uBranchHash();
  // create node link
  let clone = cloneNode(node);
  patcher.nodes[ihash] = {
    hash: ihash,
    node: clone
  };
  node.magic = true;
  let decls = node.declarations;
  // walk
  for (let ii = 0; ii < decls.length; ++ii) {
    patcher.walk(decls[ii], patcher, patcher.stage);
  }
  // patch
  for (let ii = 0; ii < decls.length; ++ii) {
    let decl = decls[ii];
    let declClone = clone.declarations[ii];
    if (decl.magic) continue;
    let init = decl.init;
    decl.magic = true;
    let dhash = uBranchHash();
    // create node link
    patcher.nodes[dhash] = {
      hash: dhash,
      node: declClone
    };
    decl.init = {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_VAR_INIT")
      },
      arguments: [
        parseExpression(ihash),
        // fire declaration instant by placing a call wrapper around
        // then assign its value afterwards
        {
          magic: true,
          type: "CallExpression",
          callee: {
            magic: true,
            type: "Identifier",
            name: patcher.instance.getLink("DEBUG_VAR_DECLARE")
          },
          arguments: [
            parseExpression(dhash),
            {
              magic: true,
              type: "Literal",
              value: decl.id.name,
              raw: `"${decl.id.name}"`
            }
          ]
        }
      ]
    };
    if (init !== null) decl.init.arguments.push(init);
  }
};

STAGE1.NewExpression = function(node, patcher) {
  if (node.magic) return;
  node.magic = true;
  patcher.walk(node.callee, patcher, patcher.stage);
  node.arguments.map((arg) => {
    patcher.walk(arg, patcher, patcher.stage);
  });
  let callee = cloneNode(node.callee);
  let args = [
    callee,
    {
      magic: true,
      type: "ArrayExpression",
      elements: [...node.arguments]
    }
  ];
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };

  node.callee = {
    magic: true,
    type: "Identifier",
    name: patcher.instance.getLink("DEBUG_OP_NEW_END")
  };
  node.arguments = [
    parseExpression(hash),
    parseExpression(patcher.instance.key),
    {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_OP_NEW")
      },
      arguments: [
        parseExpression(hash),
        ...args
      ]
    },
  ];
};

STAGE1.ObjectExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  node.properties.map((prop) => { patcher.walk(prop, patcher, patcher.stage); });
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_ALLOC")
    },
    arguments: [
      parseExpression(hash),
      cloneNode(node)
    ]
  };
  delete node.properties;
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.MemberExpression = function(node, patcher) {
  if (node.magic) {
    patcher.walk(node.object, patcher, patcher.stage);
    patcher.walk(node.property, patcher, patcher.stage);
    return;
  }
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  patcher.walk(node.object, patcher, patcher.stage);
  patcher.walk(node.property, patcher, patcher.stage);
  let property = node.property;
  if (node.property.type === "Identifier" || node.property.type === "PrivateIdentifier") {
    // PrivateIdentifier (`this.#x`) must also become a string literal here:
    // passed as a bare argument it is invalid JS (`#x` is only legal after
    // `.` in a member expression), and the outer member below keeps the
    // original PrivateIdentifier node so `.#x` still generates correctly.
    property = {
      magic: true,
      type: "Literal",
      value: property.name
    };
  }
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_MEMBER_EXPR")
    },
    arguments: [
      parseExpression(hash),
      node.object,
      property
    ]
  };
  call = {
    magic: true,
    type: "MemberExpression",
    object: call,
    property: node.property
  };
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.AssignmentExpression = function(node, patcher) {
  if (node.magic) {
    node.left.magic = true;
    patcher.walk(node.left, patcher, patcher.stage);
    patcher.walk(node.right, patcher, patcher.stage);
    return;
  }
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  node.left.magic = true;
  let left = node.left;
  let right = node.right;
  // Destructuring assignment (`[a, b] = [b, a]`, `({x} = y)`): the left
  // side is a pattern, not a member or an identifier, so there is nothing
  // for DEBUG_ASSIGN to do — and passing null as its object/property
  // arguments would put literal nulls in the AST and crash the walker.
  // Walk both sides and leave the assignment alone, like the magic path.
  if (left.type !== "MemberExpression" && left.type !== "Identifier") {
    patcher.walk(node.left, patcher, patcher.stage);
    patcher.walk(node.right, patcher, patcher.stage);
    return;
  }
  // Private-field assignment (`this.#count += 1`): DEBUG_ASSIGN does the
  // assignment as `obj[prop]` with prop a string, and `obj["count"]` is a
  // *public* property — a different slot from `#count`. Routing it
  // through DEBUG_ASSIGN would silently write the wrong slot. Leave the
  // native assignment in place (no ASSIGN event for it) and walk both
  // sides so the operands are still traced.
  if (
    left.type === "MemberExpression" &&
    left.property.type === "PrivateIdentifier"
  ) {
    patcher.walk(node.left, patcher, patcher.stage);
    patcher.walk(node.right, patcher, patcher.stage);
    return;
  }
  let operator = node.operator;
  if (operator !== "=") {
    operator = operator.substr(0, operator.length - 1);
  }
  // #object assignment
  let object = null;
  let property = null;
  // skip the last property and manually
  // access it inside the debug function
  if (left.type === "MemberExpression") {
    if (left.property.type === "Identifier") {
      if (left.computed) {
        property = left.property;
      } else {
        property = {
          magic: true,
          type: "Literal",
          value: left.property.name
        };
      }
    } else if (left.property.type === "PrivateIdentifier") {
      // `#x` is only legal after `.` — pass it as a string literal.
      property = {
        magic: true,
        type: "Literal",
        value: left.property.name
      };
    } else {
      property = left.property;
    }
    object = left.object;
  }
  // identifier based assignment
  // fixed up below by turning into assign expr again
  else if (left.type === "Identifier") {
    object = left;
    property = parseExpression(null);
  }
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_ASSIGN")
    },
    arguments: [
      parseExpression(hash),
      parseExpression(OP[operator]),
      (
        left.type === "Identifier" ?
        parseExpression(`"${left.name}"`) :
        object
      ),
      property,
      right
    ]
  };
  // #identifier assignment
  if (left.type === "Identifier") {
    call = {
      magic: true,
      type: "AssignmentExpression",
      operator: node.operator,
      left: object,
      right: call
    };
  }
  patcher.walk(node.left, patcher, patcher.stage);
  patcher.walk(node.right, patcher, patcher.stage);
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.UpdateExpression = function(node, patcher) {
  if (node.magic) {
    patcher.walk(node.argument, patcher, patcher.stage);
    return;
  }
  node.magic = true;
  patcher.walk(node.argument, patcher, patcher.stage);
  let hash = uBranchHash();
  // create node link
  let clone = cloneNode(node);
  patcher.nodes[hash] = {
    hash: hash,
    node: clone
  };
  let arg = node.argument;
  let operator = node.operator;
  // #object assignment
  let object = null;
  let property = null;
  // skip the last property and manually
  // access it inside the debug function
  if (arg.type === "MemberExpression") {
    if (arg.property.type === "Identifier") {
      if (arg.computed) {
        property = arg.property;
      } else {
        property = {
          magic: true,
          type: "Literal",
          value: arg.property.name
        };
      }
    } else {
      property = arg.property;
    }
    object = arg.object;
  }
  // identifier based assignment
  // fixed up below by turning into assign expr again
  else if (arg.type === "Identifier") {
    object = arg;
    property = parseExpression(null);
  }
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_UPDATE")
    },
    arguments: [
      parseExpression(hash),
      parseExpression(OP[operator]),
      clone,
      parseExpression(node.prefix)
    ]
  };
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.ArrayExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  node.elements.map((el) => { if (el !== null) patcher.walk(el, patcher, patcher.stage); });
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_ALLOC")
    },
    arguments: [
      parseExpression(hash),
      cloneNode(node)
    ]
  };
  delete node.elements;
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.Literal = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  let clone = cloneNode(node);
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: clone
  };
  node.magic = true;
  let call = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_LITERAL")
    },
    arguments: [
      parseExpression(hash),
      clone
    ]
  };
  for (let key in call) {
    if (!call.hasOwnProperty(key)) continue;
    node[key] = call[key];
  }
};

STAGE1.ForStatement = function(node, patcher) {
  if (!node.hasOwnProperty("labels")) node.labels = [];
  patcher.pushScope(node);
  if (node.test) patcher.walk(node.test, patcher, patcher.stage);
  if (node.init) patcher.walk(node.init, patcher, patcher.stage);
  if (node.update) patcher.walk(node.update, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.ForInStatement = function(node, patcher) {
  node.left.magic = true;
  patcher.pushScope(node);
  patcher.walk(node.left, patcher, patcher.stage);
  patcher.walk(node.right, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.ForOfStatement = function(node, patcher) {
  node.left.magic = true;
  patcher.pushScope(node);
  patcher.walk(node.left, patcher, patcher.stage);
  patcher.walk(node.right, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.WhileStatement = function(node, patcher) {
  patcher.pushScope(node);
  if (node.test) patcher.walk(node.test, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE1.DoWhileStatement = function(node, patcher) {
  patcher.pushScope(node);
  if (node.test) patcher.walk(node.test, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

let STAGE2 = {};

STAGE2.IfStatement = function(node, patcher) {
  if (node.magic) {
    patcher.walk(node.test, patcher, patcher.stage);
    patcher.walk(node.consequent, patcher, patcher.stage);
    if (node.alternate) patcher.walk(node.alternate, patcher, patcher.stage);
    return;
  }
  node.magic = true;

  let test = cloneNode(node.test);
  // branch hash
  let elseHash = uBranchHash();
  let isElse = (
    node.alternate &&
    node.alternate.type !== "IfStatement"
  );
  let isBlockedElse = (
    isElse &&
    node.alternate.body === "BlockStatement"
  );

  if (isElse) {
    // create node link
    let link = {
      hash: elseHash,
      node: null
    };
    patcher.nodes[elseHash] = link;
    link.node = cloneNode(node.alternate);
    if (!isBlockedElse) {
      // force else to be blocked
      let alternate = node.alternate;
      node.alternate = parseExpressionStatement("{}");
      node.alternate.body.push(alternate);
    }
  }

  // branch hash
  let ifHash = uBranchHash();
  // create node link
  patcher.nodes[ifHash] = {
    hash: ifHash,
    node: cloneNode(node)
  };

  patcher.walk(node.test, patcher, patcher.stage);
  patcher.walk(node.consequent, patcher, patcher.stage);
  if (node.alternate) patcher.walk(node.alternate, patcher, patcher.stage);

  let id = reserveTempVarId();
  let patch = parseExpressionStatement(`var ${id};`);
  injectPatchIntoNode(patcher.scope.node, patch);

  // debug if test
  node.test = {
    magic: true,
    type: "AssignmentExpression",
    operator: "=",
    left: parseExpression(id),
    right: {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_IF_TEST")
      },
      arguments: [
        parseExpression(ifHash),
        node.test
      ]
    }
  };

  // patch else enter, leave
  if (isElse) {
    let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_ELSE_LEAVE"));
    let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_ELSE_ENTER"));
    end.expression.arguments.push(
      parseExpression(elseHash)
    );
    start.expression.arguments.push(
      parseExpression(elseHash)
    );
    node.alternate.body.unshift(start);
    node.alternate.body.push(end);
  }

  // debug if body enter, leave
  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_IF_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_IF_ENTER"));
  // branch hash
  end.expression.arguments.push(
    parseExpression(ifHash)
  );
  // branch hash
  start.expression.arguments.push(
    parseExpression(ifHash)
  );
  // pass in condition result into if enter
  start.expression.arguments.push(parseExpression(id));
  if (node.consequent.type === "BlockStatement") {
    node.consequent.body.unshift(start);
    node.consequent.body.push(end);
  } else {
    node.consequent = {
      type: "BlockStatement",
      body: [start, node.consequent, end]
    };
  }

};

STAGE2.Program = STAGE1.Program;
STAGE2.BlockStatement = STAGE1.BlockStatement;
STAGE2.MethodDefinition = STAGE1.MethodDefinition;
STAGE2.FunctionDeclaration = STAGE1.FunctionDeclaration;
STAGE2.FunctionExpression = STAGE1.FunctionExpression;
STAGE2.ArrowFunctionExpression = STAGE1.ArrowFunctionExpression;

let STAGE3 = {};

STAGE3.BlockStatement = function(node, patcher) {
  let body = node.body;
  // transform try, switch and labels here
  for (let ii = 0; ii < body.length; ++ii) {
    let child = body[ii];
    //if (child.magic) continue;
    // labeled statement
    let isLabeledStmt = isLabeledStatement(child.type);
    if (isLabeledStmt) {
      child = processLabels(child);
    }
    let isTryStmt = isTryStatement(child.type);
    let isSwitchStmt = isSwitchStatement(child.type);
    let hash = -1;
    let isHashBranch = (
      isTryStmt ||
      isSwitchStmt
    );
    // only generate hash if necessary
    if (isHashBranch) hash = uBranchHash();
    // #ENTER
    if (isHashBranch) {
      let link = patcher.instance.getLinkCall(
        isTryStmt ? "DEBUG_TRY_ENTER" :
        isSwitchStmt ? "DEBUG_SWITCH_ENTER" :
        "" // throws error
      );
      let start = parseExpressionStatement(link);
      patcher.nodes[hash] = {
        hash: hash,
        node: cloneNode(child)
      };
      start.expression.arguments.push(
        parseExpression(hash)
      );
      body.splice(ii, 0, start);
      ii++;
    }
    // switch test
    if (isSwitchStmt) {
      let test = {
        magic: true,
        type: "CallExpression",
        callee: {
          magic: true,
          type: "Identifier",
          name: patcher.instance.getLink("DEBUG_SWITCH_TEST")
        },
        arguments: [
          parseExpression(hash),
          child.discriminant
        ]
      };
      child.discriminant = test;
    }
    patcher.walk(child, patcher, patcher.stage);
    // #LEAVE
    if (isHashBranch) {
      let link = patcher.instance.getLinkCall(
        isTryStmt ? "DEBUG_TRY_LEAVE" :
        isSwitchStmt ? "DEBUG_SWITCH_LEAVE" :
        "" // throws error
      );
      let end = parseExpressionStatement(link);
      end.expression.arguments.push(
        parseExpression(hash)
      );
      body.splice(ii + 1, 0, end);
      ii++;
      if (isTryStmt) {
        if (child.finalizer) STAGE3.FinalClause(child.finalizer, patcher);
      }
    }
  }
};

STAGE3.CatchClause = function(node, patcher) {
  if (node.magic) return;
  patcher.pushScope(node);
  patcher.walk(node.param, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);

  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let hashExpr = parseExpression(hash);
  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_CATCH_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_CATCH_ENTER"));
  end.expression.arguments.push(hashExpr);
  start.expression.arguments.push(hashExpr);
  node.body.body.unshift(start);
  node.body.body.push(end);

  patcher.popScope();
};

STAGE3.FinalClause = function(node, patcher) {
  if (node.magic) return;
  patcher.pushScope(node);
  patcher.walk(node, patcher, patcher.stage);

  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let hashExpr = parseExpression(hash);
  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FINAL_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FINAL_ENTER"));
  end.expression.arguments.push(hashExpr);
  start.expression.arguments.push(hashExpr);
  node.body.unshift(start);
  node.body.push(end);

  patcher.popScope();
};

STAGE3.Program = STAGE1.Program;
STAGE3.MethodDefinition = STAGE1.MethodDefinition;
STAGE3.FunctionDeclaration = STAGE1.FunctionDeclaration;
STAGE3.FunctionExpression = STAGE1.FunctionExpression;
STAGE3.ArrowFunctionExpression = STAGE1.ArrowFunctionExpression;

let STAGE4 = {};

STAGE4.SwitchStatement = function(node, patcher) {
  if (node.magic) {
    patcher.walk(node.discriminant, patcher, patcher.stage);
    node.cases.map((cs) => {
      patcher.walk(cs, patcher, patcher.stage);
    });
    return;
  }
  node.magic = true;

  let hash = uBranchHash();
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };

  patcher.walk(node.discriminant, patcher, patcher.stage);
  node.cases.map((cs) => {
    patcher.walk(cs, patcher, patcher.stage);
  });

  let id = reserveTempVarId();
  let patch = parseExpressionStatement(`var ${id};`);
  injectPatchIntoNode(patcher.scope.node, patch);

  // debug if test
  node.discriminant = {
    magic: true,
    type: "AssignmentExpression",
    operator: "=",
    left: parseExpression(id),
    right: node.discriminant
  };

};

STAGE4.SwitchCase = function(node, patcher) {
  if (node.magic) {
    if (node.test) patcher.walk(node.test, patcher, patcher.stage);
    node.consequent.map((cons) => {
      patcher.walk(cons, patcher, patcher.stage);
    });
    return;
  }
  node.magic = true;

  let hash = uBranchHash();

  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };

  let test = null;
  if (node.test) {
    let id = reserveTempVarId();
    let patch = parseExpressionStatement(`var ${id};`);
    injectPatchIntoNode(patcher.scope.node, patch);
    test = parseExpression(id);
    // debug if test
    node.test = {
      magic: true,
      type: "AssignmentExpression",
      operator: "=",
      left: test,
      right: node.test
    };
    node.test = {
      magic: true,
      type: "CallExpression",
      callee: {
        magic: true,
        type: "Identifier",
        name: patcher.instance.getLink("DEBUG_CASE_TEST")
      },
      arguments: [
        parseExpression(hash),
        node.test
      ]
    };
  }

  // default or case
  let type = (
    test !== null ? test : parseExpression("null")
  );

  let start = parseExpressionStatement(
    patcher.instance.getLinkCall("DEBUG_CASE_ENTER")
  );
  // pass case test result
  start.expression.arguments.push(
    parseExpression(hash)
  );
  // pass case value
  start.expression.arguments.push(test || parseExpression(null));
  // trace default case
  start.expression.arguments.push(
    parseExpression(test === null)
  );
  node.consequent.splice(0, 0, start);

  let end = parseExpressionStatement(
    patcher.instance.getLinkCall("DEBUG_CASE_LEAVE")
  );
  end.expression.arguments.push(
    parseExpression(hash)
  );
  node.consequent.splice(node.consequent.length, 0, end);

};

STAGE4.Program = STAGE1.Program;
STAGE4.BlockStatement = STAGE1.BlockStatement;
STAGE4.MethodDefinition = STAGE1.MethodDefinition;
STAGE4.FunctionDeclaration = STAGE1.FunctionDeclaration;
STAGE4.FunctionExpression = STAGE1.FunctionExpression;
STAGE4.ArrowFunctionExpression = STAGE1.ArrowFunctionExpression;

let STAGE5 = {};

STAGE5.ClassDeclaration = function(node, patcher) {
  patcher.pushScope(node);
  patcher.walk(node.id, patcher, patcher.stage);
  patcher.walk(node.body, patcher, patcher.stage);
  patcher.popScope();
};

STAGE5.MethodDefinition = function(node, patcher) {
  if (node.magic) {
    patcher.pushScope(node);
    patcher.walk(node.key, patcher, patcher.stage);
    patcher.walk(node.value, patcher, patcher.stage);
    patcher.popScope();
    return;
  }

  let scope = patcher.scope;
  // branch hash
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };

  node.magic = true;
  node.value.superIndex = -1;
  node.value.superNode = null;
  patcher.pushScope(node);
  patcher.walk(node.key, patcher, patcher.stage);
  patcher.walk(node.value, patcher, patcher.stage);

  let isConstructor = node.kind === "constructor";

  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_METHOD_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_METHOD_ENTER"));
  let body = node.value.body.body;

  start.expression.arguments.push(parseExpression("this"));
  start.expression.arguments.push(parseExpression("arguments"));

  // patch constructor
  if (isConstructor) {
    if (node.value.superNode !== null) {
      // only function expressions supported for now
      console.assert(node.value.type === "FunctionExpression");
      // find super class call
      // patch in ctor enter, leave afterwards
      let index = node.value.superIndex;
      body.splice(index + 1, 0, start);
      body.splice(index + body.length, 0, end);
    } else {
      body.splice(0, 0, start);
      body.splice(body.length, 0, end);
    }
  } else {
    body.splice(0, 0, start);
    body.splice(body.length, 0, end);
  }

  // constructor state
  end.expression.arguments.unshift(parseExpression(isConstructor));
  start.expression.arguments.unshift(parseExpression(isConstructor));

  // class name
  end.expression.arguments.unshift(scope.node.id);
  start.expression.arguments.unshift(scope.node.id);

  // hash
  end.expression.arguments.unshift(parseExpression(hash));
  start.expression.arguments.unshift(parseExpression(hash));

  patcher.popScope();
};

STAGE5.CallExpression = function(node, patcher) {
  if (node.magic) return;
  // dont patch super class calls
  if (node.callee && node.callee.type === "Super") {
    let scope = patcher.scope.node;
    let index = -1;
    console.assert(scope.type === "FunctionExpression");
    scope.body.body.map((child, idx) => {
      console.assert(child.type === "ExpressionStatement");
      if (child.expression === node) {
        index = idx;
      }
    });
    console.assert(index !== -1);
    scope.superIndex = index;
    scope.superNode = node;

    // patch debug super
    node.arguments = [
      {
        magic: true,
        type: "CallExpression",
        callee: {
          magic: true,
          type: "Identifier",
          name: patcher.instance.getLink("DEBUG_SUPER")
        },
        arguments: [
          // class ctor
          patcher.scope.parent.parent.node.id,
          {
            magic: true,
            type: "SpreadElement",
            argument: {
              magic: true,
              type: "ArrayExpression",
              elements: node.arguments
            }
          }
        ]
      }
    ];
  }
};

STAGE5.Program = STAGE1.Program;
STAGE5.BlockStatement = STAGE1.BlockStatement;
STAGE5.FunctionDeclaration = STAGE1.FunctionDeclaration;
STAGE5.FunctionExpression = STAGE1.FunctionExpression;
STAGE5.ArrowFunctionExpression = STAGE1.ArrowFunctionExpression;

let STAGE6 = {};

STAGE6.FunctionDeclaration = function(node, patcher) {
  patcher.pushScope(node);
  patcher.walk(node.id, patcher, patcher.stage);
  node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
  patcher.walk(node.body, patcher, patcher.stage);

  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let hashExpr = parseExpression(hash);
  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FUNCTION_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FUNCTION_ENTER"));
  end.expression.arguments.push(hashExpr);
  end.expression.arguments.push(parseExpression("this"));
  start.expression.arguments.push(hashExpr);
  start.expression.arguments.push(parseExpression("this"));
  // NOTE: pass the function name as a string literal, not a bare identifier.
  // astring only emits an id binding for named function expressions; for
  // arrows, object methods and getters the id is dropped, so a bare
  // `$$ANON_*` reference was never declared and the patched code threw
  // `ReferenceError: $$ANON_* is not defined` at runtime.
  // DEBUG_FUNCTION_ENTER only stores this as currentScope and reads the
  // event name from nodes[hash].node.id.name, so a string is safe here.
  start.expression.arguments.push(parseExpression(`"${node.id.name}"`));
  start.expression.arguments.push(parseExpression("arguments"));
  node.body.body.unshift(start);
  node.body.body.push(end);

  patcher.popScope();
};

STAGE6.FunctionExpression = function(node, patcher) {
  if (patcher.scope.node.type === "MethodDefinition") return;
  // Scaffolding functions injected by the decorator desugar
  // (src/decorators.js) are magic and have no id: STAGE1 only assigns
  // ids to functions it processes as user code, and these live inside
  // magic context objects it never descends into. They must stay
  // invisible — no ENTER/LEAVE events — and the instrumentation below
  // would throw on `node.id.name` for the missing id. Real user
  // functions always have an id by this stage, so this skips nothing
  // else.
  if (node.magic && !node.id) return;
  patcher.pushScope(node);
  patcher.walk(node.id, patcher, patcher.stage);
  node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
  patcher.walk(node.body, patcher, patcher.stage);

  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let hashExpr = parseExpression(hash);
  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FUNCTION_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FUNCTION_ENTER"));
  end.expression.arguments.push(hashExpr);
  end.expression.arguments.push(parseExpression("this"));
  start.expression.arguments.push(hashExpr);
  start.expression.arguments.push(parseExpression("this"));
  // See FunctionDeclaration above: name as a string literal, not a bare
  // identifier. Function expressions used as object methods/getters also
  // lose their artificial id in generated code (astring emits method
  // shorthand), so a bare $$ANON_* reference would be unbound there too.
  start.expression.arguments.push(parseExpression(`"${node.id.name}"`));
  start.expression.arguments.push(parseExpression("arguments"));
  node.body.body.unshift(start);
  node.body.body.push(end);

  patcher.popScope();
};

STAGE6.ArrowFunctionExpression = function(node, patcher) {
  // See FunctionExpression above: id-less magic arrows are decorator
  // scaffolding (a forEach callback). They have no id and an
  // expression body, so the instrumentation below would throw on
  // `node.id.name` and on `node.body.body`.
  if (node.magic && !node.id) return;
  patcher.pushScope(node);
  node.params.map((param) => { patcher.walk(param, patcher, patcher.stage); });
  patcher.walk(node.body, patcher, patcher.stage);

  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  let hashExpr = parseExpression(hash);
  let end = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FUNCTION_LEAVE"));
  let start = parseExpressionStatement(patcher.instance.getLinkCall("DEBUG_FUNCTION_ENTER"));
  end.expression.arguments.push(hashExpr);
  end.expression.arguments.push(parseExpression("this"));
  start.expression.arguments.push(hashExpr);
  start.expression.arguments.push(parseExpression("this"));
  // See FunctionDeclaration above: name as a string literal. Arrows have
  // no id in ESTree and astring never emits one, so the bare identifier
  // `$$ANON_ARROW_*` was unbound and every arrow callback (e.g. .map(x => …))
  // threw ReferenceError at runtime.
  start.expression.arguments.push(parseExpression(`"${node.id.name}"`));
  let args = {
    magic: true,
    type: "ArrayExpression",
    elements: []
  };
  node.params.map((param) => {
    args.elements.push(param);
  });
  start.expression.arguments.push(args);
  node.body.body.unshift(start);
  node.body.body.push(end);

  patcher.popScope();
};

STAGE6.Program = STAGE1.Program;
STAGE6.BlockStatement = STAGE1.BlockStatement;
STAGE6.MethodDefinition = STAGE1.MethodDefinition;

let STAGE7 = {};

STAGE7.BlockStatement = function(node, patcher) {
  let body = node.body;
  for (let ii = 0; ii < body.length; ++ii) {
    let child = body[ii];
    //if (child.magic) continue;
    //child.magic = true;

    // labeled statement
    let isLabeledStmt = isLabeledStatement(child.type);
    if (isLabeledStmt) {
      child = processLabels(child);
    }

    let isLazyBlock = (
      child.type === "BlockStatement"
    );
    let isLoopStmt = isLoopStatement(child.type);
    let isSwitchStmt = isSwitchStatement(child.type);
    let isHashBranch = (
      isLoopStmt ||
      isLazyBlock
    );
    let hash = -1;
    let id = null;
    if (isHashBranch) {
      // generate hash
      hash = uBranchHash();
      id = reserveTempVarId();
      patcher.nodes[hash] = {
        hash: hash,
        node: cloneNode(child)
      };
    }

    if (isLazyBlock) {
      let start = {
        magic: true,
        type: "ExpressionStatement",
        expression: {
          magic: true,
          type: "CallExpression",
          callee: {
            magic: true,
            type: "Identifier",
            name: patcher.instance.getLink("DEBUG_BLOCK_ENTER")
          },
          arguments: [
            parseExpression(hash)
          ]
        }
      };
      let end = {
        magic: true,
        type: "ExpressionStatement",
        expression: {
          magic: true,
          type: "CallExpression",
          callee: {
            magic: true,
            type: "Identifier",
            name: patcher.instance.getLink("DEBUG_BLOCK_LEAVE")
          },
          arguments: [ parseExpression(hash) ]
        }
      };
      child.body.unshift(start);
      child.body.push(end);
      patcher.walk(child, patcher, patcher.stage);
      continue;
    }

    if (isLoopStmt) {
      forceLoopBodyBlocked(child);
      console.assert(child.body.type === "BlockStatement");

      let patch = parseExpressionStatement(`var ${id} = 0;`);
      body.splice(ii, 0, patch);
      ii++;

      let test = {
        magic: true,
        type: "CallExpression",
        callee: {
          magic: true,
          type: "Identifier",
          name: patcher.instance.getLink("DEBUG_LOOP_TEST")
        },
        arguments: [
          parseExpression(hash),
          child.test ? child.test : (
            // empty for test means infinite
            child.type === "ForStatement" ?
            parseExpression(true) :
            "" // throws error
          ),
          parseExpression(`"${child.type}"`)
        ]
      };
      child.test = test;

      let start = {
        magic: true,
        type: "IfStatement",
        test: parseExpression(`${id} === 0`),
        alternate: null,
        consequent: {
          magic: true,
          type: "ExpressionStatement",
          expression: {
            magic: true,
            type: "CallExpression",
            callee: {
              magic: true,
              type: "Identifier",
              name: patcher.instance.getLink("DEBUG_LOOP_ENTER")
            },
            arguments: [
              parseExpression(hash),
              // set the loop enter state to fullfilled
              parseExpression(`${id} = 1`),
              parseExpression(`"${child.type}"`)
            ]
          }
        }
      };
      child.body.body.unshift(start);
    }
    patcher.walk(child, patcher, patcher.stage);
    if (isLoopStmt) {
      let end = {
        magic: true,
        type: "ExpressionStatement",
        expression: {
          magic: true,
          type: "CallExpression",
          callee: {
            magic: true,
            type: "Identifier",
            name: patcher.instance.getLink("DEBUG_LOOP_LEAVE")
          },
          arguments: [
            parseExpression(hash),
            parseExpression(id),
            parseExpression(`"${child.type}"`),
          ]
        }
      };
      body.splice(ii + 1, 0, end);
      ii++;
    }
  }
};

STAGE7.Program = STAGE1.Program;
STAGE7.MethodDefinition = STAGE1.MethodDefinition;
STAGE7.FunctionDeclaration = STAGE1.FunctionDeclaration;
STAGE7.FunctionExpression = STAGE1.FunctionExpression;
STAGE7.ArrowFunctionExpression = STAGE1.ArrowFunctionExpression;

let STAGE8 = {};

STAGE8.ThisExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: patcher.instance.getLink("DEBUG_THIS")
  };
  node.arguments = [
    parseExpression(hash),
    parseExpression("this")
  ];
};

STAGE8.BinaryExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  patcher.walk(node.left, patcher, patcher.stage);
  patcher.walk(node.right, patcher, patcher.stage);
  node.magic = true;
  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: patcher.instance.getLink("DEBUG_BINARY")
  };
  node.arguments = [
    parseExpression(hash),
    parseExpression(OP[node.operator]),
    node.left,
    node.right
  ];
};

STAGE8.LogicalExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  patcher.walk(node.left, patcher, patcher.stage);
  patcher.walk(node.right, patcher, patcher.stage);
  node.magic = true;
  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: patcher.instance.getLink("DEBUG_LOGICAL")
  };
  let right = parseExpression("(function() { }).bind(this)");
  // enter bind expression to get the binded function
  let fn = right.callee.object;
  fn.body.body.push({
    magic: true,
    type: "ReturnStatement",
    argument: node.right
  });
  node.arguments = [
    parseExpression(hash),
    parseExpression(OP[node.operator]),
    node.left,
    right
  ];
};

STAGE8.UnaryExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  patcher.walk(node.argument, patcher, patcher.stage);
  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: patcher.instance.getLink("DEBUG_UNARY")
  };
  let argument = node.argument;
  // non-trackable yet FIXME
  if (node.operator === "delete") {
    argument = {
      magic: true,
      type: "UnaryExpression",
      operator: node.operator,
      prefix: true,
      argument: argument
    };
  }
  node.arguments = [
    parseExpression(hash),
    parseExpression(OP[node.operator]),
    parseExpression("this"),
    parseExpression(false),
    argument
  ];
  // typeof fixup
  // typeof is a weirdo
  if (node.operator === "typeof" && argument.type === "Identifier") {
    let id = reserveTempVarId();
    let patch = parseExpressionStatement(`var ${id};`);
    injectPatchIntoNode(patcher.scope.node, patch);
    let name = argument.name;
    // heute sind wir räudig
    let critical = parseExpression(
      `(function() { try { ${name}; } catch(e) { ${id} = "undefined"; return true; } ${id} = ${name}; return false; }).bind(this)()`
    );
    node.arguments = [
      parseExpression(hash),
      parseExpression(OP[node.operator]),
      parseExpression("this"),
      critical,
      parseExpression(id)
    ];
  }
};

STAGE8.ConditionalExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  node.magic = true;
  patcher.walk(node.test, patcher, patcher.stage);
  patcher.walk(node.consequent, patcher, patcher.stage);
  patcher.walk(node.alternate, patcher, patcher.stage);

  let cons = parseExpression("(function() { }).bind(this)");
  cons.callee.object.body.body.push({
    magic: true,
    type: "ReturnStatement",
    argument: node.consequent
  });
  let alt = parseExpression("(function() { }).bind(this)");
  alt.callee.object.body.body.push({
    magic: true,
    type: "ReturnStatement",
    argument: node.alternate
  });

  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: patcher.instance.getLink("DEBUG_TERNARY")
  };
  node.arguments = [
    parseExpression(hash),
    node.test,
    cons,
    alt
  ];
};

/*
STAGE8.Literal = function(node) {
  if (node.magic) return;
  let clone = Iroh.cloneNode(node);
  node.magic = true;
  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: Iroh.getLink("DEBUG_LITERAL")
  };
  node.arguments = [
    clone
  ];
};

STAGE8.Identifier = function(node) {
  if (node.magic) return;
  node.magic = true;
  let clone = Iroh.cloneNode(node);
  node.type = "CallExpression";
  node.callee = {
    magic: true,
    type: "Identifier",
    name: Iroh.getLink("DEBUG_IDENTIFIER")
  };
  node.arguments = [
    Iroh.parseExpression(`"${node.name}"`),
    clone
  ];
};
*/

// `await X` becomes `await DEBUG_AWAIT(hash, X)`. The debug call saves
// the frame stack at the await point and restores it when the awaited
// value settles, before the async function's continuation runs — without
// this, a continuation that returns or leaves a try block resolves frames
// against whatever stack other code left behind and throws
// "Unexpected frame type FUNCTION_CALL". See DEBUG_AWAIT in stage/debug.js.
STAGE8.AwaitExpression = function(node, patcher) {
  if (node.magic) return;
  let hash = uBranchHash();
  // create node link
  patcher.nodes[hash] = {
    hash: hash,
    node: cloneNode(node)
  };
  patcher.walk(node.argument, patcher, patcher.stage);
  node.magic = true;
  node.argument = {
    magic: true,
    type: "CallExpression",
    callee: {
      magic: true,
      type: "Identifier",
      name: patcher.instance.getLink("DEBUG_AWAIT")
    },
    arguments: [
      parseExpression(hash),
      node.argument
    ]
  };
};

STAGE8.Program = STAGE1.Program;
STAGE8.BlockStatement = STAGE1.BlockStatement;
STAGE8.MethodDefinition = STAGE1.MethodDefinition;
STAGE8.FunctionDeclaration = STAGE1.FunctionDeclaration;
STAGE8.FunctionExpression = STAGE1.FunctionExpression;
STAGE8.ArrowFunctionExpression = STAGE1.ArrowFunctionExpression;

class Patcher {
  constructor(instance) {
    this.uid = uid();
    // patch AST scope
    this.scope = null;
    // patch stage
    this.stage = null;
    // patch state
    this.state = null;
    // node symbols
    this.symbols = {};
    // node clones
    this.nodes = {};
    // stage instance
    this.instance = instance;
  }
}

Patcher.prototype.walk = function(ast, state, visitors) {
  return acornWalk.recursive(ast, state, visitors, acornWalk.base);
};

Patcher.prototype.pushScope = function(node) {
  let tmp = this.scope;
  this.scope = new Scope(node);
  this.scope.parent = tmp;
};

Patcher.prototype.popScope = function(node) {
  this.scope = this.scope.parent;
};

Patcher.prototype.applyStagePatch = function(ast, stage) {
  this.stage = stage;
  this.walk(ast, this, this.stage);
};

Patcher.prototype.applyPatches = function(ast) {
  this.applyStagePatch(ast, STAGE2);
  this.applyStagePatch(ast, STAGE7);
  this.applyStagePatch(ast, STAGE4);
  this.applyStagePatch(ast, STAGE5);
  this.applyStagePatch(ast, STAGE1);
  this.applyStagePatch(ast, STAGE3);
  this.applyStagePatch(ast, STAGE6);
  this.applyStagePatch(ast, STAGE8);
};

// Decorator desugaring — turns the `Decorator` nodes the Acorn
// plugin (src/decorators-plugin.js) produces into plain calls.
//
// Why a desugar, not regeneration: Node cannot execute `@` syntax at
// all — verified on Node v24.22.1, even with the --js-decorators V8
// flag — and astring cannot generate `Decorator` nodes. So decorated
// code is rewritten before the other patch stages run, and the
// rewritten code is what gets traced. The decorator expressions
// themselves stay in the tree (non-magic), so `@factory()` still
// fires a CALL event for `factory`; only the scaffolding is magic.
//
// Semantics implemented (TC39 decorators proposal, standard
// semantics for the common cases):
//   - Decorator expressions evaluate in written order; decorators
//     apply in reverse order within each element, elements in
//     definition order, class decorators last.
//   - Class decorator: called with (Class, {kind:"class", name}),
//     a function return replaces the class, undefined keeps it.
//   - Method decorator: called with (method, {kind:"method", ...}),
//     a function return replaces the method, undefined keeps it.
//   - Field decorator: called with (undefined, {kind:"field", ...}),
//     a function return is an initializer: it is called per instance
//     (or once, at class definition, for static fields) with the
//     field's initial value, and its return becomes the field value.
//   - Context objects carry kind, name, static, private, access
//     ({has, get} for methods, {has, get, set} for fields) and
//     addInitializer. Static addInitializer callbacks run right after
//     the class definition; instance ones run at the end of the
//     constructor (the constructor is wrapped, or added when the
//     class has none).
//   - Private methods/fields apply through a magic static block,
//     because `#m` cannot be named outside the class body.
//
// How the apply works: the decorator invocation reuses the existing
// DEBUG_FUNCTION_CALL link (`$$STx1.$N(hash, null, dec, null,
// [value, context])`), so the call fires a normal FUNCTION_CALL
// before/after pair for the decorator, with the right frame and
// try/catch behaviour, and no new instruction type is needed. The
// hash points at the original Decorator node, so the event locates
// the `@` in the source.
//
// Limitations (documented, not silent):
//   - No `accessor` fields (the plugin does not parse them).
//   - Class expressions with decorated elements are hoisted into a
//     temp variable before their statement, so a static block in such
//     a class runs at the statement boundary rather than at the exact
//     expression position.
//   - Decorator evaluation order between a static field and an
//     instance element is definition order only when the static field
//     comes first; a static field's decorators always evaluate during
//     class definition, instance elements' after it.
//   - A field with several decorators invokes them in written order
//     for the *calls* only when the field is static (the initializer
//     chain itself always follows the standard order).
//
// Written ES2015-only (no async/await, no for...of, no ?. or ??):
// this file is bundled into the browser build by buble.
// Mark a constructed node (and, for convenience, return it) as
// scaffolding: the patch stages walk it but emit no events for it.
// The decorator expressions and the field's original initial value
// are the exceptions — they stay non-magic so they are traced.
function magic(node) {
  node.magic = true;
  return node;
}

function ident(name) {
  return { type: "Identifier", name: name };
}

function lit(value) {
  return { type: "Literal", value: value };
}

// A magic call to a stage debug link: $$STx1.$N(...args).
function linkCall(patcher, linkName, args) {
  return magic({
    type: "CallExpression",
    callee: magic({
      type: "MemberExpression",
      object: ident(patcher.instance.key),
      property: ident(patcher.instance.getLink(linkName).split(".")[1]),
      computed: false,
    }),
    arguments: args,
  });
}

// Invoke a decorator through DEBUG_FUNCTION_CALL so the call is
// traced like any other call: (hash, ctx=null, decoratorFn,
// call=null, [value, context]). `call === null` makes
// DEBUG_FUNCTION_CALL invoke the function itself (root = object).
// Returns the call node (magic); the decorator expression inside
// stays non-magic so `@factory()` still fires its CALL event.
function applyCall(patcher, hash, decoratorExpr, valueNode, contextNode) {
  return linkCall(patcher, "DEBUG_FUNCTION_CALL", [
    parseExpression(String(hash)),
    parseExpression("null"),
    decoratorExpr,
    parseExpression("null"),
    magic({
      type: "ArrayExpression",
      elements: [valueNode, contextNode],
    }),
  ]);
}

// The `access` object of a decorator context. Public members read
// through the class binding (`CN`); private members read through
// closures created inside the class body (see the static-block
// handling in desugarDecorators — `holder` is a temp holding those
// closures for the private case, null for the public case).
function accessObject(kind, isStatic, isPrivate, className, keyName, holder) {
  function fn(params, body) {
    return magic({
      type: "FunctionExpression",
      id: null,
      params: params.map(function(p) { return ident(p); }),
      body: magic({
        type: "BlockStatement",
        body: [magic({
          type: "ReturnStatement",
          argument: body,
        })],
      }),
    });
  }
  function member(obj, prop) {
    return magic({
      type: "MemberExpression",
      object: obj,
      property: ident(prop),
      computed: false,
    });
  }
  function inCheck(obj) {
    return magic({
      type: "BinaryExpression",
      operator: "in",
      left: isPrivate
        ? { type: "PrivateIdentifier", name: keyName.slice(1) }
        : lit(keyName),
      right: obj,
    });
  }
  let access = { type: "ObjectExpression", properties: [] };
  magic(access);
  function prop(name, valueNode) {
    access.properties.push(magic({
      type: "Property",
      key: ident(name),
      value: valueNode,
      kind: "init",
      computed: false,
      shorthand: false,
      method: false,
    }));
  }
  if (isPrivate) {
    // Holder closures live on the temp object built in the static
    // block: holder.has / holder.get / holder.set. Getters have no
    // set, setters have no get (Babel's _applyDecs access object:
    // getter access = { has, get }, setter access = { has, set }).
    prop("has", fn(isStatic ? [] : ["o"], magic({
      type: "CallExpression",
      callee: member(ident(holder), "has"),
      arguments: isStatic ? [] : [ident("o")],
    })));
    if (kind !== "setter") {
      prop("get", fn(isStatic ? [] : ["o"], magic({
        type: "CallExpression",
        callee: member(ident(holder), "get"),
        arguments: isStatic ? [] : [ident("o")],
      })));
    }
    if (kind === "field" || kind === "setter") {
      prop("set", fn(isStatic ? ["v"] : ["o", "v"], magic({
        type: "CallExpression",
        callee: member(ident(holder), "set"),
        arguments: isStatic ? [ident("v")] : [ident("o"), ident("v")],
      })));
    }
    return access;
  }
  let target = isStatic ? ident(className) : ident("o");
  if (kind === "method" || kind === "getter") {
    if (isStatic) {
      prop("has", fn([], lit(true)));
      prop("get", fn([], member(ident(className), keyName)));
    } else {
      prop("has", fn(["o"], inCheck(ident("o"))));
      prop("get", fn(["o"], member(ident("o"), keyName)));
    }
  } else if (kind === "setter") {
    if (isStatic) {
      prop("has", fn([], inCheck(ident(className))));
      prop("set", fn(["v"], magic({
        type: "AssignmentExpression",
        operator: "=",
        left: member(ident(className), keyName),
        right: ident("v"),
      })));
    } else {
      prop("has", fn(["o"], inCheck(ident("o"))));
      prop("set", fn(["o", "v"], magic({
        type: "AssignmentExpression",
        operator: "=",
        left: member(ident("o"), keyName),
        right: ident("v"),
      })));
    }
  } else {
    if (isStatic) {
      prop("has", fn([], inCheck(ident(className))));
      prop("get", fn([], member(ident(className), keyName)));
      prop("set", fn(["v"], magic({
        type: "AssignmentExpression",
        operator: "=",
        left: member(ident(className), keyName),
        right: ident("v"),
      })));
    } else {
      prop("has", fn(["o"], inCheck(ident("o"))));
      prop("get", fn(["o"], member(ident("o"), keyName)));
      prop("set", fn(["o", "v"], magic({
        type: "AssignmentExpression",
        operator: "=",
        left: member(ident("o"), keyName),
        right: ident("v"),
      })));
    }
  }
  return access;
}

// The decorator context object: { kind, name, static, private,
// access, addInitializer }. `addInitializer` pushes into the temp
// array for this class (instance or static); the arrays are run by
// the constructor wrapper / after the class definition.
function contextObject(patcher, opts) {
  let ctx = { type: "ObjectExpression", properties: [] };
  magic(ctx);
  function prop(name, valueNode) {
    ctx.properties.push(magic({
      type: "Property",
      key: ident(name),
      value: valueNode,
      kind: "init",
      computed: false,
      shorthand: false,
      method: false,
    }));
  }
  prop("kind", lit(opts.kind));
  // Computed keys keep their (cloned) expression as the name; the
  // original key node stays on the element and is traced once.
  prop("name", opts.computed ? cloneNode(opts.keyNode) : lit(opts.name));
  prop("static", lit(opts.isStatic));
  prop("private", lit(opts.isPrivate));
  if (opts.kind !== "class") {
    prop("access", accessObject(
      opts.kind, opts.isStatic, opts.isPrivate,
      opts.className, opts.name, opts.holder
    ));
  }
  prop("addInitializer", magic({
    type: "FunctionExpression",
    id: null,
    params: [ident("fn")],
    body: magic({
      type: "BlockStatement",
      body: [magic({
        type: "ExpressionStatement",
        expression: magic({
          type: "CallExpression",
          callee: magic({
            type: "MemberExpression",
            object: ident(opts.initsArray),
            property: ident("push"),
            computed: false,
          }),
          arguments: [ident("fn")],
        }),
      })],
    }),
  }));
  return ctx;
}

// Build the nested apply calls for one element's decorators:
// apply(d1, apply(d2, value, ctx), ctx). Arguments evaluate
// left-to-right, so d1's expression evaluates before d2's, while
// the inner call applies d2 first — written evaluation order and
// reverse application order, both correct.
function nestedApplies(patcher, decorators, valueNode, makeContext) {
  let value = valueNode;
  for (let ii = decorators.length - 1; ii >= 0; --ii) {
    let dec = decorators[ii];
    let hash = nextHash(patcher);
    patcher.nodes[hash] = { hash: hash, node: cloneNode(dec) };
    value = applyCall(patcher, hash, dec.expression, value, makeContext(dec));
  }
  return value;
}

// A magic ExpressionStatement wrapping an expression.
function stmt(expr) {
  return magic({ type: "ExpressionStatement", expression: expr });
}

// Apply decorators with the undefined guard: per the proposal, a
// decorator that returns undefined keeps the original value — so the
// result replaces the value only when it is not undefined. A bare
// `target = apply(...)` would destroy the class/method whenever a
// decorator merely observes and returns nothing (the common logging
// case). Returns { stmts, temp }: stmts assigns temp the guarded
// result (the apply result in appTemp, the original in the alternate
// — cloned, so the value node is not shared three ways).
function guardedApplies(patcher, decorators, valueNode, makeContext, temp) {
  let appTemp = temp();
  let resultTemp = temp();
  let stmts = [
    stmt(magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(appTemp),
      right: nestedApplies(patcher, decorators, valueNode, makeContext),
    })),
    stmt(magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(resultTemp),
      right: magic({
        type: "ConditionalExpression",
        test: magic({
          type: "BinaryExpression",
          operator: "!==",
          left: ident(appTemp),
          right: parseExpression("undefined"),
        }),
        consequent: ident(appTemp),
        alternate: cloneNode(valueNode),
      }),
    })),
  ];
  return { stmts: stmts, temp: resultTemp };
}

let hashCounter = 1000000;
function nextHash(patcher) {
  // uBranchHash() is global across stages; the desugar runs before
  // them, so use a separate high range to avoid collisions.
  hashCounter += 1;
  return hashCounter;
}

// Replace a child node reference inside its parent (used when a
// class expression is hoisted into a temp variable).
function replaceChild(parent, oldNode, newNode) {
  let keys = Object.keys(parent);
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    if (key === "loc" || key === "range") continue;
    let value = parent[key];
    if (value === oldNode) {
      parent[key] = newNode;
      return true;
    }
    if (Array.isArray(value)) {
      for (let jj = 0; jj < value.length; ++jj) {
        if (value[jj] === oldNode) {
          value[jj] = newNode;
          return true;
        }
      }
    }
  }
  return false;
}

// Generic pre-order walk that records, for every node, the chain of
// ancestors (each { node, key, index }) so the desugar can find the
// enclosing statement list for insertions.
function collectDecorated(ast) {
  let found = { classes: [], elements: [] };
  function visit(node, ancestors) {
    if (!node || typeof node.type !== "string") return;
    if (node.decorators && node.decorators.length > 0) {
      if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
        found.classes.push({ node: node, ancestors: ancestors.slice() });
      } else if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
        found.elements.push({ node: node, ancestors: ancestors.slice() });
      }
    }
    let keys = Object.keys(node);
    for (let ii = 0; ii < keys.length; ++ii) {
      let key = keys[ii];
      if (key === "loc" || key === "range" || key === "decorators") continue;
      let value = node[key];
      if (Array.isArray(value)) {
        for (let jj = 0; jj < value.length; ++jj) {
          let child = value[jj];
          if (child && typeof child.type === "string") {
            ancestors.push({ node: node, key: key, index: jj });
            visit(child, ancestors);
            ancestors.pop();
          }
        }
      } else if (value && typeof value.type === "string") {
        ancestors.push({ node: node, key: key, index: -1 });
        visit(value, ancestors);
        ancestors.pop();
      }
    }
  }
  visit(ast, []);
  return found;
}

// For a collected node, find the enclosing statement: the nearest
// ancestor that is a Program or BlockStatement, and the child of it
// on the chain (the statement). Returns { body, index, statement }.
function enclosingStatement(entry) {
  let ancestors = entry.ancestors;
  for (let ii = ancestors.length - 1; ii >= 0; --ii) {
    let parent = ancestors[ii].node;
    if (parent.type === "Program" || parent.type === "BlockStatement") {
      let child = ii + 1 < ancestors.length ? ancestors[ii + 1].node : entry.node;
      let body = parent.body;
      for (let jj = 0; jj < body.length; ++jj) {
        if (body[jj] === child) {
          return { body: body, index: jj, statement: child };
        }
      }
    }
  }
  return null;
}

function elementKeyName(el) {
  if (el.key.type === "PrivateIdentifier") return "#" + el.key.name;
  if (el.key.type === "Identifier") return el.key.name;
  if (el.key.type === "Literal") return String(el.key.value);
  return null; // computed — the name is the key expression
}

// Desugar all decorators in the AST. Runs in Stage.patch after
// parsing, before the other patch stages.
function desugarDecorators(ast, patcher) {
  let found = collectDecorated(ast);
  if (found.classes.length === 0 && found.elements.length === 0) return;

  let temps = [];
  function temp() {
    let name = reserveTempVarId();
    temps.push(name);
    return name;
  }

  // One magic `var t1, t2, ...;` at the top of the program for every
  // temp the desugar allocates (no initializers, so nothing to trace).
  function declareTemps() {
    if (temps.length === 0) return;
    ast.body.unshift(magic({
      type: "VariableDeclaration",
      kind: "var",
      declarations: temps.map(function(name) {
        return magic({ type: "VariableDeclarator", id: ident(name), init: null });
      }),
    }));
  }

  // Statements to insert, grouped by body array: { body, index,
  // stmts } — applied in reverse index order at the end so earlier
  // insertions do not shift later ones.
  let inserts = [];
  function insertAfter(body, index, stmts) {
    inserts.push({ body: body, index: index + 1, stmts: stmts });
  }
  function insertBefore(body, index, stmts) {
    inserts.push({ body: body, index: index, stmts: stmts });
  }

  // Classes to process: decorated classes, plus any class that owns
  // decorated elements. A class with only element decorators has no
  // entry in found.classes, but its elements still need desugaring —
  // the loop below is driven by classes, so those owners are added
  // here (nearest class ancestor of each element, in source order).
  let classEntries = found.classes.slice();
  for (let ei = 0; ei < found.elements.length; ++ei) {
    let ancestors = found.elements[ei].ancestors;
    for (let ai = ancestors.length - 1; ai >= 0; --ai) {
      let anc = ancestors[ai].node;
      if (anc.type === "ClassDeclaration" || anc.type === "ClassExpression") {
        let already = false;
        for (let ci = 0; ci < classEntries.length; ++ci) {
          if (classEntries[ci].node === anc) { already = true; break; }
        }
        if (!already) {
          classEntries.push({ node: anc, ancestors: ancestors.slice(0, ai) });
        }
        break;
      }
    }
  }

  // Process every decorated class. Elements are processed as part
  // of their class (in definition order); the class itself is
  // processed last for that class, so element applies run first.
  for (let ci = 0; ci < classEntries.length; ++ci) {
    let entry = classEntries[ci];
    let cls = entry.node;
    // An anonymous default export (`export default class {}`) has no
    // binding to reassign, so it takes the class-expression path
    // (hoist into a temp) even though its node type is a declaration.
    let isDeclaration = cls.type === "ClassDeclaration" && !!cls.id;
    let className = cls.id ? cls.id.name : null;

    // The name the applies use for the class value, and the
    // statement the applies follow. For a declaration it is the
    // class binding; for an expression the class is hoisted into a
    // temp before its statement.
    let valueName = className;
    let enc = enclosingStatement(entry);
    if (!enc) continue; // unreachable in practice (top-level class)
    let afterBody = enc.body;
    let afterIndex = enc.index;
    // The hoist statement for a class expression, if any. It is NOT
    // inserted here: the applies and the hoist must land in one
    // insert (hoist first), because two inserts at the same index
    // would apply in the wrong order. See the insert at the end of
    // this loop iteration.
    let hoistStmt = null;

    if (!isDeclaration) {
      // Hoist the expression into a temp before its statement.
      let tmp = temp();
      valueName = tmp;
      let parentEntry = entry.ancestors[entry.ancestors.length - 1];
      let parent = parentEntry ? parentEntry.node : null;
      // The expression itself becomes the temp's initializer; the
      // original position gets the temp identifier. For a variable
      // declarator the init is replaced by the nested class applies
      // (below); for other positions the temp is used directly and
      // the applies follow as statements.
      let isVarInit = parent && parent.type === "VariableDeclarator" && parent.init === cls;
      // NOT magic: STAGE1 returns early for magic VariableDeclarations
      // without walking them, so a magic hoist would leave the class
      // inside untraced (its methods would never get STAGE1's call /
      // return wrapping, and STAGE6 would then crash on their id-less
      // function expressions). As ordinary code the hoist fires VAR
      // events for the temp — noise, but the class is fully traced.
      hoistStmt = {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [{
          type: "VariableDeclarator",
          id: ident(tmp),
          init: cls,
        }],
      };
      replaceChild(parent, cls, ident(tmp));
      // From here on the class is the temp; element applies target
      // it, class applies reassign it (declarator case) or are
      // statements after the hoist (other positions).
      cls.__irohValueName = tmp;
      cls.__irohVarInit = isVarInit;
      cls.__irohParent = parent;
    }

    // Collect this class's decorated elements, in definition order.
    let elements = [];
    for (let ei = 0; ei < found.elements.length; ++ei) {
      let el = found.elements[ei];
      // An element belongs to this class if the class is among its
      // ancestors.
      let ancestors = el.ancestors;
      let belongs = false;
      for (let ai = 0; ai < ancestors.length; ++ai) {
        if (ancestors[ai].node === cls) { belongs = true; break; }
      }
      if (belongs) elements.push(el.node);
    }

    // Per-class temp arrays for addInitializer callbacks.
    let initsInst = temp();
    let initsStatic = temp();
    let hasInstanceDecorators = false;
    for (let ei = 0; ei < elements.length; ++ei) {
      if (!elements[ei].static) { hasInstanceDecorators = true; break; }
    }

    // Wrap the constructor (or add one) so instance initializers
    // run at the end of construction, after field initializers.
    if (hasInstanceDecorators) {
      wrapConstructor(cls, initsInst);
    }

    let applyStmts = [];
    let classNameForCtx = valueName;

    for (let ei = 0; ei < elements.length; ++ei) {
      let el = elements[ei];
      let isStatic = !!el.static;
      let isPrivate = el.key.type === "PrivateIdentifier";
      let isMethod = el.type === "MethodDefinition";
      // The proposal's kinds: method, getter, setter, field.
      let kind = isMethod
        ? (el.kind === "get" ? "getter" : el.kind === "set" ? "setter" : "method")
        : "field";
      let keyName = elementKeyName(el);
      let computed = keyName === null;
      let initsArray = isStatic ? initsStatic : initsInst;

      // Decorators can't be used with a constructor (Babel: "Decorators
      // can't be used with a constructor. Did you mean '@dec class
      // { ... }'?").
      if (isMethod && el.kind === "constructor") {
        throw new Error("Decorators can't be used with a constructor. Did you mean '@dec class { ... }'?");
      }

      // Private members need their `access` closures built inside
      // the class body (a static block), where `#m` is legal.
      let holder = null;
      if (isPrivate) {
        holder = temp();
        if (isMethod) {
          // A decorated private method cannot be read back off the
          // prototype — `C.prototype.#m` throws "Receiver must be an
          // instance" — so, following Babel's 2023-11 desugar, the
          // method becomes a private FIELD holding the decorated
          // function. The decorator applies once, in a static block
          // at class definition; each instance's field then holds the
          // same function. Private getters/setters keep their shape,
          // but their bodies delegate to the decorated function
          // (also Babel's pattern: `return _call_x(this)`).
          let fnTemp = temp();
          let block = buildPrivateBlock(
            patcher, el, kind, isStatic, keyName, holder, fnTemp,
            initsArray, classNameForCtx, temp
          );
          // Before the element: static initializers run in
          // definition order, so fnTemp must exist before the
          // converted field's initializer reads it.
          cls.body.body.splice(cls.body.body.indexOf(el), 0, block);
          if (kind === "method") {
            el.type = "PropertyDefinition";
            el.value = ident(fnTemp);
            delete el.kind;
          } else {
            // getter/setter: delegate to the decorated function.
            let originalFn = el.value;
            let delegateArgs = [parseExpression("this")];
            if (kind === "setter" && originalFn.params.length > 0) {
              delegateArgs.push(cloneNode(originalFn.params[0]));
            }
            el.value = magic({
              type: "FunctionExpression",
              id: null,
              params: originalFn.params,
              body: magic({
                type: "BlockStatement",
                body: [magic({
                  type: "ReturnStatement",
                  argument: magic({
                    type: "CallExpression",
                    callee: magic({
                      type: "MemberExpression",
                      object: ident(fnTemp),
                      property: ident("call"),
                      computed: false,
                    }),
                    arguments: delegateArgs,
                  }),
                })],
              }),
            });
          }
          continue;
        }
        // Private field: the holder (access closures) is built in
        // the static block; the field apply (initializer temp)
        // happens below like the public case. The block goes before
        // the field so the holder exists before a static field's
        // initializer (which runs the decorators inline) reads it.
        let block = buildPrivateBlock(
          patcher, el, kind, isStatic, keyName, holder, null,
          initsArray, classNameForCtx, temp
        );
        cls.body.body.splice(cls.body.body.indexOf(el), 0, block);
      }

      let makeContext = (function(elCopy, kindCopy, isStaticCopy, isPrivateCopy, keyNameCopy, computedCopy, initsArrayCopy, holderCopy) {
        return function(dec) {
          return contextObject(patcher, {
            kind: kindCopy,
            name: keyNameCopy,
            computed: computedCopy,
            keyNode: elCopy.key,
            isStatic: isStaticCopy,
            isPrivate: isPrivateCopy,
            className: classNameForCtx,
            holder: holderCopy,
            initsArray: initsArrayCopy,
          });
        };
      })(el, kind, isStatic, isPrivate, keyName, computed, initsArray, holder);

      if (isMethod) {
        // target: C.prototype.m / C.m / tmp.prototype.m / tmp.m
        let targetObj;
        if (isStatic) {
          targetObj = ident(valueName);
        } else {
          targetObj = magic({
            type: "MemberExpression",
            object: ident(valueName),
            property: ident("prototype"),
            computed: false,
          });
        }
        let target = magic({
          type: "MemberExpression",
          object: targetObj,
          property: computed ? cloneNode(el.key) : ident(keyName),
          computed: computed,
        });
        let valueNode = target;
        let descProp = null;
        if (el.kind === "get" || el.kind === "set") {
          // Reading an accessor through the target would INVOKE it
          // (C.prototype.x calls the getter). The decorator must
          // receive the getter/setter function itself, so read it
          // off the property descriptor instead.
          descProp = el.kind === "get" ? "get" : "set";
          valueNode = magic({
            type: "MemberExpression",
            object: magic({
              type: "CallExpression",
              callee: magic({
                type: "MemberExpression",
                object: ident("Object"),
                property: ident("getOwnPropertyDescriptor"),
                computed: false,
              }),
              arguments: [cloneNode(targetObj), computed ? cloneNode(el.key) : lit(keyName)],
            }),
            property: ident(descProp),
            computed: false,
          });
        }
        // A decorator returning undefined keeps the original method.
        let guarded = guardedApplies(patcher, el.decorators, valueNode, makeContext, temp);
        for (let si = 0; si < guarded.stmts.length; ++si) {
          applyStmts.push(guarded.stmts[si]);
        }
        if (descProp !== null) {
          // Accessors are replaced via Object.defineProperty:
          // assigning the function as a plain property would
          // destroy the accessor.
          applyStmts.push(stmt(magic({
            type: "CallExpression",
            callee: magic({
              type: "MemberExpression",
              object: ident("Object"),
              property: ident("defineProperty"),
              computed: false,
            }),
            arguments: [
              targetObj,
              computed ? cloneNode(el.key) : lit(keyName),
              magic({
                type: "ObjectExpression",
                properties: [
                  magic({ type: "Property", key: ident(descProp), value: ident(guarded.temp), kind: "init", computed: false, shorthand: false, method: false }),
                  magic({ type: "Property", key: ident("configurable"), value: lit(true), kind: "init", computed: false, shorthand: false, method: false }),
                  magic({ type: "Property", key: ident("enumerable"), value: lit(false), kind: "init", computed: false, shorthand: false, method: false }),
                ],
              }),
            ],
          })));
        } else {
          applyStmts.push(stmt(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: target,
            right: ident(guarded.temp),
          })));
        }
      } else {
        // Field: the decorators produce initializer temps; the
        // field's own initializer is rewritten to run them.
        // applyFieldDecorators returns { temps, assignStmt } — temps
        // in written order (d1 first).
        let inits = applyFieldDecorators(
          patcher, el.decorators, makeContext, temp
        );
        let temps = inits.temps;
        // The field value runs them innermost-first (d2's init,
        // then d1's) via nested conditionals.
        let value = el.value ? el.value : parseExpression("undefined");
        for (let ii = temps.length - 1; ii >= 0; --ii) {
          value = fieldInitValue(patcher, temps[ii], value);
        }
        if (isStatic) {
          // Static field initializers run during class definition,
          // before any statement after the class — so the applies
          // happen inline, as the first item of a sequence in the
          // field's own initializer. The sequence needs the
          // assignment EXPRESSION, not the ExpressionStatement
          // (a statement inside a sequence is a syntax error).
          let seq = magic({
            type: "SequenceExpression",
            expressions: [inits.assignStmt.expression, value],
          });
          el.value = seq;
        } else {
          el.value = value;
          applyStmts.push(inits.assignStmt);
        }
      }
    }

    // Class decorators apply last, after all element applies.
    if (cls.decorators && cls.decorators.length > 0) {
      let makeClassContext = function(dec) {
        return contextObject(patcher, {
          kind: "class",
          name: className,
          computed: false,
          keyNode: null,
          isStatic: false,
          isPrivate: false,
          className: classNameForCtx,
          holder: null,
          initsArray: initsStatic,
        });
      };
      if (isDeclaration) {
        // A decorator returning undefined keeps the original class.
        let guarded = guardedApplies(
          patcher, cls.decorators, ident(valueName), makeClassContext, temp
        );
        for (let si = 0; si < guarded.stmts.length; ++si) {
          applyStmts.push(guarded.stmts[si]);
        }
        applyStmts.push(stmt(magic({
          type: "AssignmentExpression",
          operator: "=",
          left: ident(valueName),
          right: ident(guarded.temp),
        })));
      } else if (cls.__irohVarInit) {
        // Variable declarator: the guarded applies run in the
        // combined insert (before the statement, after the hoist),
        // and the init becomes the guarded result (const-safe: no
        // reassignment of the binding).
        let parent = cls.__irohParent;
        let guarded = guardedApplies(
          patcher, cls.decorators, ident(valueName), makeClassContext, temp
        );
        for (let si = 0; si < guarded.stmts.length; ++si) {
          applyStmts.push(guarded.stmts[si]);
        }
        parent.init = ident(guarded.temp);
      } else {
        let guarded = guardedApplies(
          patcher, cls.decorators, ident(valueName), makeClassContext, temp
        );
        for (let si = 0; si < guarded.stmts.length; ++si) {
          applyStmts.push(guarded.stmts[si]);
        }
        applyStmts.push(stmt(magic({
          type: "AssignmentExpression",
          operator: "=",
          left: ident(valueName),
          right: ident(guarded.temp),
        })));
      }
    }

    // The addInitializer arrays start as empty arrays. The temps are
    // declared (as `var`, no init) at the top of the program, so they
    // are undefined until this runs. They must be initialized BEFORE
    // the class evaluates: a static field decorator runs during
    // class definition (its initializer is inline), and it may call
    // addInitializer — which pushes into one of these arrays. (For
    // a declaration the applies run after the class, so initializing
    // them there would be too late.)
    let initStmts = [
      stmt(magic({
        type: "AssignmentExpression",
        operator: "=",
        left: ident(initsStatic),
        right: magic({ type: "ArrayExpression", elements: [] }),
      })),
      stmt(magic({
        type: "AssignmentExpression",
        operator: "=",
        left: ident(initsInst),
        right: magic({ type: "ArrayExpression", elements: [] }),
      })),
    ];

    // Run static addInitializer callbacks after the class is
    // defined (element applies included). Static initializers run
    // with `this` = the class, like the field initializers above —
    // so the callback is fn.call(Class), not fn().
    let staticInitsStmt = stmt(magic({
      type: "CallExpression",
      callee: magic({
        type: "MemberExpression",
        object: ident(initsStatic),
        property: ident("forEach"),
        computed: false,
      }),
      arguments: [magic({
        type: "ArrowFunctionExpression",
        id: null,
        params: [ident("fn")],
        body: {
          type: "CallExpression",
          callee: magic({
            type: "MemberExpression",
            object: ident("fn"),
            property: ident("call"),
            computed: false,
          }),
          arguments: [ident(valueName)],
        },
      })],
    }));
    if (!isDeclaration && cls.__irohVarInit) {
      // Variable declarator: the class decorators run in the
      // declarator's init — the enclosing statement itself — so the
      // static initializers must run after that statement. Otherwise
      // initializers registered by a class decorator would never run
      // (the forEach in applyStmts runs before the statement).
      insertAfter(afterBody, afterIndex, [staticInitsStmt]);
    } else {
      applyStmts.push(staticInitsStmt);
    }

    if (applyStmts.length > 0 || hoistStmt !== null) {
      if (!isDeclaration) {
        // Hoisted expression: the inits, the hoist and the applies
        // go in ONE insert before the enclosing statement, in this
        // order: inits, hoist, element applies, class applies,
        // static initializers. (For a variable declarator the class
        // decorators are folded into the declarator's init instead,
        // so they run last, after the element applies in this
        // insert.) Two inserts at the same index would land in the
        // wrong order.
        insertBefore(afterBody, afterIndex, initStmts.concat([hoistStmt], applyStmts));
      } else {
        // Declaration: the inits go before the class (a static field
        // decorator runs during class definition and may call
        // addInitializer); the applies run after it.
        insertBefore(afterBody, afterIndex, initStmts);
        insertAfter(afterBody, afterIndex, applyStmts);
      }
    }

    // Clear the decorators arrays so later stages never see them.
    cls.decorators = [];
    for (let ei = 0; ei < elements.length; ++ei) {
      elements[ei].decorators = [];
    }
  }

  // Apply the collected insertions (reverse index order per body).
  inserts.sort(function(a, b) { return b.index - a.index; });
  for (let ii = 0; ii < inserts.length; ++ii) {
    let ins = inserts[ii];
    let args = [ins.index, 0].concat(ins.stmts);
    Array.prototype.splice.apply(ins.body, args);
  }

  declareTemps();
}

// Compute one field decorator's initializer temp: a statement that
// assigns the temp the decorator's return (an initializer function
// or undefined). For several decorators the assignments nest so the
// calls happen in reverse (application) order while the expressions
// evaluate in written order — see nestedApplies. Returns
// { temps, assignStmt } — temps in written order, assignStmt a
// single magic ExpressionStatement performing all the assignments.
function applyFieldDecorators(patcher, decorators, makeContext, temp) {
  let temps = [];
  for (let ii = 0; ii < decorators.length; ++ii) temps.push(temp());
  // Build the nested assignment: __t0 = apply(d1, (__t1 =
  // apply(d2, undefined, ctx), undefined), ctx). The inner
  // assignment runs first (d2 applied first); d1's expression
  // evaluates first (outer call's first argument).
  let value = parseExpression("undefined");
  for (let ii = decorators.length - 1; ii >= 0; --ii) {
    let dec = decorators[ii];
    let hash = nextHash(patcher);
    patcher.nodes[hash] = { hash: hash, node: cloneNode(dec) };
    let ctx = makeContext(dec);
    if (ii === decorators.length - 1) {
      value = applyCall(patcher, hash, dec.expression, value, ctx);
    } else {
      value = applyCall(patcher, hash, dec.expression, magic({
        type: "SequenceExpression",
        expressions: [magic({
          type: "AssignmentExpression",
          operator: "=",
          left: ident(temps[ii + 1]),
          right: value,
        }), parseExpression("undefined")],
      }), ctx);
    }
  }
  let assignStmt = magic({
    type: "ExpressionStatement",
    expression: magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(temps[0]),
      right: value,
    }),
  });
  return { temps: temps, assignStmt: assignStmt };
}

// Rewrite a field's initial value to run one initializer:
//   init ? init.call(this, value) : value
// The conditional is non-magic (so the original value stays
// traced); the initializer invocation reuses DEBUG_FUNCTION_CALL
// with call="call", so it fires a FUNCTION_CALL event named "call".
function fieldInitValue(patcher, initTemp, value) {
  let hash = nextHash(patcher);
  patcher.nodes[hash] = { hash: hash, node: { type: "Decorator", expression: null } };
  let callInit = linkCall(patcher, "DEBUG_FUNCTION_CALL", [
    parseExpression(String(hash)),
    parseExpression("null"),
    ident(initTemp),
    lit("call"),
    magic({
      type: "ArrayExpression",
      elements: [parseExpression("this"), value],
    }),
  ]);
  return {
    type: "ConditionalExpression",
    test: ident(initTemp),
    consequent: callInit,
    alternate: value,
  };
}

// Append (or add) a constructor that runs the instance
// initializers at the end of construction.
function wrapConstructor(cls, initsArray) {
  let body = cls.body.body;
  let ctor = null;
  for (let ii = 0; ii < body.length; ++ii) {
    let el = body[ii];
    if (el.type === "MethodDefinition" && el.kind === "constructor") {
      ctor = el;
      break;
    }
  }
  let runStmt = magic({
    type: "ExpressionStatement",
    expression: magic({
      type: "CallExpression",
      callee: magic({
        type: "MemberExpression",
        object: ident(initsArray),
        property: ident("forEach"),
        computed: false,
      }),
      arguments: [magic({
        type: "ArrowFunctionExpression",
        id: null,
        params: [ident("fn")],
        body: {
          type: "CallExpression",
          callee: ident("fn"),
          arguments: [],
        },
      })],
    }),
  });
  // The forEach callback must call fn with the instance as `this`:
  // use an arrow function whose body is fn.call(this). Rebuilt
  // below (the arrow above calls fn() with no this).
  runStmt.expression.arguments[0] = magic({
    type: "ArrowFunctionExpression",
    id: null,
    params: [ident("fn")],
    body: {
      type: "CallExpression",
      callee: magic({
        type: "MemberExpression",
        object: ident("fn"),
        property: ident("call"),
        computed: false,
      }),
      arguments: [parseExpression("this")],
    },
  });
  if (ctor) {
    ctor.value.body.body.push(runStmt);
    return;
  }
  let isDerived = !!cls.superClass;
  let ctorFn = magic({
    type: "FunctionExpression",
    id: null,
    params: isDerived ? [magic({
      type: "RestElement",
      argument: ident("__args"),
    })] : [],
    body: magic({
      type: "BlockStatement",
      body: isDerived ? [magic({
        type: "ExpressionStatement",
        expression: magic({
          type: "CallExpression",
          callee: { type: "Super" },
          arguments: [magic({
            type: "SpreadElement",
            argument: ident("__args"),
          })],
        }),
      }), runStmt] : [runStmt],
    }),
  });
  body.push(magic({
    type: "MethodDefinition",
    key: ident("constructor"),
    value: ctorFn,
    kind: "constructor",
    computed: false,
    static: false,
  }));
}

// Build the static block for a private element. It always creates
// the access holder (closures over #m, legal only inside the class
// body). For methods/getters/setters it also applies the decorators
// ONCE, at class definition: the original function is first moved
// into a temp (origTemp), then fnTemp gets the guarded result (the
// decorator return, or the original when it returns undefined). The
// caller rewrites the element to use fnTemp (a field for methods, a
// delegating body for getters/setters). For fields, fnTemp is null
// and only the holder is built; the field apply happens like the
// public case. The caller must splice this block BEFORE the element
// in the class body: static field initializers run in definition
// order, so the holder/fnTemp must exist before the element's own
// initializer runs.
function buildPrivateBlock(patcher, el, kind, isStatic, keyName, holder, fnTemp, initsArray, className, temp) {
  let stmts = [];
  // var __holder = { has, get, set } — closures over #m.
  function accFn(params, expr) {
    return magic({
      type: "FunctionExpression",
      id: null,
      params: params.map(function(p) { return ident(p); }),
      body: magic({
        type: "BlockStatement",
        body: [magic({
          type: "ReturnStatement",
          argument: expr,
        })],
      }),
    });
  }
  function privMember(obj) {
    return magic({
      type: "MemberExpression",
      object: obj,
      property: { type: "PrivateIdentifier", name: keyName.slice(1) },
      computed: false,
    });
  }
  let accessProps = [];
  function accProp(name, valueNode) {
    accessProps.push(magic({
      type: "Property",
      key: ident(name),
      value: valueNode,
      kind: "init",
      computed: false,
      shorthand: false,
      method: false,
    }));
  }
  if (isStatic) {
    // `this` in the static block is the class; capture it for the
    // closures (a nested function's `this` would not be the class).
    // The class BINDING must not be used here: for a hoisted class
    // expression (`var tmp = class {...}`) the binding is not
    // assigned yet while the class body evaluates, so it would read
    // undefined. `this` is the class in both cases.
    let clsTmp = temp();
    stmts.push(stmt(magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(clsTmp),
      right: parseExpression("this"),
    })));
    accProp("has", accFn([], magic({
      type: "BinaryExpression",
      operator: "in",
      left: { type: "PrivateIdentifier", name: keyName.slice(1) },
      right: ident(clsTmp),
    })));
    if (kind !== "setter") {
      accProp("get", accFn([], privMember(ident(clsTmp))));
    }
    if (kind === "field" || kind === "setter") {
      accProp("set", accFn(["v"], magic({
        type: "AssignmentExpression",
        operator: "=",
        left: privMember(ident(clsTmp)),
        right: ident("v"),
      })));
    }
  } else {
    accProp("has", accFn(["o"], magic({
      type: "BinaryExpression",
      operator: "in",
      left: { type: "PrivateIdentifier", name: keyName.slice(1) },
      right: ident("o"),
    })));
    if (kind !== "setter") {
      accProp("get", accFn(["o"], privMember(ident("o"))));
    }
    if (kind === "field" || kind === "setter") {
      accProp("set", accFn(["o", "v"], magic({
        type: "AssignmentExpression",
        operator: "=",
        left: privMember(ident("o")),
        right: ident("v"),
      })));
    }
  }
  let accessObj = magic({ type: "ObjectExpression", properties: accessProps });
  stmts.push(magic({
    type: "ExpressionStatement",
    expression: magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(holder),
      right: accessObj,
    }),
  }));

  if (kind === "method" || kind === "getter" || kind === "setter") {
    // The original function moves into origTemp (evaluated once),
    // the decorators apply to it, and fnTemp gets the guarded
    // result. A decorator returning undefined keeps the original.
    let origTemp = temp();
    stmts.push(stmt(magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(origTemp),
      right: el.value,
    })));
    let makeContext = function(dec) {
      return contextObject(patcher, {
        kind: kind,
        name: keyName,
        computed: false,
        keyNode: el.key,
        isStatic: isStatic,
        isPrivate: true,
        className: className,
        holder: holder,
        initsArray: initsArray,
      });
    };
    let guarded = guardedApplies(
      patcher, el.decorators, ident(origTemp), makeContext, temp
    );
    for (let si = 0; si < guarded.stmts.length; ++si) {
      stmts.push(guarded.stmts[si]);
    }
    stmts.push(stmt(magic({
      type: "AssignmentExpression",
      operator: "=",
      left: ident(fnTemp),
      right: ident(guarded.temp),
    })));
  }

  return magic({
    type: "StaticBlock",
    body: stmts,
  });
}

class RuntimeEvent {
  constructor(type, instance) {
    this.type = type;
    this.category = getCategoryFromInstruction(type);
    // base properties
    this.hash = -1;
    this.indent = -1;
    this.node = null;
    this.location = null;
    this.instance = instance;
    // TODO
    // turn all events into seperate classes
    // so we can save a lot memory
  }
  trigger(trigger) {
    // trigger all attached listeners
    this.instance.triggerListeners(this, trigger);
  }
  getASTNode() {
    let node = this.instance.nodes[this.hash].node;
    return node;
  }
  getPosition() {
    let node = this.getASTNode();
    return {
      end: node.end,
      start: node.start
    };
  }
  getLocation() {
    let node = this.getASTNode();
    return node.loc;
  }
  getSource() {
    let loc = this.getPosition();
    let input = this.instance.input;
    let output = input.substr(loc.start, loc.end - loc.start);
    return output;
  }
}

class RuntimeListenerEvent {
  constructor(type, callback) {
    this.type = type;
    this.callback = callback;
  }
}

class RuntimeListener {
  constructor(category) {
    this.category = category;
    this.triggers = {};
  }
  on(type, callback) {
    let event = new RuntimeListenerEvent(type, callback);
    // not registered yet
    if (this.triggers[type] === void 0) {
      this.triggers[type] = [];
    }
    this.triggers[type].push(event);
    // allow stream calls
    return this;
  }
  trigger(event, trigger) {
    // any triggers registered?
    if (!this.triggers.hasOwnProperty(trigger)) return;
    let triggers = this.triggers[trigger];
    for (let ii = 0; ii < triggers.length; ++ii) {
      triggers[ii].callback(event);
    }
  }
}

function evalUnaryExpression(op, ctx, a) {
  switch (op) {
    case OP["+"]:      return +a;
    case OP["-"]:      return -a;
    case OP["!"]:      return !a;
    case OP["~"]:      return ~a;
    case OP["void"]:   return void a;
    case OP["typeof"]: return typeof a;
    // handled outside
    case OP["delete"]: return a;
    default:
      throw new Error(`Invalid operator ${op}`);
    break;
  }
}

function evalBinaryExpression(op, a, b) {
  switch (op) {
    case OP["+"]:          return a + b;
    case OP["-"]:          return a - b;
    case OP["*"]:          return a * b;
    case OP["/"]:          return a / b;
    case OP["%"]:          return a % b;
    case OP["**"]:         return a ** b;
    case OP["<<"]:         return a << b;
    case OP[">>"]:         return a >> b;
    case OP[">>>"]:        return a >>> b;
    case OP["&"]:          return a & b;
    case OP["^"]:          return a ^ b;
    case OP["|"]:          return a | b;
    case OP["in"]:         return a in b;
    case OP["=="]:         return a == b;
    case OP["==="]:        return a === b;
    case OP["!="]:         return a != b;
    case OP["!=="]:        return a !== b;
    case OP[">"]:          return a > b;
    case OP[">="]:         return a >= b;
    case OP["<"]:          return a < b;
    case OP["<="]:         return a <= b;
    case OP["instanceof"]: return a instanceof b;
    default:
      throw new Error(`Invalid operator ${op}`);
    break;
  }
}

function evalObjectAssignmentExpression(op, obj, prop, value) {
  switch (op) {
    case OP["="]:   return obj[prop] =    value;
    case OP["+"]:   return obj[prop] +=   value;
    case OP["-"]:   return obj[prop] -=   value;
    case OP["*"]:   return obj[prop] *=   value;
    case OP["/"]:   return obj[prop] /=   value;
    case OP["%"]:   return obj[prop] %=   value;
    case OP["**"]:  return obj[prop] **=  value;
    case OP["<<"]:  return obj[prop] <<=  value;
    case OP[">>"]:  return obj[prop] >>=  value;
    case OP[">>>"]: return obj[prop] >>>= value;
    case OP["&"]:   return obj[prop] &=   value;
    case OP["^"]:   return obj[prop] ^=   value;
    case OP["|"]:   return obj[prop] |=   value;
    // Logical assignment (ES2021). Written out longhand: the patcher
    // strips `||=` to `||` before calling here, and the right-hand value
    // was already evaluated by the caller, so these only decide whether
    // to store it. (Identifier assignments, `x ||= y`, are handled by
    // the native operator in the outer assignment instead.)
    case OP["||"]:
      if (obj[prop]) return obj[prop];
      return obj[prop] = value;
    case OP["&&"]:
      if (obj[prop]) return obj[prop] = value;
      return obj[prop];
    case OP["??"]:
      if (obj[prop] !== null && obj[prop] !== void 0) return obj[prop];
      return obj[prop] = value;
    default:
      throw new Error(`Invalid operator ${op}`);
    break;
  }
}

// #IF
function DEBUG_IF_TEST(hash, value) {
  // API
  let event = this.createEvent(INSTR.IF_TEST);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("test");
  // API END
  return event.value;
}
function DEBUG_IF_ENTER(hash, value) {
  //console.log(indentString(this.indent) + "if");
  // FRAME
  let frame = this.pushFrame(INSTR.IF_ENTER, hash);
  frame.values = [hash, value];
  // FRAME END
  // API
  let event = this.createEvent(INSTR.IF_ENTER);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("enter");
  // API END
  this.indent += INDENT_FACTOR;
}
function DEBUG_IF_LEAVE(hash) {
  this.indent -= INDENT_FACTOR;
  // API
  let event = this.createEvent(INSTR.IF_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("leave");
  // API END
  //console.log(indentString(this.indent) + "if end");
  // FRAME
  this.popFrame();
  // FRAME END
}

// #ELSE
function DEBUG_ELSE_ENTER(hash) {
  // API
  let event = this.createEvent(INSTR.ELSE_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("enter");
  // API END
  //console.log(indentString(this.indent) + "else");
  // FRAME
  let frame = this.pushFrame(INSTR.ELSE_ENTER, hash);
  frame.values = [hash];
  // FRAME END
  this.indent += INDENT_FACTOR;
}
function DEBUG_ELSE_LEAVE(hash) {
  this.indent -= INDENT_FACTOR;
  // API
  let event = this.createEvent(INSTR.ELSE_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("leave");
  // API END
  //console.log(indentString(this.indent) + "else end");
  // FRAME
  this.popFrame();
  // FRAME END
}

// #LOOPS
function DEBUG_LOOP_TEST(hash, value, kind) {
  // API
  let event = this.createEvent(INSTR.LOOP_TEST);
  event.hash = hash;
  event.indent = this.indent;
  event.value = value;
  event.kind = kind;
  event.trigger("test");
  // API END
  return event.value;
}
function DEBUG_LOOP_ENTER(hash, id, kind) {
  // API
  let event = this.createEvent(INSTR.LOOP_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.kind = kind;
  event.trigger("enter");
  // API END
  //console.log(indentString(this.indent) + "loop", hash);
  // FRAME
  let frame = this.pushFrame(INSTR.LOOP_ENTER, hash);
  frame.values = [hash, 1];
  // FRAME END
  this.indent += INDENT_FACTOR;
}
function DEBUG_LOOP_LEAVE(hash, entered, kind) {
  // loop never entered, so dont leave it
  if (entered === 0) return;
  this.indent -= INDENT_FACTOR;
  // API
  let event = this.createEvent(INSTR.LOOP_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.kind = kind;
  event.trigger("leave");
  // API END
  //console.log(indentString(this.indent) + "loop end", hash);
  // FRAME
  this.popFrame();
  // FRAME END
}

// #FLOW
function DEBUG_BREAK(hash, label, ctx) {
  // API
  let event = this.createEvent(INSTR.BREAK);
  event.hash = hash;
  event.value = true;
  event.label = label;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  //console.log(indentString(this.indent) + "break", label ? label : "");
  // FRAME
  let expect = this.resolveBreakFrame(this.frame, label);
  this.leaveFrameUntil(expect);
  // FRAME END
  return event.value;
}
function DEBUG_CONTINUE(hash, label, ctx) {
  // API
  let event = this.createEvent(INSTR.CONTINUE);
  event.hash = hash;
  event.value = true;
  event.label = label;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  //console.log(indentString(this.indent) + "continue", label ? label : "");
  // FRAME
  let expect = this.resolveBreakFrame(this.frame, label);
  this.leaveFrameUntil(expect);
  // FRAME END
  return event.value;
}

// # SWITCH
function DEBUG_SWITCH_TEST(hash, value) {
  // API
  let event = this.createEvent(INSTR.SWITCH_TEST);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("test");
  // API END
  return event.value;
}
function DEBUG_SWITCH_ENTER(hash) {
  // API
  let event = this.createEvent(INSTR.SWITCH_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("enter");
  // API END
  //console.log(indentString(this.indent) + "switch");
  // FRAME
  let frame = this.pushFrame(INSTR.SWITCH_ENTER, hash);
  frame.values = [hash];
  // FRAME END
  this.indent += INDENT_FACTOR;
}
function DEBUG_SWITCH_LEAVE(hash) {
  this.indent -= INDENT_FACTOR;
  // API
  let event = this.createEvent(INSTR.SWITCH_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("leave");
  // API END
  //console.log(indentString(this.indent) + "switch end");
  // FRAME
  this.popFrame();
  // FRAME END
}

// #CASE
function DEBUG_CASE_TEST(hash, value) {
  // API
  let event = this.createEvent(INSTR.CASE_TEST);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("test");
  // API END
  return event.value;
}
function DEBUG_CASE_ENTER(hash, value, isDefault) {
  // API
  let event = this.createEvent(INSTR.CASE_ENTER);
  event.hash = hash;
  event.value = value;
  event.default = isDefault;
  event.indent = this.indent;
  event.trigger("enter");
  // API END
  //console.log(indentString(this.indent) + (isDefault ? "default" : "case"));
  // FRAME
  let frame = this.pushFrame(INSTR.CASE_ENTER, hash);
  frame.values = [hash, value, isDefault];
  this.frame.isSwitchDefault = isDefault;
  // FRAME END
  this.indent += INDENT_FACTOR;
}
function DEBUG_CASE_LEAVE(hash) {
  this.indent -= INDENT_FACTOR;
  let isDefault = this.resolveCaseFrame(this.frame).isSwitchDefault;
  // API
  let event = this.createEvent(INSTR.CASE_LEAVE);
  event.hash = hash;
  event.isDefault = isDefault;
  event.indent = this.indent;
  event.trigger("leave");
  // API END
  //console.log(indentString(this.indent) + (isDefault ? "default" : "case") + " end");
  // FRAME
  this.popFrame();
  // FRAME END
}

// #CALL
function DEBUG_FUNCTION_CALL(hash, ctx, object, call, args) {
  // Optional call (`?.()`): if the object is nullish, or the method
  // does not exist, the call never happens and the value is undefined —
  // and no CALL event fires for a call that did not happen. This check
  // must come first: `object[call]` below would throw on null.
  let node = this.nodes[hash].node;
  if (node.optional) {
    if (object === null || object === void 0) return void 0;
    if (call !== null && (object[call] === null || object[call] === void 0)) return void 0;
    if (call === null && (object === null || object === void 0)) return void 0;
  }
  let callee = (typeof call === "function") ? call.name : getCallee(object, call);
  let previous = this.$$frameHash;
  let value = null;
  let root = null;
  let name = null;
  let proto = null;

  // create function
  if (typeof call === "function") {
    // private method call: the caller passed the member expression
    // itself, because `this["reset"]` cannot reach a `#reset` method.
    root = call;
    proto = object;
  } else if (call !== null) {
    root = object[call];
    proto = object;
  } else {
    root = object;
    proto = null;
  }
  name = root.name;

  // external functions are traced as sloppy
  let isSloppy = this.symbols[name] === void 0;

  node.isSloppy = isSloppy;

  // API
  let before = this.createEvent(INSTR.FUNCTION_CALL);
  before.hash = hash;
  before.context = ctx;
  before.object = proto;
  before.callee = call;
  before.name = callee;
  before.call = root;
  before.arguments = args;
  before.external = isSloppy;
  before.indent = this.indent;
  before.trigger("before");
  // API END

  // FRAME
  let frame = this.pushFrame(INSTR.FUNCTION_CALL, hash);
  frame.values = [hash, ctx, before.object, before.callee, before.arguments];
  this.$$frameHash = Math.abs(hash);
  // FRAME END

  this.indent += INDENT_FACTOR; 
  // evaluate function bully protected
  try {
    value = before.call.apply(before.object, before.arguments);
  } catch (e) {
    let tryFrame = this.resolveTryFrame(this.frame, true);
    // error isn't try-catch wrapped
    if (tryFrame === null) {
      this.reset();
      throw e;
    // error is try-catch wrapped
    } else {
      let catchFrame = this.resolveCatchClauseFrame(this.frame, true);
      let finalFrame = this.resolveFinalClauseFrame(this.frame, true);
      // something failed inside the catch frame
      if (catchFrame !== null || finalFrame !== null) {
        this.reset();
        throw e;
      }
    }
  }
  this.indent -= INDENT_FACTOR;

  // API
  let after = this.createEvent(INSTR.FUNCTION_CALL_END);
  after.hash = hash;
  after.context = before.context;
  after.object = before.object;
  after.callee = before.callee;
  after.name = callee;
  after.call = root;
  after.arguments = before.arguments;
  after.return = value;
  after.external = isSloppy;
  after.indent = this.indent;
  after.trigger("after");
  // API END

  // FRAME
  this.popFrame();
  this.$$frameHash = previous;
  // FRAME END

  return after.return;
}

// #FUNCTION
function DEBUG_FUNCTION_ENTER(hash, ctx, scope, args) {
  this.previousScope = this.currentScope;
  this.currentScope = scope;
  // function sloppy since called with invalid call hash
  let isSloppy = (
    (this.$$frameHash <= 0) ||
    this.nodes[this.$$frameHash].node.isSloppy
  );

  // API
  let event = this.createEvent(INSTR.FUNCTION_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.scope = scope;
  event.sloppy = isSloppy;
  event.arguments = args;
  event.name = this.nodes[hash].node.id.name;
  event.trigger("enter");
  // API END

  if (isSloppy) {
    //console.log(indentString(this.indent) + "call", name, "#sloppy", "(", args, ")");
    this.indent += INDENT_FACTOR;
  }
}
function DEBUG_FUNCTION_LEAVE(hash, ctx) {
  this.currentScope = this.previousScope;
  let isSloppy = (this.$$frameHash <= 0) || this.nodes[this.$$frameHash].node.isSloppy;

  // API
  let event = this.createEvent(INSTR.FUNCTION_LEAVE);
  event.hash = hash;
  event.indent = this.indent - (isSloppy ? INDENT_FACTOR : 0);
  event.sloppy = isSloppy;
  event.name = this.nodes[hash].node.id.name;
  event.trigger("leave");
  // API END

  if (isSloppy) {
    this.indent -= INDENT_FACTOR;
    //console.log(indentString(this.indent) + "call", name, "end #sloppy", "->", [void 0]);
  }
}
function DEBUG_FUNCTION_RETURN(hash, name, value) {

  let isSloppy = (this.$$frameHash <= 0) || this.nodes[this.$$frameHash].node.isSloppy;

  // API
  let event = this.createEvent(INSTR.FUNCTION_RETURN);
  event.hash = hash;
  event.name = name;
  event.return = value;
  event.indent = this.indent - (isSloppy ? INDENT_FACTOR : 0);
  event.sloppy = isSloppy;
  event.trigger("return");
  // API END

  // FRAME
  let expect = this.resolveReturnFrame(this.frame);
  this.leaveFrameUntil(expect);
  // FRAME END
  this.currentScope = this.previousScope;

  if (isSloppy) {
    this.indent -= INDENT_FACTOR;
    //console.log(indentString(this.indent) + "call", name, "end #sloppy", "->", [value]);
  }
  return event.return;
}

// # AWAIT
function DEBUG_AWAIT(hash, value) {
  // An async function suspends at `await` and its continuation resumes
  // later, after other code has run and moved the shared frame stack on.
  // Save the stack state now and restore it in the promise handlers,
  // which run before the async continuation — otherwise the continuation's
  // RETURN / TRY_LEAVE handlers resolve frames against the wrong stack
  // and throw "Unexpected frame type FUNCTION_CALL".
  // Limitation: this restores the pointer to the saved frames, it does
  // not snapshot them. Code that runs while suspended and pops frames
  // below the saved point (e.g. an outer function returning) can still
  // leave the restored chain stale. Async tracing is best-effort.
  let stage = this;
  let frame = this.frame;
  let frameHash = this.$$frameHash;
  let indent = this.indent;
  let currentScope = this.currentScope;
  let previousScope = this.previousScope;

  // API
  let event = this.createEvent(INSTR.AWAIT);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("fire");
  // API END

  function restore(v) {
    stage.frame = frame;
    stage.$$frameHash = frameHash;
    stage.indent = indent;
    stage.currentScope = currentScope;
    stage.previousScope = previousScope;
    return v;
  }
  return Promise.resolve(value).then(
    function (v) { return restore(v); },
    function (e) { restore(void 0); throw e; }
  );
}

// # DECLS
function DEBUG_VAR_DECLARE(hash, name) {
  //console.log(indentString(this.indent) + "▶️ Declare " + name);

  // API
  let event = this.createEvent(INSTR.VAR_DECLARE);
  event.hash = hash;
  event.name = name;
  event.indent = this.indent;
  event.trigger("before");
  // API END

  return name;
}
function DEBUG_VAR_INIT(hash, name, value) {
  //console.log(indentString(this.indent) + "⏩ Initialise " + name + "::" + value);

  // API
  let event = this.createEvent(INSTR.VAR_INIT);
  event.hash = hash;
  event.name = name;
  event.value = value;
  event.indent = this.indent;
  event.trigger("after");
  // API END

  return event.value;
}

// #NEW
function DEBUG_OP_NEW(hash, ctor, args) {

  // API
  let event = this.createEvent(INSTR.OP_NEW);
  event.hash = hash;
  event.ctor = ctor;
  event.name = ctor.name || ctor.constructor.name;
  event.arguments = args;
  event.indent = this.indent;
  event.trigger("before");
  // API END

  //console.log(indentString(this.indent) + "new " + ctor.name);

  this.indent += INDENT_FACTOR;

  // FRAME
  let frame = this.pushFrame(INSTR.OP_NEW, hash);
  frame.values = [hash, event.ctor, event.arguments];
  // FRAME END

  return new event.ctor(...event.arguments);
}
function DEBUG_OP_NEW_END(hash, self, ret) {
  self.indent -= INDENT_FACTOR;

  // FRAME
  self.popFrame();
  // FRAME END

  // API
  let event = self.createEvent(INSTR.OP_NEW_END);
  event.hash = hash;
  event.return = ret;
  event.indent = self.indent;
  event.trigger("after");
  // API END

  //console.log(indentString(self.indent) + "new end");

  return event.return;
}

// #SUPER
function DEBUG_SUPER(cls, args) {
  // API TODO
  return args;
}
// method enter not available before super
// super_fix is injected after super
function DEBUG_SUPER_FIX(ctx) {
  // API TODO
}

// # CLASS METHOD
function DEBUG_METHOD_ENTER(hash, cls, isConstructor, args) {
  // API TODO
  // (Silenced: these console.logs printed "method"/"ctor" to the user's
  // stdout on every class method call. Every other debug trace in this
  // file is already commented out; these two were the only ones left live.)
  this.indent += INDENT_FACTOR;
  let frame = this.pushFrame(INSTR.METHOD_ENTER, hash);
  frame.values = [hash, cls, isConstructor, args];
}
function DEBUG_METHOD_LEAVE(hash, cls, isConstructor) {
  // API TODO
  this.indent -= INDENT_FACTOR;
  this.popFrame();
}

// #TRY
function DEBUG_TRY_ENTER(hash) {
  //console.log(indentString(this.indent) + "try");

  // API
  let event = this.createEvent(INSTR.TRY_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("enter");
  // API END

  this.indent += INDENT_FACTOR;
  // FRAME
  let frame = this.pushFrame(INSTR.TRY_ENTER, hash);
  frame.values = [hash];
  // FRAME END
}
function DEBUG_TRY_LEAVE(hash) {

  // FRAME
  // fix up missing left frames until try_leave
  // e.g. a call inside try, but never finished because it failed
  if (this.frame.type !== INSTR.TRY_ENTER) {
    let expect = this.resolveTryFrame(this.frame);
    this.leaveFrameUntil(expect);
  }
  this.popFrame();
  // FRAME END

  this.indent -= INDENT_FACTOR;

  // API
  let event = this.createEvent(INSTR.TRY_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("leave");
  // API END

  //console.log(indentString(this.indent) + "try end");
}

// #CATCH
function DEBUG_CATCH_ENTER(hash) {

  // API
  let event = this.createEvent(INSTR.CATCH_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("enter");
  // API END

  this.indent += INDENT_FACTOR;
  // FRAME
  let frame = this.pushFrame(INSTR.CATCH_ENTER, hash);
  frame.values = [hash];
  // FRAME END
}
function DEBUG_CATCH_LEAVE(hash) {
  this.indent -= INDENT_FACTOR;

  // API
  let event = this.createEvent(INSTR.CATCH_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("leave");
  // API END

  this.popFrame();
  // FRAME END
}

// #FINALLY
function DEBUG_FINAL_ENTER(hash) {

  // API
  let event = this.createEvent(INSTR.FINAL_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("enter");
  // API END

  this.indent += INDENT_FACTOR;
  // FRAME
  let frame = this.pushFrame(INSTR.FINAL_ENTER, hash);
  frame.values = [hash];
  // FRAME END
}
function DEBUG_FINAL_LEAVE(hash) {
  this.indent -= INDENT_FACTOR;

  // API
  let event = this.createEvent(INSTR.FINAL_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("leave");
  // API END

  this.popFrame();
  // FRAME END
}

// #ALLOC
function DEBUG_ALLOC(hash, value) {
  //console.log(indentString(this.indent) + "#Allocated", value);

  // API
  let event = this.createEvent(INSTR.ALLOC);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("fire");
  // API END

  return event.value;
}

// #MEMBER
function DEBUG_MEMBER_EXPR(hash, object, property) {
  //console.log(indentString(this.indent), object, "[" + property + "]");

  // API
  let event = this.createEvent(INSTR.MEMBER_EXPR);
  event.hash = hash;
  event.object = object;
  event.property = property;
  event.indent = this.indent;
  event.trigger("fire");
  // API END

  return event.object;
}

// fix for lazy blocks
function DEBUG_BLOCK_ENTER(hash) {
  let frame = this.pushFrame(INSTR.BLOCK_ENTER, hash);
  frame.values = [hash];
}
function DEBUG_BLOCK_LEAVE(hash) {
  this.popFrame();
}

// #THIS
function DEBUG_THIS(hash, ctx) {
  // API
  let event = this.createEvent(INSTR.THIS);
  event.hash = hash;
  event.context = ctx;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.context;
}

// #LITERAL
function DEBUG_LITERAL(hash, value) {
  // API
  let event = this.createEvent(INSTR.LITERAL);
  event.hash = hash;
  event.value = value;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.value;
}

// #EXPRESSIONS
function DEBUG_ASSIGN(hash, op, obj, prop, value) {
  let result = null;
  // API: add before, after
  if (prop === null) {
    if (op === OP["="]) result = value;
    else result = value;
  } else {
    result = evalObjectAssignmentExpression(op, obj, prop, value);
  }
  // API
  let event = this.createEvent(INSTR.ASSIGN);
  event.op = operatorToString(op) + "=";
  event.hash = hash;
  event.object = obj;
  event.property = prop;
  event.value = value;
  event.result = result;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.result;
}

function DEBUG_TERNARY(hash, test, truthy, falsy) {
  let result = null;
  // API: add before, after
  if (test) result = truthy();
  else result = falsy();
  // API
  let event = this.createEvent(INSTR.TERNARY);
  event.hash = hash;
  event.test = test;
  event.falsy = falsy;
  event.truthy = truthy;
  event.result = result;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.result;
}

function DEBUG_LOGICAL(hash, op, a, b) {
  let result = null;
  // API: add before, after
  switch (op) {
    case OP["&&"]:
      result = a ? b() : a;
    break;
    case OP["||"]:
      result = a ? a : b();
    break;
    case OP["??"]:
      result = (a !== null && a !== void 0) ? a : b();
    break;
  }
  // API
  let event = this.createEvent(INSTR.LOGICAL);
  event.op = operatorToString(op);
  event.hash = hash;
  event.left = a;
  event.right = b;
  event.result = result;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.result;
}

function DEBUG_BINARY(hash, op, a, b) {
  let result = evalBinaryExpression(op, a, b);
  // API
  let event = this.createEvent(INSTR.BINARY);
  event.op = operatorToString(op);
  event.hash = hash;
  event.left = a;
  event.right = b;
  event.result = result;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.result;
}

function DEBUG_UNARY(hash, op, ctx, critical, value) {
  let result = null;
  // typeof argument is not defined
  if (op === OP["typeof"] && critical) {
    result = value;
  } else {
    result = evalUnaryExpression(op, ctx, value);
  }
  // API
  let event = this.createEvent(INSTR.UNARY);
  event.op = operatorToString(op);
  event.hash = hash;
  event.value = value;
  event.result = result;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  //console.log(indentString(this.indent) + operatorToString(op), value, "->", result, critical);
  return event.result;
}

function DEBUG_UPDATE(hash, op, value, prefix) {
  let result = value;
  // API
  let event = this.createEvent(INSTR.UPDATE);
  event.op = operatorToString(op);
  event.result = result;
  event.hash = hash;
  event.prefix = prefix;
  event.indent = this.indent;
  event.trigger("fire");
  // API END
  return event.result;
}

// deprecated
/*
export function DEBUG_LITERAL = function(value) {
  console.log("Literal:", value);
  return value;
};
export function DEBUG_IDENTIFIER = function(id, value) {
  console.log("Identifier:", id, value);
  return value;
};*/

function DEBUG_PROGRAM_ENTER(hash) {
  //console.log(indentString(this.indent) + "Program");
  // API
  let event = this.createEvent(INSTR.PROGRAM_ENTER);
  event.hash = hash;
  event.indent = this.indent;
  event.trigger("enter");
  // API END
  this.indent += INDENT_FACTOR;
}
function DEBUG_PROGRAM_LEAVE(hash, ret) {
  this.indent -= INDENT_FACTOR;
  //console.log(indentString(this.indent) + "Program end ->", ret);
  // API
  let event = this.createEvent(INSTR.PROGRAM_LEAVE);
  event.hash = hash;
  event.indent = this.indent;
  event.return = ret;
  event.trigger("leave");
  // API END
  return event.return;
}
function DEBUG_PROGRAM_FRAME_VALUE(value) {
  //console.log(value);
}


var _debug = Object.freeze({
	DEBUG_IF_TEST: DEBUG_IF_TEST,
	DEBUG_IF_ENTER: DEBUG_IF_ENTER,
	DEBUG_IF_LEAVE: DEBUG_IF_LEAVE,
	DEBUG_ELSE_ENTER: DEBUG_ELSE_ENTER,
	DEBUG_ELSE_LEAVE: DEBUG_ELSE_LEAVE,
	DEBUG_LOOP_TEST: DEBUG_LOOP_TEST,
	DEBUG_LOOP_ENTER: DEBUG_LOOP_ENTER,
	DEBUG_LOOP_LEAVE: DEBUG_LOOP_LEAVE,
	DEBUG_BREAK: DEBUG_BREAK,
	DEBUG_CONTINUE: DEBUG_CONTINUE,
	DEBUG_SWITCH_TEST: DEBUG_SWITCH_TEST,
	DEBUG_SWITCH_ENTER: DEBUG_SWITCH_ENTER,
	DEBUG_SWITCH_LEAVE: DEBUG_SWITCH_LEAVE,
	DEBUG_CASE_TEST: DEBUG_CASE_TEST,
	DEBUG_CASE_ENTER: DEBUG_CASE_ENTER,
	DEBUG_CASE_LEAVE: DEBUG_CASE_LEAVE,
	DEBUG_FUNCTION_CALL: DEBUG_FUNCTION_CALL,
	DEBUG_FUNCTION_ENTER: DEBUG_FUNCTION_ENTER,
	DEBUG_FUNCTION_LEAVE: DEBUG_FUNCTION_LEAVE,
	DEBUG_FUNCTION_RETURN: DEBUG_FUNCTION_RETURN,
	DEBUG_AWAIT: DEBUG_AWAIT,
	DEBUG_VAR_DECLARE: DEBUG_VAR_DECLARE,
	DEBUG_VAR_INIT: DEBUG_VAR_INIT,
	DEBUG_OP_NEW: DEBUG_OP_NEW,
	DEBUG_OP_NEW_END: DEBUG_OP_NEW_END,
	DEBUG_SUPER: DEBUG_SUPER,
	DEBUG_SUPER_FIX: DEBUG_SUPER_FIX,
	DEBUG_METHOD_ENTER: DEBUG_METHOD_ENTER,
	DEBUG_METHOD_LEAVE: DEBUG_METHOD_LEAVE,
	DEBUG_TRY_ENTER: DEBUG_TRY_ENTER,
	DEBUG_TRY_LEAVE: DEBUG_TRY_LEAVE,
	DEBUG_CATCH_ENTER: DEBUG_CATCH_ENTER,
	DEBUG_CATCH_LEAVE: DEBUG_CATCH_LEAVE,
	DEBUG_FINAL_ENTER: DEBUG_FINAL_ENTER,
	DEBUG_FINAL_LEAVE: DEBUG_FINAL_LEAVE,
	DEBUG_ALLOC: DEBUG_ALLOC,
	DEBUG_MEMBER_EXPR: DEBUG_MEMBER_EXPR,
	DEBUG_BLOCK_ENTER: DEBUG_BLOCK_ENTER,
	DEBUG_BLOCK_LEAVE: DEBUG_BLOCK_LEAVE,
	DEBUG_THIS: DEBUG_THIS,
	DEBUG_LITERAL: DEBUG_LITERAL,
	DEBUG_ASSIGN: DEBUG_ASSIGN,
	DEBUG_TERNARY: DEBUG_TERNARY,
	DEBUG_LOGICAL: DEBUG_LOGICAL,
	DEBUG_BINARY: DEBUG_BINARY,
	DEBUG_UNARY: DEBUG_UNARY,
	DEBUG_UPDATE: DEBUG_UPDATE,
	DEBUG_PROGRAM_ENTER: DEBUG_PROGRAM_ENTER,
	DEBUG_PROGRAM_LEAVE: DEBUG_PROGRAM_LEAVE,
	DEBUG_PROGRAM_FRAME_VALUE: DEBUG_PROGRAM_FRAME_VALUE
});

class Stage {
  constructor(input, opt = {}) {
    // validate
    if (typeof input !== "string") {
      throw new Error(`Expected input type string, but got ${typeof input}`);
    }
    this.input = input;
    // unique session key
    this.key = `$$STx${uid()}`;
    this.links = {};
    this.nodes = null;
    this.symbols = null;
    // Parser options, honoured by patch(): ecmaVersion (default "latest")
    // and allowHashBang (default true). Previously the constructor took
    // `opt` and silently dropped it.
    this.options = opt || {};
    this.indent = 0;
    this.frame = null;
    this.$$frameHash = 0;
    this.currentScope = null;
    this.previousScope = null;
    this.listeners = {};
    this.generateLinks();
    this.generateListeners();
    this.script = this.patch(input);
  }
}

extend(Stage, _debug);

Stage.prototype.reset = function() {
  this.indent = 0;
};

Stage.prototype.triggerListeners = function(event, trigger) {
  let type = event.type;
  let category = event.category;
  // invalid listener
  if (!this.listeners.hasOwnProperty(category)) {
    console.error(`Unexpected trigger category ${category}`);
    return;
  }
  let listeners = this.listeners[category];
  // no listeners are attached
  if (listeners.length <= 0) return;
  for (let ii = 0; ii < listeners.length; ++ii) {
    let listener = listeners[ii];
    listener.trigger(event, trigger);
  }
};

Stage.prototype.createEvent = function(type) {
  let event = new RuntimeEvent(type, this);
  return event;
};

Stage.prototype.addListener = function(category) {
  // validate
  if (!this.listeners.hasOwnProperty(category)) {
    console.error(`Unexpected listener category`);
    return null;
  }
  let listener = new RuntimeListener(category);
  this.listeners[category].push(listener);
  return listener;
};

Stage.prototype.generateListeners = function() {
  for (let key in CATEGORY) {
    let bit = CATEGORY[key];
    this.listeners[bit] = [];
  }
};

Stage.prototype.generateLinks = function() {
  let ihdx = 0;
  for (let callee in INSTR) {
    if (!INSTR.hasOwnProperty(callee)) continue;
    let name = "$DEBUG_" + callee;
    let key = DEBUG_KEY + ihdx++;
    this.links[name] = {
      // link function, escape dollar sign
      fn: this[name.substr(1, name.length)],
      key
    };
    if (CLEAN_DEBUG_INJECTION) {
      this[name] = this.links[name].fn;
    } else {
      this[key] = this.links[name].fn;
    }
  }
};

Stage.prototype.getLink = function(name) {
  name = "$" + name;
  if (CLEAN_DEBUG_INJECTION) {
    return `${this.key}.${name}`;
  }
  let key = this.links[name].key;
  return `${this.key}.${key}`;
};

Stage.prototype.getLinkCall = function(name) {
  return this.getLink(name) + "()";
};

Stage.prototype.getFunctionNodeByName = function(name) {
  return (
    this.symbols[name] || null
  );
};

Stage.prototype.getInverseInstruction = function(frame) {
  let type = frame.type;
  let links = this.links;
  switch (type) {
    case INSTR.FUNCTION_ENTER: return links.$DEBUG_FUNCTION_LEAVE.fn;
    case INSTR.IF_ENTER:       return links.$DEBUG_IF_LEAVE.fn;
    case INSTR.ELSE_ENTER:     return links.$DEBUG_ELSE_LEAVE.fn;
    case INSTR.LOOP_ENTER:     return links.$DEBUG_LOOP_LEAVE.fn;
    case INSTR.SWITCH_ENTER:   return links.$DEBUG_SWITCH_LEAVE.fn;
    case INSTR.CASE_ENTER:     return links.$DEBUG_CASE_LEAVE.fn;
    case INSTR.METHOD_ENTER:   return links.$DEBUG_METHOD_LEAVE.fn;
    case INSTR.OP_NEW:         return links.$DEBUG_OP_NEW_END.fn;
    case INSTR.TRY_ENTER:      return links.$DEBUG_TRY_LEAVE.fn;
    case INSTR.CATCH_ENTER:    return links.$DEBUG_CATCH_LEAVE.fn;
    case INSTR.FINAL_ENTER:    return links.$DEBUG_FINAL_LEAVE.fn;
    case INSTR.BLOCK_ENTER:    return links.$DEBUG_BLOCK_LEAVE.fn;
    default:
      throw new Error(`Unexpected frame type ${frame.cleanType}`);
    break;
  }
  return null;
};

Stage.prototype.manuallyLeaveFrame = function(frame) {
  console.assert(isValidFrameInstruction(frame));
  let args = frame.values;
  //console.log("Manually leaving", frame.cleanType);
  let inverse = this.getInverseInstruction(frame);
  inverse.apply(this, args);
};

Stage.prototype.leaveFrameUntil = function(target) {
  while (true) {
    if (this.frame.equals(target)) break;
    this.manuallyLeaveFrame(this.frame);
  }
};

Stage.prototype.leaveFrameUntilHash = function(hash) {
  while (true) {
    if (this.frame.hash === hash) break;
    this.manuallyLeaveFrame(this.frame);
  }
};

Stage.prototype.pushFrame = function(type, hash) {
  let parent = this.frame;
  let frame = new Frame(type, hash);
  frame.parent = parent;
  frame.node = this.nodes[hash].node;
  frame.location = frame.node.loc;
  this.frame = frame;
  return frame;
};

Stage.prototype.popFrame = function() {
  // out of bounds check
  console.assert(this.frame !== null);
  this.frame = this.frame.parent;
};

Stage.prototype.resolveBreakFrame = function(frm, label) {
  let frame = frm;
  while (true) {
    // TODO: isContinuable stable?
    if (frame.isBreakable || frame.isContinuable) {
      if (label !== null) {
        let node = this.nodes[frame.hash].node;
        if (
          node.labels !== void 0 &&
          node.labels.indexOf(label) > -1
        ) break;
      } else {
        break;
      }
    } else if (label !== null) {
      let node = this.nodes[frame.hash].node;
      if (
        node.labels !== void 0 &&
        node.labels.indexOf(label) > -1
      ) break;
    }
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  console.assert(
    isBreakableFrameType(frame.type)
  );
  return frame;
};

Stage.prototype.resolveReturnFrame = function(frm) {
  let frame = frm;
  while (true) {
    // break on instantiation calls
    if (frame.isInstantiation) break;
    // break on function call frames
    if (frame.isReturnable) break;
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  if (
    !isReturnableFrameType(frame.type) &&
    !isInstantiationFrameType(frame.type)
  ) {
    // only beef if frame hashes doesn't match
    if (frame.hash !== this.$$frameHash) {
      console.error(frame);
    }
  }
  return frame;
};

Stage.prototype.resolveCaseFrame = function(frm) {
  let frame = frm;
  while (true) {
    if (frame.isSwitchCase) break;
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  console.assert(
    frame.type === INSTR.CASE_ENTER
  );
  return frame;
};

Stage.prototype.resolveTryFrame = function(frm, silent) {
  let frame = frm;
  while (true) {
    if (frame.isTryStatement) break;
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  if (silent) return (frame.type === INSTR.TRY_ENTER ? frame : null);
  console.assert(
    frame.type === INSTR.TRY_ENTER
  );
  return frame;
};

Stage.prototype.resolveCatchClauseFrame = function(frm, silent) {
  let frame = frm;
  while (true) {
    if (frame.isCatchClause) break;
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  if (silent) return (frame.type === INSTR.CATCH_ENTER ? frame : null);
  console.assert(
    frame.type === INSTR.CATCH_ENTER
  );
  return frame;
};

Stage.prototype.resolveFinalClauseFrame = function(frm, silent) {
  let frame = frm;
  while (true) {
    if (frame.isFinalClause) break;
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  if (silent) return (frame.type === INSTR.FINAL_ENTER ? frame : null);
  console.assert(
    frame.type === INSTR.FINAL_ENTER
  );
  return frame;
};

Stage.prototype.resolveProgramFrame = function(frm) {
  let frame = frm;
  while (true) {
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  console.assert(
    frame.type === INSTR.PROGRAM
  );
  return frame;
};

Stage.prototype.resolveLeftFrames = function(frm) {
  let frame = frm;
  while (true) {
    // break on instantiation calls
    if (frame.isInstantiation) break;
    // break on function call frames
    if (frame.isReturnable) break;
    // frame is super sloppy (possibly async), break out of everything
    if (frame.isGlobal()) break;
    frame = frame.parent;
  }
  return frame;
};

Stage.prototype.getFrameByHashFrom = function(frm, hash) {
  let frame = frm;
  while (true) {
    if (frame.hash === hash) break;
    if (frame.isGlobal()) return null;
    frame = frame.parent;
  }
  return frame;
};

Stage.prototype.patch = function(input) {
  let patcher = new Patcher(this);
  // Parse at the newest language level Acorn supports ("latest": ES2025
  // RegExp modifiers, `using` declarations, import attributes) plus
  // allowHashBang for #! scripts, unless the Stage was constructed with
  // explicit options. Newer node types without a dedicated patch handler
  // are still walked generically by acorn-walk's base visitors, so they
  // run — they just don't get their own listener yet.
  // sourceType: "script" (default) or "module" — modules allow
  // import/export, import.meta, import attributes and top-level await.
  // allowAwaitOutsideFunction: lets a script carry top-level await
  // (traceAsync() runs it through an async wrapper); without it Acorn
  // rejects the await at parse time, before the runner can help.
  let opt = this.options || {};
  let ast = parse$2(input, {
    locations: true,
    ecmaVersion: opt.ecmaVersion || "latest",
    allowHashBang: opt.allowHashBang !== false,
    sourceType: opt.sourceType || "script",
    allowAwaitOutsideFunction: opt.allowAwaitOutsideFunction === true,
  });
  // Decorators desugar before the patch stages walk: Node cannot
  // execute `@` syntax at all, and astring cannot generate
  // `Decorator` nodes, so `@dec` is rewritten into plain calls
  // (the decorator expressions stay in the tree, non-magic, so they
  // are traced like any other call). The patch stages then walk the
  // rewritten code.
  desugarDecorators(ast, patcher);
  this.frame = new Frame(INSTR.PROGRAM, this.$$frameHash);
  patcher.applyPatches(ast);
  // link walk things to stage
  this.nodes = patcher.nodes;
  this.symbols = patcher.symbols;
  return generate$2(ast, {
    format: {
      indent: {
        style: "  "
      }
    }
  });
};

function setup() {
  this.generateCategoryBits();
  // Expose the label tables on the singleton, so consumers (notably the
  // CLI, which needs to turn event type/category numbers back into
  // names) can read them without the dist bundle changing its export
  // shape — `require("iroh")` still returns this object directly.
  this.INSTR = INSTR;
  this.CATEGORY = CATEGORY;
  this.OP = OP;
  this.VERSION = VERSION;
  // Test assertions, for code running inside a stage. The 2017 fixtures
  // in tests/expressions/ and tests/other/ were written against this API,
  // but it was never implemented — `Iroh.assert` was undefined at runtime.
  // assert() records and returns the result instead of throwing, so one
  // failing check does not hide the rest of the fixture; the harness (or
  // the user) reads Iroh.assertions afterwards. resetAssertions() clears
  // the record, e.g. between fixture runs.
  this.assertions = [];
  this.assert = function(name, condition) {
    let passed = !!condition;
    this.assertions.push({ name: String(name), passed: passed });
    return passed;
  };
  this.resetAssertions = function() {
    this.assertions = [];
  };
  // Iroh.log is the fixtures' way to print from inside traced code.
  this.log = function() {
    console.log.apply(console, arguments);
  };
}

function generateCategoryBits() {
  for (let key in CATEGORY) {
    this[key] = CATEGORY[key] | 0;
  }
}

const TRACE_TRIGGERS = ["before", "after", "enter", "leave", "fire", "test", "return"];

function resolveTraceCategories(iroh, events) {
  if (events === void 0 || events === null || events === "ALL") {
    return Object.keys(CATEGORY);
  }
  let names = Array.isArray(events) ? events : String(events).split(",");
  names = names.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  // Indexed loop, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let name = names[ii];
    if (!(name in CATEGORY) || typeof iroh[name] !== "number") {
      throw new Error("Unknown event category: " + name);
    }
  }
  return names;
}

// Shared core of trace() / traceAsync() / traceModule(): build the
// Stage and attach listeners for the requested categories. Returns
// { stage, events }. A parse error throws before anything runs; the
// two errors users hit most often get a pointer at the right entry
// point instead of Acorn's bare message:
//   - import/export/import.meta in a script -> Iroh.traceModule()
//   - top-level await in Iroh.trace() -> Iroh.traceAsync()
// Acorn reports top-level await as a bare "Unexpected token", so the
// await case is decided by a probe: if the code parses with top-level
// await allowed, the failure was the await.
function createTraceRun(iroh, code, options) {
  options = options || {};
  let names = resolveTraceCategories(iroh, options.events);
  let stage;
  try {
    stage = new iroh.Stage(code, options.stageOptions || {});
  } catch (e) {
    if (e instanceof SyntaxError) {
      let msg = e.message;
      if (
        msg.indexOf("may appear only with 'sourceType: module'") !== -1 ||
        msg.indexOf("outside a module") !== -1
      ) {
        throw new Error(
          "This program uses import/export (or import.meta) — trace it with Iroh.traceModule(); Iroh.trace() and Iroh.traceAsync() run scripts only"
        );
      }
      let stageOptions = options.stageOptions || {};
      if (!stageOptions.allowAwaitOutsideFunction) {
        try {
          parse$2(code, {
            locations: true,
            ecmaVersion: stageOptions.ecmaVersion || "latest",
            allowHashBang: stageOptions.allowHashBang !== false,
            sourceType: stageOptions.sourceType || "script",
            allowAwaitOutsideFunction: true,
          });
          // It parses with top-level await allowed, so the failure
          // was the await.
          throw new Error(
            "This program uses top-level await — run it with Iroh.traceAsync() (or Iroh.traceModule() for modules); Iroh.trace() runs synchronously"
          );
        } catch (probeError) {
          if (probeError.message.indexOf("top-level await") !== -1) {
            throw probeError;
          }
          // The probe failed too: fall through to the original error.
        }
      }
    }
    throw e;
  }
  let events = [];
  let onEvent = options.onEvent;
  // Indexed loops, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let listener = stage.addListener(iroh[names[ii]]);
    for (let jj = 0; jj < TRACE_TRIGGERS.length; ++jj) {
      let trigger = TRACE_TRIGGERS[jj];
      listener.on(trigger, (event) => {
        let line = iroh.eventToJSON(event, trigger);
        events.push(line);
        if (onEvent) onEvent(line);
      });
    }
  }
  return { stage: stage, events: events };
}

// Compile a Stage's generated script into a runnable function. The
// generated script starts with `const $$STx1 = Iroh.stages[...]` —
// it needs an `Iroh` binding in scope that is this instance. eval()
// inside the library has no such binding (the class is named Iroh,
// the instance is not), so run the script through a fresh Function
// with the instance passed in as its `Iroh` parameter. The function
// is strict, matching the eval-based usage, and returns $$frameValue
// — the program's completion value, the same value eval() returns.
//
// Two retries, same try/catch pattern as the old trace():
//   - a program that declares its own top-level `Iroh` collides with
//     the Function parameter ("Identifier 'Iroh' has already been
//     declared"): retry with the instance under `$$Iroh` and the
//     generated header rewritten to match.
//   - top-level `await` is a SyntaxError in a plain Function: when
//     allowAsync, the script is wrapped in an async IIFE instead
//     (`return (async function() { ...; return $$frameValue; })();`).
//     The Iroh-collision retry applies to the wrapper too.
// The header rewrite replaces the FIRST occurrence of `Iroh.stages[`
// — which is the generated header, the first statement of the script
// — via a function, because in a replacement string `$$` means a
// literal `$`.
function compileRunner(iroh, stage, allowAsync) {
  function rewriteHeader(script, name) {
    if (name === "Iroh") return script;
    return script.replace("Iroh.stages[", () => name + ".stages[");
  }
  function syncSource(name) {
    return '"use strict";\n' + rewriteHeader(stage.script, name) + "\n; return $$frameValue;";
  }
  function asyncSource(name) {
    return '"use strict";\nreturn (async function() {\n' + rewriteHeader(stage.script, name) + "\n; return $$frameValue;\n})();";
  }
  // traceAsync() always uses the async wrapper: a top-level `await`
  // is a SyntaxError in a plain Function, and the message V8 gives
  // for it ("missing ) after argument list") does not even mention
  // await, so sniffing the sync failure to decide is unreliable.
  // The wrapper changes nothing observable for ordinary programs:
  // the IIFE returns the program's completion value (adopting a
  // promise if it is one), and traceAsync() awaits it either way.
  // The wrapper always runs under $$Iroh, not Iroh: the generated
  // header sits INSIDE the IIFE, where a user's own top-level
  // `const Iroh` would shadow the wrapper's `Iroh` parameter for
  // the whole IIFE scope — a RUNTIME TDZ error ("Cannot access
  // 'Iroh' before initialization"), not a compile error, so it
  // cannot be caught by retrying on a SyntaxError. (A sync-form
  // probe would only catch it when the Iroh declaration precedes
  // the first await; `await ...; const Iroh = 5;` would still hit
  // the TDZ.) Under $$Iroh the user's own Iroh is untouched. If
  // the user declared $$Iroh itself, fall back to Iroh.
  if (allowAsync) {
    try {
      return new Function("$$Iroh", asyncSource("$$Iroh"));
    } catch (e) {
      if (
        e instanceof SyntaxError &&
        e.message.indexOf("'$$Iroh' has already been declared") !== -1
      ) {
        return new Function("Iroh", asyncSource("Iroh"));
      }
      throw e;
    }
  }
  try {
    return new Function("Iroh", syncSource("Iroh"));
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    let msg = e.message;
    if (msg.indexOf("'Iroh' has already been declared") !== -1) {
      return new Function("$$Iroh", syncSource("$$Iroh"));
    }
    if (msg.indexOf("may appear only with 'sourceType: module'") !== -1) {
      throw new Error(
        "This program uses import/export — trace it with Iroh.traceModule(); Iroh.trace() and Iroh.traceAsync() run scripts only"
      );
    }
    throw e;
  }
}

// One-shot tracing — the modern SDK entry point. Runs `code` through a
// Stage and returns { events, result }: `events` is the list of plain
// event objects (same shape as the CLI's JSON lines — see
// Iroh.eventToJSON), `result` is the program's completion value, live
// (not serialized). Options:
//   events: "ALL" (default), an array of category names (["CALL","IF"]),
//           or a comma string ("CALL,IF").
//   onEvent(event): called for every event as it fires.
//   stageOptions: passed to the Stage (ecmaVersion, allowHashBang,
//           sourceType, allowAwaitOutsideFunction). sourceType
//           "module" is rejected here — use traceModule().
// A parse error throws before running; a runtime error throws with the
// events that fired before it attached as error.events. Top-level
// await and modules are rejected with a pointer at traceAsync() /
// traceModule() instead of a bare SyntaxError.
function trace(code, options) {
  options = options || {};
  if (options.stageOptions && options.stageOptions.sourceType === "module") {
    throw new Error("Iroh.trace() cannot run modules — use Iroh.traceModule()");
  }
  let run = createTraceRun(this, code, options);
  let runner = compileRunner(this, run.stage, false);
  let result;
  try {
    result = runner(this);
  } catch (e) {
    attachTraceEvents(e, run.events);
    throw e;
  }
  return { events: run.events, result: result };
}

// Attach the events that fired before an error to the error itself, so
// the trace of a failed program is not lost. Only objects can carry a
// property — a program may throw a string, a number, or null, and in
// strict mode assigning to a primitive throws, masking the original
// error. Those rethrow unchanged.
function attachTraceEvents(err, events) {
  if (err !== null && (typeof err === "object" || typeof err === "function")) {
    err.events = events;
  }
}

// Async version of trace(): awaits the program's completion value before
// returning, so events from async continuations (await, promises) are
// included — and so top-level `await` in scripts works, via the async
// wrapper in compileRunner. The returned `result` is the awaited value.
// Written as a plain Promise chain (no async/await syntax) because the
// browser bundle is transpiled by buble, which cannot compile async
// functions.
function traceAsync(code, options) {
  options = options || {};
  if (options.stageOptions && options.stageOptions.sourceType === "module") {
    return Promise.reject(new Error("Iroh.traceAsync() cannot run modules — use Iroh.traceModule()"));
  }
  // Top-level await needs allowAwaitOutsideFunction at parse time.
  let stageOptions = Object.assign({}, options.stageOptions, {
    allowAwaitOutsideFunction: true,
  });
  // createTraceRun throws synchronously for module code (and for
  // parse errors) — but traceAsync() returns a promise, so a sync
  // throw would escape assert.rejects and any .catch on the caller.
  // Reject instead.
  let run;
  try {
    run = createTraceRun(this, code, Object.assign({}, options, {
      stageOptions: stageOptions,
    }));
  } catch (e) {
    return Promise.reject(e);
  }
  let runner = compileRunner(this, run.stage, true);
  let result;
  try {
    result = runner(this);
  } catch (e) {
    attachTraceEvents(e, run.events);
    throw e;
  }
  let out = { events: run.events, result: result };
  if (result && typeof result.then === "function") {
    return result.then(
      (value) => {
        out.result = value;
        return out;
      },
      // Like the sync path, an async failure carries the events that
      // fired before it — otherwise the trace of a rejected program is
      // lost entirely.
      (err) => {
        attachTraceEvents(err, out.events);
        throw err;
      }
    );
  }
  return Promise.resolve(out);
}

// Whether this is Node.js. `process.versions.node` is the check — the
// cfg.js IS_NODE flag (module/require) is false in the ESM dist, so it
// cannot be used here. In a browser `process` is undefined.
function isNodeRuntime() {
  return (
    typeof process !== "undefined" &&
    process.versions !== void 0 &&
    process.versions !== null &&
    process.versions.node !== void 0
  );
}

// Dynamic import() without writing `import()` literally in src/:
// buble cannot parse import() syntax, so the import is built through
// new Function at runtime (the string is parsed by the engine, not by
// buble). Used to lazily load node: builtins only when traceModule()
// runs — a static `node:fs` import would break the browser (iife)
// rollup build, which cannot resolve it.
function nodeImport(specifier) {
  return new Function("s", "return import(s);")(specifier);
}

// How many traceModule() calls are in flight, and what
// `globalThis.__irohStages` was before the first of them. The
// generated module reads its stage through that registry (see
// below), and the registry must stay set until every in-flight
// module has been evaluated — so the pre-existing value is snapshotted
// only when the count goes 0 -> 1 (a later concurrent call would
// snapshot our own registry as "previous") and restored only once the
// count hits zero again.
let irohStagesUsers = 0;
let irohStagesHadPrevious = false;
let irohStagesPrevious = void 0;

// One-shot tracing for ES modules. Returns a Promise of { events,
// result }: `events` is the list of plain event objects (same shape
// as trace()), `result` is the module namespace object — every export,
// named and default (as `.default`), live, not serialized.
//
// How it runs: the instrumented code is written to a temp `.mjs` file
// and dynamic-imported — Node 24's vm.SourceTextModule still needs
// --experimental-vm-modules, so it is not used. The generated script's
// header (`const $$STx1 = Iroh.stages[...]`) cannot name an `Iroh`
// binding in a module, so it is rewritten to a `globalThis.__irohStages`
// registry holding the same `Iroh.stages` object the _Stage wrapper
// registers into — instance identity is exact in both the CJS and ESM
// dists, and importing the dist from the generated module (which would
// give a second singleton in one of the two shapes) is avoided.
// Relative imports in the traced code resolve against `options.filename`
// when given (the temp file is written next to it); without it they
// resolve against a fresh temp directory under os.tmpdir() and will
// usually fail. `import.meta.url` in traced code is the temp file's
// URL. The temp file is deleted after the import settles.
//
// Options: events, onEvent, stageOptions (sourceType is forced to
// "module"), filename (base path for relative imports). A parse error
// rejects before running; a runtime error rejects with the events that
// fired before it attached as error.events. Requires Node.js — in a
// browser it rejects with a clear error.
function traceModule(code, options) {
  options = options || {};
  let iroh = this;
  if (!isNodeRuntime()) {
    return Promise.reject(new Error(
      "Iroh.traceModule() requires Node.js — modules run through a temp .mjs file and dynamic import()"
    ));
  }
  let stageOptions = Object.assign({}, options.stageOptions, {
    sourceType: "module",
  });
  let run;
  try {
    run = createTraceRun(iroh, code, Object.assign({}, options, {
      stageOptions: stageOptions,
    }));
  } catch (e) {
    return Promise.reject(e);
  }
  // The header rewrite: first occurrence of `Iroh.stages[` is the
  // generated header, the first statement of the script.
  let script = run.stage.script.replace(
    "Iroh.stages[",
    () => "globalThis.__irohStages["
  );
  return Promise.all([
    nodeImport("node:fs"),
    nodeImport("node:os"),
    nodeImport("node:path"),
    nodeImport("node:url"),
  ]).then(function(mods) {
    let fs = mods[0];
    let os = mods[1];
    let path = mods[2];
    let url = mods[3];
    let dir;
    let ownDir = false;
    if (options.filename) {
      dir = path.dirname(path.resolve(options.filename));
    } else {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "iroh-trace-"));
      ownDir = true;
    }
    let file = path.join(dir, ".iroh-trace-" + run.stage.key + ".mjs");
    fs.writeFileSync(file, script, "utf8");
    // Register the stages object for the generated module's header.
    // Snapshot whatever was there (normally nothing) only when this
    // is the first in-flight call; restore it once no call is in
    // flight any more.
    if (irohStagesUsers === 0) {
      irohStagesHadPrevious = Object.prototype.hasOwnProperty.call(globalThis, "__irohStages");
      irohStagesPrevious = globalThis.__irohStages;
    }
    irohStagesUsers += 1;
    globalThis.__irohStages = iroh.stages;
    function cleanup() {
      irohStagesUsers -= 1;
      if (irohStagesUsers <= 0) {
        irohStagesUsers = 0;
        if (irohStagesHadPrevious) {
          globalThis.__irohStages = irohStagesPrevious;
        } else {
          delete globalThis.__irohStages;
        }
      }
      try {
        fs.unlinkSync(file);
      } catch (e) {
        // Best effort: a missing temp file is not a trace failure.
      }
      if (ownDir) {
        try {
          fs.rmdirSync(dir);
        } catch (e) {
          // Best effort.
        }
      }
    }
    let fileUrl = url.pathToFileURL(file).href;
    return nodeImport(fileUrl).then(
      function(namespace) {
        cleanup();
        return { events: run.events, result: namespace };
      },
      function(err) {
        cleanup();
        attachTraceEvents(err, run.events);
        throw err;
      }
    );
  });
}

function greet() {
  if (
    IS_BROWSER &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().indexOf("chrome") > -1
  ) {
    console.log(`%c ☕ Iroh.js - ${VERSION} `, "background: #2e0801; color: #fff; padding:1px 0;");
  }
}


var _setup = Object.freeze({
	setup: setup,
	generateCategoryBits: generateCategoryBits,
	trace: trace,
	traceAsync: traceAsync,
	traceModule: traceModule,
	greet: greet
});

class Iroh {
  constructor() {
    // patch AST scope
    this.scope = null;
    // patch stage
    this.stage = null;
    // patch state
    this.state = null;
    // stage instance
    this.instance = null;
    // container for all stages
    this.stages = {};
    // enter setup phase
    this.setup();
    // say hello
    this.greet();
  }
}

// link methods to main class
extend(Iroh, _utils);
extend(Iroh, _setup);

const iroh = new Iroh();

// intercept Stage instantiations
let _Stage = function() {
  let stage = new Stage(...arguments);
  // register stage to iroh stages
  // so we can keep track of it
  iroh.stages[stage.key] = stage;
  return stage;
};
_Stage.prototype = Object.create(Stage.prototype);
iroh.Stage = _Stage;

// link to outer space
if (typeof window !== "undefined") {
  window.Iroh = iroh;
}

module.exports = iroh;
