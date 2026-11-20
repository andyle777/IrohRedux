import { generate } from 'astring';
import { Parser, TokenType } from 'acorn';
import { base, full, recursive } from 'acorn-walk';

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

var version = "1.0.1";

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
const atToken = new TokenType("@", { startsExpr: true });

// NOTE: Acorn's `tokTypes` is NOT imported. Rollup cannot see it as a
// named export of acorn's CJS dist (the browser bundle fails with
// "'tokTypes' is not exported by node_modules/acorn/dist/acorn.js"),
// so token types are compared by their stable `.label` strings
// instead: "(" "=" ";" "}" "eof" "[" "]". The `@` token is this
// file's own TokenType, compared by identity.

// The tokens that can follow a complete class-element name: `(` for
// a method, `=` for a field with an initializer, `;` / `}` / `@` for
// a field that ends there (or the next decorated element). Anything
// else after a `]` — an identifier, another `[` — means the bracket
// belonged to the decorator expression (a computed member access),
// and the element's name follows it.
function isElementNameTerminator(type) {
  return (
    type.label === "(" ||
    type.label === "=" ||
    type.label === ";" ||
    type.label === "}" ||
    type === atToken
  );
}

// The token after the token starting at `offset`. Found by
// tokenizing with a throwaway parser — Acorn's token stream is a
// function of the input and options alone, so a fresh parser over
// the same input produces the same tokens as the real one, and no
// tokenizer state has to be saved and restored. Returns the token
// object, or null at end of input.
function tokenAfterOffset(options, input, offset) {
  let probeOptions = Object.assign({}, options, {
    onToken: void 0,
    onComment: void 0,
  });
  let probe = new DecoratorParser(probeOptions, input);
  for (;;) {
    let tok = probe.getToken();
    if (tok.type.label === "eof") return null;
    if (tok.start === offset) {
      let next = probe.getToken();
      return next.type.label === "eof" ? null : next;
    }
  }
}

// True when a token can start a class-element name (mirrors
// Acorn's isClassElementNameStart, by label — see the tokTypes
// note above).
function isNameStartToken(type) {
  return (
    type.label === "name" ||
    type.label === "privateId" ||
    type.label === "num" ||
    type.label === "string" ||
    type.label === "[" ||
    !!type.keyword
  );
}
function tokenAfterBracket(options, input, bracketStart) {
  let probeOptions = Object.assign({}, options, {
    onToken: void 0,
    onComment: void 0,
  });
  let probe = new DecoratorParser(probeOptions, input);
  let depth = 0;
  let started = false;
  for (;;) {
    let tok = probe.getToken();
    if (tok.type.label === "eof") return null;
    if (!started) {
      if (tok.start === bracketStart && tok.type.label === "[") {
        started = true;
        depth = 1;
      }
      continue;
    }
    if (tok.type.label === "[") depth += 1;
    else if (tok.type.label === "]") {
      depth -= 1;
      if (depth === 0) {
        let next = probe.getToken();
        return next.type.label === "eof" ? null : next;
      }
    }
  }
}

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
    // LeftHandSideExpression (identifier, member chain, call, ...).
    // parseExprSubscripts parses an atom plus member/call chains, and
    // stops before binary operators, so `@a + b` is a decorator `@a`
    // followed by `+ b` (a later error), while `@(a + b)` and
    // `@factory()` parse as written. A `[` that begins a computed
    // class-element name is NOT part of the decorator:
    // `@dec [key]` is a decorator `dec` on a computed element, while
    // `@dec[key] m()` is a member decorator on a method `m` — told
    // apart by the token after the matching `]` (see
    // parseDecoratorExpression).
    parseDecorators() {
      let decorators = [];
      while (this.type === atToken) {
        let node = this.startNode();
        this.next();
        node.expression = this.parseDecoratorExpression();
        decorators.push(this.finishNode(node, "Decorator"));
      }
      return decorators;
    }

    // True when the next subscript step would be a `[` that begins a
    // computed class-element name (not a member access on the
    // decorator). Decided by the token after the matching `]`.
    computedElementNameAhead() {
      if (this.type.label !== "[") return false;
      let after = tokenAfterBracket(this.options, this.input, this.start);
      return after !== null && isElementNameTerminator(after.type);
    }

    // A decorator's LeftHandSideExpression, stopping before a `[`
    // that begins a computed class-element name. Mirrors
    // parseExprSubscripts / parseSubscripts, but the subscript loop
    // breaks (leaving the `[` unconsumed, for the element parser)
    // when computedElementNameAhead() says the bracket is the
    // element's name. Everything else — dot members, calls, optional
    // chaining, template tags, async arrows — goes through Acorn's
    // own parseSubscript, so decorator expressions parse exactly as
    // they did before.
    parseDecoratorExpression() {
      let startPos = this.start, startLoc = this.startLoc;
      let expr = this.parseExprAtom(null, false);
      if (expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")") {
        return expr;
      }
      let maybeAsyncArrow = this.options.ecmaVersion >= 8 && expr.type === "Identifier" && expr.name === "async" &&
        this.lastTokEnd === expr.end && !this.canInsertSemicolon() && expr.end - expr.start === 5 &&
        this.potentialArrowAt === expr.start;
      let optionalChained = false;
      for (;;) {
        if (this.computedElementNameAhead()) break;
        let element = this.parseSubscript(expr, startPos, startLoc, false, maybeAsyncArrow, optionalChained, false);
        if (element.optional) optionalChained = true;
        if (element.end === expr.end || element.type === "ArrowFunctionExpression") {
          if (optionalChained) {
            let chainNode = this.startNodeAt(startPos, startLoc);
            chainNode.expression = element;
            element = this.finishNode(chainNode, "ChainExpression");
          }
          return element;
        }
        expr = element;
        maybeAsyncArrow = false;
      }
      if (optionalChained) {
        let chainNode = this.startNodeAt(startPos, startLoc);
        chainNode.expression = expr;
        expr = this.finishNode(chainNode, "ChainExpression");
      }
      return expr;
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

    // `accessor x = 1` — the decorators proposal's accessor field.
    // Acorn has no `accessor` keyword, so it is recognized here, at
    // the element-name position (after `static`, and never after
    // `get`/`set`/`async`/`*`, which Acorn consumes first). It is an
    // accessor field only when a name follows: `accessor()`,
    // `accessor = 1` and `accessor;` are a plain method/field named
    // "accessor" and fall through to Acorn unchanged. The element is
    // marked `__irohAccessor` for the desugar, which rewrites it
    // into a private storage field plus a getter/setter pair.
    parseClassElementName(element) {
      if (this.type.label === "name" && this.value === "accessor") {
        let next = tokenAfterOffset(this.options, this.input, this.start);
        if (next !== null && isNameStartToken(next.type)) {
          this.next();
          element.__irohAccessor = true;
        }
      }
      return super.parseClassElementName(element);
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

const DecoratorParser = Parser.extend(decoratorsPlugin);

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
  return generate.apply(null, arguments);
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
  full(node, function(child) {
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
  return generate.apply(null, arguments);
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
  return recursive(ast, state, visitors, base);
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
//   - Decorators on private accessor fields are not supported yet
//     (a clear error, not a silent drop); public accessor fields
//     work, including computed keys and the {get, set} / {init}
//     decorator returns.
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
function accessObject(kind, isStatic, isPrivate, className, keyName, holder, keyTemp, computed) {
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
      property: computed ? ident(keyTemp) : ident(prop),
      computed: !!computed,
    });
  }
  function inCheck(obj) {
    return magic({
      type: "BinaryExpression",
      operator: "in",
      left: computed
        ? ident(keyTemp)
        : isPrivate
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
    if (kind === "field" || kind === "setter" || kind === "accessor") {
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
  // Computed keys read the key temp (assigned once, in the element's
  // key sequence during class definition) — never the key
  // expression itself, which would re-evaluate it.
  prop("name", opts.computed ? (opts.keyTemp ? ident(opts.keyTemp) : cloneNode(opts.keyNode)) : lit(opts.name));
  prop("static", lit(opts.isStatic));
  prop("private", lit(opts.isPrivate));
  if (opts.kind !== "class") {
    prop("access", accessObject(
      opts.kind, opts.isStatic, opts.isPrivate,
      opts.className, opts.name, opts.holder, opts.keyTemp, opts.computed
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
    } else if (node.__irohAccessor && (node.type === "MethodDefinition" || node.type === "PropertyDefinition")) {
      // An undecorated accessor field has no decorators, but it
      // still needs desugaring — left as-is it would be generated
      // as a plain field, a silent mistranslation.
      node.decorators = [];
      found.elements.push({ node: node, ancestors: ancestors.slice() });
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
    // Only decorated instance elements can register initializers —
    // an undecorated accessor field never calls addInitializer, so
    // it must not force a constructor wrap on its class.
    let hasInstanceDecorators = false;
    for (let ei = 0; ei < elements.length; ++ei) {
      if (!elements[ei].static && elements[ei].decorators && elements[ei].decorators.length > 0) { hasInstanceDecorators = true; break; }
    }

    // Accessor init temps (one per decorated accessor field), to
    // initialize to the identity function before the class
    // evaluates — see the accessor branch below.
    let accessorInitTemps = [];

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
      // The proposal's kinds: method, getter, setter, field,
      // accessor.
      let kind = el.__irohAccessor
        ? "accessor"
        : isMethod
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

      // Computed keys and decorator expressions evaluate once,
      // during class definition (phase 1), in definition order —
      // before static blocks and static field initializers, which
      // run in phase 2. They are evaluated together, as the
      // element's key: the key becomes a sequence that assigns the
      // key expression to a temp (computed keys) or the literal name
      // to a temp (plain keys), then each decorator expression to a
      // temp, and yields the key temp — so the context `name`, the
      // method target and the field applies all read the temp, and
      // nothing re-evaluates. Without this the key expression was
      // cloned into the context `name` and the method target, so it
      // ran once per clone — and instance elements' decorator
      // expressions ran after the class definition, out of order
      // with static fields'. The key sequence runs with the
      // enclosing `this` and the class binding (both available in
      // phase 1), exactly as the proposal requires. Private elements
      // keep their old path (a private key cannot be a computed
      // sequence): their decorator expressions still evaluate in
      // the private static block, in phase 2.
      let keyTemp = null;
      if (!isPrivate && el.decorators.length > 0) {
        keyTemp = temp();
        let seqExprs = [];
        if (computed) {
          seqExprs.push(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: ident(keyTemp),
            right: el.key,
          }));
        } else {
          seqExprs.push(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: ident(keyTemp),
            right: lit(keyName),
          }));
        }
        for (let di = 0; di < el.decorators.length; ++di) {
          let dec = el.decorators[di];
          let decTemp = temp();
          seqExprs.push(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: ident(decTemp),
            right: dec.expression,
          }));
          dec.expression = ident(decTemp);
        }
        seqExprs.push(ident(keyTemp));
        el.key = {
          type: "SequenceExpression",
          expressions: seqExprs,
        };
        el.computed = true;
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

      let makeContext = (function(elCopy, kindCopy, isStaticCopy, isPrivateCopy, keyNameCopy, computedCopy, keyTempCopy, initsArrayCopy, holderCopy) {
        return function(dec) {
          return contextObject(patcher, {
            kind: kindCopy,
            name: keyNameCopy,
            computed: computedCopy,
            keyNode: elCopy.key,
            keyTemp: keyTempCopy,
            isStatic: isStaticCopy,
            isPrivate: isPrivateCopy,
            className: classNameForCtx,
            holder: holderCopy,
            initsArray: initsArrayCopy,
          });
        };
      })(el, kind, isStatic, isPrivate, keyName, computed, keyTemp, initsArray, holder);

      if (el.__irohAccessor) {
      // Accessor field: rewrite into a private storage field plus
      // a getter/setter pair, and (when decorated) apply the
      // decorators to the {get, set} pair. The storage name is
      // derived from the element name where it is a plain
      // identifier, else a fresh temp — it never collides with a
      // user private field (the Iroh$$ prefix is the desugar's
      // own namespace).
      if (isPrivate && el.decorators.length > 0) {
        // A private accessor's get/set cannot be reinstalled with
        // defineProperty (a private name is not a property key),
        // so decorated private accessors need the holder
        // delegation pattern — not built in this pass. Loud, not
        // silent: the program fails with a clear message rather
        // than running with undecorated accessors.
        throw new Error("Decorators on private accessor fields are not supported yet (public accessor fields are).");
      }
      let storageName = (!computed && keyName !== null && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyName))
        ? "Iroh$$acc_" + keyName
        : "Iroh$$acc_" + temp().replace(/^Iroh\$\$/, "");
      // The getter takes the element's key (the key sequence for
      // a decorated public element — it evaluates the key and the
      // decorator expressions once, in phase 1, in definition
      // order); the setter reads the key temp the sequence
      // assigned. For an undecorated element the key is cloned
      // (a plain name has no side effects). A key sequence is
      // always computed (it needs brackets), even for a plain
      // name — without them astring would emit `get (seq)()`,
      // which is a syntax error.
      let getterKey = el.key;
      let setterKey;
      let accComputed;
      if (keyTemp !== null) {
        setterKey = ident(keyTemp);
        accComputed = true;
      } else {
        setterKey = cloneNode(el.key);
        accComputed = computed;
      }
      // The init temp: the composed {init} chain (identity until
      // a decorator returns one). Initialized in initStmts,
      // before the class evaluates.
      let accInitTemp = null;
      let accInitUsed = null;
      let rawInit = el.value ? el.value : parseExpression("undefined");
      let storageValue = rawInit;
      if (el.decorators.length > 0) {
        accInitTemp = temp();
        accInitUsed = temp();
        accessorInitTemps.push({ init: accInitTemp, used: accInitUsed });
        storageValue = magic({
          type: "CallExpression",
          callee: ident(accInitTemp),
          arguments: [rawInit],
        });
      }
      let storageField = magic({
        type: "PropertyDefinition",
        key: { type: "PrivateIdentifier", name: storageName },
        value: storageValue,
        computed: false,
        static: isStatic,
      });
      function accFn(params, bodyStmt) {
        return magic({
          type: "FunctionExpression",
          id: null,
          params: params.map(function(p) { return ident(p); }),
          body: magic({ type: "BlockStatement", body: [bodyStmt] }),
        });
      }
      let getter = magic({
        type: "MethodDefinition",
        kind: "get",
        key: getterKey,
        value: accFn([], magic({
          type: "ReturnStatement",
          argument: magic({
            type: "MemberExpression",
            object: parseExpression("this"),
            property: { type: "PrivateIdentifier", name: storageName },
            computed: false,
          }),
        })),
        computed: accComputed,
        static: isStatic,
      });
      let setter = magic({
        type: "MethodDefinition",
        kind: "set",
        key: setterKey,
        value: accFn(["v"], magic({
          type: "ExpressionStatement",
          expression: magic({
            type: "AssignmentExpression",
            operator: "=",
            left: magic({
              type: "MemberExpression",
              object: parseExpression("this"),
              property: { type: "PrivateIdentifier", name: storageName },
              computed: false,
            }),
            right: ident("v"),
          }),
        })),
        computed: accComputed,
        static: isStatic,
      });
      let elIdx = cls.body.body.indexOf(el);
      cls.body.body.splice(elIdx, 1, storageField, getter, setter);
      if (el.decorators.length > 0) {
        // Apply the decorators to the {get, set} pair, one at a
        // time (in reverse, so the outermost decorator's result
        // is the final pair), merging get/set per decorator and
        // composing any {init} returns into accInitTemp.
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
        let keyArg = computed ? ident(keyTemp) : lit(keyName);
        let descTemp = temp();
        applyStmts.push(stmt(magic({
          type: "AssignmentExpression",
          operator: "=",
          left: ident(descTemp),
          right: magic({
            type: "CallExpression",
            callee: magic({
              type: "MemberExpression",
              object: ident("Object"),
              property: ident("getOwnPropertyDescriptor"),
              computed: false,
            }),
            arguments: [cloneNode(targetObj), cloneNode(keyArg)],
          }),
        })));
        let valueTemp = temp();
        applyStmts.push(stmt(magic({
          type: "AssignmentExpression",
          operator: "=",
          left: ident(valueTemp),
          right: magic({
            type: "ObjectExpression",
            properties: [
              magic({ type: "Property", key: ident("get"), value: magic({ type: "MemberExpression", object: ident(descTemp), property: ident("get"), computed: false }), kind: "init", computed: false, shorthand: false, method: false }),
              magic({ type: "Property", key: ident("set"), value: magic({ type: "MemberExpression", object: ident(descTemp), property: ident("set"), computed: false }), kind: "init", computed: false, shorthand: false, method: false }),
            ],
          }),
        })));
        for (let di = el.decorators.length - 1; di >= 0; --di) {
          let dec = el.decorators[di];
          let hash = nextHash(patcher);
          patcher.nodes[hash] = { hash: hash, node: cloneNode(dec) };
          let resTemp = temp();
          applyStmts.push(stmt(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: ident(resTemp),
            right: applyCall(patcher, hash, dec.expression, ident(valueTemp), makeContext(dec)),
          })));
          // Merge: a decorator returning undefined keeps the
          // pair; a returned {get}/{set} replaces only the
          // property it defines.
          let merged = magic({
            type: "ObjectExpression",
            properties: [
              magic({ type: "Property", key: ident("get"), value: magic({
                type: "ConditionalExpression",
                test: magic({ type: "BinaryExpression", operator: "!==", left: magic({ type: "MemberExpression", object: ident(resTemp), property: ident("get"), computed: false }), right: parseExpression("undefined") }),
                consequent: magic({ type: "MemberExpression", object: ident(resTemp), property: ident("get"), computed: false }),
                alternate: magic({ type: "MemberExpression", object: ident(valueTemp), property: ident("get"), computed: false }),
              }), kind: "init", computed: false, shorthand: false, method: false }),
              magic({ type: "Property", key: ident("set"), value: magic({
                type: "ConditionalExpression",
                test: magic({ type: "BinaryExpression", operator: "!==", left: magic({ type: "MemberExpression", object: ident(resTemp), property: ident("set"), computed: false }), right: parseExpression("undefined") }),
                consequent: magic({ type: "MemberExpression", object: ident(resTemp), property: ident("set"), computed: false }),
                alternate: magic({ type: "MemberExpression", object: ident(valueTemp), property: ident("set"), computed: false }),
              }), kind: "init", computed: false, shorthand: false, method: false }),
            ],
          });
          applyStmts.push(stmt(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: ident(valueTemp),
            right: magic({
              type: "ConditionalExpression",
              test: magic({ type: "BinaryExpression", operator: "!==", left: ident(resTemp), right: parseExpression("undefined") }),
              consequent: merged,
              alternate: ident(valueTemp),
            }),
          })));
          // {init}: compose it onto accInitTemp (outermost last,
          // so the innermost decorator's init runs first — the
          // field semantics) and mark it used.
          let prevInit = temp();
          let initBody = magic({
            type: "BlockStatement",
            body: [magic({
              type: "ReturnStatement",
              argument: magic({
                type: "CallExpression",
                callee: magic({ type: "MemberExpression", object: ident(resTemp), property: ident("init"), computed: false }),
                arguments: [magic({
                  type: "CallExpression",
                  callee: ident(prevInit),
                  arguments: [ident("v")],
                })],
              }),
            })],
          });
          applyStmts.push(magic({
            type: "IfStatement",
            test: magic({
              type: "LogicalExpression",
              operator: "&&",
              left: magic({
                type: "BinaryExpression",
                operator: "!==",
                left: ident(resTemp),
                right: parseExpression("undefined"),
              }),
              right: magic({
                type: "BinaryExpression",
                operator: "===",
                left: magic({
                  type: "UnaryExpression",
                  operator: "typeof",
                  prefix: true,
                  argument: magic({ type: "MemberExpression", object: ident(resTemp), property: ident("init"), computed: false }),
                }),
                right: lit("function"),
              }),
            }),
            consequent: magic({
              type: "BlockStatement",
              body: [
                stmt(magic({
                  type: "AssignmentExpression",
                  operator: "=",
                  left: ident(prevInit),
                  right: ident(accInitTemp),
                })),
                stmt(magic({
                  type: "AssignmentExpression",
                  operator: "=",
                  left: ident(accInitTemp),
                  right: magic({
                    type: "FunctionExpression",
                    id: null,
                    params: [ident("v")],
                    body: initBody,
                  }),
                })),
                stmt(magic({
                  type: "AssignmentExpression",
                  operator: "=",
                  left: ident(accInitUsed),
                  right: lit(true),
                })),
              ],
            }),
            alternate: null,
          }));
        }
        // Install the (possibly replaced) pair.
        applyStmts.push(stmt(magic({
          type: "CallExpression",
          callee: magic({
            type: "MemberExpression",
            object: ident("Object"),
            property: ident("defineProperty"),
            computed: false,
          }),
          arguments: [
            cloneNode(targetObj),
            cloneNode(keyArg),
            magic({
              type: "ObjectExpression",
              properties: [
                magic({ type: "Property", key: ident("get"), value: magic({ type: "MemberExpression", object: ident(valueTemp), property: ident("get"), computed: false }), kind: "init", computed: false, shorthand: false, method: false }),
                magic({ type: "Property", key: ident("set"), value: magic({ type: "MemberExpression", object: ident(valueTemp), property: ident("set"), computed: false }), kind: "init", computed: false, shorthand: false, method: false }),
                magic({ type: "Property", key: ident("configurable"), value: lit(true), kind: "init", computed: false, shorthand: false, method: false }),
                magic({ type: "Property", key: ident("enumerable"), value: lit(false), kind: "init", computed: false, shorthand: false, method: false }),
              ],
            }),
          ],
        })));
        if (isStatic) {
          // A static storage field initializes during class
          // definition, before the applies compose accInitTemp —
          // so if a decorator returned {init}, re-apply the
          // transform through the (now decorated) accessors.
          let readMember = magic({
            type: "MemberExpression",
            object: cloneNode(targetObj),
            property: computed ? ident(keyTemp) : ident(keyName),
            computed: computed,
          });
          applyStmts.push(magic({
            type: "IfStatement",
            test: ident(accInitUsed),
            consequent: magic({
              type: "BlockStatement",
              body: [stmt(magic({
                type: "AssignmentExpression",
                operator: "=",
                left: cloneNode(readMember),
                right: magic({
                  type: "CallExpression",
                  callee: ident(accInitTemp),
                  arguments: [cloneNode(readMember)],
                }),
              }))],
            }),
            alternate: null,
          }));
        }
        }
        continue;
      }

      if (isMethod) {
        // The method target / descriptor key. For a computed key
        // that was rewritten to a sequence, read the temp — cloning
        // the sequence would re-evaluate the key and the decorator
        // expressions. For a plain key, the literal name.
        let targetKey = computed
          ? (keyTemp !== null ? ident(keyTemp) : cloneNode(el.key))
          : ident(keyName);
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
          property: targetKey,
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
              arguments: [cloneNode(targetObj), computed ? cloneNode(targetKey) : lit(keyName)],
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
              computed ? cloneNode(targetKey) : lit(keyName),
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
          // Instance field: the applies run in a static block
          // spliced before the element, so they happen during
          // class definition (phase 2), in definition order
          // interleaved with static field initializers — not after
          // the class, where a static field's decorators would
          // have run first regardless of definition order. The
          // initializer temps are assigned in the block and read
          // by the field's value at construction time.
          el.value = value;
          cls.body.body.splice(cls.body.body.indexOf(el), 0, magic({
            type: "StaticBlock",
            body: [inits.assignStmt],
          }));
        }
      }
    }

    // Class decorator expressions evaluate during class definition,
    // after the elements' decorators — hoist them into temps in a
    // trailing static block, so the applies (after the class) read
    // the temps instead of evaluating the expressions there. One
    // caveat: a class decorator expression that reads `this` sees
    // the class inside a static block, where the proposal gives it
    // the enclosing `this`.
    if (cls.decorators && cls.decorators.length > 0) {
      let classDecStmts = [];
      for (let di = 0; di < cls.decorators.length; ++di) {
        let dec = cls.decorators[di];
        let decTemp = temp();
        classDecStmts.push(stmt(magic({
          type: "AssignmentExpression",
          operator: "=",
          left: ident(decTemp),
          right: dec.expression,
        })));
        dec.expression = ident(decTemp);
      }
      cls.body.body.push(magic({
        type: "StaticBlock",
        body: classDecStmts,
      }));
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
    // Accessor {init} temps start as the identity function (and
    // their "used" flags as false), before the class evaluates: a
    // static accessor's storage field calls the temp during class
    // definition, so it must already be a function by then.
    for (let ai = 0; ai < accessorInitTemps.length; ++ai) {
      initStmts.push(stmt(magic({
        type: "AssignmentExpression",
        operator: "=",
        left: ident(accessorInitTemps[ai].init),
        right: magic({
          type: "FunctionExpression",
          id: null,
          params: [ident("v")],
          body: magic({
            type: "BlockStatement",
            body: [magic({
              type: "ReturnStatement",
              argument: ident("v"),
            })],
          }),
        }),
      })));
      initStmts.push(stmt(magic({
        type: "AssignmentExpression",
        operator: "=",
        left: ident(accessorInitTemps[ai].used),
        right: lit(false),
      })));
    }

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
    if (kind === "field" || kind === "setter" || kind === "accessor") {
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
    if (kind === "field" || kind === "setter" || kind === "accessor") {
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
  // Raw-event hook for the director engine (src/direct.js): the raw
  // event object, its trigger, and the JSON line — called synchronously
  // inside the DEBUG call, after the line is recorded, so mutating the
  // raw event changes the running program.
  let rawOnEvent = options.rawOnEvent;
  // Indexed loops, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let listener = stage.addListener(iroh[names[ii]]);
    for (let jj = 0; jj < TRACE_TRIGGERS.length; ++jj) {
      let trigger = TRACE_TRIGGERS[jj];
      listener.on(trigger, (event) => {
        let line = iroh.eventToJSON(event, trigger);
        events.push(line);
        // The raw hook runs before onEvent: a director mutates the raw
        // event (and, through applyEntry, the line) so downstream
        // consumers — onEvent, the live analyzer, the recorded events —
        // all see the directed value, the value the program actually
        // ran with.
        if (rawOnEvent) rawOnEvent(event, trigger, line);
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

// Internal run machinery, shared with the director engine
// (src/direct.js): createTraceRun builds a Stage and attaches the event
// listeners, compileRunner turns a Stage's generated script into a
// runnable function, importTracedModule runs an instrumented module
// through a temp .mjs file and dynamic import, attachTraceEvents puts
// the events so far on a thrown error. Exported as one plain object —
// not as functions — so extend() in src/index.js, which only copies
// functions, does not put them on the Iroh singleton.
const runInternals = { createTraceRun, compileRunner, importTracedModule, attachTraceEvents };

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

// The import half of traceModule(), shared with directModule():
// write the instrumented module to a temp .mjs file and dynamic-
// import it, with the globalThis.__irohStages registry the generated
// module reads its stage through. Returns a Promise of { events,
// result } (result = the module namespace). Requires Node.js — in a
// browser it rejects with a clear error. `run` is a createTraceRun
// result; `options.filename` bases relative imports, as in
// traceModule().
function importTracedModule(iroh, run, options) {
  options = options || {};
  if (!isNodeRuntime()) {
    return Promise.reject(new Error(
      "Modules require Node.js — they run through a temp .mjs file and dynamic import()"
    ));
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
  return importTracedModule(iroh, run, options);
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
	runInternals: runInternals,
	traceAsync: traceAsync,
	traceModule: traceModule,
	greet: greet
});

// Tiny neuron layer for IrohRedux 0.8.0 — a single perceptron over
// trace-window features, pure JavaScript, no dependencies.
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

const FEATURE_NAMES = ["calls", "depth", "repeat", "imbalance", "mix"];

// Frozen weights from the offline training run (200 synthetic samples,
// converged at epoch 1, 200/200 train, 100/100 held-out).
const DEFAULT_WEIGHTS = [0.1218, 0.1037, 0.1217, -0.0253, 0.0328];
const DEFAULT_BIAS = -0.1;

// Extract the five features from a trace's events array (the plain
// objects Iroh.trace() returns). An empty trace is all zeros.
function extractFeatures(events) {
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
function createPerceptron(weights, bias) {
  let w = (weights || DEFAULT_WEIGHTS).slice();
  let b = bias === void 0 ? DEFAULT_BIAS : bias;
  function predict(features) {
    let x = Array.isArray(features) ? features : featuresToArray(features);
    let score = b;
    for (let jj = 0; jj < 5; ++jj) score += w[jj] * (x[jj] || 0);
    // Round the score for stable, readable output.
    score = Math.round(score * 10000) / 10000;
    return { score: score, label: score >= 0 ? "hot" : "normal" };
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
function classifyWindow(events) {
  let features = extractFeatures(events);
  let perceptron = createPerceptron();
  let result = perceptron.predict(features);
  return { label: result.label, score: result.score, features: features };
}


var _neurons = Object.freeze({
	FEATURE_NAMES: FEATURE_NAMES,
	DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
	DEFAULT_BIAS: DEFAULT_BIAS,
	extractFeatures: extractFeatures,
	createPerceptron: createPerceptron,
	classifyWindow: classifyWindow
});

// AI analysis layer for IrohRedux 0.8.0 — deterministic rules over a
// trace's events, plus a toolkit scorecard. No LLM, no network, no
// randomness: the same events always give the same analysis.
//
//   Iroh.analyze(events, options)          -> { findings, scores, summary, neuron }
//   Iroh.analyzeTrace(code, options)       -> { events, result, analysis }
//   Iroh.analyzeTraceAsync(code, options)  -> Promise of the same
//   Iroh.analyzeModule(code, options)      -> Promise of the same
//
// Findings are { code, severity, message, evidence, neuron } — every
// finding cites its evidence (counts, names, hashes); no finding
// without evidence. Severities: "warning" (likely a real problem) and
// "info" (worth knowing). Thresholds live in `options` with the
// defaults documented below.
//
// The neuron field is the trace-window classification from
// src/neurons.js (hot vs normal) on the findings the perceptron
// applies to — HOT_LOOP, DEEP_RECURSION, REPEATED_SEQUENCE. The
// perceptron classifies hotness only, so ONE_SIDED_BRANCH,
// ZERO_ITERATION_LOOP and THROWING_PATH get neuron: null with a note
// saying so, rather than a forced label.
//
// Scores (every number carries its denominator, per Andy's rule):
//   coverage — event categories fired vs total categories in CATEGORY.
//     Note: this assumes an unfiltered trace (events: "ALL"). A trace
//     collected with an events filter scores the filter, not the
//     toolkit — analyzeTrace() traces with ALL categories by default.
//   fidelity — instrumented regions observed vs all regions:
//     observed = distinct event hashes; missing = regions the trace
//     shows were never entered (loop bodies never entered, one-sided
//     if arms); blind spots = private-field and destructuring
//     assignments found in the source (only when options.source is
//     given — analyzeTrace() passes it; without source they are
//     listed as known blind spots with a null count, never hidden).
//   overhead — events per statement (when source is given) and
//     events per region (always). `value` is the per-statement ratio
//     when available, else per-region, and `denominator` says which.

const ANALYZE_DEFAULTS = {
  hotLoopThreshold: 100,
  deepRecursionThreshold: 20,
  repeatSequenceMinOccurrences: 3,
  oneSidedMinTests: 2,
};

// Constructs the instrumenter never reports as events. Listed in
// every scorecard, whether or not the trace's source was available
// to count them — a blind spot that is counted as zero is still a
// blind spot, and one that cannot be counted is not hidden.
const KNOWN_BLIND_SPOTS = [
  {
    kind: "private-field-assignment",
    note: "Assignments to private fields (this.#x = ...) are left native and produce no ASSIGN event (0.4.0).",
  },
  {
    kind: "destructuring-assignment",
    note: "Pattern assignments ([a, b] = ... / ({a} = ...)) are left native and produce no ASSIGN event (0.4.0).",
  },
];

// Walk an AST counting statements and the known blind-spot
// constructs. A statement is a node whose type ends in "Statement"
// or is a VariableDeclaration / FunctionDeclaration. Blind spots are
// AssignmentExpressions whose left side is a MemberExpression with a
// PrivateIdentifier property, or an ArrayPattern / ObjectPattern.
function inspectSource(code) {
  let ast;
  try {
    ast = parse$1(code);
  } catch (e) {
    return null;
  }
  let statements = 0;
  let blindSpots = 0;
  function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let ii = 0; ii < node.length; ++ii) walk(node[ii]);
      return;
    }
    if (typeof node.type === "string") {
      if (
        node.type.slice(-"Statement".length) === "Statement" ||
        node.type === "VariableDeclaration" ||
        node.type === "FunctionDeclaration"
      ) {
        statements += 1;
      }
      if (node.type === "AssignmentExpression") {
        let left = node.left;
        if (left) {
          if (
            left.type === "MemberExpression" &&
            left.property &&
            left.property.type === "PrivateIdentifier"
          ) {
            blindSpots += 1;
          } else if (
            left.type === "ArrayPattern" ||
            left.type === "ObjectPattern"
          ) {
            blindSpots += 1;
          }
        }
      }
    }
    let keys = Object.keys(node);
    for (let ii = 0; ii < keys.length; ++ii) {
      let key = keys[ii];
      if (key === "loc" || key === "range" || key === "start" || key === "end") {
        continue;
      }
      walk(node[key]);
    }
  }
  walk(ast);
  return { statements: statements, blindSpots: blindSpots };
}

function groupByHash(events, eventName, trigger) {
  let groups = {};
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event !== eventName) continue;
    if (trigger !== void 0 && e.trigger !== trigger) continue;
    let key = String(e.hash);
    if (!groups[key]) {
      groups[key] = { hash: e.hash, events: [], kind: e.kind, name: e.name };
    }
    groups[key].events.push(e);
  }
  return groups;
}

function analyze(events, options) {
  options = options || {};
  let thresholds = {
    hotLoopThreshold: options.hotLoopThreshold === void 0
      ? ANALYZE_DEFAULTS.hotLoopThreshold : options.hotLoopThreshold,
    deepRecursionThreshold: options.deepRecursionThreshold === void 0
      ? ANALYZE_DEFAULTS.deepRecursionThreshold : options.deepRecursionThreshold,
    repeatSequenceMinOccurrences: options.repeatSequenceMinOccurrences === void 0
      ? ANALYZE_DEFAULTS.repeatSequenceMinOccurrences : options.repeatSequenceMinOccurrences,
    oneSidedMinTests: options.oneSidedMinTests === void 0
      ? ANALYZE_DEFAULTS.oneSidedMinTests : options.oneSidedMinTests,
  };
  events = Array.isArray(events) ? events : [];
  let totalEvents = events.length;

  // --- Window classification (the neuron) -------------------------
  let neuron = classifyWindow(events);

  // --- Per-hash groups ---------------------------------------------
  let loopEnters = groupByHash(events, "LOOP_ENTER", "enter");
  let loopTests = groupByHash(events, "LOOP_TEST", "test");
  let ifTests = groupByHash(events, "IF_TEST", "test");
  let catches = groupByHash(events, "CATCH_ENTER", "enter");

  // --- Findings ------------------------------------------------------
  let findings = [];
  function neuronForHotness() {
    return { label: neuron.label, score: neuron.score };
  }
  let neuronNote =
    "The perceptron classifies hot vs normal only; this finding is not a hotness phenomenon, so it carries no neuron label.";

  // HOT_LOOP: a loop body entered at or above the threshold.
  // LOOP_ENTER fires once per loop entry, not per iteration, so
  // iterations are counted from LOOP_TEST events with value true
  // (one true test per iteration, plus one final false test).
  let loopHashes = Object.keys(loopTests);
  for (let ii = 0; ii < loopHashes.length; ++ii) {
    let g = loopTests[loopHashes[ii]];
    let iterations = 0;
    for (let jj = 0; jj < g.events.length; ++jj) {
      if (g.events[jj].value === true) iterations += 1;
    }
    if (iterations >= thresholds.hotLoopThreshold) {
      findings.push({
        code: "HOT_LOOP",
        severity: "warning",
        message:
          "Loop entered " + iterations + " times (threshold " +
          thresholds.hotLoopThreshold + ").",
        evidence: {
          hash: g.hash,
          kind: g.kind || null,
          iterations: iterations,
          tests: g.events.length,
          threshold: thresholds.hotLoopThreshold,
        },
        neuron: neuronForHotness(),
      });
    }
  }

  // ZERO_ITERATION_LOOP: a loop tested but never entered.
  let testHashes = Object.keys(loopTests);
  for (let ii = 0; ii < testHashes.length; ++ii) {
    let g = loopTests[testHashes[ii]];
    if (!loopEnters[String(g.hash)] && g.events.length > 0) {
      findings.push({
        code: "ZERO_ITERATION_LOOP",
        severity: "info",
        message:
          "Loop tested " + g.events.length + " time(s) but its body never ran.",
        evidence: {
          hash: g.hash,
          kind: g.kind || null,
          tests: g.events.length,
          iterations: 0,
        },
        neuron: null,
        neuronNote: neuronNote,
      });
    }
  }

  // DEEP_RECURSION: the deepest function entry at or above the threshold.
  let maxDepth = 0;
  let deepestName = null;
  let deepestCalls = 0;
  let callsByName = {};
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "FUNCTION_ENTER") {
      if (typeof e.indent === "number" && e.indent > maxDepth) {
        maxDepth = e.indent;
        deepestName = e.name || null;
      }
    }
    if (e.event === "FUNCTION_CALL" && e.trigger === "before" && e.name) {
      callsByName[e.name] = (callsByName[e.name] || 0) + 1;
    }
  }
  if (deepestName !== null) deepestCalls = callsByName[deepestName] || 0;
  if (maxDepth >= thresholds.deepRecursionThreshold) {
    findings.push({
      code: "DEEP_RECURSION",
      severity: "warning",
      message:
        "Call depth reached " + maxDepth + " (threshold " +
        thresholds.deepRecursionThreshold + "), deepest in '" +
        deepestName + "'.",
      evidence: {
        name: deepestName,
        maxDepth: maxDepth,
        threshold: thresholds.deepRecursionThreshold,
        calls: deepestCalls,
      },
      neuron: neuronForHotness(),
    });
  }

  // REPEATED_SEQUENCE: the same call sequence (names, in order)
  // repeating. N-grams of length 2..4 over FUNCTION_CALL names;
  // the most frequent sequence at or above the occurrence threshold
  // wins (ties go to the longest, then the first seen).
  let callNames = [];
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "FUNCTION_CALL" && e.trigger === "before" && e.name) {
      callNames.push(e.name);
    }
  }
  let bestSequence = null;
  let bestOccurrences = 0;
  let bestLength = 0;
  for (let n = 2; n <= 4; ++n) {
    let counts = {};
    let firstSeen = {};
    for (let ii = 0; ii + n <= callNames.length; ++ii) {
      let seq = callNames.slice(ii, ii + n).join("\n");
      if (counts[seq] === void 0) {
        counts[seq] = 0;
        firstSeen[seq] = ii;
      }
      counts[seq] += 1;
    }
    let keys = Object.keys(counts);
    for (let ii = 0; ii < keys.length; ++ii) {
      let seq = keys[ii];
      let occ = counts[seq];
      if (
        occ >= thresholds.repeatSequenceMinOccurrences &&
        (occ > bestOccurrences ||
          (occ === bestOccurrences && n > bestLength))
      ) {
        bestSequence = seq.split("\n");
        bestOccurrences = occ;
        bestLength = n;
      }
    }
  }
  if (bestSequence !== null) {
    findings.push({
      code: "REPEATED_SEQUENCE",
      severity: "info",
      message:
        "Call sequence [" + bestSequence.join(", ") + "] repeated " +
        bestOccurrences + " times.",
      evidence: {
        sequence: bestSequence,
        occurrences: bestOccurrences,
        length: bestLength,
        threshold: thresholds.repeatSequenceMinOccurrences,
      },
      neuron: neuronForHotness(),
    });
  }

  // ONE_SIDED_BRANCH: an if evaluated at least oneSidedMinTests
  // times whose outcome was always the same side.
  let ifHashes = Object.keys(ifTests);
  for (let ii = 0; ii < ifHashes.length; ++ii) {
    let g = ifTests[ifHashes[ii]];
    let trueCount = 0;
    let falseCount = 0;
    for (let jj = 0; jj < g.events.length; ++jj) {
      if (g.events[jj].value === true) trueCount += 1;
      else if (g.events[jj].value === false) falseCount += 1;
    }
    let total = trueCount + falseCount;
    if (total >= thresholds.oneSidedMinTests && (trueCount === 0 || falseCount === 0)) {
      findings.push({
        code: "ONE_SIDED_BRANCH",
        severity: "info",
        message:
          "If evaluated " + total + " time(s), always " +
          (trueCount > 0 ? "true" : "false") + " — the other arm never fired.",
        evidence: {
          hash: g.hash,
          trueCount: trueCount,
          falseCount: falseCount,
          tests: total,
        },
        neuron: null,
        neuronNote: neuronNote,
      });
    }
  }

  // THROWING_PATH: a catch block ran (caught exceptions). Uncaught
  // exceptions end the trace itself and are reported by the caller
  // (trace() throws with the events attached), not by the analyzer.
  let catchHashes = Object.keys(catches);
  if (catchHashes.length > 0) {
    let catchCount = 0;
    let hashes = [];
    for (let ii = 0; ii < catchHashes.length; ++ii) {
      let g = catches[catchHashes[ii]];
      catchCount += g.events.length;
      hashes.push(g.hash);
    }
    findings.push({
      code: "THROWING_PATH",
      severity: "warning",
      message:
        "Exceptions were caught " + catchCount + " time(s) during the trace.",
      evidence: { catches: catchCount, hashes: hashes },
      neuron: null,
      neuronNote: neuronNote,
    });
  }

  // --- Scorecard -------------------------------------------------------
  // Coverage: categories fired vs total categories.
  let totalCategories = Object.keys(CATEGORY).length;
  let firedSet = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (events[ii].category) firedSet[events[ii].category] = true;
  }
  let firedCategories = Object.keys(firedSet).sort();
  let missingCategories = [];
  let allCategories = Object.keys(CATEGORY);
  for (let ii = 0; ii < allCategories.length; ++ii) {
    if (!firedSet[allCategories[ii]]) missingCategories.push(allCategories[ii]);
  }
  let coverage = {
    fired: firedCategories.length,
    total: totalCategories,
    value: totalCategories > 0
      ? Math.round((firedCategories.length / totalCategories) * 10000) / 10000
      : 0,
    firedCategories: firedCategories,
    missingCategories: missingCategories,
    note: "Assumes an unfiltered trace (events: ALL). A trace collected with an events filter scores the filter, not the toolkit.",
  };

  // Fidelity: observed regions vs all regions. Observed = distinct
  // event hashes. Missing = regions the trace shows were never
  // entered (zero-iteration loop bodies, one-sided if arms). Blind
  // spots = known uninstrumented constructs found in the source, when
  // the source was given.
  let hashSet = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (typeof events[ii].hash === "number") hashSet[events[ii].hash] = true;
  }
  let observedRegions = Object.keys(hashSet).length;
  let missingRegions = 0;
  for (let ii = 0; ii < testHashes.length; ++ii) {
    if (!loopEnters[String(loopTests[testHashes[ii]].hash)]) missingRegions += 1;
  }
  for (let ii = 0; ii < ifHashes.length; ++ii) {
    let g = ifTests[ifHashes[ii]];
    let t = 0;
    let f = 0;
    for (let jj = 0; jj < g.events.length; ++jj) {
      if (g.events[jj].value === true) t += 1;
      else if (g.events[jj].value === false) f += 1;
    }
    if (t + f >= thresholds.oneSidedMinTests && (t === 0 || f === 0)) {
      missingRegions += 1;
    }
  }
  let sourceInfo = null;
  if (typeof options.source === "string") {
    sourceInfo = inspectSource(options.source);
  }
  let blindSpotStatements = sourceInfo ? sourceInfo.blindSpots : null;
  let blindSpotCount = blindSpotStatements === null ? 0 : blindSpotStatements;
  let totalRegions = observedRegions + missingRegions + blindSpotCount;
  let fidelity = {
    observedRegions: observedRegions,
    missingRegions: missingRegions,
    blindSpotStatements: blindSpotStatements,
    totalRegions: totalRegions,
    value: totalRegions > 0
      ? Math.round((observedRegions / totalRegions) * 10000) / 10000
      : 1,
    knownBlindSpots: KNOWN_BLIND_SPOTS,
  };

  // Overhead: events per statement (when the source was given) and
  // events per region (always). `value` is the per-statement ratio
  // when available, else per-region; `denominator` says which.
  let statements = sourceInfo ? sourceInfo.statements : null;
  let eventsPerRegion = observedRegions > 0
    ? Math.round((totalEvents / observedRegions) * 100) / 100
    : 0;
  let eventsPerStatement = statements !== null && statements > 0
    ? Math.round((totalEvents / statements) * 100) / 100
    : null;
  let overhead = {
    events: totalEvents,
    statements: statements,
    regions: observedRegions,
    eventsPerStatement: eventsPerStatement,
    eventsPerRegion: eventsPerRegion,
    value: eventsPerStatement !== null ? eventsPerStatement : eventsPerRegion,
    denominator: eventsPerStatement !== null ? "statements" : "regions",
  };

  let scores = { coverage: coverage, fidelity: fidelity, overhead: overhead };

  let warnings = 0;
  let infos = 0;
  for (let ii = 0; ii < findings.length; ++ii) {
    if (findings[ii].severity === "warning") warnings += 1;
    else infos += 1;
  }
  let summary = {
    events: totalEvents,
    findings: findings.length,
    warnings: warnings,
    infos: infos,
    maxCallDepth: maxDepth,
    distinctRegions: observedRegions,
  };

  return { findings: findings, scores: scores, summary: summary, neuron: neuron };
}

// Trace a script and analyze it in one call. Options are trace()'s,
// plus `analyze` (thresholds / source override — `source` defaults
// to the code being traced). Returns { events, result, analysis }.
function analyzeTrace(code, options) {
  options = options || {};
  let out = this.trace(code, options);
  let analyzeOptions = options.analyze || {};
  if (analyzeOptions.source === void 0) analyzeOptions.source = code;
  return { events: out.events, result: out.result, analysis: analyze(out.events, analyzeOptions) };
}

// Async version of analyzeTrace(): scripts with top-level await, via
// traceAsync(). Returns a Promise of { events, result, analysis }.
function analyzeTraceAsync(code, options) {
  options = options || {};
  let iroh = this;
  let analyzeOptions = options.analyze || {};
  if (analyzeOptions.source === void 0) analyzeOptions.source = code;
  return iroh.traceAsync(code, options).then(function(out) {
    return { events: out.events, result: out.result, analysis: analyze(out.events, analyzeOptions) };
  });
}

// Module version of analyzeTrace(), via traceModule(). Node only.
// Returns a Promise of { events, result, analysis }.
function analyzeModule(code, options) {
  options = options || {};
  let iroh = this;
  let analyzeOptions = options.analyze || {};
  if (analyzeOptions.source === void 0) analyzeOptions.source = code;
  return iroh.traceModule(code, options).then(function(out) {
    return { events: out.events, result: out.result, analysis: analyze(out.events, analyzeOptions) };
  });
}


var _analyze = Object.freeze({
	ANALYZE_DEFAULTS: ANALYZE_DEFAULTS,
	analyze: analyze,
	analyzeTrace: analyzeTrace,
	analyzeTraceAsync: analyzeTraceAsync,
	analyzeModule: analyzeModule
});

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

const VECTOR_FEATURE_NAMES = FEATURE_NAMES.concat(["coverage"]);

// Project a trace's events into a feature vector. `events` is the
// plain array Iroh.trace() returns (or the CLI's event lines, or a
// Python/C++ tracer's — the projection only reads event/category/
// trigger/hash/indent/value, so it works the same across languages).
function toVector(events) {
  events = Array.isArray(events) ? events : [];
  let features = extractFeatures(events);
  let totalCategories = Object.keys(CATEGORY).length;
  let fired = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (events[ii].category) fired[events[ii].category] = true;
  }
  let firedCount = Object.keys(fired).length;
  let coverage = totalCategories > 0
    ? Math.round((firedCount / totalCategories) * 10000) / 10000
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
function cosineSimilarity(a, b) {
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
function euclideanDistance(a, b) {
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
function compareVectors(a, b) {
  return {
    cosine: cosineSimilarity(a, b),
    euclidean: euclideanDistance(a, b),
  };
}


var _vectors = Object.freeze({
	VECTOR_FEATURE_NAMES: VECTOR_FEATURE_NAMES,
	toVector: toVector,
	cosineSimilarity: cosineSimilarity,
	euclideanDistance: euclideanDistance,
	compareVectors: compareVectors
});

// AI-friendly scan mode for IrohRedux 0.9.0 — trace -> analyze ->
// vector in ONE pass, emitting ONE compact JSON document instead of
// the raw event flood:
//
//   { vectors, findings, scores, summary }
//
// - `vectors` is the toVector() projection (src/vectors.js): named
//   features, the ordered numeric vector, and the feature names.
// - `findings`, `scores` are exactly what Iroh.analyze() returns —
//   every finding cites its evidence, every score carries its
//   denominator.
// - `summary` is analyze()'s summary plus the scan's own fields:
//   `language` (javascript/python/cpp), `neuron` (the window
//   classification), and `findingsTruncated` (0 unless the findings
//   cap below bit — a large trace must scan to something far smaller
//   than its raw event stream, so findings are capped; the cap is a
//   safety bound, and the count of dropped findings is reported,
//   never hidden).
//
// The scan works the same across languages: scan(events) only reads
// the plain event objects, so a JS, Python or C++ trace scans to the
// same schema. scanTrace()/scanTraceAsync()/scanModule() are the JS
// conveniences (trace then scan); Python and C++ traces reach the
// scan through the CLI --scan flag.
//
//   Iroh.scan(events, options)          -> scan document
//   Iroh.scanTrace(code, options)       -> scan document (JS, sync)
//   Iroh.scanTraceAsync(code, options)  -> Promise of the same
//   Iroh.scanModule(code, options)      -> Promise of the same
//
// Options: language (default "javascript"), source (for the fidelity
// score's blind-spot count — defaults to the traced code in the
// scanTrace family), the analyze() thresholds (hotLoopThreshold,
// deepRecursionThreshold, repeatSequenceMinOccurrences,
// oneSidedMinTests, via options.analyze in the scanTrace family),
// maxFindings (default 200), includeEvents (default false — when
// true the raw events ride along in the document under `events`, for
// callers that explicitly want the flood).

const SCAN_DEFAULTS = {
  maxFindings: 200,
};

// The scan of a trace's events. Pure function — no tracing, no I/O.
function scan(events, options) {
  options = options || {};
  events = Array.isArray(events) ? events : [];
  let maxFindings = options.maxFindings === void 0
    ? SCAN_DEFAULTS.maxFindings : options.maxFindings;
  // A negative cap is nonsense, not a request for "all but N": slice(0, -5)
  // would emit all but the last five findings and report a negative
  // truncation. Clamp to >= 0; a non-number falls back to the default.
  if (typeof maxFindings !== "number" || !isFinite(maxFindings)) {
    maxFindings = SCAN_DEFAULTS.maxFindings;
  }
  maxFindings = Math.max(0, Math.floor(maxFindings));
  let analysis = analyze(events, options);
  let vectors = toVector(events);
  let allFindings = analysis.findings;
  let truncated = 0;
  let findings = allFindings;
  if (allFindings.length > maxFindings) {
    truncated = allFindings.length - maxFindings;
    findings = allFindings.slice(0, maxFindings);
  }
  let summary = {
    events: analysis.summary.events,
    findings: analysis.summary.findings,
    warnings: analysis.summary.warnings,
    infos: analysis.summary.infos,
    maxCallDepth: analysis.summary.maxCallDepth,
    distinctRegions: analysis.summary.distinctRegions,
    language: options.language || "javascript",
    neuron: {
      label: analysis.neuron.label,
      score: analysis.neuron.score,
    },
    findingsTruncated: truncated,
  };
  let doc = {
    vectors: vectors,
    findings: findings,
    scores: analysis.scores,
    summary: summary,
  };
  if (options.includeEvents) {
    doc.events = events;
  }
  return doc;
}

// Scan a JS script: trace it, then scan the events. Options are
// trace()'s, plus `analyze` (thresholds / source override — `source`
// defaults to the code), `language` (default "javascript"),
// `maxFindings` and `includeEvents`.
function scanTrace(code, options) {
  options = options || {};
  let out = this.trace(code, options);
  // Copy: scanOptions defaults (source, language) are written onto this
  // object, and aliasing the caller's options.analyze would mutate
  // their object as a side effect of scanning.
  let scanOptions = Object.assign({}, options.analyze);
  if (scanOptions.source === void 0) scanOptions.source = code;
  if (scanOptions.language === void 0) scanOptions.language = "javascript";
  if (options.maxFindings !== void 0 && scanOptions.maxFindings === void 0) {
    scanOptions.maxFindings = options.maxFindings;
  }
  if (options.includeEvents !== void 0 && scanOptions.includeEvents === void 0) {
    scanOptions.includeEvents = options.includeEvents;
  }
  return scan(out.events, scanOptions);
}

// Async version of scanTrace(): scripts with top-level await, via
// traceAsync(). Returns a Promise of the scan document.
function scanTraceAsync(code, options) {
  options = options || {};
  let iroh = this;
  let scanOptions = Object.assign({}, options.analyze);
  if (scanOptions.source === void 0) scanOptions.source = code;
  if (scanOptions.language === void 0) scanOptions.language = "javascript";
  if (options.maxFindings !== void 0 && scanOptions.maxFindings === void 0) {
    scanOptions.maxFindings = options.maxFindings;
  }
  if (options.includeEvents !== void 0 && scanOptions.includeEvents === void 0) {
    scanOptions.includeEvents = options.includeEvents;
  }
  return iroh.traceAsync(code, options).then(function(out) {
    return scan(out.events, scanOptions);
  });
}

// Module version of scanTrace(), via traceModule(). Node only.
// Returns a Promise of the scan document.
function scanModule(code, options) {
  options = options || {};
  let iroh = this;
  let scanOptions = Object.assign({}, options.analyze);
  if (scanOptions.source === void 0) scanOptions.source = code;
  if (scanOptions.language === void 0) scanOptions.language = "javascript";
  if (options.maxFindings !== void 0 && scanOptions.maxFindings === void 0) {
    scanOptions.maxFindings = options.maxFindings;
  }
  if (options.includeEvents !== void 0 && scanOptions.includeEvents === void 0) {
    scanOptions.includeEvents = options.includeEvents;
  }
  return iroh.traceModule(code, options).then(function(out) {
    return scan(out.events, scanOptions);
  });
}


var _scan = Object.freeze({
	SCAN_DEFAULTS: SCAN_DEFAULTS,
	scan: scan,
	scanTrace: scanTrace,
	scanTraceAsync: scanTraceAsync,
	scanModule: scanModule
});

// Live wire AI analysis mode for IrohRedux 0.9.0 — analysis that runs
// WHILE the program runs, streaming findings as events arrive, instead
// of analyze-after-the-fact:
//
//   let live = Iroh.liveAnalyzer(options);
//   live.feed(event);   // -> findings that fired on this event (usually [])
//   live.findings();    // all findings fired so far, in fire order
//   live.snapshot();    // progress so far (no scores — those are final)
//   live.finish();      // final summary: batch-equal findings + scores + vectors
//
// A finding fires the moment its threshold trips: HOT_LOOP when a
// loop's true-test count reaches hotLoopThreshold, DEEP_RECURSION when
// a FUNCTION_ENTER indent reaches deepRecursionThreshold,
// REPEATED_SEQUENCE when a call sequence reaches
// repeatSequenceMinOccurrences, THROWING_PATH on the first CATCH_ENTER.
// Each fired finding carries `firedAt` (the 0-based index of the event
// that tripped it) and the evidence as of the trip — the counts are the
// counts so far, not the final tally.
//
// Two findings cannot be decided incrementally, so they fire at stream
// end (finish()) with a `note` saying so, never a wrong early call:
// ZERO_ITERATION_LOOP (a loop could still be entered later) and
// ONE_SIDED_BRANCH (a later test could take the other arm). They are
// taken from the batch analysis at finish(), so they are batch-equal
// by construction.
//
// Consistency: the codes of the fired findings (after finish()) equal
// the codes of batch analyze() on the same complete trace — every batch
// finding either trips mid-stream or at stream end. The final summary
// IS the batch analysis (findings, scores, summary, neuron) plus the
// toVector() projection, so live vs batch agreement holds by
// construction, not by re-implementation. The fired findings' evidence
// may differ from the final tally (counts as of the trip vs final
// counts; the live REPEATED_SEQUENCE is the first sequence to reach
// the threshold, the final one is the batch-best) — the live finding
// is the early warning, the summary is the authoritative tally.
// Deterministic: the same events always give the same findings in the
// same order — no randomness, no wall-clock, no iteration over
// unordered state (per-hash state is only read at finish(), from the
// batch analysis, whose order is deterministic).

// Notes attached to the findings that can only be decided at stream end.
const STREAM_END_NOTES = {
  ZERO_ITERATION_LOOP:
    "Decided at stream end: a loop is only zero-iteration once the trace is complete — it could still be entered later.",
  ONE_SIDED_BRANCH:
    "Decided at stream end: a branch is only one-sided once the trace is complete — a later test could take the other arm.",
};

const NEURON_NOTE =
  "The perceptron classifies hot vs normal only; this finding is not a hotness phenomenon, so it carries no neuron label.";

function liveAnalyzer(options) {
  options = options || {};
  let thresholds = {
    hotLoopThreshold: options.hotLoopThreshold === void 0
      ? ANALYZE_DEFAULTS.hotLoopThreshold : options.hotLoopThreshold,
    deepRecursionThreshold: options.deepRecursionThreshold === void 0
      ? ANALYZE_DEFAULTS.deepRecursionThreshold : options.deepRecursionThreshold,
    repeatSequenceMinOccurrences: options.repeatSequenceMinOccurrences === void 0
      ? ANALYZE_DEFAULTS.repeatSequenceMinOccurrences : options.repeatSequenceMinOccurrences,
    oneSidedMinTests: options.oneSidedMinTests === void 0
      ? ANALYZE_DEFAULTS.oneSidedMinTests : options.oneSidedMinTests,
  };
  let analyzer = {
    events: [],
    fired: [],
    finished: false,
    finalSummary: null,
    // Per-loop-hash state: { hash, kind, iterations, tests, entered }.
    loops: {},
    // Per-if-hash state: { hash, trueCount, falseCount }.
    ifs: {},
    // Call names in order (for REPEATED_SEQUENCE n-grams), and the
    // per-name call counts (for DEEP_RECURSION evidence).
    callNames: [],
    callsByName: {},
    // N-gram counts for lengths 2..4, keyed by the names joined with
    // "\n", plus the first-seen start index of each sequence.
    ngramCounts: [{}, {}, {}],
    ngramFirstSeen: [{}, {}, {}],
    hotLoopFired: {},
    deepFired: false,
    sequenceFired: false,
    throwingFired: false,
  };

  function neuronNow() {
    // The window classification over the events so far — the best
    // available estimate at the trip. The final summary carries the
    // whole-trace classification instead.
    return classifyWindow(analyzer.events);
  }

  function fire(finding, index) {
    finding.firedAt = index;
    analyzer.fired.push(finding);
    return finding;
  }

  function feed(event) {
    if (analyzer.finished) {
      throw new Error("live analyzer is finished; feed() after finish() is a programming error");
    }
    if (!event || typeof event !== "object") return [];
    analyzer.events.push(event);
    let index = analyzer.events.length - 1;
    let firedNow = [];

    if (event.event === "LOOP_TEST" && event.trigger === "test") {
      let key = String(event.hash);
      let loop = analyzer.loops[key];
      if (!loop) {
        loop = { hash: event.hash, kind: event.kind || null, iterations: 0, tests: 0, entered: false };
        analyzer.loops[key] = loop;
      }
      loop.tests += 1;
      if (event.value === true) {
        loop.iterations += 1;
        if (loop.iterations >= thresholds.hotLoopThreshold && !analyzer.hotLoopFired[key]) {
          analyzer.hotLoopFired[key] = true;
          firedNow.push(fire({
            code: "HOT_LOOP",
            severity: "warning",
            message:
              "Loop entered " + loop.iterations + " times (threshold " +
              thresholds.hotLoopThreshold + ").",
            evidence: {
              hash: loop.hash,
              kind: loop.kind,
              iterations: loop.iterations,
              tests: loop.tests,
              threshold: thresholds.hotLoopThreshold,
            },
            neuron: neuronNow(),
          }, index));
        }
      }
    } else if (event.event === "LOOP_ENTER" && event.trigger === "enter") {
      let key = String(event.hash);
      let loop = analyzer.loops[key];
      if (!loop) {
        loop = { hash: event.hash, kind: event.kind || null, iterations: 0, tests: 0, entered: false };
        analyzer.loops[key] = loop;
      }
      loop.entered = true;
    } else if (event.event === "FUNCTION_ENTER") {
      if (typeof event.indent === "number" &&
          event.indent >= thresholds.deepRecursionThreshold &&
          !analyzer.deepFired) {
        analyzer.deepFired = true;
        firedNow.push(fire({
          code: "DEEP_RECURSION",
          severity: "warning",
          message:
            "Call depth reached " + event.indent + " (threshold " +
            thresholds.deepRecursionThreshold + "), deepest in '" +
            (event.name || null) + "'.",
          evidence: {
            name: event.name || null,
            maxDepth: event.indent,
            threshold: thresholds.deepRecursionThreshold,
            calls: analyzer.callsByName[event.name] || 0,
          },
          neuron: neuronNow(),
        }, index));
      }
    } else if (event.event === "FUNCTION_CALL" && event.trigger === "before" && event.name) {
      analyzer.callsByName[event.name] = (analyzer.callsByName[event.name] || 0) + 1;
      analyzer.callNames.push(event.name);
      if (!analyzer.sequenceFired) {
        // N-grams ending at this call, lengths 2..4. A sequence's
        // count grows only here, so every trip is observed.
        let best = null;
        let bestOccurrences = 0;
        let bestLength = 0;
        let bestFirstSeen = 0;
        for (let n = 2; n <= 4; ++n) {
          if (analyzer.callNames.length < n) continue;
          let start = analyzer.callNames.length - n;
          let seq = analyzer.callNames.slice(start).join("\n");
          let counts = analyzer.ngramCounts[n - 2];
          let firstSeen = analyzer.ngramFirstSeen[n - 2];
          if (counts[seq] === void 0) {
            counts[seq] = 0;
            firstSeen[seq] = start;
          }
          counts[seq] += 1;
          let occ = counts[seq];
          if (occ >= thresholds.repeatSequenceMinOccurrences &&
              (occ > bestOccurrences ||
                (occ === bestOccurrences && n > bestLength) ||
                (occ === bestOccurrences && n === bestLength &&
                  firstSeen[seq] < bestFirstSeen))) {
            best = seq.split("\n");
            bestOccurrences = occ;
            bestLength = n;
            bestFirstSeen = firstSeen[seq];
          }
        }
        if (best !== null) {
          analyzer.sequenceFired = true;
          firedNow.push(fire({
            code: "REPEATED_SEQUENCE",
            severity: "info",
            message:
              "Call sequence [" + best.join(", ") + "] repeated " +
              bestOccurrences + " times.",
            evidence: {
              sequence: best,
              occurrences: bestOccurrences,
              length: bestLength,
              threshold: thresholds.repeatSequenceMinOccurrences,
            },
            neuron: neuronNow(),
          }, index));
        }
      }
    } else if (event.event === "CATCH_ENTER" && event.trigger === "enter") {
      if (!analyzer.throwingFired) {
        analyzer.throwingFired = true;
        firedNow.push(fire({
          code: "THROWING_PATH",
          severity: "warning",
          message: "Exceptions were caught 1 time(s) during the trace.",
          evidence: { catches: 1, hashes: [event.hash] },
          neuron: null,
          neuronNote: NEURON_NOTE,
        }, index));
      }
    } else if (event.event === "IF_TEST" && event.trigger === "test") {
      let key = String(event.hash);
      let branch = analyzer.ifs[key];
      if (!branch) {
        branch = { hash: event.hash, trueCount: 0, falseCount: 0 };
        analyzer.ifs[key] = branch;
      }
      if (event.value === true) branch.trueCount += 1;
      else if (event.value === false) branch.falseCount += 1;
    }
    return firedNow;
  }

  function findings() {
    return analyzer.fired.slice();
  }

  function snapshot() {
    if (analyzer.finished) return analyzer.finalSummary;
    // Progress so far: the findings that have fired, the window
    // classification and the vector over the events so far. No scores:
    // the scorecard is only final, at finish().
    return {
      events: analyzer.events.length,
      findings: analyzer.fired.slice(),
      neuron: classifyWindow(analyzer.events),
      vectors: toVector(analyzer.events),
      finished: false,
    };
  }

  function finish() {
    if (analyzer.finished) return analyzer.finalSummary;
    // The final summary IS the batch analysis — findings, scores,
    // summary, neuron — plus the vector projection, so live vs batch
    // agreement holds by construction. The stream-end findings are
    // taken from it (same order, same evidence) and marked as decided
    // at stream end; the mid-stream firings keep their trip-time
    // evidence.
    let final = analyze(analyzer.events, options);
    let summary = final.summary;
    summary.language = options.language || "javascript";
    let lastIndex = analyzer.events.length - 1;
    for (let ii = 0; ii < final.findings.length; ++ii) {
      let f = final.findings[ii];
      if (f.code === "ZERO_ITERATION_LOOP" || f.code === "ONE_SIDED_BRANCH") {
        let fired = {
          code: f.code,
          severity: f.severity,
          message: f.message,
          evidence: f.evidence,
          neuron: f.neuron,
          firedAt: lastIndex,
          note: STREAM_END_NOTES[f.code],
        };
        if (f.neuronNote) fired.neuronNote = f.neuronNote;
        analyzer.fired.push(fired);
      }
    }
    analyzer.finished = true;
    analyzer.finalSummary = {
      findings: final.findings,
      scores: final.scores,
      summary: summary,
      neuron: final.neuron,
      vectors: toVector(analyzer.events),
      finished: true,
    };
    return analyzer.finalSummary;
  }

  return {
    feed: feed,
    findings: findings,
    snapshot: snapshot,
    finish: finish,
  };
}


var _live = Object.freeze({
	liveAnalyzer: liveAnalyzer
});

// Live code engine + AI director for IrohRedux 1.0.0 — the original
// vision complete. The engine runs a program under trace and changes it
// mid-flight; the director sits on the live wire, reads findings as
// they fire, and calls the shots.
//
//   let out = Iroh.direct(code, Iroh.runawayGuard());
//   // out.result, out.stopped, out.stopReason, out.events,
//   // out.findings, out.directives, out.analysis
//
// How a directive takes effect — the tracer's DEBUG functions return
// the event's value AFTER triggering listeners (see src/stage/debug.js),
// so a listener that mutates the event changes the running program:
//   set  — VAR_INIT returns event.value (the initializer), and a plain
//          `x = v` is patched to `x = DEBUG_ASSIGN(...)`, which returns
//          event.result — so setting event.result on the next ASSIGN
//          event for that name writes the new value into the variable.
//          A loop counter advanced by `i++` has no assignment point,
//          so a set for it applies at the next LOOP_TEST for a loop
//          whose test compares that variable with a literal bound: the
//          comparison is evaluated with the set value, and the test is
//          flipped to false only when the set value makes it false.
//          Member assignments (`obj.prop = v`, including compound
//          `obj.prop += v`) are written before the event fires, so a
//          set for "obj.prop" overwrites the property on the live
//          object after the write — which runs a setter a second time
//          when the property is one, so use it on plain data
//          properties. A plain compound assignment (`x += v`) passes
//          only the right-hand value through event.result — it is not
//          a set point, and a set never applies there.
//          A set may carry `scope`: the name of the function it applies
//          in (the innermost function at the interception point, as the
//          stage tracks it; null means top level). An omitted scope
//          matches any scope — the 1.0.0 behaviour.
//   skip — FUNCTION_CALL fires "before" with event.call (the function)
//          and event.arguments, and only then applies the callee. A
//          listener that replaces event.call with a stub makes the call
//          expression evaluate to the stub's return, and the real
//          function never runs (no FUNCTION_ENTER, no side effects).
//   stop — the engine throws a sentinel from the listener. It
//          propagates out of the run like any listener throw. A program
//          inside try/catch may swallow one throw, so the engine
//          re-throws the sentinel at every following event until it
//          propagates out or the program ends; if the program ends
//          first, the stop is recorded as requested-but-swallowed and
//          the run completes normally.
//
// Ordering inside one event: pending directives apply first (so the
// live analyzer sees the directed value), then the event feeds the
// live analyzer, then — only when new findings fired — the director
// is consulted. A directive issued in response applies at the NEXT
// matching point, with one exception: a skip for the very call that
// tripped the finding applies to that call now, because the call has
// not run yet. A set issued on a HOT_LOOP trip does NOT flip the trip
// test itself: that iteration's body still runs, so the iterations
// the analysis counts are exactly the bodies that ran, and the loop
// exits at the next test. When a directive applies, the JSON line is
// mutated alongside the raw event, so the recorded trace shows what
// the program actually ran with — a flipped loop test reads false in
// the events, and a directed assignment reads the directed value.
// The director is also called once before the run starts (findings
// [], event null), so it can issue initial directives — e.g. skip a
// call from the outset.
//
// Each directive applies once, at the first matching point, then it is
// consumed. A directive that never matches is recorded with
// applied: false and a reason — the audit log never pretends a
// directive took effect. Matching is by name, and by scope when the
// directive carries one: a set for "i" in scope "inner" applies only
// to the `i` in that function, not to an outer or top-level `i`.
//
// The director receives { findings, allFindings, snapshot, event,
// eventIndex, directives } and returns a directive, an array of
// directives, or null. The loop closes: trace -> analyze live ->
// direct -> change -> trace again, and the record (findings,
// directives, analysis) makes the run auditable, not a black box.
//
// Limits (also in CHANGELOG.md): direct() runs scripts synchronously
// (like trace()) — top-level await is rejected with the same pointer
// trace() gives; use directAsync() for that. Modules are directed by
// directModule(). Python/C++ traces cannot be directed —
// their events arrive buffered after the run, so there is nothing
// live to direct; the CLI --direct flag is JavaScript-only.

// The sentinel thrown to stop a run. It is one object, compared by
// identity — a program that throws its own value can never be mistaken
// for a directed stop, and a directed stop can never be mistaken for a
// program error.
let DIRECTOR_STOP = { __irohDirectorStop: true };

// Flip a comparison operator for the counter-on-the-other-side form:
// `10000 > i` reads, from the counter's side, as `i < 10000`.
function flipOperator(op) {
  if (op === "<") return ">";
  if (op === ">") return "<";
  if (op === "<=") return ">=";
  if (op === ">=") return "<=";
  if (op === "==" || op === "===" || op === "!=" || op === "!==") return op;
  return null;
}

// The counter value that makes `counter <op> bound` false — the value
// a throttle sets the counter to. == / === cannot be falsified by
// setting the counter to one value without knowing what it is not, so
// they have no exit value and the guard falls back to stopping.
function exitValueFor(operator, bound) {
  if (operator === "<") return bound;
  if (operator === "<=") return bound + 1;
  if (operator === ">") return bound;
  if (operator === ">=") return bound - 1;
  if (operator === "!=" || operator === "!==") return bound;
  return null;
}

// Resolve a loop's test from its LOOP_TEST hash: the stage's node map
// holds the loop statement clone with the ORIGINAL test expression
// (the DEBUG_LOOP_TEST call wraps it at patch time). Returns
// { hash, kind, counter, bound, operator, counterOnLeft, value } —
// operator normalized to the counter-on-the-left form — or null when
// the test is not a simple counter comparison against a numeric
// literal (`while (true)`, `i < n`, `i + 1 < 10`, compound tests).
function resolveLoopTest(stage, hash) {
  if (!stage || !stage.nodes || !stage.nodes[hash]) return null;
  let node = stage.nodes[hash].node;
  if (!node || !node.test || node.test.type !== "BinaryExpression") return null;
  let test = node.test;
  let counter = null;
  let bound = null;
  let operator = test.operator;
  let counterOnLeft = true;
  if (
    test.left.type === "Identifier" &&
    test.right.type === "Literal" &&
    typeof test.right.value === "number"
  ) {
    counter = test.left.name;
    bound = test.right.value;
    counterOnLeft = true;
  } else if (
    test.right.type === "Identifier" &&
    test.left.type === "Literal" &&
    typeof test.left.value === "number"
  ) {
    counter = test.right.name;
    bound = test.left.value;
    counterOnLeft = false;
    operator = flipOperator(operator);
    if (operator === null) return null;
  } else {
    return null;
  }
  return {
    hash: hash,
    kind: node.type,
    counter: counter,
    bound: bound,
    operator: operator,
    counterOnLeft: counterOnLeft,
    value: exitValueFor(operator, bound),
  };
}

// Evaluate the normalized comparison `counterValue <operator> bound`.
// Returns true/false, or null for an operator the evaluator cannot
// run (only comparisons reach here).
function compareWith(operator, counterValue, bound) {
  let op = OP[operator];
  if (op === void 0) return null;
  return evalBinaryExpression(op, counterValue, bound);
}

function normalizeDirectives(answer) {
  if (answer === null || answer === void 0) return [];
  if (Array.isArray(answer)) return answer;
  return [answer];
}

// A director bug fails loudly: an unknown directive type, or a set/skip
// without a name or a value, throws instead of being silently ignored.
// The returned object keeps only the known fields, so the audit log
// never carries a director's stray properties. A set's `scope`, when
// given, must be a string (the function name) or null (top level); a
// dotted set name must be exactly "object.property" (one level) —
// deeper paths are not a set point.
function validateDirective(d) {
  if (!d || typeof d !== "object") {
    throw new Error(
      "A director must return a directive object, an array of directive objects, or null — got: " + String(d)
    );
  }
  if (d.type === "set") {
    if (typeof d.name !== "string" || d.name === "") {
      throw new Error("A \"set\" directive needs a non-empty string `name`.");
    }
    if (d.name.indexOf(".") !== -1) {
      let parts = d.name.split(".");
      let ident = /^[$A-Za-z_][$\w]*$/;
      if (
        parts.length !== 2 ||
        !ident.test(parts[0]) ||
        !ident.test(parts[1])
      ) {
        throw new Error(
          "A \"set\" directive name with a dot must be exactly \"object.property\" (one level) — got: " + d.name
        );
      }
    }
    if (!Object.prototype.hasOwnProperty.call(d, "value")) {
      throw new Error("A \"set\" directive needs a `value`.");
    }
    let out = { type: "set", name: d.name, value: d.value };
    if (Object.prototype.hasOwnProperty.call(d, "scope")) {
      if (d.scope !== null && typeof d.scope !== "string") {
        throw new Error(
          "A \"set\" directive `scope` must be a string (the function name) or null (top level) — got: " + String(d.scope)
        );
      }
      out.scope = d.scope;
    }
    return out;
  }
  if (d.type === "skip") {
    if (typeof d.name !== "string" || d.name === "") {
      throw new Error("A \"skip\" directive needs a non-empty string `name` (the function to skip).");
    }
    if (!Object.prototype.hasOwnProperty.call(d, "value")) {
      throw new Error("A \"skip\" directive needs a `value` (the result the skipped call evaluates to).");
    }
    return { type: "skip", name: d.name, value: d.value };
  }
  if (d.type === "stop") {
    return {
      type: "stop",
      reason:
        typeof d.reason === "string" && d.reason !== ""
          ? d.reason
          : "Director stopped the run.",
    };
  }
  throw new Error(
    "Unknown directive type: " + String(d.type) + " (want \"set\", \"skip\" or \"stop\")."
  );
}

// The live code engine. Runs `code` under trace with `director`
// (a function, or null for an undirected run — the record then has no
// directives, and the run is trace() with a direction audit). Options:
//   events: ignored — the director and the live analyzer need the full
//           stream, so direct() always traces ALL categories.
//   stageOptions: passed to the Stage (ecmaVersion, allowHashBang).
//   onEvent(line): called for every JSON event line as it fires.
//   onDirective(entry): called when a directive is applied (or when a
//           stop is issued).
//   onFinding(findings): called with the findings that just fired
//           (HOT_LOOP carries its loop info), for a caller that wants
//           to print them live without being the director.
//   hotLoopThreshold, deepRecursionThreshold,
//   repeatSequenceMinOccurrences, oneSidedMinTests: live analyzer
//           thresholds, as for liveAnalyzer().
//   source, language: passed to the live analyzer (source defaults to
//           the code, so the fidelity score can count its blind spots).
// Returns { result, stopped, stopReason, events, findings, directives,
// analysis } — the analysis is the live finish() summary (findings,
// scores, summary, neuron, vectors), so live vs batch agreement holds
// by construction. A runtime error throws with the events that fired
// before it attached as error.events (like trace()) and the direction
// record so far as error.direct. A directed stop is not an error: it
// returns normally with stopped: true.
//
// directInternal is the shared core of direct() (sync), directAsync()
// and directModule(): the same setup, the same director calls, the
// same completion handling — only the runner differs (compileRunner's
// sync form, its async wrapper, or the temp-file import for modules).
// Written with Promise chains, not async/await, because the browser
// bundle is transpiled by buble.
function directInternal(iroh, code, director, options, mode) {
  options = options || {};
  let allowAsync = mode === "async";
  let isModule = mode === "module";
  if (
    director !== null &&
    director !== void 0 &&
    typeof director !== "function"
  ) {
    throw new Error("Iroh.direct() needs a director function (or null for an undirected run).");
  }
  let live = iroh.liveAnalyzer(
    Object.assign({}, options, {
      source: options.source || code,
      language: options.language || "javascript",
    })
  );
  let onEvent = options.onEvent;
  let onDirective = options.onDirective;
  let pending = []; // issued set/skip entries not yet applied
  let log = []; // the audit log: every directive, with its outcome
  let stopped = false;
  let stopReason = null;
  let stopPending = false; // a stop was issued; re-thrown at every event until it lands
  let stopEntry = null;
  let stage = null;
  let run = null;

  function recordDirective(directive, issuedAtEvent) {
    let entry = {
      directive: directive,
      issuedAtEvent: issuedAtEvent,
      applied: false,
      appliedAtEvent: null,
      appliedVia: null,
      note: null,
    };
    log.push(entry);
    return entry;
  }

  // Whether this directive's scope matches the current point: an
  // omitted scope matches anywhere; a string matches only that
  // function (the innermost, as the stage tracks it); null matches
  // only top level. Without a stage the scope cannot be checked, so
  // a scoped directive does not apply.
  function scopeMatches(d) {
    if (!Object.prototype.hasOwnProperty.call(d, "scope")) return true;
    if (stage === null) return false;
    if (d.scope === null) return stage.currentScope === null;
    return stage.currentScope === d.scope;
  }

  // Try to apply one pending set/skip entry at this raw event. Returns
  // true when it applied (the entry is then consumed). The raw event is
  // the live object the DEBUG function is about to use, so mutating it
  // changes the running program — and the JSON line is mutated alongside
  // it, so the recorded trace shows what the program actually ran with,
  // not the value before direction (otherwise the final analysis would
  // count a flipped loop test as an iteration whose body never ran).
  function applyEntry(entry, raw, trigger, line) {
    let d = entry.directive;
    if (d.type === "set") {
      // Declaration: the initializer flows through event.value.
      if (
        raw.type === INSTR.VAR_INIT &&
        trigger === "after" &&
        raw.name === d.name &&
        scopeMatches(d)
      ) {
        raw.value = d.value;
        // The line carries the safe projection of the value (like
        // eventToJSON), so a circular or deep director value cannot
        // break a later JSON.stringify of the recorded events; the
        // program itself gets the live value through raw.value.
        line.value = iroh.safeValue(d.value, 3, new Set());
        entry.applied = true;
        entry.appliedVia = "init";
        return true;
      }
      // Plain assignment `x = v`: the patched code is
      // `x = DEBUG_ASSIGN(...)`, so event.result IS the new value of x.
      // Compound assignments (`x += v`) pass only the right-hand value
      // through event.result, and member assignments are already
      // written before the event fires — neither is a set point.
      if (
        raw.type === INSTR.ASSIGN &&
        trigger === "fire" &&
        raw.object === d.name &&
        raw.property === null &&
        scopeMatches(d)
      ) {
        let node = null;
        try {
          node = raw.getASTNode();
        } catch (e) {
          node = null;
        }
        if (node !== null && node.operator === "=") {
          raw.result = d.value;
          line.result = iroh.safeValue(d.value, 3, new Set());
          entry.applied = true;
          entry.appliedVia = "assign";
          return true;
        }
      }
      // Member assignment `obj.prop = v` (or `obj.prop += v`): the
      // write already happened before the event fires, so a set for
      // "obj.prop" overwrites the property on the live object. The
      // object variable name comes from the AST — the event carries
      // the object itself, not its name. A setter property runs twice
      // (once for the original write, once for the overwrite), so use
      // this on plain data properties. The recorded line is updated
      // alongside (result and the object projection) so the trace
      // shows the directed value.
      if (
        raw.type === INSTR.ASSIGN &&
        trigger === "fire" &&
        raw.property !== null &&
        d.name.indexOf(".") !== -1 &&
        scopeMatches(d)
      ) {
        let parts = d.name.split(".");
        let node = null;
        try {
          node = raw.getASTNode();
        } catch (e) {
          node = null;
        }
        if (
          node !== null &&
          node.left &&
          node.left.type === "MemberExpression" &&
          node.left.object &&
          node.left.object.type === "Identifier" &&
          node.left.object.name === parts[0]
        ) {
          let propName = null;
          if (!node.left.computed && node.left.property) {
            propName = node.left.property.name;
          } else if (
            node.left.computed &&
            node.left.property &&
            node.left.property.type === "Literal"
          ) {
            propName = String(node.left.property.value);
          }
          if (
            propName === parts[1] &&
            raw.property === parts[1] &&
            raw.object !== null &&
            typeof raw.object === "object"
          ) {
            try {
              raw.object[raw.property] = d.value;
            } catch (e) {
              return false;
            }
            line.result = iroh.safeValue(d.value, 3, new Set());
            line.object = iroh.safeValue(raw.object, 3, new Set());
            entry.applied = true;
            entry.appliedVia = "member";
            entry.note =
              "Member assignment: the write had already happened when the event fired, so the property was overwritten on the live object" +
              (node.operator === "=" ? "" : " (compound " + node.operator + " — the overwrite replaces the computed result)") +
              "; a setter property would run twice.";
            return true;
          }
        }
      }
      // Loop test: the loop compares this variable with a literal
      // bound. Flip the test to false only when the set value makes
      // the comparison false — a set that keeps the test true is not
      // applied here (it may still apply at a later assignment).
      if (
        raw.type === INSTR.LOOP_TEST &&
        trigger === "test" &&
        raw.value === true &&
        scopeMatches(d)
      ) {
        let info = resolveLoopTest(stage, raw.hash);
        if (info !== null && info.counter === d.name) {
          let testValue = compareWith(info.operator, d.value, info.bound);
          if (testValue === false) {
            raw.value = false;
            line.value = false;
            entry.applied = true;
            entry.appliedVia = "loop-test";
            entry.note =
              "Counter advances by ++, so no assignment point exists; the loop test was flipped to false, which is equivalent to the counter having passed its limit (" +
              d.value +
              " " +
              info.operator +
              " " +
              info.bound +
              " is false).";
            return true;
          }
        }
      }
    } else if (d.type === "skip") {
      // The call has not run yet: replace the callee with a stub
      // returning the director's value. The real function never
      // executes — no FUNCTION_ENTER, no side effects — and the call
      // expression evaluates to the stub's return.
      if (
        raw.type === INSTR.FUNCTION_CALL &&
        trigger === "before" &&
        raw.name === d.name
      ) {
        let value = d.value;
        raw.call = function () {
          return value;
        };
        entry.applied = true;
        entry.appliedVia = "call";
        return true;
      }
    }
    return false;
  }

  // Issue the director's answer: validate each directive, record it,
  // queue set/skip as pending, and stop immediately on a stop. A skip
  // issued in response to the current event applies to that very call
  // when it matches — the call has not run yet. A set does not apply
  // to the current event (see the header comment).
  function issueDirectives(answer, issuedAtEvent, raw, trigger, line) {
    let list = normalizeDirectives(answer);
    for (let ii = 0; ii < list.length; ++ii) {
      let d = validateDirective(list[ii]);
      let entry = recordDirective(d, issuedAtEvent);
      if (d.type === "stop") {
        stopped = true;
        stopReason = d.reason;
        stopPending = true;
        stopEntry = entry;
        if (onDirective) onDirective(entry);
        throw DIRECTOR_STOP;
      }
      pending.push(entry);
      if (raw !== null && d.type === "skip" && applyEntry(entry, raw, trigger, line)) {
        entry.appliedAtEvent = issuedAtEvent;
        let at = pending.indexOf(entry);
        if (at !== -1) pending.splice(at, 1);
        if (onDirective) onDirective(entry);
      }
    }
  }

  // Enrich a HOT_LOOP finding with its loop info (a copy — the live
  // analyzer's own finding objects stay clean). The guard uses it to
  // decide whether the loop can be throttled by setting its counter.
  function enrichFindings(fired) {
    let out = [];
    for (let ii = 0; ii < fired.length; ++ii) {
      let f = fired[ii];
      if (
        f.code === "HOT_LOOP" &&
        f.evidence &&
        typeof f.evidence.hash === "number"
      ) {
        let info = resolveLoopTest(stage, f.evidence.hash);
        if (info !== null) {
          out.push(Object.assign({}, f, { loop: info }));
          continue;
        }
      }
      out.push(f);
    }
    return out;
  }

  // The raw-event hook: pending directives first, then the live
  // analyzer, then the director on new findings. Runs synchronously
  // inside the DEBUG call, so every mutation here takes effect in the
  // running program.
  function handleRaw(raw, trigger, line) {
    // A stop that was swallowed (a program inside try/catch can catch
    // the sentinel once) is re-thrown at every following event until
    // it propagates out or the program ends.
    if (stopPending) throw DIRECTOR_STOP;
    let eventIndex = run.events.length - 1;
    for (let ii = pending.length - 1; ii >= 0; --ii) {
      let entry = pending[ii];
      if (applyEntry(entry, raw, trigger, line)) {
        entry.appliedAtEvent = eventIndex;
        pending.splice(ii, 1);
        if (onDirective) onDirective(entry);
      }
    }
    let fired = live.feed(line);
    if (fired.length > 0) {
      let enriched = enrichFindings(fired);
      if (director) {
        let answer = director({
          findings: enriched,
          allFindings: live.findings(),
          snapshot: live.snapshot(),
          event: line,
          eventIndex: eventIndex,
          directives: log.slice(),
        });
        issueDirectives(answer, eventIndex, raw, trigger, line);
      }
      // Live findings as they fire, for a caller that wants to print
      // them (the CLI --live flag) without being the director.
      if (options.onFinding) options.onFinding(enriched);
    }
  }

  // Parse errors reject/throw before anything runs; the two errors
  // users hit most often get a pointer at the right entry point
  // (directAsync / directModule) instead of createTraceRun's
  // traceAsync / traceModule pointers.
  let runOptions = Object.assign({}, options, { events: "ALL", rawOnEvent: handleRaw });
  if (allowAsync) {
    runOptions.stageOptions = Object.assign({}, options.stageOptions, {
      allowAwaitOutsideFunction: true,
    });
  }
  if (isModule) {
    runOptions.stageOptions = Object.assign({}, options.stageOptions, {
      sourceType: "module",
    });
  }
  try {
    run = runInternals.createTraceRun(iroh, code, runOptions);
  } catch (e) {
    if (e instanceof Error && typeof e.message === "string" && !isModule) {
      if (e.message.indexOf("This program uses top-level await") === 0) {
        throw new Error(
          "This program uses top-level await — run it with Iroh.directAsync() (or Iroh.directModule() for modules); Iroh.direct() runs synchronously"
        );
      }
      if (e.message.indexOf("This program uses import/export") === 0) {
        throw new Error(
          "This program uses import/export (or import.meta) — direct it with Iroh.directModule(); Iroh.direct() and Iroh.directAsync() run scripts only"
        );
      }
    }
    throw e;
  }
  stage = run.stage;
  let runner = isModule ? null : runInternals.compileRunner(iroh, run.stage, allowAsync);

  // The run completed normally: directives that never matched stay in
  // the audit log as unapplied, with the reason — the log never
  // pretends one took effect. A stop that was swallowed the same way:
  // the run completed, so the stop did not take effect.
  function finishSuccess(result) {
    for (let ii = 0; ii < pending.length; ++ii) {
      pending[ii].note =
        "Never applied: no matching interception point was reached before the run ended.";
    }
    if (stopPending && stopEntry !== null) {
      stopEntry.applied = false;
      stopEntry.note =
        "Stop requested but the program caught the director's stop signal and ran to completion — a program that swallows every thrown value defeats a stop.";
    }
    let summary = live.finish();
    return {
      result: result,
      stopped: false,
      stopReason: null,
      events: run.events,
      findings: summary.findings,
      directives: log,
      analysis: summary,
    };
  }

  // The run ended by a directed stop or an error. A directed stop is
  // a normal outcome, not an error: the analysis is the live finish()
  // over the trace as it stands — a loop the run never reached counts
  // as zero-iteration in the recorded trace. A runtime error (or a
  // director bug) throws with the trace so far attached, like trace(),
  // plus the direction record so far.
  function finishError(e) {
    if (e === DIRECTOR_STOP) {
      if (stopEntry !== null) {
        stopEntry.applied = true;
        stopEntry.appliedAtEvent = run.events.length - 1;
        stopEntry.appliedVia = "stop";
      }
      let summary = live.finish();
      return {
        result: void 0,
        stopped: true,
        stopReason: stopReason,
        events: run.events,
        findings: summary.findings,
        directives: log,
        analysis: summary,
      };
    }
    runInternals.attachTraceEvents(e, run.events);
    e.direct = {
      result: void 0,
      stopped: false,
      stopReason: null,
      events: run.events,
      findings: live.findings(),
      directives: log,
      analysis: live.snapshot(),
    };
    throw e;
  }

  let result;
  try {
    // Start call: the director may issue initial directives (e.g. skip
    // a call from the outset) before the first event fires.
    if (director) {
      let answer = director({
        findings: [],
        allFindings: [],
        snapshot: live.snapshot(),
        event: null,
        eventIndex: -1,
        directives: [],
      });
      issueDirectives(answer, -1, null, null, null);
    }
    if (isModule) {
      // The module runs through the temp-file import; its result is
      // the namespace (like traceModule()), and a directed stop thrown
      // from a listener rejects the import with the sentinel, which
      // finishError turns into the stopped record.
      return runInternals.importTracedModule(iroh, run, options).then(
        function(out) { return finishSuccess(out.result); },
        finishError
      );
    }
    if (allowAsync) {
      return runner(iroh).then(finishSuccess, finishError);
    }
    result = runner(iroh);
  } catch (e) {
    return finishError(e);
  }
  return finishSuccess(result);
}

// Synchronous directed run: direct() in the 1.0.0 sense.
function direct(code, director, options) {
  return directInternal(this, code, director, options, "sync");
}

// Async directed run: the same engine, but the program runs through
// compileRunner's async wrapper, so top-level await works and async
// continuations are included. Returns a Promise of the directed
// record. A parse error or module code rejects (never throws
// synchronously) — like traceAsync() — and a runtime error rejects
// with the events that fired before it attached as error.events and
// the direction record so far as error.direct.
function directAsync(code, director, options) {
  let out;
  try {
    out = directInternal(this, code, director, options, "async");
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(out);
}

// Module directed run: the same engine, but the program runs as an ES
// module through the temp-file import, so import/export and top-level
// await both work. Returns a Promise of the directed record; the
// record's result is the module namespace (like traceModule()).
// Options.filename bases relative imports, as in traceModule(). A
// parse error rejects before running; a runtime error rejects with the
// events that fired before it attached as error.events and the
// direction record so far as error.direct. Requires Node.js.
function directModule(code, director, options) {
  let out;
  try {
    out = directInternal(this, code, director, options, "module");
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(out);
}

// The built-in director: a runaway-loop guard. When HOT_LOOP fires it
// throttles by default — it sets the loop's counter to the value that
// makes its test false, so the loop exits at the next test — or, with
// { action: "stop" }, it stops the run with a reason. A loop whose
// counter cannot be resolved (while(true), a non-literal bound, a
// compound test, == / ===) cannot be throttled, so the guard stops
// the run instead and says so. The guard is a factory: it returns the
// director function, so one guard instance directs one run.
function runawayGuard(options) {
  options = options || {};
  let action = options.action || "throttle";
  if (action !== "throttle" && action !== "stop") {
    throw new Error(
      "runawayGuard action must be \"throttle\" or \"stop\", got: " + action
    );
  }
  return function guard(ctx) {
    let out = [];
    for (let ii = 0; ii < ctx.findings.length; ++ii) {
      let f = ctx.findings[ii];
      if (f.code !== "HOT_LOOP") continue;
      let hash =
        f.evidence && f.evidence.hash !== void 0 ? "#" + f.evidence.hash : "";
      let count =
        f.evidence && f.evidence.iterations !== void 0
          ? f.evidence.iterations
          : "?";
      let threshold =
        f.evidence && f.evidence.threshold !== void 0
          ? f.evidence.threshold
          : "?";
      if (action === "stop" || !f.loop || f.loop.value === null) {
        let why =
          action === "stop"
            ? "stopping the run by policy"
            : "its counter could not be resolved (the test is not a simple counter comparison against a numeric limit), so the run stops instead of throttling";
        out.push({
          type: "stop",
          reason:
            "Runaway loop guard: loop " +
            hash +
            " entered " +
            count +
            " times (threshold " +
            threshold +
            "); " +
            why +
            ".",
        });
      } else {
        out.push({ type: "set", name: f.loop.counter, value: f.loop.value });
      }
    }
    if (out.length === 0) return null;
    if (out.length === 1) return out[0];
    return out;
  };
}


var _direct = Object.freeze({
	direct: direct,
	directAsync: directAsync,
	directModule: directModule,
	runawayGuard: runawayGuard
});

// Hybrid translation engine for IrohRedux 0.8.0 — JavaScript ->
// Python / C++, Python -> JavaScript, C++ -> JavaScript.
//
//   Iroh.translate(code, { from, to })      -> { code, report } (sync)
//   Iroh.translateAsync(code, { from, to }) -> Promise of the same
//
// `from` defaults to "javascript"; `to` is "python" | "cpp" |
// "javascript". The JavaScript-out leg is hybrid: the AST (static)
// plus trace evidence (dynamic — the program is run through the
// tracer first and the events resolve what static analysis can't:
// runtime types, values, which branches fired). The reverse legs
// (Python -> JS, C++ -> JS) are static-only — there is no tracer
// for Python or C++, and the report says so (staticOnly: true).
//
// The report shape is the same every leg:
//   { ok, from, to, staticOnly, clean, assumptions, unsupported, notes, verify }
// `ok` is false when anything was unsupported. Unsupported constructs
// are reported, never silently mistranslated: the emitted code
// raises/throws at that point, loudly, and the report names the
// construct. Assumptions cite their trace evidence.
//
// v1 construct scope (both directions): functions, arithmetic,
// loops, conditionals, arrays (lists / vectors), strings, console
// output (console.log / print / std::cout). No classes, no
// closures-as-objects, no async in v1.
//
// Python -> JS parses with Python's own `ast` module: a small
// stdlib-only Python helper (embedded below) is run through python3
// and emits the AST as JSON; the JS side translates that AST. No
// hand-rolled Python parser. C++ -> JS uses a scoped subset parser
// written here (src/translate.js) — anything outside the subset is
// reported unsupported, never guessed at.
//
// Buble: no async/await, no for...of in this file (browser bundle).
// The Python leg needs Node.js (child_process) + python3 on PATH;
// in the browser / ESM builds translate() throws a clear error and
// translateAsync() is the way in (it loads child_process by dynamic
// import).

// ------------------------------------------------------------------
// Report + shared helpers
// ------------------------------------------------------------------

function newReport(from, to, staticOnly) {
  return {
    ok: true,
    from: from,
    to: to,
    staticOnly: staticOnly,
    clean: [],
    assumptions: [],
    unsupported: [],
    notes: [],
  };
}

function markUnsupported(report, construct, message) {
  report.ok = false;
  report.unsupported.push({ construct: construct, message: message });
}

function recordAssumption(report, what, evidence) {
  report.assumptions.push({ what: what, evidence: evidence });
}

// 1.0.1 patch (Fix Spec 3.7): verify the emitted Python actually
// runs. `report.ok` answers "did I produce text"; every user reads
// it as "will this run". The verify block closes that gap: the
// emitted program is executed under python3 (fed on stdin as
// `python3 -`, 10 s cap) and the result is recorded on the report.
// ran: null is not ran: true — when no interpreter is present the
// block says attempted: false instead of omitting the field. When
// ran is false the interpreter's stderr is carried verbatim: the
// exact SyntaxError line is what lets a reader find the defect.
// The interpreter probe is cached per process (PATH does not change
// mid-process); the run itself is not cached — every translation is
// verified fresh. A translated program that reads stdin sees EOF:
// `python3 -` consumes stdin as the program itself.
let _pyVerifyProbe = null; // { cmd, version } | { missing: true, cmd }
function probePython(cp) {
  if (_pyVerifyProbe) return _pyVerifyProbe;
  let cmd = (typeof process !== "undefined" && process && process.env && process.env.IROH_PYTHON) || "python3";
  try {
    let p = cp.spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 10000 });
    if (p.status === 0) {
      let v = ((p.stdout || "") + (p.stderr || "")).trim().replace(/^Python /, "");
      _pyVerifyProbe = { cmd: cmd, version: v };
      return _pyVerifyProbe;
    }
  } catch (e) {
    // Fall through to missing.
  }
  _pyVerifyProbe = { missing: true, cmd: cmd };
  return _pyVerifyProbe;
}

function verifyEmittedPython(report, code, options) {
  if (options.verify === false) {
    report.verify = { attempted: false, ran: null, reason: "verify disabled (options.verify: false)" };
    return;
  }
  let cp = getChildProcessSync();
  if (!cp) {
    report.verify = { attempted: false, ran: null, reason: "no child_process (browser / ESM build without Node)" };
    return;
  }
  let probe = probePython(cp);
  if (probe.missing) {
    report.verify = { attempted: false, ran: null, reason: "no " + probe.cmd + " on PATH" };
    return;
  }
  let run;
  try {
    run = cp.spawnSync(probe.cmd, ["-"], { input: code, encoding: "utf8", timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: null, stderr: "verify spawn failed: " + (e.message || String(e)) };
    return;
  }
  if (run.error) {
    if (run.error.code === "ETIMEDOUT") {
      report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: null, stderr: "verify timed out after 10 s (emitted program did not finish)" };
    } else {
      report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: null, stderr: "verify spawn failed: " + (run.error.message || String(run.error)) };
    }
    return;
  }
  if (run.status === 0) {
    report.verify = { attempted: true, ran: true, interpreter: probe.version, exit: 0 };
  } else {
    report.verify = { attempted: true, ran: false, interpreter: probe.version, exit: run.status, stderr: run.stderr || "" };
  }
}

// C++ type of a traced (safeValue-serialized) runtime value.
// Returns "int" | "double" | "std::string" | "bool" |
// "std::vector<T>" | null (unknown). safeValue markers ("[Function
// ...]", "[Object]", ...) are not real values.
function cppTypeOfValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "double";
  }
  if (typeof value === "string") {
    if (
      value.indexOf("[Function ") === 0 ||
      value === "[Object]" ||
      value === "[Circular]" ||
      value === "[Promise]" ||
      value === "[Unserializable]"
    ) {
      return null;
    }
    return "std::string";
  }
  if (typeof value === "boolean") return "bool";
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    let inner = cppTypeOfValue(value[0]);
    return inner ? "std::vector<" + inner + ">" : null;
  }
  return null;
}

function isIdentifierName(s) {
  return typeof s === "string" && /^[A-Za-z_$][\w$]*$/.test(s);
}

// Build the dynamic evidence environment from trace events:
//   vars:   name -> { value, type } from VAR_INIT / ASSIGN
//   funcs:  name -> { args, returns } from FUNCTION_CALL / FUNCTION_RETURN
//   called: names with at least one call
//   ifOutcomes: hash -> { trueCount, falseCount } from IF_TEST
function buildTraceEnv(events) {
  let env = { vars: {}, funcs: {}, called: {}, ifOutcomes: {} };
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "VAR_INIT" && e.name && e.value !== void 0) {
      if (!(e.name in env.vars)) {
        env.vars[e.name] = { value: e.value, type: cppTypeOfValue(e.value) };
      }
    } else if (
      e.event === "ASSIGN" &&
      isIdentifierName(e.object) &&
      e.value !== void 0
    ) {
      if (!(e.object in env.vars)) {
        env.vars[e.object] = { value: e.value, type: cppTypeOfValue(e.value) };
      }
    } else if (e.event === "FUNCTION_CALL" && e.trigger === "before" && e.name) {
      env.called[e.name] = true;
      if (!env.funcs[e.name]) {
        env.funcs[e.name] = { args: e.arguments || [], returns: null, calls: [], returnValues: [] };
      }
      // Every call's arguments, not just the first: a later call with
      // a different argument type must not silently reuse the first
      // call's signature (see the ctx seeding below).
      env.funcs[e.name].calls.push(e.arguments || []);
    } else if (e.event === "FUNCTION_RETURN" && e.name) {
      if (!env.funcs[e.name]) {
        env.funcs[e.name] = { args: null, returns: null, calls: [], returnValues: [] };
      }
      if (e.return !== void 0) {
        env.funcs[e.name].returnValues.push(e.return);
        if (env.funcs[e.name].returns === null) {
          env.funcs[e.name].returns = e.return;
        }
      }
    } else if (e.event === "IF_TEST") {
      let g = env.ifOutcomes[e.hash];
      if (!g) g = env.ifOutcomes[e.hash] = { trueCount: 0, falseCount: 0 };
      if (e.value === true) g.trueCount += 1;
      else if (e.value === false) g.falseCount += 1;
    }
  }
  return env;
}

// Static C++ type inference for an expression node, using the
// variable/function types known so far (ctx.vars / ctx.funcs map
// names to C++ type strings). Returns a type string or null.
function inferType(node, ctx) {
  if (!node || typeof node.type !== "string") return null;
  switch (node.type) {
    case "Literal": {
      if (typeof node.value === "number") {
        // Only a safe integer is a C++ int: JS numbers are doubles,
        // and a literal like 1e21 is integer-valued but cannot be a
        // C++ int (nor a long long) — String(1e21) must format as
        // "1e+21", not std::to_string's full digits.
        return Number.isSafeInteger(node.value) ? "int" : "double";
      }
      if (typeof node.value === "string") return "std::string";
      if (typeof node.value === "boolean") return "bool";
      return null;
    }
    case "Identifier":
      return ctx.vars[node.name] || null;
    case "ArrayExpression": {
      if (node.elements.length === 0) return null;
      let inner = inferType(node.elements[0], ctx);
      return inner ? "std::vector<" + inner + ">" : null;
    }
    case "TemplateLiteral":
      return "std::string";
    case "BinaryExpression":
    case "LogicalExpression": {
      let op = node.operator;
      if (op === "==" || op === "!=" || op === "===" || op === "!==" ||
          op === "<" || op === ">" || op === "<=" || op === ">=" ||
          op === "&&" || op === "||" || op === "in" || op === "instanceof") {
        return "bool";
      }
      if (op === "+") {
        let lt = inferType(node.left, ctx);
        let rt = inferType(node.right, ctx);
        if (lt === "std::string" || rt === "std::string") return "std::string";
      }
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      if (lt === null || rt === null) return null;
      if (lt === "double" || rt === "double") return "double";
      if (lt === "int" && rt === "int") return "int";
      return null;
    }
    case "UnaryExpression": {
      if (node.operator === "!") return "bool";
      if (node.operator === "-" || node.operator === "+") {
        return inferType(node.argument, ctx);
      }
      return null;
    }
    case "UpdateExpression":
      return inferType(node.argument, ctx);
    case "AssignmentExpression":
      return inferType(node.right, ctx);
    case "ConditionalExpression": {
      let t = inferType(node.consequent, ctx);
      let a = inferType(node.alternate, ctx);
      return t !== null && t === a ? t : null;
    }
    case "SequenceExpression":
      return inferType(node.expressions[node.expressions.length - 1], ctx);
    case "CallExpression": {
      if (node.callee.type === "Identifier") {
        let name = node.callee.name;
        if (ctx.funcs[name] && ctx.funcs[name].returns) {
          return ctx.funcs[name].returns;
        }
        if (name === "String") return "std::string";
        if (name === "Number" || name === "parseFloat") return "double";
        if (name === "parseInt") return "int";
        if (name === "Boolean") return "bool";
      }
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Math"
      ) {
        let prop = node.callee.property.name;
        if (prop === "floor" || prop === "ceil" || prop === "round" || prop === "trunc") {
          return "int";
        }
        if (prop === "pow" || prop === "sqrt" || prop === "abs" || prop === "max" || prop === "min") {
          return "double";
        }
      }
      return null;
    }
    case "MemberExpression": {
      if (
        node.property &&
        ((node.property.type === "Identifier" && node.property.name === "length") ||
          (node.property.type === "Literal" && node.property.value === "length"))
      ) {
        return "int";
      }
      return null;
    }
    default:
      return null;
  }
}

// Precedence table for parenthesization (higher binds tighter).
function precedence(node) {
  if (!node || typeof node.type !== "string") return 16;
  switch (node.type) {
    case "AssignmentExpression": return 1;
    case "ConditionalExpression": return 2;
    case "LogicalExpression":
      return node.operator === "||" ? 3 : 4;
    case "BinaryExpression": {
      let op = node.operator;
      if (op === "|") return 5;
      if (op === "^") return 6;
      if (op === "&") return 7;
      if (op === "==" || op === "!=" || op === "===" || op === "!==") return 8;
      if (op === "<" || op === ">" || op === "<=" || op === ">=" ||
          op === "in" || op === "instanceof") return 9;
      if (op === "<<" || op === ">>" || op === ">>>") return 10;
      if (op === "+" || op === "-") return 11;
      if (op === "*" || op === "/" || op === "%") return 12;
      if (op === "**") return 13;
      return 12;
    }
    case "UnaryExpression":
    case "UpdateExpression": return 14;
    case "CallExpression":
    case "MemberExpression": return 15;
    default: return 16;
  }
}

// ------------------------------------------------------------------
// JavaScript -> Python / C++ emitter
// ------------------------------------------------------------------

// Escape a message for embedding as a string literal (valid in both
// Python and C++).
function quotedMessage(msg) {
  return JSON.stringify(String(msg));
}

function makeJSEmitter(target, report, env, hints) {
  let isPy = target === "python";
  let lines = [];
  let indentLevel = 0;
  let needs = { math: false, random: false, cmath: false, algorithm: false, stdexcept: false, vectorHelper: false, unsupportedHelper: false, cout: false, jsmod: false, jsnum: false, jsbool: false };
  let noted = {};
  function noteOnce(key, text) {
    if (!noted[key]) {
      noted[key] = true;
      report.notes.push(text);
    }
  }
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  // C++ type context: variable name -> C++ type string; function
  // name -> { params: [types], returns: type }.
  let ctx = { vars: {}, funcs: {} };
  // Seed the type context from trace evidence.
  let varNames = Object.keys(env.vars);
  for (let ii = 0; ii < varNames.length; ++ii) {
    let v = env.vars[varNames[ii]];
    if (v.type) ctx.vars[varNames[ii]] = v.type;
  }
  let funcNames = Object.keys(env.funcs);
  for (let ii = 0; ii < funcNames.length; ++ii) {
    let f = env.funcs[funcNames[ii]];
    let params = null;
    let paramsConflict = null;
    if (f.args) {
      params = [];
      for (let jj = 0; jj < f.args.length; ++jj) {
        params.push(cppTypeOfValue(f.args[jj]));
      }
      // A later call with a different argument type is a conflict,
      // not a reason to silently reuse the first call's signature.
      // cppSignature refuses the function when one is recorded.
      if (f.calls) {
        for (let jj = 0; jj < params.length; ++jj) {
          for (let kk = 1; kk < f.calls.length; ++kk) {
            let t = cppTypeOfValue(f.calls[kk][jj]);
            if (t !== null && params[jj] !== null && t !== params[jj]) {
              if (!paramsConflict) paramsConflict = [];
              paramsConflict.push({ index: jj, first: params[jj], other: t, call: kk });
              break;
            }
          }
        }
      }
    }
    // Same for returns: differing return types across calls.
    let returnsConflict = null;
    if (f.returnValues && f.returnValues.length > 1) {
      let first = cppTypeOfValue(f.returnValues[0]);
      for (let kk = 1; kk < f.returnValues.length; ++kk) {
        let t = cppTypeOfValue(f.returnValues[kk]);
        if (t !== null && first !== null && t !== first) {
          returnsConflict = { first: first, other: t, call: kk };
          break;
        }
      }
    }
    ctx.funcs[funcNames[ii]] = {
      params: params,
      returns: f.returns !== null && f.returns !== void 0 ? cppTypeOfValue(f.returns) : null,
      // Raw evidence, kept so assumptions can cite it.
      args: f.args || null,
      returnValue: f.returns !== null && f.returns !== void 0 ? f.returns : null,
      paramsFrom: params ? "trace" : null,
      returnsFrom: f.returns !== null && f.returns !== void 0 ? "trace" : null,
      paramsConflict: paramsConflict,
      returnsConflict: returnsConflict,
      callCount: f.calls ? f.calls.length : 0,
      returnCount: f.returnValues ? f.returnValues.length : 0,
    };
  }
  if (hints && hints.functions) {
    let hNames = Object.keys(hints.functions);
    for (let ii = 0; ii < hNames.length; ++ii) {
      let h = hints.functions[hNames[ii]];
      let entry = ctx.funcs[hNames[ii]] || { params: null, returns: null, args: null, returnValue: null, paramsFrom: null, returnsFrom: null };
      if (h.params) { entry.params = h.params.slice(); entry.paramsFrom = "hint"; }
      if (h.returns) { entry.returns = h.returns; entry.returnsFrom = "hint"; }
      ctx.funcs[hNames[ii]] = entry;
    }
  }
  if (hints && hints.variables) {
    let hNames = Object.keys(hints.variables);
    for (let ii = 0; ii < hNames.length; ++ii) {
      ctx.vars[hNames[ii]] = hints.variables[hNames[ii]];
    }
  }

  function indentStr() {
    if (isPy) return "    ".repeat(indentLevel);
    return "  ".repeat(indentLevel);
  }
  function emitLine(text) {
    lines.push(indentStr() + text);
  }
  function stubExpr(detail) {
    if (isPy) {
      needs.unsupportedHelper = true;
      return '_iroh_unsupported(' + quotedMessage(detail) + ')';
    }
    needs.stdexcept = true;
    return '(throw std::runtime_error(' + quotedMessage("IrohRedux: " + detail) + '))';
  }
  function stubStmt(detail) {
    if (isPy) {
      return 'raise NotImplementedError(' + quotedMessage("IrohRedux: " + detail) + ')';
    }
    needs.stdexcept = true;
    return 'throw std::runtime_error(' + quotedMessage("IrohRedux: " + detail) + ');';
  }
  function unsupportedExpr(detail, construct) {
    markUnsupported(report, construct, detail);
    return stubExpr(detail);
  }
  function unsupportedStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    emitLine(stubStmt(detail));
  }

  // Wrap a child expression in parens when its precedence is lower
  // than the parent context's.
  function paren(exprStr, childNode, parentPrec) {
    if (precedence(childNode) < parentPrec) return "(" + exprStr + ")";
    return exprStr;
  }

  function literalValue(node) {
    if (node.regex) return unsupportedExpr("regular expression literal", "Literal");
    if (node.value === null) {
      if (isPy) return "None";
      return unsupportedExpr("null literal has no C++ equivalent in v1", "Literal");
    }
    if (typeof node.value === "number") {
      if (Number.isNaN(node.value)) {
        if (!isPy) needs.cmath = true;
        return isPy ? "float('nan')" : "NAN";
      }
      if (node.value === Infinity) {
        if (!isPy) needs.cmath = true;
        return isPy ? "float('inf')" : "INFINITY";
      }
      if (node.value === -Infinity) {
        if (!isPy) needs.cmath = true;
        return isPy ? "float('-inf')" : "-INFINITY";
      }
      return String(node.value);
    }
    if (typeof node.value === "string") return JSON.stringify(node.value);
    if (typeof node.value === "boolean") return isPy ? (node.value ? "True" : "False") : (node.value ? "true" : "false");
    return unsupportedExpr("literal of unsupported type", "Literal");
  }

  // Python helper: render an expression as a string for concatenation.
  // Python "+" refuses str + number at runtime, so non-strings must be
  // converted — str() for ints, the JS "true"/"false" ternary for
  // bools, __iroh_jsnum for doubles (str() formats 1e16 as "1e+16",
  // where JS prints "10000000000000000").
  function pyStringOf(node) {
    let t = inferType(node, ctx);
    let s = expr(node, 16);
    if (t === "std::string") return s;
    if (t === "int") return "str(" + s + ")";
    if (t === "bool") return '("true" if ' + s + ' else "false")';
    if (t === "double") {
      needs.jsnum = true;
      return "__iroh_jsnum(" + s + ")";
    }
    if (t && t.indexOf("std::vector<") === 0) {
      return unsupportedExpr(
        "string concatenation of an array in Python (JS joins with commas; Python str() prints brackets)",
        "BinaryExpression"
      );
    }
    recordAssumption(
      report,
      "string concatenation operand assumed to be a string",
      "No static or trace type for the operand; emitted as-is"
    );
    return s;
  }

  // C++ helper: render an expression as a string for concatenation.
  // Every result must be a real std::string: a bare string literal is
  // const char*, and `"a" + const char*` is pointer arithmetic, not
  // concatenation — so literals and the bool ternary (whose arms are
  // literals) are wrapped in std::string(...).
  function cppStringOf(node) {
    let t = inferType(node, ctx);
    let s = expr(node, 16);
    if (t === "std::string") {
      if (node.type === "Literal" && typeof node.value === "string") return "std::string(" + s + ")";
      return s;
    }
    if (t === "int") return "std::to_string(" + s + ")";
    if (t === "bool") return "std::string(((" + s + ') ? "true" : "false"))';
    if (t === "double") {
      // JS Number -> string: the shortest decimal that round-trips,
      // formatted the way JS String(v) formats it (see __iroh_jsnum).
      needs.jsnum = true;
      return "__iroh_jsnum(" + s + ")";
    }
    recordAssumption(
      report,
      "string concatenation operand assumed to be a string",
      "No static or trace type for the operand; emitted as std::string(...)"
    );
    return "std::string(" + s + ")";
  }

  function templateLiteral(node) {
    if (isPy) {
      // 1.0.1 patch (Fix Spec 3.5 Option 1): concatenation, NOT an
      // f-string. Property P1 (spec 3.2): on Python before 3.12 a
      // replacement field cannot contain the delimiter quote, a
      // backslash, # or an unbalanced brace/colon — and every branch
      // that pushed a raw expression into {...} violated it in
      // principle. In 1.0.1 that was four branches, not one: string
      // literals, ternaries of strings, literal text + a field, and
      // the bool branch, which emitted an inline ("true" if v else
      // "false") ternary inside the field (1.1.1 fixed bool only, as
      // D1). All four emitted SyntaxErrors on 3.9-3.11 while the
      // report said ok. Concatenation has no delimiter rules: the
      // expression sits in ordinary parentheses. Literal text is
      // emitted with JSON.stringify — a real serialiser, not the
      // hand-rolled regex chain (which missed newlines and other
      // control characters). One deviation from the spec's sketch:
      // ints go through str(), not bare — "a" + 5 is a TypeError in
      // Python, so the sketch's bare push for int would have traded
      // a SyntaxError for a runtime error.
      let parts = [];
      for (let ii = 0; ii < node.quasis.length; ++ii) {
        let q = node.quasis[ii];
        let raw = q.value.cooked !== void 0 && q.value.cooked !== null ? q.value.cooked : q.value.raw;
        if (raw !== "") parts.push(JSON.stringify(raw));
        if (ii < node.expressions.length) {
          let e = node.expressions[ii];
          let t = inferType(e, ctx);
          if (t === "std::string") {
            parts.push(expr(e, 16));
          } else if (t === "int") {
            parts.push("str(" + expr(e, 16) + ")");
          } else if (t === "bool") {
            // A bool interpolates as "true"/"false" (Python str()
            // would print "True"). Route through the helper, same
            // pattern as __iroh_jsnum for doubles.
            needs.jsbool = true;
            parts.push("__iroh_jsbool(" + expr(e, 16) + ")");
          } else if (t === "double") {
            needs.jsnum = true;
            parts.push("__iroh_jsnum(" + expr(e, 16) + ")");
          } else if (t && t.indexOf("std::vector<") === 0) {
            return unsupportedExpr(
              "template literal interpolation of an array in Python (JS joins with commas; Python str() prints brackets)",
              "TemplateLiteral"
            );
          } else {
            // Unknown type: str() is JS ToString's closest honest
            // neighbour (an object prints its repr, not
            // "[object Object]" — a recorded approximation, not a
            // syntax landmine).
            recordAssumption(
              report,
              "template literal interpolation coerced with str()",
              "No static or trace type for the interpolation"
            );
            parts.push("str(" + expr(e, 16) + ")");
          }
        }
      }
      return "(" + (parts.length ? parts.join(" + ") : '""') + ")";
    }
    // C++: "a" + std::to_string(x) + "b" — string/integral/double
    // interpolations; doubles go through __iroh_jsnum so they print
    // the way JS does (std::to_string would print 6 decimals).
    let parts = [];
    for (let ii = 0; ii < node.quasis.length; ++ii) {
      let q = node.quasis[ii];
      let raw = q.value.cooked !== void 0 && q.value.cooked !== null ? q.value.cooked : q.value.raw;
      if (raw !== "") parts.push("std::string(" + JSON.stringify(raw) + ")");
      if (ii < node.expressions.length) {
        let e = node.expressions[ii];
        let t = inferType(e, ctx);
        if (t === "std::string") parts.push(expr(e, 16));
        else if (t === "int") parts.push("std::to_string(" + expr(e, 16) + ")");
        else if (t === "bool") parts.push("((" + expr(e, 16) + ') ? "true" : "false")');
        else if (t === "double") {
          needs.jsnum = true;
          parts.push("__iroh_jsnum(" + expr(e, 16) + ")");
        } else {
          return unsupportedExpr(
            "template literal interpolation of non-string, non-integer, non-double value in C++",
            "TemplateLiteral"
          );
        }
      }
    }
    if (parts.length === 0) return 'std::string("")';
    return parts.join(" + ");
  }

  function memberExpr(node) {
    let obj = expr(node.object, 15);
    if (!node.computed) {
      let prop = node.property.name !== void 0 ? node.property.name : node.property.value;
      if (prop === "length") {
        if (isPy) return "len(" + obj + ")";
        return obj + ".size()";
      }
      return obj + "." + prop;
    }
    return obj + "[" + expr(node.property, 16) + "]";
  }

  function callExpr(node) {
    // console.log(...)
    if (
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.object.type === "Identifier" &&
      node.callee.object.name === "console" &&
      node.callee.property.name === "log"
    ) {
      counts.outputs += 1;
      if (isPy) {
        let args = [];
        for (let ii = 0; ii < node.arguments.length; ++ii) {
          let a = node.arguments[ii];
          if (a.type === "SpreadElement") {
            return unsupportedExpr("spread arguments to console.log", "CallExpression");
          }
          if (a.type === "Literal" && a.value === null) {
            args.push('"null"');
          } else if (a.type === "Literal" && typeof a.value === "boolean") {
            args.push(a.value ? '"true"' : '"false"');
          } else if (inferType(a, ctx) === "bool") {
            args.push('("true" if ' + expr(a, 16) + ' else "false")');
          } else if (inferType(a, ctx) === "double") {
            // print() uses str(), which formats 1e16 as "1e+16"
            // where JS prints "10000000000000000".
            needs.jsnum = true;
            args.push("__iroh_jsnum(" + expr(a, 16) + ")");
          } else {
            args.push(expr(a, 16));
          }
        }
        return "print(" + args.join(", ") + ")";
      }
      // C++ console.log is emitted as statements, not an expression.
      return unsupportedExpr(
        "console.log used as an expression (C++ emits it as statements)",
        "CallExpression"
      );
    }
    // Math.* / parseInt / String / Number
    if (node.callee.type === "MemberExpression" && !node.callee.computed &&
        node.callee.object.type === "Identifier" && node.callee.object.name === "Math") {
      let prop = node.callee.property.name;
      let mathFns = { floor: 1, ceil: 1, round: 1, trunc: 1, sqrt: 1, abs: 1, pow: 1, max: 1, min: 1 };
      if (prop === "random") {
        return unsupportedExpr("Math.random() has no deterministic equivalent in v1", "CallExpression");
      }
      if (!mathFns[prop]) {
        return unsupportedExpr("Math." + prop + " is not in the v1 scope", "CallExpression");
      }
      let args = node.arguments.map(function(a) { return expr(a, 16); }).join(", ");
      if (isPy) {
        // Python's math module has no max/min/round/abs — those are
        // builtins. Math.pow becomes `**` (math.pow returns a float,
        // JS Math.pow(2, 3) is 8). Math.round is banker's rounding in
        // Python but half-up in JS, so it is emulated, not mapped.
        if (prop === "max" || prop === "min" || prop === "abs") {
          return prop + "(" + args + ")";
        }
        if (prop === "pow") {
          if (node.arguments.length !== 2) {
            return unsupportedExpr("Math.pow with " + node.arguments.length + " argument(s) (v1 supports exactly 2)", "CallExpression");
          }
          return "(" + node.arguments.map(function(a) { return expr(a, 16); }).join(" ** ") + ")";
        }
        if (prop === "round") {
          if (node.arguments.length !== 1) {
            return unsupportedExpr("Math.round with " + node.arguments.length + " argument(s) (v1 supports exactly 1)", "CallExpression");
          }
          needs.math = true;
          noteOnce(
            "math-round",
            "Math.round is emulated as math.floor(x + 0.5) — Python's round() is banker's rounding, JS rounds half up."
          );
          return "math.floor(" + args + " + 0.5)";
        }
        needs.math = true;
        return "math." + prop + "(" + args + ")";
      }
      needs.cmath = true;
      if (prop === "max" || prop === "min") needs.algorithm = true;
      return "std::" + prop + "(" + args + ")";
    }
    if (node.callee.type === "Identifier") {
      let name = node.callee.name;
      if (name === "parseInt") {
        if (isPy) return "int(" + expr(node.arguments[0], 16) + ")";
        return "std::stoi(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "parseFloat") {
        if (isPy) return "float(" + expr(node.arguments[0], 16) + ")";
        return "std::stod(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "String") {
        if (isPy) {
          let at = inferType(node.arguments[0], ctx);
          if (at === "double") {
            // str() formats 1e16 as "1e+16"; JS prints "10000000000000000".
            needs.jsnum = true;
            return "__iroh_jsnum(" + expr(node.arguments[0], 16) + ")";
          }
          if (at === "bool") {
            // str(True) is "True"; JS String(true) is "true".
            return '("true" if ' + expr(node.arguments[0], 16) + ' else "false")';
          }
          if (at && at.indexOf("std::vector<") === 0) {
            return unsupportedExpr(
              "String() of an array in Python (JS joins with commas; Python str() prints brackets)",
              "CallExpression"
            );
          }
          return "str(" + expr(node.arguments[0], 16) + ")";
        }
        // std::to_string prints doubles with 6 decimals ("1.500000"),
        // unlike JS String(1.5) ("1.5") — route doubles through the
        // JS number formatter. std::to_string(true) is "1", not
        // "true" — bools get the ternary. Ints and strings keep
        // std::to_string.
        if (inferType(node.arguments[0], ctx) === "double") {
          needs.jsnum = true;
          return "__iroh_jsnum(" + expr(node.arguments[0], 16) + ")";
        }
        if (inferType(node.arguments[0], ctx) === "bool") {
          return "std::string(((" + expr(node.arguments[0], 16) + ') ? "true" : "false"))';
        }
        return "std::to_string(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "Number") {
        if (isPy) return "float(" + expr(node.arguments[0], 16) + ")";
        return "std::stod(" + expr(node.arguments[0], 16) + ")";
      }
      if (name === "Boolean") {
        if (isPy) return "bool(" + expr(node.arguments[0], 16) + ")";
        return unsupportedExpr("Boolean() has no direct C++ equivalent in v1", "CallExpression");
      }
      let args = [];
      for (let ii = 0; ii < node.arguments.length; ++ii) {
        let a = node.arguments[ii];
        if (a.type === "SpreadElement") {
          return unsupportedExpr("spread arguments", "CallExpression");
        }
        args.push(expr(a, 16));
      }
      return name + "(" + args.join(", ") + ")";
    }
    // Member calls: arr.push(x), str.toUpperCase(), ...
    if (node.callee.type === "MemberExpression") {
      let prop = node.callee.computed
        ? null
        : (node.callee.property.name !== void 0 ? node.callee.property.name : node.callee.property.value);
      let obj = expr(node.callee.object, 15);
      if (prop === "push") {
        let args = node.arguments.map(function(a) { return expr(a, 16); }).join(", ");
        if (isPy) return obj + ".append(" + args + ")";
        return obj + ".push_back(" + args + ")";
      }
      if (prop === "toUpperCase") {
        if (isPy) return obj + ".upper()";
        return unsupportedExpr("String.toUpperCase() has no stdlib one-liner in C++ v1", "CallExpression");
      }
      if (prop === "toLowerCase") {
        if (isPy) return obj + ".lower()";
        return unsupportedExpr("String.toLowerCase() has no stdlib one-liner in C++ v1", "CallExpression");
      }
      return unsupportedExpr("method call ." + prop + " is not in the v1 scope", "CallExpression");
    }
    return unsupportedExpr("call of computed or unusual callee", "CallExpression");
  }

  function binaryExpr(node, parentPrec) {
    let op = node.operator;
    if (op === "instanceof" || op === "in") {
      return unsupportedExpr("operator " + op + " is not in the v1 scope", "BinaryExpression");
    }
    if (op === "**") {
      if (isPy) {
        return paren(expr(node.left, 13), node.left, 13) + " ** " + paren(expr(node.right, 13), node.right, 13);
      }
      needs.cmath = true;
      return "std::pow(" + expr(node.left, 16) + ", " + expr(node.right, 16) + ")";
    }
    if (op === "%") {
      if (isPy) {
        // JS % is the truncated remainder; Python % is floored (it
        // takes the divisor's sign). math.fmod has the right sign but
        // returns a float, which would print "-2.0" where JS prints
        // "-2" — so use the truncating identity through a helper,
        // which keeps ints int and floats float.
        needs.jsmod = true;
        return "__iroh_jsmod(" + expr(node.left, 16) + ", " + expr(node.right, 16) + ")";
      }
      // C++ % is truncated like JS, but only for integers — % on
      // doubles does not compile. Route double operands through
      // std::fmod (also truncated, so the semantics match).
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      if (lt === "double" || rt === "double") {
        needs.cmath = true;
        return "std::fmod(" + expr(node.left, 16) + ", " + expr(node.right, 16) + ")";
      }
    }
    let outOp = op;
    if (op === "===") outOp = "==";
    else if (op === "!==") outOp = "!=";
    else if (op === "&&") outOp = isPy ? "and" : "&&";
    else if (op === "||") outOp = isPy ? "or" : "||";
    let myPrec = precedence(node);
    if (isPy && op === "+") {
      // String concatenation: either side a string (or a string
      // literal) makes the whole `+` a concat. Python refuses str +
      // number at runtime, so route non-strings through pyStringOf.
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      let leftIsStr = lt === "std::string" || (node.left.type === "Literal" && typeof node.left.value === "string");
      let rightIsStr = rt === "std::string" || (node.right.type === "Literal" && typeof node.right.value === "string");
      if (leftIsStr || rightIsStr) {
        return pyStringOf(node.left) + " + " + pyStringOf(node.right);
      }
    }
    if (!isPy && op === "+") {
      // String concatenation: either side a string (or a string
      // literal) makes the whole `+` a concat. A literal on its own
      // is const char*, so `"a" + 1` would compile as pointer
      // arithmetic — route everything through cppStringOf, which
      // wraps literals and bool ternaries in std::string(...).
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      let leftIsStr = lt === "std::string" || (node.left.type === "Literal" && typeof node.left.value === "string");
      let rightIsStr = rt === "std::string" || (node.right.type === "Literal" && typeof node.right.value === "string");
      if (leftIsStr || rightIsStr) {
        return cppStringOf(node.left) + " + " + cppStringOf(node.right);
      }
    }
    return (
      paren(expr(node.left, myPrec), node.left, myPrec) +
      " " + outOp + " " +
      paren(expr(node.right, myPrec), node.right, myPrec)
    );
  }

  function expr(node, parentPrec) {
    parentPrec = parentPrec === void 0 ? 0 : parentPrec;
    if (!node || typeof node.type !== "string") {
      return unsupportedExpr("missing expression", "Expression");
    }
    switch (node.type) {
      case "Literal":
        return literalValue(node);
      case "Identifier": {
        if (node.name === "undefined") {
          return unsupportedExpr("undefined has no equivalent in v1", "Identifier");
        }
        return node.name;
      }
      case "ArrayExpression": {
        if (node.elements.length === 0) {
          if (!isPy) {
            return unsupportedExpr(
              "empty array literal needs an element type in C++ (give a trace or a type hint)",
              "ArrayExpression"
            );
          }
          return "[]";
        }
        let parts = [];
        for (let ii = 0; ii < node.elements.length; ++ii) {
          let el = node.elements[ii];
          if (el === null) {
            parts.push(isPy ? "None" : unsupportedExpr("hole in array literal", "ArrayExpression"));
          } else if (el.type === "SpreadElement") {
            return unsupportedExpr("spread in array literal", "ArrayExpression");
          } else {
            parts.push(expr(el, 16));
          }
        }
        if (isPy) return "[" + parts.join(", ") + "]";
        let elemType = inferType(node.elements[0], ctx);
        if (!elemType) {
          return unsupportedExpr(
            "array literal element type could not be determined in C++",
            "ArrayExpression"
          );
        }
        return "std::vector<" + elemType + ">{" + parts.join(", ") + "}";
      }
      case "MemberExpression":
        return memberExpr(node);
      case "CallExpression":
        return callExpr(node);
      case "BinaryExpression":
      case "LogicalExpression":
        return binaryExpr(node, parentPrec);
      case "UnaryExpression": {
        if (node.operator === "typeof" || node.operator === "void" || node.operator === "delete") {
          return unsupportedExpr("unary operator " + node.operator + " is not in the v1 scope", "UnaryExpression");
        }
        let op = node.operator === "!" && isPy ? "not " : node.operator;
        let arg = expr(node.argument, 14);
        if (precedence(node.argument) < 14) arg = "(" + arg + ")";
        return op + arg;
      }
      case "UpdateExpression": {
        if (isPy) {
          return unsupportedExpr(
            "++ / -- as an expression (Python has no increment operator; use it as a statement)",
            "UpdateExpression"
          );
        }
        let arg = expr(node.argument, 16);
        return node.prefix ? node.operator + arg : arg + node.operator;
      }
      case "AssignmentExpression": {
        let op = node.operator;
        if (op === "**=" && !isPy) {
          return unsupportedExpr("**= has no C++ equivalent in v1", "AssignmentExpression");
        }
        if ((op === "||=" || op === "&&=" || op === "??=") && isPy) {
          return unsupportedExpr("logical assignment " + op + " has no Python equivalent", "AssignmentExpression");
        }
        if (op === "||=" || op === "&&=" || op === "??=") {
          return unsupportedExpr("logical assignment " + op + " has no C++ equivalent", "AssignmentExpression");
        }
        if (op === "<<=" || op === ">>=" || op === "&=" || op === "|=" || op === "^=") {
          // Exists in both languages.
        }
        let left = expr(node.left, 1);
        let right = expr(node.right, 1);
        return left + " " + op + " " + right;
      }
      case "ConditionalExpression": {
        if (isPy) {
          return expr(node.consequent, 2) + " if " + expr(node.test, 2) + " else " + expr(node.alternate, 2);
        }
        return expr(node.test, 2) + " ? " + expr(node.consequent, 2) + " : " + expr(node.alternate, 2);
      }
      case "TemplateLiteral":
        return templateLiteral(node);
      case "SequenceExpression": {
        if (isPy) {
          return unsupportedExpr("comma (sequence) expressions have no Python equivalent", "SequenceExpression");
        }
        let parts = node.expressions.map(function(e) { return expr(e, 16); });
        return "(" + parts.join(", ") + ")";
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return unsupportedExpr(
          "function value in expression position (v1 translates functions declared as statements only)",
          node.type
        );
      case "AwaitExpression":
      case "YieldExpression":
      case "NewExpression":
      case "ObjectExpression":
      case "ClassExpression":
      case "TaggedTemplateExpression":
        return unsupportedExpr(node.type + " is not in the v1 scope", node.type);
      default:
        return unsupportedExpr("expression " + node.type + " is not in the v1 scope", node.type);
    }
  }

  function paramList(params) {
    let out = [];
    for (let ii = 0; ii < params.length; ++ii) {
      let p = params[ii];
      if (p.type === "Identifier") {
        out.push(p.name);
      } else if (p.type === "AssignmentPattern") {
        out.push(p.left.name + " = " + expr(p.right, 16));
      } else if (p.type === "RestElement") {
        out.push(unsupportedExpr("rest parameters are not in the v1 scope", "RestElement"));
      } else {
        out.push(unsupportedExpr("parameter pattern is not in the v1 scope", p.type));
      }
    }
    return out;
  }

  // C++ signature for a function: { params: ["int n", ...], ret: "int" }.
  // Param types come from trace evidence, then type hints; return type
  // from static inference over the return values, then trace evidence,
  // then hints. A function with no value-return is void. Anything
  // untypeable is reported unsupported and the signature is null.
  function cppSignature(fnNode, fnName) {
    let sig = { params: [], ret: null };
    let traceFn = ctx.funcs[fnName];
    let paramsFromTrace = false;
    for (let ii = 0; ii < fnNode.params.length; ++ii) {
      let p = fnNode.params[ii];
      let pname = p.type === "Identifier" ? p.name : (p.left && p.left.name) || "?";
      let def = p.type === "AssignmentPattern" ? " = " + expr(p.right, 16) : "";
      let t = null;
      if (traceFn && traceFn.params && traceFn.params[ii]) {
        t = traceFn.params[ii];
        if (traceFn.paramsFrom === "trace") paramsFromTrace = true;
      }
      if (!t && hints && hints.functions && hints.functions[fnName] && hints.functions[fnName].params) {
        t = hints.functions[fnName].params[ii] || null;
      }
      if (!t) {
        markUnsupported(
          report,
          "FunctionDeclaration",
          "C++ parameter '" + pname + "' of '" + fnName +
            "' has no type: the function was never called in the trace and no type hint was given (pass types in options.types)"
        );
        return null;
      }
      // A conflict recorded across calls (trace types only — a hint
      // fills gaps but never overrides trace evidence, so it cannot
      // rescue a conflict). One C++ signature cannot cover two types.
      if (traceFn && traceFn.paramsFrom === "trace" && traceFn.paramsConflict) {
        for (let ci = 0; ci < traceFn.paramsConflict.length; ++ci) {
          let c = traceFn.paramsConflict[ci];
          if (c.index === ii) {
            markUnsupported(
              report,
              "FunctionDeclaration",
              "C++ parameter '" + pname + "' of '" + fnName + "' was called with conflicting types (" + c.first + " in the first call, " + c.other + " in call " + (c.call + 1) + ") — one C++ signature cannot cover both; split the function into one per argument type (a type hint cannot override trace evidence)"
            );
            return null;
          }
        }
      }
      sig.params.push(t + " " + pname + def);
    }
    if (paramsFromTrace) {
      let callCount = (traceFn && traceFn.callCount) || 1;
      recordAssumption(
        report,
        "parameter types of '" + fnName + "' (" + sig.params.join(", ") + ") taken from the trace (verified consistent across " + callCount + " call" + (callCount === 1 ? "" : "s") + ")",
        "FUNCTION_CALL '" + fnName + "' arguments " + JSON.stringify(traceFn.args || [])
      );
    }
    let ret = null;
    let retFromTrace = false;
    if (hints && hints.functions && hints.functions[fnName] && hints.functions[fnName].returns) {
      ret = hints.functions[fnName].returns;
    }
    if (!ret) {
      let rets = [];
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) {
          for (let ii = 0; ii < n.length; ++ii) walk(n[ii]);
          return;
        }
        if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
          return; // do not descend into nested functions
        }
        if (n.type === "ReturnStatement" && n.argument) rets.push(n.argument);
        let keys = Object.keys(n);
        for (let ii = 0; ii < keys.length; ++ii) walk(n[keys[ii]]);
      })(fnNode.body);
      if (rets.length === 0) {
        ret = "void";
      } else {
        let types = [];
        for (let ii = 0; ii < rets.length; ++ii) types.push(inferType(rets[ii], ctx));
        let first = types[0];
        let allSame = first !== null;
        for (let ii = 1; ii < types.length; ++ii) {
          if (types[ii] !== first) allSame = false;
        }
        if (allSame) ret = first;
        else if (traceFn && traceFn.returns) {
          // Conflicting return types across calls refuse, like params.
          if (traceFn.returnsConflict) {
            markUnsupported(
              report,
              "FunctionDeclaration",
              "C++ return type of '" + fnName + "' differs across calls (" + traceFn.returnsConflict.first + " in the first call, " + traceFn.returnsConflict.other + " in call " + (traceFn.returnsConflict.call + 1) + ") — one C++ signature cannot cover both; split the function into one per argument type (a type hint cannot override trace evidence)"
            );
            return null;
          }
          ret = traceFn.returns;
          if (traceFn.returnsFrom === "trace") retFromTrace = true;
        }
      }
    }
    if (retFromTrace) {
      let returnCount = (traceFn && traceFn.returnCount) || 1;
      recordAssumption(
        report,
        "return type of '" + fnName + "' (" + ret + ") taken from the trace (verified consistent across " + returnCount + " return" + (returnCount === 1 ? "" : "s") + ")",
        "FUNCTION_RETURN '" + fnName + "' value " + JSON.stringify(traceFn.returnValue)
      );
    }
    if (!ret) {
      markUnsupported(
        report,
        "FunctionDeclaration",
        "C++ return type of '" + fnName +
          "' could not be determined from the return values, the trace, or a type hint"
      );
      return null;
    }
    sig.ret = ret;
    return sig;
  }

  // Emit a function body (a BlockStatement's statements) at the
  // current indent. An empty body gets `pass` (Python) / nothing (C++
  // braces are emitted by the caller).
  function emitBody(block) {
    if (!block || block.body.length === 0) {
      if (isPy) emitLine("pass");
      return;
    }
    indentLevel += 1;
    for (let ii = 0; ii < block.body.length; ++ii) stmt(block.body[ii]);
    indentLevel -= 1;
  }

  function emitFunction(fnNode, fnName) {
    counts.functions += 1;
    if (isPy) {
      let params = paramList(fnNode.params);
      emitLine("def " + fnName + "(" + params.join(", ") + "):");
      emitBody(fnNode.body);
      return;
    }
    let sig = cppSignature(fnNode, fnName);
    if (!sig) {
      // Untypeable: emit a throwing stub so the gap is loud, not silent.
      emitLine("auto " + fnName + " = " + stubExpr("function '" + fnName + "' could not be typed for C++") + ";");
      return;
    }
    emitLine(sig.ret + " " + fnName + "(" + sig.params.join(", ") + ") {");
    emitBody(fnNode.body);
    emitLine("}");
  }

  function forLoopPattern(node) {
    // Classic numeric for: for (let i = A; i <op> B; update)
    if (!node.init || node.init.type !== "VariableDeclaration") return null;
    if (node.init.declarations.length !== 1) return null;
    let decl = node.init.declarations[0];
    if (decl.id.type !== "Identifier" || !decl.init) return null;
    if (!node.test || node.test.type !== "BinaryExpression") return null;
    let test = node.test;
    if (test.left.type !== "Identifier" || test.left.name !== decl.id.name) return null;
    if (["<", "<=", ">", ">="].indexOf(test.operator) === -1) return null;
    let step = null;
    let upd = node.update;
    if (!upd) return null;
    if (upd.type === "UpdateExpression" && upd.argument.type === "Identifier" && upd.argument.name === decl.id.name) {
      step = upd.operator === "++" ? 1 : -1;
    } else if (upd.type === "AssignmentExpression" && upd.left.type === "Identifier" && upd.left.name === decl.id.name) {
      if (upd.operator === "+=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = upd.right.value;
      else if (upd.operator === "-=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = -upd.right.value;
      else return null;
    } else return null;
    return { name: decl.id.name, start: decl.init, op: test.operator, end: test.right, step: step };
  }

  function stmt(node) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "BlockStatement": {
        if (isPy) {
          for (let ii = 0; ii < node.body.length; ++ii) stmt(node.body[ii]);
        } else {
          emitLine("{");
          indentLevel += 1;
          for (let ii = 0; ii < node.body.length; ++ii) stmt(node.body[ii]);
          indentLevel -= 1;
          emitLine("}");
        }
        return;
      }
      case "VariableDeclaration": {
        for (let ii = 0; ii < node.declarations.length; ++ii) {
          let d = node.declarations[ii];
          counts.variables += 1;
          if (d.id.type !== "Identifier") {
            unsupportedStmt("destructuring declaration is not in the v1 scope", "VariableDeclaration");
            continue;
          }
          // Arrow function assigned to a variable: emit as a function.
          if (d.init && d.init.type === "ArrowFunctionExpression") {
            let fnNode = {
              type: "FunctionDeclaration",
              id: d.id,
              params: d.init.params,
              body: d.init.body.type === "BlockStatement"
                ? d.init.body
                : { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: d.init.body }] },
            };
            emitFunction(fnNode, d.id.name);
            continue;
          }
          if (isPy) {
            emitLine(d.id.name + " = " + (d.init ? expr(d.init, 16) : "None"));
          } else if (!d.init) {
            let t = ctx.vars[d.id.name] || null;
            if (!t) {
              markUnsupported(
                report,
                "VariableDeclaration",
                "C++ variable '" + d.id.name + "' declared without an initializer and no type evidence (no later assignment in the trace, no type hint)"
              );
              emitLine(stubStmt("variable '" + d.id.name + "' could not be typed for C++"));
            } else {
              emitLine(t + " " + d.id.name + ";");
            }
          } else if (d.init.type === "ArrayExpression") {
            let elemType = d.init.elements.length > 0 ? inferType(d.init.elements[0], ctx) : null;
            if (!elemType && ctx.vars[d.id.name]) {
              let vt = ctx.vars[d.id.name];
              let m = /^std::vector<(.+)>$/.exec(vt);
              if (m) elemType = m[1];
            }
            if (!elemType) {
              markUnsupported(
                report,
                "VariableDeclaration",
                "C++ array '" + d.id.name + "' element type could not be determined"
              );
              emitLine(stubStmt("array '" + d.id.name + "' could not be typed for C++"));
            } else {
              let parts = [];
              for (let jj = 0; jj < d.init.elements.length; ++jj) {
                parts.push(expr(d.init.elements[jj], 16));
              }
              emitLine("std::vector<" + elemType + "> " + d.id.name + " = {" + parts.join(", ") + "};");
            }
          } else {
            // `auto` deduces a string literal as const char*, which
            // breaks `+` concatenation — declare strings (and
            // vectors) with their real type.
            let t = inferType(d.init, ctx);
            if (t) ctx.vars[d.id.name] = t;
            let kind;
            if (t === "std::string") {
              kind = node.kind === "const" ? "const std::string " : "std::string ";
            } else if (t && t.indexOf("std::vector<") === 0) {
              kind = t + " ";
            } else {
              kind = node.kind === "const" ? "const auto " : "auto ";
            }
            emitLine(kind + d.id.name + " = " + expr(d.init, 16) + ";");
          }
        }
        return;
      }
      case "FunctionDeclaration": {
        emitFunction(node, node.id.name);
        return;
      }
      case "ReturnStatement": {
        if (isPy) emitLine(node.argument ? "return " + expr(node.argument, 16) : "return");
        else emitLine(node.argument ? "return " + expr(node.argument, 16) + ";" : "return;");
        return;
      }
      case "ExpressionStatement": {
        // console.log as a C++ statement: several cout lines.
        if (
          !isPy &&
          node.expression.type === "CallExpression" &&
          node.expression.callee.type === "MemberExpression" &&
          !node.expression.callee.computed &&
          node.expression.callee.object.type === "Identifier" &&
          node.expression.callee.object.name === "console" &&
          node.expression.callee.property.name === "log"
        ) {
          counts.outputs += 1;
          needs.cout = true;
          let args = node.expression.arguments;
          if (args.length === 0) {
            emitLine("std::cout << std::endl;");
            return;
          }
          for (let ii = 0; ii < args.length; ++ii) {
            let a = args[ii];
            if (a.type === "SpreadElement") {
              unsupportedStmt("spread arguments to console.log", "CallExpression");
              return;
            }
            let piece;
            if (a.type === "Literal" && a.value === null) piece = '"null"';
            else if (a.type === "Literal" && typeof a.value === "boolean") piece = a.value ? '"true"' : '"false"';
            else if (inferType(a, ctx) === "bool") piece = "((" + expr(a, 16) + ') ? "true" : "false")';
            else if (inferType(a, ctx) === "double") {
              // std::cout defaults to 6 significant digits ("0.3"
              // for 0.1 + 0.2); JS prints "0.30000000000000004".
              needs.jsnum = true;
              piece = "__iroh_jsnum(" + expr(a, 16) + ")";
            }
            else if (a.type === "ArrayExpression" || (inferType(a, ctx) || "").indexOf("std::vector<") === 0) {
              needs.vectorHelper = true;
              piece = null;
              emitLine("__iroh_print_vec(" + expr(a, 16) + ");");
            } else piece = expr(a, 16);
            if (piece !== null && piece !== void 0) {
              emitLine("std::cout << " + piece + ";");
            }
            if (ii < args.length - 1) emitLine('std::cout << " ";');
          }
          emitLine("std::cout << std::endl;");
          return;
        }
        let e = node.expression;
        if (isPy && e.type === "UpdateExpression") {
          emitLine(expr(e.argument, 16) + (e.operator === "++" ? " += 1" : " -= 1"));
          return;
        }
        if (isPy) {
          let s = expr(e, 16);
          // console.log in Python is a single print() expression.
          emitLine(s);
        } else {
          emitLine(expr(e, 16) + ";");
        }
        return;
      }
      case "IfStatement": {
        counts.conditionals += 1;
        if (isPy) {
          emitLine("if " + expr(node.test, 16) + ":");
          emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { type: "BlockStatement", body: [node.consequent] });
          let alt = node.alternate;
          while (alt) {
            if (alt.type === "IfStatement") {
              emitLine("elif " + expr(alt.test, 16) + ":");
              emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { type: "BlockStatement", body: [alt.consequent] });
              alt = alt.alternate;
            } else {
              emitLine("else:");
              emitBody(alt.type === "BlockStatement" ? alt : { type: "BlockStatement", body: [alt] });
              alt = null;
            }
          }
        } else {
          emitLine("if (" + expr(node.test, 16) + ") {");
          emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { type: "BlockStatement", body: [node.consequent] });
          emitLine("}");
          let alt = node.alternate;
          if (alt) {
            if (alt.type === "IfStatement") {
              // else-if: emit as `} else if (...) {` — simplest is to
              // re-enter with the alternate as an if, on the else line.
              lines[lines.length - 1] = indentStr() + "} else if (" + expr(alt.test, 16) + ") {";
              emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { type: "BlockStatement", body: [alt.consequent] });
              emitLine("}");
              if (alt.alternate) {
                lines[lines.length - 1] = indentStr() + "} else {";
                emitBody(alt.alternate.type === "BlockStatement" ? alt.alternate : { type: "BlockStatement", body: [alt.alternate] });
                emitLine("}");
              }
            } else {
              lines[lines.length - 1] = indentStr() + "} else {";
              emitBody(alt.type === "BlockStatement" ? alt : { type: "BlockStatement", body: [alt] });
              emitLine("}");
            }
          }
        }
        return;
      }
      case "ForStatement": {
        counts.loops += 1;
        if (isPy) {
          let pat = forLoopPattern(node);
          if (!pat) {
            unsupportedStmt("for loop is not a simple numeric loop (v1 supports for (let i = A; i <op> B; i++/i--/i+=k))", "ForStatement");
            return;
          }
          let start = expr(pat.start, 16);
          let end = expr(pat.end, 16);
          let rangeArgs = start + ", " + end;
          if (pat.op === "<=") rangeArgs = start + ", " + end + " + 1";
          else if (pat.op === ">=") rangeArgs = start + ", " + end + " - 1";
          if (pat.step !== 1 && pat.step !== -1) rangeArgs += ", " + pat.step;
          else if (pat.op === ">" || pat.op === ">=") rangeArgs += ", -1";
          emitLine("for " + pat.name + " in range(" + rangeArgs + "):");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        } else {
          let init = "";
          if (node.init) {
            if (node.init.type === "VariableDeclaration") {
              if (node.init.declarations.length !== 1) {
                unsupportedStmt("for loop with multiple init declarations (v1 supports one)", "ForStatement");
                return;
              }
              let d = node.init.declarations[0];
              if (!d.init) {
                unsupportedStmt("for loop with an uninitialised init variable", "ForStatement");
                return;
              }
              init = "auto " + d.id.name + " = " + expr(d.init, 16);
            } else init = expr(node.init, 16);
          }
          emitLine("for (" + init + "; " + (node.test ? expr(node.test, 16) : "") + "; " + (node.update ? expr(node.update, 16) : "") + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "ForOfStatement": {
        counts.loops += 1;
        let target = node.left.declarations ? node.left.declarations[0].id.name : (node.left.name || "?");
        if (isPy) {
          emitLine("for " + target + " in " + expr(node.right, 16) + ":");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        } else {
          emitLine("for (auto " + target + " : " + expr(node.right, 16) + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "ForInStatement":
        unsupportedStmt("for-in loops are not in the v1 scope", "ForInStatement");
        return;
      case "WhileStatement": {
        counts.loops += 1;
        if (isPy) {
          emitLine("while " + expr(node.test, 16) + ":");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        } else {
          emitLine("while (" + expr(node.test, 16) + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "DoWhileStatement": {
        counts.loops += 1;
        if (isPy) {
          emitLine("while True:");
          indentLevel += 1;
          let body = node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] };
          for (let ii = 0; ii < body.body.length; ++ii) stmt(body.body[ii]);
          emitLine("if not (" + expr(node.test, 16) + "):");
          indentLevel += 1;
          emitLine("break");
          indentLevel -= 2;
        } else {
          emitLine("do {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
          emitLine("} while (" + expr(node.test, 16) + ");");
        }
        return;
      }
      case "SwitchStatement": {
        counts.conditionals += 1;
        if (isPy) {
          // Only when every case ends with break/return/throw (no
          // fallthrough — Python has no fallthrough to mirror it with).
          let ok = true;
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            if (c.consequent.length === 0) { ok = false; break; }
            let last = c.consequent[c.consequent.length - 1];
            if (last.type !== "BreakStatement" && last.type !== "ReturnStatement" && last.type !== "ThrowStatement") {
              ok = false;
              break;
            }
          }
          if (!ok) {
            unsupportedStmt("switch with fallthrough cannot be translated to Python (no fallthrough in if/elif chains)", "SwitchStatement");
            return;
          }
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            let kw = ii === 0 ? "if" : "elif";
            if (c.test === null) {
              emitLine("else:");
            } else {
              emitLine(kw + " " + expr(node.discriminant, 16) + " == " + expr(c.test, 16) + ":");
            }
            indentLevel += 1;
            for (let jj = 0; jj < c.consequent.length; ++jj) {
              if (c.consequent[jj].type === "BreakStatement") continue; // no break in if/elif chains
              stmt(c.consequent[jj]);
            }
            indentLevel -= 1;
          }
        } else {
          emitLine("switch (" + expr(node.discriminant, 16) + ") {");
          indentLevel += 1;
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            if (c.test === null) emitLine("default:");
            else emitLine("case " + expr(c.test, 16) + ":");
            indentLevel += 1;
            for (let jj = 0; jj < c.consequent.length; ++jj) stmt(c.consequent[jj]);
            indentLevel -= 1;
          }
          indentLevel -= 1;
          emitLine("}");
        }
        return;
      }
      case "TryStatement": {
        if (isPy) {
          emitLine("try:");
          emitBody(node.block);
          if (node.handler) {
            if (node.handler.param) emitLine("except Exception as " + node.handler.param.name + ":");
            else emitLine("except Exception:");
            emitBody(node.handler.body);
          }
          if (node.finalizer) {
            emitLine("finally:");
            emitBody(node.finalizer);
          }
        } else {
          if (node.finalizer) {
            unsupportedStmt("try/finally has no C++ equivalent in v1 (C++ has no finally)", "TryStatement");
            return;
          }
          emitLine("try {");
          emitBody(node.block);
          emitLine("}");
          if (node.handler) {
            if (node.handler.param) emitLine("catch (const std::exception& " + node.handler.param.name + ") {");
            else emitLine("catch (const std::exception&) {");
            emitBody(node.handler.body);
            emitLine("}");
          }
        }
        return;
      }
      case "ThrowStatement": {
        if (node.argument && node.argument.type === "Literal" && typeof node.argument.value === "string") {
          if (isPy) emitLine("raise Exception(" + JSON.stringify(node.argument.value) + ")");
          else emitLine("throw std::runtime_error(" + JSON.stringify(node.argument.value) + ");");
        } else {
          unsupportedStmt("throw of a non-string value is not in the v1 scope", "ThrowStatement");
        }
        return;
      }
      case "BreakStatement":
        emitLine(isPy ? "break" : "break;");
        return;
      case "ContinueStatement":
        emitLine(isPy ? "continue" : "continue;");
        return;
      case "EmptyStatement":
      case "DebuggerStatement":
        return;
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        unsupportedStmt(node.type + " is not in the v1 scope (translate scripts, not modules)", node.type);
        return;
      case "ClassDeclaration":
      case "LabeledStatement":
        unsupportedStmt(node.type + " is not in the v1 scope", node.type);
        return;
      default:
        unsupportedStmt("statement " + node.type + " is not in the v1 scope", node.type);
        return;
    }
  }

  function run(ast) {
    // Hoist top-level function declarations first (JS hoisting):
    // a call before the textual declaration works in JS, so the
    // target must define the function first too.
    let fns = [];
    let rest = [];
    for (let ii = 0; ii < ast.body.length; ++ii) {
      let s = ast.body[ii];
      if (s.type === "FunctionDeclaration") fns.push(s);
      else rest.push(s);
    }
    if (isPy) {
      for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
      if (fns.length > 0 && rest.length > 0) lines.push("");
      for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
      // Imports/helpers must come first: rebuild with the header.
      let header = [];
      if (needs.math) header.push("import math");
      if (needs.random) header.push("import random");
      if (needs.jsmod) {
        // JS % is the truncated remainder; Python % is floored.
        // int(a / b) truncates toward zero, so this keeps ints int
        // and floats float, matching JS output exactly.
        header.push("def __iroh_jsmod(a, b):");
        header.push("    return a - int(a / b) * b");
        header.push("");
      }
      if (needs.jsnum) {
        // JS Number -> string: the shortest decimal that round-trips,
        // formatted the way JS String(v) formats it. Python repr is
        // already shortest, but it switches to exponential at 1e16
        // (JS waits until 1e21) and zero-pads exponents ("1e-07"
        // where JS prints "1e-7") — so take repr's digits and
        // exponent, then place the point per the ECMAScript
        // Number::toString rules (k = decimal exponent, n = digit
        // count): 0 < k <= n <= 21 writes the digits with the point
        // at k; n < k <= 21 appends zeros; -6 < k <= 0 writes "0."
        // with -k zeros; otherwise exponential with a bare exponent.
        header.push("def __iroh_jsnum(v):");
        header.push("    if v != v: return \"NaN\"");
        header.push("    if v == float(\"inf\"): return \"Infinity\"");
        header.push("    if v == float(\"-inf\"): return \"-Infinity\"");
        header.push("    if v == 0: return \"0\"");
        header.push("    neg = v < 0");
        header.push("    if neg: v = -v");
        header.push("    s = repr(v)");
        header.push("    if \"e\" in s:");
        header.push("        mant, exp = s.split(\"e\")");
        header.push("        k = int(exp) + 1");
        header.push("        digits = mant.replace(\".\", \"\")");
        header.push("    elif \".\" in s:");
        header.push("        ip, fp = s.split(\".\")");
        header.push("        k = len(ip)");
        header.push("        digits = ip + fp");
        header.push("    else:");
        header.push("        k = len(s)");
        header.push("        digits = s");
        header.push("    digits = digits.rstrip(\"0\") or \"0\"");
        header.push("    n = len(digits)");
        header.push("    if 0 < k <= n <= 21:");
        header.push("        out = digits[:k]");
        header.push("        if k < n: out += \".\" + digits[k:]");
        header.push("    elif n < k <= 21:");
        header.push("        out = digits + \"0\" * (k - n)");
        header.push("    elif -6 < k <= 0:");
        header.push("        out = \"0.\" + \"0\" * (-k) + digits");
        header.push("    else:");
        header.push("        out = digits[0]");
        header.push("        if n > 1: out += \".\" + digits[1:]");
        header.push("        out += \"e\" + (\"+\" if k - 1 >= 0 else \"-\") + str(abs(k - 1))");
        header.push("    return (\"-\" if neg else \"\") + out");
        header.push("");
      }
      if (needs.jsbool) {
        // 1.0.1 patch: JS bool -> string: "true"/"false". A helper,
        // not an inline ternary, so the double quotes never sit
        // inside an f-string replacement field (SyntaxError on
        // Python < 3.12, PEP 701). Same pattern as __iroh_jsnum.
        header.push("def __iroh_jsbool(v):");
        header.push("    return \"true\" if v else \"false\"");
        header.push("");
      }
      if (needs.unsupportedHelper) {
        header.push("def _iroh_unsupported(msg):");
        header.push("    raise NotImplementedError(\"IrohRedux: \" + msg)");
        header.push("");
      }
      return { text: header.concat(lines).join("\n") + "\n", counts: counts, needs: needs };
    }
    // C++: headers, then functions, then main(). The body is emitted
    // first (into a temp array, at indent 1) because needs.cout — set
    // by console.log statements — decides the boolalpha line that
    // must come first inside main().
    let bodyLines = [];
    let savedLines = lines;
    lines = bodyLines;
    indentLevel = 1;
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    indentLevel = 0;
    lines = savedLines;
    for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
    if (fns.length > 0) lines.push("");
    lines.push("int main() {");
    if (needs.cout) lines.push("  std::cout << std::boolalpha;");
    for (let ii = 0; ii < bodyLines.length; ++ii) lines.push(bodyLines[ii]);
    lines.push("  return 0;");
    lines.push("}");
    let header = [];
    header.push("#include <iostream>");
    header.push("#include <string>");
    header.push("#include <vector>");
    if (needs.cmath) header.push("#include <cmath>");
    if (needs.algorithm) header.push("#include <algorithm>");
    if (needs.stdexcept) header.push("#include <stdexcept>");
    if (needs.vectorHelper) {
      header.push("");
      header.push("template <typename T>");
      header.push("void __iroh_print_vec(const std::vector<T>& v) {");
      header.push("  std::cout << \"[\";");
      header.push("  for (size_t i = 0; i < v.size(); ++i) {");
      header.push("    if (i) std::cout << \", \";");
      header.push("    std::cout << v[i];");
      header.push("  }");
      header.push("  std::cout << \"]\";");
      header.push("}");
    }
    if (needs.jsnum) {
      // JS Number -> string: the shortest decimal that round-trips,
      // formatted the way JS String(v) formats it. std::to_string
      // prints 6 decimals and std::cout defaults to 6 significant
      // digits, neither of which matches JS — so find the shortest
      // digits that round-trip (via %e at increasing precision),
      // then place the point per the ECMAScript Number::toString
      // rules (k = decimal exponent, n = digit count): k <= n <= 21
      // writes the digits with the point at k; n < k <= 21 appends
      // zeros; -6 < k <= 0 writes "0." with -k zeros; otherwise
      // exponential with a bare exponent ("1e+21", "1e-7").
      header.push("");
      header.push("#include <cmath>");
      header.push("#include <cstdio>");
      header.push("#include <sstream>");
      header.push("std::string __iroh_jsnum(double v) {");
      header.push("  if (std::isnan(v)) return \"NaN\";");
      header.push("  if (std::isinf(v)) return v > 0 ? \"Infinity\" : \"-Infinity\";");
      header.push("  if (v == 0) return \"0\";");
      header.push("  bool neg = v < 0;");
      header.push("  if (neg) v = -v;");
      header.push("  std::string digits;");
      header.push("  int k = 0;");
      header.push("  char buf[64];");
      header.push("  for (int p = 1; p <= 17; ++p) {");
      header.push("    std::snprintf(buf, sizeof(buf), \"%.*e\", p - 1, v);");
      header.push("    std::string s(buf);");
      header.push("    size_t epos = s.find('e');");
      header.push("    int e = std::stoi(s.substr(epos + 1));");
      header.push("    std::string d;");
      header.push("    d += s[0];");
      header.push("    size_t dot = s.find('.');");
      header.push("    if (dot != std::string::npos) {");
      header.push("      for (size_t j = dot + 1; j < epos; ++j) d += s[j];");
      header.push("    }");
      header.push("    while (d.size() > 1 && d[d.size() - 1] == '0') d.pop_back();");
      header.push("    if (std::stod(s) == v) { digits = d; k = e + 1; break; }");
      header.push("  }");
      header.push("  if (digits.empty()) { std::ostringstream os; os << v; return os.str(); }");
      header.push("  int n = (int)digits.size();");
      header.push("  std::string out = neg ? \"-\" : \"\";");
      header.push("  if (k > 0 && k <= n && n <= 21) {");
      header.push("    out += digits.substr(0, k);");
      header.push("    if (k < n) { out += \".\"; out += digits.substr(k); }");
      header.push("  } else if (n < k && k <= 21) {");
      header.push("    out += digits;");
      header.push("    for (int i = 0; i < k - n; ++i) out += \"0\";");
      header.push("  } else if (k > -6 && k <= 0) {");
      header.push("    out += \"0.\";");
      header.push("    for (int i = 0; i < -k; ++i) out += \"0\";");
      header.push("    out += digits;");
      header.push("  } else {");
      header.push("    out += digits.substr(0, 1);");
      header.push("    if (n > 1) { out += \".\"; out += digits.substr(1); }");
      header.push("    out += \"e\";");
      header.push("    out += (k - 1 >= 0 ? \"+\" : \"-\");");
      header.push("    out += std::to_string(k - 1 >= 0 ? k - 1 : -(k - 1));");
      header.push("  }");
      header.push("  return out;");
      header.push("}");
    }
    header.push("");
    return { text: header.concat(lines).join("\n") + "\n", counts: counts, needs: needs };
  }

  return { run: run, counts: counts };
}

// ------------------------------------------------------------------
// JavaScript-out translation (translateFromJS)
// ------------------------------------------------------------------

function translateFromJS(iroh, code, to, options) {
  let report = newReport("javascript", to, false);
  let ast = null;
  try {
    ast = parse$1(code);
  } catch (e) {
    if (
      e instanceof SyntaxError &&
      (e.message.indexOf("may appear only with 'sourceType: module'") !== -1 ||
        e.message.indexOf("outside a module") !== -1)
    ) {
      try {
        ast = parse$1(code, { sourceType: "module" });
      } catch (e2) {
        throw e;
      }
    } else {
      throw e;
    }
  }
  // Dynamic evidence: run the program through the tracer (best
  // effort — a program that throws, awaits, or imports still
  // translates statically, and the report says the evidence was
  // unavailable). The evidence trace must not leak the program's
  // output: translate() is a pure function, so the tracer's output
  // is silenced for the duration. Note the program's console.log
  // runs natively (the instrumenter does not rewrite it — Iroh.log
  // is only the fixtures' explicit print), so the global
  // console.log is swapped, not just Iroh.log.
  let events = [];
  let originalLog = iroh.log;
  let originalConsoleLog = typeof console !== "undefined" ? console.log : null;
  iroh.log = function() {};
  if (originalConsoleLog) console.log = function() {};
  try {
    events = iroh.trace(code).events;
  } catch (e) {
    report.notes.push(
      "Dynamic trace evidence unavailable (" + (e.message || String(e)) + "); types come from static inference or hints only."
    );
  } finally {
    iroh.log = originalLog;
    if (originalConsoleLog) console.log = originalConsoleLog;
  }
  let env = buildTraceEnv(events);
  let emitter = makeJSEmitter(to, report, env, options.types || null);
  let out = emitter.run(ast);
  let c = out.counts;
  if (c.functions > 0) {
    report.clean.push({ construct: "functions", count: c.functions, detail: "function declarations translated" });
  }
  if (c.variables > 0) {
    report.clean.push({ construct: "variables", count: c.variables, detail: "variable declarations translated" });
  }
  if (c.loops > 0) {
    report.clean.push({ construct: "loops", count: c.loops, detail: "for / while / do-while loops translated" });
  }
  if (c.conditionals > 0) {
    report.clean.push({ construct: "conditionals", count: c.conditionals, detail: "if / switch statements translated" });
  }
  if (c.outputs > 0) {
    report.clean.push({ construct: "console-output", count: c.outputs, detail: "console.log calls translated" });
  }
  // Trace observations (informational, not assumptions): branch
  // outcomes and functions never called.
  let ifHashes = Object.keys(env.ifOutcomes);
  if (ifHashes.length > 0) {
    let oneSided = 0;
    for (let ii = 0; ii < ifHashes.length; ++ii) {
      let g = env.ifOutcomes[ifHashes[ii]];
      if (g.trueCount === 0 || g.falseCount === 0) oneSided += 1;
    }
    report.notes.push(
      ifHashes.length + " if-statement(s) evaluated in the trace; " + oneSided +
      " never took one arm (both arms were still translated statically)."
    );
  }
  let fnNames = [];
  for (let ii = 0; ii < ast.body.length; ++ii) {
    if (ast.body[ii].type === "FunctionDeclaration") fnNames.push(ast.body[ii].id.name);
  }
  let uncalled = [];
  for (let ii = 0; ii < fnNames.length; ++ii) {
    if (!env.called[fnNames[ii]]) uncalled.push(fnNames[ii]);
  }
  if (uncalled.length > 0) {
    report.notes.push(
      "Function(s) never called in the trace (" + uncalled.join(", ") +
      "): C++ parameter types for them came from a type hint, or the function was reported unsupported."
    );
  }
  // 1.0.1 patch (Fix Spec 3.7): the verify block. Only the Python
  // leg is executed here; every other target records that
  // verification was not attempted, so a missing verify is never
  // mistaken for a pass (ran: null is not ran: true). A translation
  // that is not ok emits a loud stub, not runnable code, so it is
  // not executed either.
  if (to === "python") {
    if (report.ok) verifyEmittedPython(report, out.text, options);
    else {
      report.verify = { attempted: false, ran: null, reason: "translation incomplete (unsupported constructs); emitted code is a stub, not run" };
    }
  } else {
    report.verify = { attempted: false, ran: null, reason: "verify is only implemented for the Python leg" };
  }
  return { code: out.text, report: report };
}

// ------------------------------------------------------------------
// Python -> JavaScript (static-only)
// ------------------------------------------------------------------

// stdlib-only Python helper: reads source on stdin, parses with the
// `ast` module, writes the AST as JSON on stdout. No hand-rolled
// Python parser on the JS side.
const PYTHON_AST_HELPER = [
  "import ast, json, sys",
  "def conv(n):",
  "    if isinstance(n, ast.AST):",
  "        d = {'_type': type(n).__name__}",
  "        for f, v in ast.iter_fields(n):",
  "            d[f] = conv(v)",
  "        return d",
  "    if isinstance(n, list):",
  "        return [conv(x) for x in n]",
  "    if n is None or isinstance(n, (str, int, float, bool)):",
  "        return n",
  "    return {'_type': '_Value', 'value': str(n)}",
  "src = sys.stdin.read()",
  "tree = ast.parse(src)",
  "sys.stdout.write(json.dumps(conv(tree)))",
].join("\n");

function getChildProcessSync() {
  // `require` is the CJS bundle's module require; in the ESM and
  // browser bundles it is undefined, so this safely returns null
  // there (the Python leg then throws a clear error — see
  // translateAsync for the ESM path).
  if (typeof require === "function") {
    try {
      return require("node:child_process");
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Dynamic import() without writing `import()` literally in src/:
// buble cannot parse import() syntax (same pattern as setup.js).
function nodeImport$1(specifier) {
  return new Function("s", "return import(s);")(specifier);
}

function runPythonAst(code, childProcess) {
  let stdout;
  try {
    stdout = childProcess.execFileSync("python3", ["-c", PYTHON_AST_HELPER], {
      input: code,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error("Iroh.translate: python3 was not found on PATH (needed to parse Python source)");
    }
    let stderr = e.stderr ? String(e.stderr) : "";
    let lines = stderr.split("\n").filter(function(l) { return l.trim() !== ""; });
    let last = lines.length > 0 ? lines[lines.length - 1] : (e.message || String(e));
    throw new Error("Iroh.translate: Python parse failed: " + last);
  }
  return JSON.parse(stdout);
}

// Python AST (JSON) -> JavaScript. One function scope at a time:
// `declared` is the set of names already given a `let` in the
// current function (Python has no declarations — the first
// assignment to a name declares it); `globals` are names a `global`
// / `nonlocal` statement claimed, which never get a `let`.
function makePyJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let scopeStack = [];
  let noted = {};

  function noteOnce(key, text) {
    if (!noted[key]) {
      noted[key] = true;
      report.notes.push(text);
    }
  }
  function indentStr() {
    return "  ".repeat(indentLevel);
  }
  function emitLine(text) {
    lines.push(indentStr() + text);
  }
  function currentScope() {
    return scopeStack[scopeStack.length - 1];
  }
  function declareName(name) {
    let scope = currentScope();
    if (scope.globals[name] || scope.declared[name]) return "";
    scope.declared[name] = true;
    return "let ";
  }
  function stubExpr(detail) {
    markUnsupported(report, "Unsupported", detail);
    return '(function() { throw new Error(' + quotedMessage("IrohRedux: " + detail) + '); })()';
  }
  function opName(op) {
    // Python AST operator node -> { _type } string.
    return op && op._type ? op._type : "?";
  }

  function expr(node) {
    if (!node || typeof node._type !== "string") {
      return stubExpr("missing expression in Python source");
    }
    switch (node._type) {
      case "Constant": {
        let v = node.value;
        if (v === null) return "null";
        if (typeof v === "string") return JSON.stringify(v);
        if (typeof v === "number") return String(v);
        if (typeof v === "boolean") return v ? "true" : "false";
        return stubExpr("constant of unsupported type");
      }
      case "Name":
        return node.id;
      case "List":
      case "Tuple": {
        let parts = [];
        for (let ii = 0; ii < node.elts.length; ++ii) parts.push(expr(node.elts[ii]));
        return "[" + parts.join(", ") + "]";
      }
      case "BinOp": {
        let op = opName(node.op);
        let l = expr(node.left);
        let r = expr(node.right);
        if (op === "Add") return "(" + l + " + " + r + ")";
        if (op === "Sub") return "(" + l + " - " + r + ")";
        if (op === "Mult") return "(" + l + " * " + r + ")";
        if (op === "Div") return "(" + l + " / " + r + ")";
        if (op === "Mod") {
          // Python % is floored; JS % is truncated (it takes the
          // dividend's sign). The floored form below matches Python
          // for every sign combination, including negative divisors.
          return "((" + l + " % " + r + ") + " + r + ") % " + r;
        }
        if (op === "Pow") return "(" + l + " ** " + r + ")";
        if (op === "FloorDiv") return "Math.floor(" + l + " / " + r + ")";
        if (op === "BitAnd") return "(" + l + " & " + r + ")";
        if (op === "BitOr") return "(" + l + " | " + r + ")";
        if (op === "BitXor") return "(" + l + " ^ " + r + ")";
        if (op === "LShift") return "(" + l + " << " + r + ")";
        if (op === "RShift") return "(" + l + " >> " + r + ")";
        return stubExpr("binary operator " + op);
      }
      case "UnaryOp": {
        let op = opName(node.op);
        if (op === "USub") return "(-" + expr(node.operand) + ")";
        if (op === "UAdd") return "(+" + expr(node.operand) + ")";
        if (op === "Not") return "(!" + expr(node.operand) + ")";
        if (op === "Invert") return "(~" + expr(node.operand) + ")";
        return stubExpr("unary operator " + op);
      }
      case "BoolOp": {
        let op = opName(node.op);
        let joiner = op === "And" ? " && " : " || ";
        let parts = [];
        for (let ii = 0; ii < node.values.length; ++ii) parts.push(expr(node.values[ii]));
        return "(" + parts.join(joiner) + ")";
      }
      case "Compare": {
        let parts = [];
        let left = expr(node.left);
        for (let ii = 0; ii < node.ops.length; ++ii) {
          let op = opName(node.ops[ii]);
          let right = expr(node.comparators[ii]);
          let jsOp = { Eq: "==", NotEq: "!=", Lt: "<", LtE: "<=", Gt: ">", GtE: ">=" }[op];
          if (!jsOp) return stubExpr("comparison operator " + op);
          parts.push("(" + left + " " + jsOp + " " + right + ")");
          left = right;
        }
        return parts.join(" && ");
      }
      case "IfExp":
        return "(" + expr(node.test) + " ? " + expr(node.body) + " : " + expr(node.orelse) + ")";
      case "Call":
        return callExpr(node);
      case "Subscript": {
        let slice = node.slice;
        if (slice && slice._type === "Slice") {
          let lower = slice.lower ? expr(slice.lower) : "";
          let upper = slice.upper ? expr(slice.upper) : "";
          if (slice.step) return stubExpr("slice with a step");
          return expr(node.value) + ".slice(" + lower + (upper !== "" || lower !== "" ? ", " + upper : "") + ")";
        }
        return expr(node.value) + "[" + expr(slice) + "]";
      }
      case "Attribute":
        return expr(node.value) + "." + node.attr;
      case "JoinedStr": {
        let parts = ["`"];
        for (let ii = 0; ii < node.values.length; ++ii) {
          let v = node.values[ii];
          if (v._type === "Constant" && typeof v.value === "string") {
            parts.push(v.value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$"));
          } else if (v._type === "FormattedValue") {
            if (v.conversion === 115) parts.push("${String(" + expr(v.value) + ")}");
            else if (v.conversion === 114) return stubExpr("f-string !r conversion");
            else if (v.format_spec) return stubExpr("f-string format spec");
            else parts.push("${" + expr(v.value) + "}");
          } else {
            return stubExpr("f-string part");
          }
        }
        parts.push("`");
        return parts.join("");
      }
      case "Lambda": {
        let params = [];
        for (let ii = 0; ii < node.args.args.length; ++ii) params.push(node.args.args[ii].arg);
        return "(" + params.join(", ") + ") => " + expr(node.body);
      }
      case "Starred":
        return stubExpr("starred expression");
      case "Await":
      case "Yield":
      case "YieldFrom":
        return stubExpr(node._type + " (no async in v1)");
      case "Dict":
        return stubExpr("dict literal (no objects in the v1 scope)");
      case "NamedExpr":
        return stubExpr("walrus operator");
      default:
        return stubExpr("Python expression " + node._type);
    }
  }

  function callExpr(node) {
    let func = node.func;
    let args = [];
    for (let ii = 0; ii < node.args.length; ++ii) {
      let a = node.args[ii];
      if (a._type === "Starred") return stubExpr("starred call arguments");
      args.push(expr(a));
    }
    if (node.keywords && node.keywords.length > 0) {
      return stubExpr("keyword call arguments");
    }
    if (func._type === "Name") {
      let name = func.id;
      if (name === "print") return "console.log(" + args.join(", ") + ")";
      if (name === "len") return args[0] + ".length";
      if (name === "str") return "String(" + args[0] + ")";
      if (name === "int") return "Math.trunc(" + args[0] + ")";
      if (name === "float") return "Number(" + args[0] + ")";
      if (name === "bool") return "Boolean(" + args[0] + ")";
      if (name === "list") return "Array.from(" + args[0] + ")";
      if (name === "range") return stubExpr("range() outside a for loop (use it as the for target)");
      return name + "(" + args.join(", ") + ")";
    }
    if (func._type === "Attribute") {
      let obj = expr(func.value);
      let attr = func.attr;
      if (attr === "append") return obj + ".push(" + args.join(", ") + ")";
      if (attr === "upper") return obj + ".toUpperCase()";
      if (attr === "lower") return obj + ".toLowerCase()";
      if (attr === "split") return obj + ".split(" + args.join(", ") + ")";
      if (attr === "strip") return obj + ".trim()";
      if (attr === "join") return args[0] + ".join(" + obj + ")";
      return stubExpr("method ." + attr + " is not in the v1 scope");
    }
    return stubExpr("call of computed callee");
  }

  function assignTarget(target, value) {
    // Emits an assignment to `target` of the already-emitted `value`
    // string, declaring the name with `let` on first assignment in
    // this scope. Returns nothing; emits lines.
    if (target._type === "Name") {
      emitLine(declareName(target.id) + target.id + " = " + value + ";");
    } else if (target._type === "Tuple" || target._type === "List") {
      // `let [a, b] = ...` if any name is new to this scope.
      let plain = [];
      let anyNew = false;
      for (let ii = 0; ii < target.elts.length; ++ii) {
        let el = target.elts[ii];
        if (el._type !== "Name") {
          markUnsupported(report, "Assign", "destructuring assignment to non-name target");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: destructuring to non-name target") + ");");
          return;
        }
        plain.push(el.id);
        let scope = currentScope();
        if (!scope.globals[el.id] && !scope.declared[el.id]) {
          scope.declared[el.id] = true;
          anyNew = true;
        }
      }
      emitLine((anyNew ? "let " : "") + "[" + plain.join(", ") + "] = " + value + ";");
    } else if (target._type === "Subscript" || target._type === "Attribute") {
      emitLine(expr(target) + " = " + value + ";");
    } else {
      markUnsupported(report, "Assign", "assignment target " + target._type);
      emitLine("throw new Error(" + quotedMessage("IrohRedux: assignment target " + target._type) + ");");
    }
  }

  function emitBody(stmts) {
    if (!stmts || stmts.length === 0) {
      emitLine("// pass");
      return;
    }
    indentLevel += 1;
    for (let ii = 0; ii < stmts.length; ++ii) stmt(stmts[ii]);
    indentLevel -= 1;
  }

  function isRangeCall(node) {
    return (
      node &&
      node._type === "Call" &&
      node.func._type === "Name" &&
      node.func.id === "range" &&
      (!node.keywords || node.keywords.length === 0) &&
      node.args.length >= 1 &&
      node.args.length <= 3
    );
  }

  function stmt(node) {
    if (!node || typeof node._type !== "string") return;
    switch (node._type) {
      case "FunctionDef": {
        if (node.decorator_list && node.decorator_list.length > 0) {
          markUnsupported(report, "FunctionDef", "decorated function '" + node.name + "' (decorators are not in the v1 scope)");
          emitLine("function " + node.name + "() { throw new Error(" + quotedMessage("IrohRedux: decorated function " + node.name) + "); }");
          return;
        }
        if (node.args.vararg || node.args.kwarg || (node.args.kwonlyargs && node.args.kwonlyargs.length > 0)) {
          markUnsupported(report, "FunctionDef", "function '" + node.name + "' uses *args/**kwargs (not in the v1 scope)");
          emitLine("function " + node.name + "() { throw new Error(" + quotedMessage("IrohRedux: *args/**kwargs") + "); }");
          return;
        }
        let params = [];
        let defaults = node.args.defaults || [];
        let positional = node.args.args || [];
        let firstDefault = positional.length - defaults.length;
        for (let ii = 0; ii < positional.length; ++ii) {
          let p = positional[ii].arg;
          if (ii >= firstDefault) p += " = " + expr(defaults[ii - firstDefault]);
          params.push(p);
        }
        emitLine("function " + node.name + "(" + params.join(", ") + ") {");
        scopeStack.push({ declared: {}, globals: {} });
        emitBody(node.body);
        scopeStack.pop();
        emitLine("}");
        return;
      }
      case "AsyncFunctionDef":
        markUnsupported(report, "AsyncFunctionDef", "async function '" + node.name + "' (no async in v1)");
        emitLine("function " + node.name + "() { throw new Error(" + quotedMessage("IrohRedux: async function") + "); }");
        return;
      case "ClassDef":
        markUnsupported(report, "ClassDef", "class '" + node.name + "' (no classes in v1)");
        emitLine("class " + node.name + " { constructor() { throw new Error(" + quotedMessage("IrohRedux: class " + node.name) + "); } }");
        return;
      case "Return":
        emitLine(node.value ? "return " + expr(node.value) + ";" : "return;");
        return;
      case "Assign": {
        if (node.targets.length === 1) {
          assignTarget(node.targets[0], expr(node.value));
        } else {
          let value = expr(node.value);
          for (let ii = 0; ii < node.targets.length; ++ii) {
            assignTarget(node.targets[ii], value);
          }
        }
        return;
      }
      case "AnnAssign": {
        if (node.value) assignTarget(node.target, expr(node.value));
        else if (node.target._type === "Name") emitLine(declareName(node.target.id) + node.target.id + ";");
        else noteOnce("annassign", "Annotation-only assignment ignored (types are not carried into JS).");
        return;
      }
      case "AugAssign": {
        let op = opName(node.op);
        let map = { Add: "+=", Sub: "-=", Mult: "*=", Div: "/=", Mod: "%=", Pow: "**=", BitAnd: "&=", BitOr: "|=", BitXor: "^=", LShift: "<<=", RShift: ">>=" };
        if (op === "FloorDiv") {
          emitLine(expr(node.target) + " = Math.floor(" + expr(node.target) + " / " + expr(node.value) + ");");
          return;
        }
        if (!map[op]) {
          markUnsupported(report, "AugAssign", "augmented assignment " + op);
          emitLine("throw new Error(" + quotedMessage("IrohRedux: augmented assignment " + op) + ");");
          return;
        }
        emitLine(expr(node.target) + " " + map[op] + " " + expr(node.value) + ";");
        return;
      }
      case "Expr":
        emitLine(expr(node.value) + ";");
        return;
      case "If": {
        emitLine("if (" + expr(node.test) + ") {");
        emitBody(node.body);
        emitLine("}");
        let orelse = node.orelse || [];
        if (orelse.length === 1 && orelse[0]._type === "If") {
          lines[lines.length - 1] = indentStr() + "} else if (" + expr(orelse[0].test) + ") {";
          emitBody(orelse[0].body);
          emitLine("}");
          let rest = orelse[0].orelse || [];
          if (rest.length > 0) {
            lines[lines.length - 1] = indentStr() + "} else {";
            emitBody(rest);
            emitLine("}");
          }
        } else if (orelse.length > 0) {
          lines[lines.length - 1] = indentStr() + "} else {";
          emitBody(orelse);
          emitLine("}");
        }
        return;
      }
      case "For": {
        if (node.orelse && node.orelse.length > 0) {
          markUnsupported(report, "For", "for-else (the else runs only when the loop completes without break)");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: for-else") + ");");
          return;
        }
        if (isRangeCall(node.iter)) {
          let args = node.iter.args;
          let start = "0";
          let end;
          let step = "1";
          if (args.length === 1) end = expr(args[0]);
          else if (args.length === 2) { start = expr(args[0]); end = expr(args[1]); }
          else { start = expr(args[0]); end = expr(args[1]); step = expr(args[2]); }
          let target = node.target._type === "Name" ? node.target.id : null;
          if (!target) {
            markUnsupported(report, "For", "range() loop with non-name target");
            emitLine("throw new Error(" + quotedMessage("IrohRedux: range() target") + ");");
            return;
          }
          noteOnce("range", "range() loops translate to numeric for loops; Python's range() semantics (half-open, step) are preserved.");
          emitLine("for (" + declareName(target) + target + " = " + start + "; " + target + " < " + end + "; " + target + " += " + step + ") {");
          emitBody(node.body);
          emitLine("}");
          return;
        }
        if (node.target._type === "Name") {
          let name = node.target.id;
          let prefix = declareName(name);
          if (prefix) emitLine("let " + name + ";");
          noteOnce("forscope", "Python loop variables leak into the enclosing scope; the translation declares them before the loop to match.");
          emitLine("for (" + name + " of " + expr(node.iter) + ") {");
          emitBody(node.body);
          emitLine("}");
          return;
        }
        if (node.target._type === "Tuple") {
          let names = [];
          for (let ii = 0; ii < node.target.elts.length; ++ii) {
            if (node.target.elts[ii]._type !== "Name") {
              markUnsupported(report, "For", "for loop with non-name tuple target");
              emitLine("throw new Error(" + quotedMessage("IrohRedux: for tuple target") + ");");
              return;
            }
            names.push(node.target.elts[ii].id);
          }
          emitLine("for (const [" + names.join(", ") + "] of " + expr(node.iter) + ") {");
          emitBody(node.body);
          emitLine("}");
          return;
        }
        markUnsupported(report, "For", "for loop with target " + node.target._type);
        emitLine("throw new Error(" + quotedMessage("IrohRedux: for target") + ");");
        return;
      }
      case "While": {
        if (node.orelse && node.orelse.length > 0) {
          markUnsupported(report, "While", "while-else");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: while-else") + ");");
          return;
        }
        emitLine("while (" + expr(node.test) + ") {");
        emitBody(node.body);
        emitLine("}");
        return;
      }
      case "Break":
        emitLine("break;");
        return;
      case "Continue":
        emitLine("continue;");
        return;
      case "Pass":
        return;
      case "Try": {
        if (node.orelse && node.orelse.length > 0) {
          markUnsupported(report, "Try", "try-else");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: try-else") + ");");
          return;
        }
        emitLine("try {");
        emitBody(node.body);
        emitLine("}");
        for (let ii = 0; ii < (node.handlers || []).length; ++ii) {
          let h = node.handlers[ii];
          let isGeneric = !h.type || (h.type._type === "Name" && h.type.id === "Exception");
          if (!isGeneric) {
            markUnsupported(report, "Try", "except for a specific error type (only bare `except:` / `except Exception:` translate in v1)");
            emitLine("catch (e) {");
            indentLevel += 1;
            emitLine("throw new Error(" + quotedMessage("IrohRedux: specific except") + ");");
            indentLevel -= 1;
            emitLine("}");
            continue;
          }
          if (h.name) emitLine("catch (" + h.name + ") {");
          else emitLine("catch (e) {");
          emitBody(h.body);
          emitLine("}");
        }
        if (node.finalbody && node.finalbody.length > 0) {
          lines[lines.length - 1] = indentStr() + "} finally {";
          emitBody(node.finalbody);
          emitLine("}");
        }
        return;
      }
      case "Raise": {
        if (!node.exc) {
          markUnsupported(report, "Raise", "bare raise");
          emitLine("throw new Error(" + quotedMessage("IrohRedux: bare raise") + ");");
          return;
        }
        if (node.exc._type === "Call" && node.exc.func._type === "Name") {
          emitLine("throw new Error(" + (node.exc.args.length > 0 ? expr(node.exc.args[0]) : '""') + ");");
          return;
        }
        emitLine("throw " + expr(node.exc) + ";");
        return;
      }
      case "Assert": {
        let msg = node.msg ? " + \": \" + " + expr(node.msg) : "";
        emitLine("if (!(" + expr(node.test) + ")) throw new Error(\"AssertionError\"" + msg + ");");
        return;
      }
      case "Global": {
        for (let ii = 0; ii < node.names.length; ++ii) currentScope().globals[node.names[ii]] = true;
        return;
      }
      case "Nonlocal": {
        noteOnce("nonlocal", "nonlocal is treated like global (assignments go to the enclosing declaration, no `let`).");
        for (let ii = 0; ii < node.names.length; ++ii) currentScope().globals[node.names[ii]] = true;
        return;
      }
      case "Import":
      case "ImportFrom": {
        let what = node._type === "Import"
          ? node.names.map(function(n) { return n.name; }).join(", ")
          : (node.module || "") + " import ...";
        markUnsupported(report, node._type, "import '" + what + "' (imports do not translate in v1)");
        emitLine("// IrohRedux: import '" + what + "' is not translated (v1 has no imports).");
        return;
      }
      case "Delete":
      case "With":
      case "AsyncFor":
      case "AsyncWith":
        markUnsupported(report, node._type, node._type + " is not in the v1 scope");
        emitLine("throw new Error(" + quotedMessage("IrohRedux: " + node._type) + ");");
        return;
      default:
        markUnsupported(report, node._type, "Python statement " + node._type + " is not in the v1 scope");
        emitLine("throw new Error(" + quotedMessage("IrohRedux: " + node._type) + ");");
        return;
    }
  }

  function run(ast) {
    scopeStack.push({ declared: {}, globals: {} });
    for (let ii = 0; ii < ast.body.length; ++ii) stmt(ast.body[ii]);
    scopeStack.pop();
    return lines.join("\n") + "\n";
  }

  return { run: run };
}

function translateFromPython(code, childProcess) {
  let report = newReport("python", "javascript", true);
  report.notes.push(
    "Static-only leg: there is no tracer for Python, so this translation uses the source alone — no runtime types, no branch evidence."
  );
  let ast = runPythonAst(code, childProcess);
  let emitter = makePyJSEmitter(report);
  let out = emitter.run(ast);
  report.clean.push({ construct: "statements", count: ast.body.length, detail: "top-level statements translated" });
  return { code: out, report: report };
}

// ------------------------------------------------------------------
// C++ -> JavaScript (static-only). A scoped subset parser for the
// v1 constructs only; anything outside the subset is reported
// unsupported, never guessed at.
// ------------------------------------------------------------------

function CppParseError(message) {
  this.name = "CppParseError";
  this.message = message;
}
CppParseError.prototype = Object.create(Error.prototype);

const CPP_MULTI_PUNCT = ["<<=", ">>=", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "->", "::"];

function tokenizeCpp(code) {
  let tokens = [];
  let includes = [];
  let ii = 0;
  function isDigit(c) { return c >= "0" && c <= "9"; }
  function isIdentStart(c) { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
  function isIdentChar(c) { return isIdentStart(c) || isDigit(c); }
  while (ii < code.length) {
    let c = code[ii];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { ii += 1; continue; }
    if (c === "/" && code[ii + 1] === "/") {
      while (ii < code.length && code[ii] !== "\n") ii += 1;
      continue;
    }
    if (c === "/" && code[ii + 1] === "*") {
      let end = code.indexOf("*/", ii + 2);
      if (end === -1) throw new CppParseError("unterminated block comment");
      ii = end + 2;
      continue;
    }
    if (c === "#") {
      // Preprocessor line: record and skip (includes are noted in
      // the report; the translation itself does not need them).
      let start = ii;
      while (ii < code.length && code[ii] !== "\n") ii += 1;
      let line = code.slice(start, ii).trim();
      if (line.indexOf("#include") === 0) includes.push(line);
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(code[ii + 1] || ""))) {
      let start = ii;
      while (ii < code.length && (isDigit(code[ii]) || code[ii] === ".")) ii += 1;
      if (code[ii] === "e" || code[ii] === "E") {
        ii += 1;
        if (code[ii] === "+" || code[ii] === "-") ii += 1;
        while (ii < code.length && isDigit(code[ii])) ii += 1;
      }
      // Suffixes (f, u, l, ll) are dropped — the value is what matters.
      while (ii < code.length && /[fFuUlL]/.test(code[ii])) ii += 1;
      tokens.push({ type: "number", value: code.slice(start, ii) });
      continue;
    }
    if (isIdentStart(c)) {
      let start = ii;
      while (ii < code.length && isIdentChar(code[ii])) ii += 1;
      tokens.push({ type: "ident", value: code.slice(start, ii) });
      continue;
    }
    if (c === '"') {
      let start = ii;
      ii += 1;
      let value = "";
      let closed = false;
      while (ii < code.length) {
        let ch = code[ii];
        if (ch === "\\") {
          let esc = code[ii + 1];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "r") value += "\r";
          else if (esc === '"') value += '"';
          else if (esc === "\\") value += "\\";
          else if (esc === "0") value += "\0";
          else value += esc || "";
          ii += 2;
          continue;
        }
        if (ch === '"') { ii += 1; closed = true; break; }
        if (ch === "\n") break;
        value += ch;
        ii += 1;
      }
      if (!closed) throw new CppParseError("unterminated string literal");
      tokens.push({ type: "string", value: value, raw: code.slice(start, ii) });
      continue;
    }
    if (c === "'") {
      ii += 1;
      let value = "";
      let closed = false;
      while (ii < code.length) {
        let ch = code[ii];
        if (ch === "\\") {
          let esc = code[ii + 1];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "'") value += "'";
          else if (esc === "\\") value += "\\";
          else if (esc === "0") value += "\0";
          else value += esc || "";
          ii += 2;
          continue;
        }
        if (ch === "'") { ii += 1; closed = true; break; }
        if (ch === "\n") break;
        value += ch;
        ii += 1;
      }
      if (!closed) throw new CppParseError("unterminated character literal");
      if (value.length !== 1) throw new CppParseError("multi-character literal is not in the v1 subset");
      tokens.push({ type: "char", value: value });
      continue;
    }
    let matched = false;
    for (let jj = 0; jj < CPP_MULTI_PUNCT.length; ++jj) {
      let p = CPP_MULTI_PUNCT[jj];
      if (code.indexOf(p, ii) === ii) {
        tokens.push({ type: "punct", value: p });
        ii += p.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    tokens.push({ type: "punct", value: c });
    ii += 1;
  }
  tokens.push({ type: "eof", value: "" });
  return { tokens: tokens, includes: includes };
}

function makeCppParser(code) {
  let scanned = tokenizeCpp(code);
  let tokens = scanned.tokens;
  let pos = 0;

  function peek(k) {
    return tokens[Math.min(pos + (k || 0), tokens.length - 1)];
  }
  function next() {
    let t = tokens[pos];
    if (pos < tokens.length - 1) pos += 1;
    return t;
  }
  function isPunct(v) {
    return peek().type === "punct" && peek().value === v;
  }
  function isIdent(v) {
    return peek().type === "ident" && (v === void 0 || peek().value === v);
  }
  function expectPunct(v) {
    if (!isPunct(v)) throw new CppParseError("expected '" + v + "' but found '" + peek().value + "'");
    next();
  }
  function expectIdent(what) {
    if (peek().type !== "ident") throw new CppParseError("expected " + (what || "identifier") + " but found '" + peek().value + "'");
    return next().value;
  }

  const CPP_KEYWORDS = ["auto", "void", "int", "long", "short", "double", "float", "bool", "char", "string", "unsigned", "signed", "const", "static", "size_t", "vector", "std"];

  function parseType() {
    // Returns a type string like "int", "std::string",
    // "std::vector<int>", or null if this is not a type.
    // Trailing `&`/`*` (references/pointers) are consumed and
    // dropped — types are not carried into JavaScript.
    let t = peek();
    if (t.type !== "ident") return null;
    let base$$1 = t.value;
    if (base$$1 === "const" || base$$1 === "static" || base$$1 === "unsigned" || base$$1 === "signed") {
      next();
      let inner = parseType();
      if (!inner) throw new CppParseError("expected a type after '" + base$$1 + "'");
      return inner; // qualifiers are dropped (int is int)
    }
    let result = null;
    if (base$$1 === "auto" || base$$1 === "void" || base$$1 === "int" || base$$1 === "long" || base$$1 === "short" ||
        base$$1 === "double" || base$$1 === "float" || base$$1 === "bool" || base$$1 === "char" || base$$1 === "size_t") {
      next();
      if (base$$1 === "long" || base$$1 === "short" || base$$1 === "size_t") result = "int";
      else if (base$$1 === "float") result = "double";
      else result = base$$1;
    } else if (base$$1 === "string") { next(); result = "std::string"; }
    else if (base$$1 === "std") {
      next();
      if (!isPunct("::")) throw new CppParseError("expected '::' after std");
      next();
      let name = expectIdent("a std:: type name");
      if (name === "string") result = "std::string";
      else if (name === "exception") result = "std::exception";
      else if (name === "vector") {
        if (!isPunct("<")) throw new CppParseError("expected '<' after std::vector");
        next();
        let inner = parseType();
        if (!inner) throw new CppParseError("expected an element type in std::vector<...>");
        expectPunct(">");
        result = "std::vector<" + inner + ">";
      } else {
        throw new CppParseError("std::" + name + " is not in the v1 subset");
      }
    } else if (base$$1 === "vector") {
      next();
      if (!isPunct("<")) throw new CppParseError("expected '<' after vector");
      next();
      let inner = parseType();
      if (!inner) throw new CppParseError("expected an element type in vector<...>");
      expectPunct(">");
      result = "std::vector<" + inner + ">";
    } else {
      return null;
    }
    while (isPunct("&") || isPunct("*")) next();
    return result;
  }

  // Speculative type parse: parseType() throws on `std::cout` (a
  // value, not a type), so speculative call sites use this — a
  // failed type parse just means "not a declaration".
  function tryParseType() {
    let saved = pos;
    try {
      return parseType();
    } catch (e) {
      if (e instanceof CppParseError) {
        pos = saved;
        return null;
      }
      throw e;
    }
  }

  function parseQualifiedName() {
    // std::cout, std::pow, plain identifiers, a.b.c
    let name = expectIdent();
    while (isPunct("::")) {
      next();
      name += "::" + expectIdent();
    }
    return name;
  }

  function parsePrimary() {
    let t = peek();
    if (t.type === "number") {
      next();
      return { type: "Literal", value: Number(t.value), raw: t.value };
    }
    if (t.type === "string") {
      next();
      return { type: "Literal", value: t.value };
    }
    if (t.type === "char") {
      next();
      return { type: "Literal", value: t.value };
    }
    if (t.type === "ident") {
      if (t.value === "true") { next(); return { type: "Literal", value: true }; }
      if (t.value === "false") { next(); return { type: "Literal", value: false }; }
      if (t.value === "nullptr") { next(); return { type: "Literal", value: null }; }
      if (t.value === "new") throw new CppParseError("'new' is not in the v1 subset");
      let name = parseQualifiedName();
      if (isPunct("(")) {
        next();
        let args = [];
        if (!isPunct(")")) {
          // Arguments, not a comma sequence: parseAssignment stops
          // at the comma.
          args.push(parseAssignment());
          while (isPunct(",")) { next(); args.push(parseAssignment()); }
        }
        expectPunct(")");
        return { type: "CallExpression", callee: { type: "Identifier", name: name }, arguments: args };
      }
      return { type: "Identifier", name: name };
    }
    if (isPunct("(")) {
      next();
      let e = parseExpression();
      expectPunct(")");
      return e;
    }
    if (isPunct("{")) {
      // Initializer list {1, 2, 3}
      next();
      let elements = [];
      if (!isPunct("}")) {
        elements.push(parseAssignment());
        while (isPunct(",")) { next(); if (isPunct("}")) break; elements.push(parseAssignment()); }
      }
      expectPunct("}");
      return { type: "ArrayExpression", elements: elements };
    }
    throw new CppParseError("unexpected token '" + t.value + "' in expression");
  }

  function parsePostfix() {
    let e = parsePrimary();
    while (true) {
      if (isPunct(".")) {
        next();
        let prop = expectIdent("a member name");
        if (isPunct("(")) {
          next();
          let args = [];
          if (!isPunct(")")) {
            args.push(parseAssignment());
            while (isPunct(",")) { next(); args.push(parseAssignment()); }
          }
          expectPunct(")");
          e = { type: "CallExpression", callee: { type: "MemberExpression", object: e, property: { type: "Identifier", name: prop }, computed: false }, arguments: args };
          continue;
        }
        e = { type: "MemberExpression", object: e, property: { type: "Identifier", name: prop }, computed: false };
        continue;
      }
      if (isPunct("[")) {
        next();
        let idx = parseExpression();
        expectPunct("]");
        e = { type: "MemberExpression", object: e, property: idx, computed: true };
        continue;
      }
      if (isPunct("++") || isPunct("--")) {
        let op = next().value;
        e = { type: "UpdateExpression", operator: op, argument: e, prefix: false };
        continue;
      }
      break;
    }
    return e;
  }

  function parseUnary() {
    if (isPunct("-") || isPunct("+") || isPunct("!") || isPunct("~")) {
      let op = next().value;
      return { type: "UnaryExpression", operator: op, argument: parseUnary(), prefix: true };
    }
    if (isPunct("++") || isPunct("--")) {
      let op = next().value;
      return { type: "UpdateExpression", operator: op, argument: parseUnary(), prefix: true };
    }
    if (isIdent("sizeof")) throw new CppParseError("sizeof is not in the v1 subset");
    return parsePostfix();
  }

  const BIN_LEVELS = [
    ["*", "/", "%"],
    ["+", "-"],
    ["<<", ">>"],
    ["<", "<=", ">", ">="],
    ["==", "!="],
    ["&"],
    ["^"],
    ["|"],
    ["&&"],
    ["||"],
  ];

  function parseBinary(level) {
    if (level >= BIN_LEVELS.length) return parseUnary();
    let left = parseBinary(level + 1);
    let ops = BIN_LEVELS[level];
    while (peek().type === "punct" && ops.indexOf(peek().value) !== -1) {
      let op = next().value;
      let right = parseBinary(level + 1);
      left = { type: "BinaryExpression", operator: op, left: left, right: right };
    }
    return left;
  }

  function parseTernary() {
    let e = parseBinary(0);
    if (isPunct("?")) {
      next();
      let consequent = parseExpression();
      expectPunct(":");
      let alternate = parseTernary();
      return { type: "ConditionalExpression", test: e, consequent: consequent, alternate: alternate };
    }
    return e;
  }

  function parseAssignment() {
    let e = parseTernary();
    if (peek().type === "punct" && ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="].indexOf(peek().value) !== -1) {
      let op = next().value;
      let right = parseAssignment();
      return { type: "AssignmentExpression", operator: op, left: e, right: right };
    }
    return e;
  }

  function parseExpression() {
    let first = parseAssignment();
    if (!isPunct(",")) return first;
    let exprs = [first];
    while (isPunct(",")) { next(); exprs.push(parseAssignment()); }
    return { type: "SequenceExpression", expressions: exprs };
  }

  function parseBlock() {
    expectPunct("{");
    let body = [];
    while (!isPunct("}")) {
      if (peek().type === "eof") throw new CppParseError("unterminated block");
      body.push(parseStatement());
    }
    expectPunct("}");
    return { type: "BlockStatement", body: body };
  }

  function parseVarDeclRest(firstType, firstName) {
    // After `type name` in a statement: `= init`, `, name2 ...`, `;`.
    let decls = [];
    let init = null;
    if (isPunct("=")) {
      next();
      init = parseExpression();
    }
    decls.push({ type: "VariableDeclarator", id: { type: "Identifier", name: firstName }, init: init });
    while (isPunct(",")) {
      next();
      let name = expectIdent("a variable name");
      let vinit = null;
      if (isPunct("=")) { next(); vinit = parseExpression(); }
      decls.push({ type: "VariableDeclarator", id: { type: "Identifier", name: name }, init: vinit });
    }
    expectPunct(";");
    return { type: "VariableDeclaration", declarations: decls, kind: "let", cppType: firstType };
  }

  function parseStatement() {
    let t = peek();
    if (isPunct("{")) return parseBlock();
    if (isPunct(";")) { next(); return { type: "EmptyStatement" }; }
    if (isIdent("if")) {
      next();
      expectPunct("(");
      let test = parseExpression();
      expectPunct(")");
      let consequent = parseStatement();
      let alternate = null;
      if (isIdent("else")) {
        next();
        alternate = parseStatement();
      }
      return { type: "IfStatement", test: test, consequent: consequent, alternate: alternate };
    }
    if (isIdent("for")) {
      next();
      expectPunct("(");
      // Range-based for: for (type name : expr)
      let saved = pos;
      let rangeType = tryParseType();
      if (rangeType !== null && peek().type === "ident" && peek(1).value === ":") {
        let name = next().value;
        next(); // ':'
        let right = parseAssignment();
        expectPunct(")");
        let body = parseStatement();
        return {
          type: "ForOfStatement",
          left: { type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name: name }, init: null }], kind: "let" },
          right: right,
          body: body,
        };
      }
      pos = saved;
      // Classic for: for (init; test; update)
      let init = null;
      if (!isPunct(";")) {
        let it = tryParseType();
        if (it !== null) {
          let name = expectIdent("a loop variable name");
          let declInit = null;
          if (isPunct("=")) { next(); declInit = parseExpression(); }
          init = { type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name: name }, init: declInit }], kind: "let" };
        } else {
          init = parseExpression();
        }
      }
      expectPunct(";");
      let test = null;
      if (!isPunct(";")) test = parseExpression();
      expectPunct(";");
      let update = null;
      if (!isPunct(")")) update = parseExpression();
      expectPunct(")");
      let body = parseStatement();
      return { type: "ForStatement", init: init, test: test, update: update, body: body };
    }
    if (isIdent("while")) {
      next();
      expectPunct("(");
      let test = parseExpression();
      expectPunct(")");
      return { type: "WhileStatement", test: test, body: parseStatement() };
    }
    if (isIdent("do")) {
      next();
      let body = parseStatement();
      if (!isIdent("while")) throw new CppParseError("expected 'while' after do-while body");
      next();
      expectPunct("(");
      let test = parseExpression();
      expectPunct(")");
      expectPunct(";");
      return { type: "DoWhileStatement", test: test, body: body };
    }
    if (isIdent("return")) {
      next();
      let arg = null;
      if (!isPunct(";")) arg = parseExpression();
      expectPunct(";");
      return { type: "ReturnStatement", argument: arg };
    }
    if (isIdent("break")) { next(); expectPunct(";"); return { type: "BreakStatement" }; }
    if (isIdent("continue")) { next(); expectPunct(";"); return { type: "ContinueStatement" }; }
    if (isIdent("switch")) {
      next();
      expectPunct("(");
      let discriminant = parseExpression();
      expectPunct(")");
      expectPunct("{");
      let cases = [];
      while (!isPunct("}")) {
        if (peek().type === "eof") throw new CppParseError("unterminated switch");
        let test = null;
        if (isIdent("case")) {
          next();
          test = parseAssignment();
        } else if (isIdent("default")) {
          next();
        } else {
          throw new CppParseError("expected 'case' or 'default' in switch, found '" + peek().value + "'");
        }
        expectPunct(":");
        let consequent = [];
        while (!isPunct("}") && !(isIdent("case") || isIdent("default"))) {
          consequent.push(parseStatement());
        }
        cases.push({ type: "SwitchCase", test: test, consequent: consequent });
      }
      expectPunct("}");
      return { type: "SwitchStatement", discriminant: discriminant, cases: cases };
    }
    if (isIdent("try")) {
      next();
      let block = parseBlock();
      let handler = null;
      let finalizer = null;
      if (isIdent("catch")) {
        next();
        expectPunct("(");
        let param = null;
        let ctype = parseType();
        if (isPunct(".")) {
          // catch(...) — matches anything.
          next(); expectPunct("."); expectPunct(".");
        } else if (peek().type === "ident") {
          param = { type: "Identifier", name: next().value };
        }
        expectPunct(")");
        handler = { type: "CatchClause", param: param, body: parseBlock() };
      }
      if (isIdent("finally")) throw new CppParseError("C++ has no finally");
      if (!handler) throw new CppParseError("try without catch is not in the v1 subset");
      return { type: "TryStatement", block: block, handler: handler, finalizer: finalizer };
    }
    if (isIdent("throw")) {
      next();
      let arg = parseExpression();
      expectPunct(";");
      return { type: "ThrowStatement", argument: arg };
    }
    if (isIdent("using")) {
      // `using namespace std;` — noted, no JS equivalent needed.
      next();
      while (!isPunct(";")) {
        if (peek().type === "eof") throw new CppParseError("unterminated using declaration");
        next();
      }
      expectPunct(";");
      return { type: "EmptyStatement" };
    }
    // Variable declaration: `type name ... ;`
    let saved = pos;
    let ty = tryParseType();
    if (ty !== null && peek().type === "ident" && CPP_KEYWORDS.indexOf(peek().value) === -1) {
      let name = next().value;
      if (isPunct("(")) {
        // `type name(...)` at statement level is a function call with
        // a type cast — not in the subset.
        throw new CppParseError("function declaration inside a body is not in the v1 subset");
      }
      return parseVarDeclRest(ty, name);
    }
    pos = saved;
    // Expression statement.
    let e = parseExpression();
    expectPunct(";");
    return { type: "ExpressionStatement", expression: e };
  }

  function parseFunctionOrDecl() {
    let ty = tryParseType();
    if (ty === null) throw new CppParseError("expected a type at the top level, found '" + peek().value + "'");
    let name = expectIdent("a function or variable name");
    if (isPunct("(")) {
      // Function definition.
      next();
      let params = [];
      if (!isPunct(")")) {
        while (true) {
          let ptype = parseType();
          if (ptype === null) throw new CppParseError("expected a parameter type in '" + name + "'");
          if (isPunct(".")) {
            next(); expectPunct("."); expectPunct(".");
            throw new CppParseError("variadic parameters are not in the v1 subset");
          }
          let pname = expectIdent("a parameter name");
          let def = null;
          if (isPunct("=")) { next(); def = parseAssignment(); }
          params.push({ name: pname, cppType: ptype, default: def });
          if (isPunct(",")) { next(); continue; }
          break;
        }
      }
      expectPunct(")");
      let body = parseBlock();
      return { type: "FunctionDeclaration", id: { type: "Identifier", name: name }, params: params, body: body, cppReturn: ty };
    }
    // Global variable declaration.
    let decl = parseVarDeclRest(ty, name);
    decl.cppType = ty;
    return decl;
  }

  function parseProgram() {
    let body = [];
    while (peek().type !== "eof") {
      if (isIdent("using")) {
        // `using namespace std;` at the top level — noted, no JS
        // equivalent needed.
        while (!isPunct(";")) {
          if (peek().type === "eof") throw new CppParseError("unterminated using declaration");
          next();
        }
        expectPunct(";");
        continue;
      }
      body.push(parseFunctionOrDecl());
    }
    return { type: "Program", body: body, includes: scanned.includes };
  }

  return { parseProgram: parseProgram };
}

// C++ AST (Acorn-like) -> JavaScript. Types are dropped; `main` is
// unwrapped to top-level statements; `std::cout << a << b` becomes
// console.log(a, b).
function makeCppJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let declared = {};
  let noted = {};

  function noteOnce(key, text) {
    if (!noted[key]) {
      noted[key] = true;
      report.notes.push(text);
    }
  }
  function indentStr() {
    return "  ".repeat(indentLevel);
  }
  function emitLine(text) {
    lines.push(indentStr() + text);
  }
  function stubExpr(detail) {
    markUnsupported(report, "Unsupported", detail);
    return '(function() { throw new Error(' + quotedMessage("IrohRedux: " + detail) + '); })()';
  }
  function unsupportedStmt(detail) {
    markUnsupported(report, "Unsupported", detail);
    emitLine("throw new Error(" + quotedMessage("IrohRedux: " + detail) + ");");
  }

  function flattenCout(node) {
    // Returns [parts] if `node` is a `<<` chain rooted at cout,
    // else null. std::endl / std::boolalpha are dropped.
    let parts = [];
    let cur = node;
    while (cur.type === "BinaryExpression" && cur.operator === "<<") {
      let right = cur.right;
      if (right.type === "Identifier" && (right.name === "std::endl" || right.name === "endl" || right.name === "std::boolalpha")) {
        cur = cur.left;
        continue;
      }
      parts.unshift(right);
      cur = cur.left;
    }
    if (cur.type === "Identifier" && (cur.name === "std::cout" || cur.name === "cout")) return parts;
    return null;
  }

  function expr(node) {
    if (!node || typeof node.type !== "string") return stubExpr("missing expression in C++ source");
    switch (node.type) {
      case "Literal":
        if (node.value === null) return "null";
        if (typeof node.value === "string") return JSON.stringify(node.value);
        if (typeof node.value === "boolean") return node.value ? "true" : "false";
        return String(node.value);
      case "Identifier":
        if (node.name === "std::endl" || node.name === "endl") return stubExpr("std::endl outside a cout chain");
        if (node.name === "std::cin" || node.name === "cin") return stubExpr("std::cin (input is not in the v1 scope)");
        return node.name;
      case "ArrayExpression": {
        let parts = [];
        for (let ii = 0; ii < node.elements.length; ++ii) parts.push(expr(node.elements[ii]));
        return "[" + parts.join(", ") + "]";
      }
      case "BinaryExpression": {
        let l = expr(node.left);
        let r = expr(node.right);
        if (node.operator === "<<" || node.operator === ">>") {
          return stubExpr("stream operator '" + node.operator + "' outside a cout chain (std::cin is not in the v1 scope)");
        }
        return "(" + l + " " + node.operator + " " + r + ")";
      }
      case "UnaryExpression":
        return "(" + node.operator + expr(node.argument) + ")";
      case "UpdateExpression": {
        let a = expr(node.argument);
        return node.prefix ? "(" + node.operator + a + ")" : "(" + a + node.operator + ")";
      }
      case "AssignmentExpression":
        return expr(node.left) + " " + node.operator + " " + expr(node.right);
      case "ConditionalExpression":
        return "(" + expr(node.test) + " ? " + expr(node.consequent) + " : " + expr(node.alternate) + ")";
      case "MemberExpression": {
        let obj = expr(node.object);
        if (!node.computed && node.property.name === "size") return obj + ".length";
        if (!node.computed) return obj + "." + node.property.name;
        return obj + "[" + expr(node.property) + "]";
      }
      case "CallExpression": {
        let callee = node.callee;
        let args = [];
        for (let ii = 0; ii < node.arguments.length; ++ii) args.push(expr(node.arguments[ii]));
        if (callee.type === "Identifier") {
          if (callee.name === "std::pow") return "(" + args[0] + " ** " + args[1] + ")";
          if (callee.name === "std::to_string") return "String(" + args[0] + ")";
          if (callee.name === "std::stoi") return "parseInt(" + args[0] + ", 10)";
          if (callee.name === "std::stod" || callee.name === "std::stof") return "parseFloat(" + args[0] + ")";
          if (callee.name === "std::string") return args[0];
          if (callee.name === "std::abs") return "Math.abs(" + args[0] + ")";
          if (callee.name === "std::sqrt") return "Math.sqrt(" + args[0] + ")";
          if (callee.name === "std::max") return "Math.max(" + args.join(", ") + ")";
          if (callee.name === "std::min") return "Math.min(" + args.join(", ") + ")";
          // Exception constructors carry a message; the throw site
          // wraps it in `new Error(...)`, so the call itself is just
          // the message.
          if (callee.name === "std::runtime_error" || callee.name === "std::logic_error" ||
              callee.name === "std::invalid_argument" || callee.name === "std::out_of_range") {
            return args[0];
          }
          return callee.name + "(" + args.join(", ") + ")";
        }
        if (callee.type === "MemberExpression" && !callee.computed) {
          let obj = expr(callee.object);
          let method = callee.property.name;
          if (method === "push_back") return obj + ".push(" + args.join(", ") + ")";
          if (method === "size") return obj + ".length";
          if (method === "substr") return obj + ".substring(" + args.join(", ") + ")";
          return obj + "." + method + "(" + args.join(", ") + ")";
        }
        return stubExpr("call of computed callee");
      }
      case "SequenceExpression": {
        let parts = [];
        for (let ii = 0; ii < node.expressions.length; ++ii) parts.push(expr(node.expressions[ii]));
        return "(" + parts.join(", ") + ")";
      }
      default:
        return stubExpr("C++ expression " + node.type);
    }
  }

  function emitBody(block) {
    if (!block || !block.body || block.body.length === 0) return;
    indentLevel += 1;
    for (let ii = 0; ii < block.body.length; ++ii) stmt(block.body[ii]);
    indentLevel -= 1;
  }

  function stmt(node) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "EmptyStatement":
        return;
      case "BlockStatement":
        emitLine("{");
        emitBody(node);
        emitLine("}");
        return;
      case "VariableDeclaration": {
        for (let ii = 0; ii < node.declarations.length; ++ii) {
          let d = node.declarations[ii];
          let name = d.id.name;
          let prefix = declared[name] ? "" : "let ";
          declared[name] = true;
          emitLine(prefix + name + (d.init ? " = " + expr(d.init) : "") + ";");
        }
        return;
      }
      case "FunctionDeclaration": {
        let params = [];
        for (let ii = 0; ii < node.params.length; ++ii) {
          let p = node.params[ii];
          params.push(p.name + (p.default ? " = " + expr(p.default) : ""));
        }
        emitLine("function " + node.id.name + "(" + params.join(", ") + ") {");
        emitBody(node.body);
        emitLine("}");
        return;
      }
      case "ReturnStatement":
        emitLine(node.argument ? "return " + expr(node.argument) + ";" : "return;");
        return;
      case "ExpressionStatement": {
        let parts = flattenCout(node.expression);
        if (parts) {
          // C++ `<<` concatenates with no separator; JS console.log
          // joins multiple arguments with spaces — so join the parts
          // with `+` into a single argument instead.
          let args = [];
          for (let ii = 0; ii < parts.length; ++ii) args.push(expr(parts[ii]));
          emitLine("console.log(" + args.join(" + ") + ");");
          return;
        }
        emitLine(expr(node.expression) + ";");
        return;
      }
      case "IfStatement": {
        emitLine("if (" + expr(node.test) + ") {");
        emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { type: "BlockStatement", body: [node.consequent] });
        emitLine("}");
        let alt = node.alternate;
        while (alt) {
          if (alt.type === "IfStatement") {
            lines[lines.length - 1] = indentStr() + "} else if (" + expr(alt.test) + ") {";
            emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { type: "BlockStatement", body: [alt.consequent] });
            emitLine("}");
            alt = alt.alternate;
          } else {
            lines[lines.length - 1] = indentStr() + "} else {";
            emitBody(alt.type === "BlockStatement" ? alt : { type: "BlockStatement", body: [alt] });
            emitLine("}");
            alt = null;
          }
        }
        return;
      }
      case "ForStatement": {
        let init = "";
        if (node.init) {
          if (node.init.type === "VariableDeclaration") {
            let d = node.init.declarations[0];
            init = "let " + d.id.name + (d.init ? " = " + expr(d.init) : "");
            declared[d.id.name] = true;
          } else {
            init = expr(node.init);
          }
        }
        emitLine("for (" + init + "; " + (node.test ? expr(node.test) : "") + "; " + (node.update ? expr(node.update) : "") + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("}");
        return;
      }
      case "ForOfStatement": {
        let name = node.left.declarations[0].id.name;
        let prefix = declared[name] ? "" : "let ";
        if (prefix) declared[name] = true;
        noteOnce("forscope", "C++ range-for variables are loop-scoped; the translation declares them before the loop to match C++ scope (JS for-of would scope them to the loop).");
        emitLine(prefix + name + ";");
        emitLine("for (" + name + " of " + expr(node.right) + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("}");
        return;
      }
      case "WhileStatement":
        emitLine("while (" + expr(node.test) + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("}");
        return;
      case "DoWhileStatement":
        emitLine("do {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { type: "BlockStatement", body: [node.body] });
        emitLine("} while (" + expr(node.test) + ");");
        return;
      case "SwitchStatement": {
        emitLine("switch (" + expr(node.discriminant) + ") {");
        indentLevel += 1;
        for (let ii = 0; ii < node.cases.length; ++ii) {
          let c = node.cases[ii];
          emitLine(c.test ? "case " + expr(c.test) + ":" : "default:");
          indentLevel += 1;
          for (let jj = 0; jj < c.consequent.length; ++jj) stmt(c.consequent[jj]);
          indentLevel -= 1;
        }
        indentLevel -= 1;
        emitLine("}");
        return;
      }
      case "TryStatement": {
        emitLine("try {");
        emitBody(node.block);
        emitLine("}");
        if (node.handler) {
          lines[lines.length - 1] = indentStr() + "} catch (" + (node.handler.param ? node.handler.param.name : "e") + ") {";
          emitBody(node.handler.body);
          emitLine("}");
        }
        return;
      }
      case "ThrowStatement":
        emitLine("throw new Error(" + expr(node.argument) + ");");
        return;
      case "BreakStatement":
        emitLine("break;");
        return;
      case "ContinueStatement":
        emitLine("continue;");
        return;
      default:
        unsupportedStmt("C++ statement " + node.type + " is not in the v1 scope");
        return;
    }
  }

  function run(ast) {
    for (let ii = 0; ii < ast.body.length; ++ii) {
      let item = ast.body[ii];
      if (item.type === "FunctionDeclaration" && item.id.name === "main") {
        noteOnce("main", "int main() is unwrapped: its body becomes the top-level program (its `return` is dropped).");
        for (let jj = 0; jj < item.body.body.length; ++jj) {
          let s = item.body.body[jj];
          if (s.type === "ReturnStatement") continue; // top-level return is not valid JS
          stmt(s);
        }
        continue;
      }
      stmt(item);
    }
    return lines.join("\n") + "\n";
  }

  return { run: run };
}

function translateFromCpp(code) {
  let report = newReport("cpp", "javascript", true);
  report.notes.push(
    "Static-only leg: there is no tracer for C++, so this translation uses the source alone — no runtime types, no branch evidence."
  );
  let parser = makeCppParser(code);
  let ast;
  try {
    ast = parser.parseProgram();
  } catch (e) {
    if (e instanceof CppParseError) {
      markUnsupported(report, "C++ subset parser", "could not parse the C++ source: " + e.message);
      return {
        code: 'throw new Error("IrohRedux: could not parse the C++ source: ' + e.message.replace(/"/g, "'") + '");\n',
        report: report,
      };
    }
    throw e;
  }
  if (ast.includes.length > 0) {
    report.notes.push("Preprocessor lines are skipped (they have no JS equivalent): " + ast.includes.join(", "));
  }
  let emitter = makeCppJSEmitter(report);
  let out = emitter.run(ast);
  let fnCount = 0;
  for (let ii = 0; ii < ast.body.length; ++ii) {
    if (ast.body[ii].type === "FunctionDeclaration") fnCount += 1;
  }
  if (fnCount > 0) report.clean.push({ construct: "functions", count: fnCount, detail: "function definitions translated" });
  return { code: out, report: report };
}

// ------------------------------------------------------------------
// Public entry points
// ------------------------------------------------------------------

function translate(code, options) {
  options = options || {};
  let from = options.from || "javascript";
  let to = options.to;
  if (to !== "python" && to !== "cpp" && to !== "javascript") {
    throw new Error("Iroh.translate: unknown target '" + to + "' — use 'python', 'cpp' or 'javascript'");
  }
  if (from === "javascript") {
    if (to === "javascript") {
      throw new Error("Iroh.translate: from and to are both 'javascript'");
    }
    return translateFromJS(this, code, to, options);
  }
  if (to !== "javascript") {
    throw new Error("Iroh.translate: only JavaScript is a target for from='" + from + "' in v1");
  }
  if (from === "python") {
    let cp = getChildProcessSync();
    if (!cp) {
      throw new Error(
        "Iroh.translate: Python -> JavaScript needs the Node.js CJS build with python3 on PATH — use Iroh.translateAsync() in ESM; it is not supported in a browser"
      );
    }
    return translateFromPython(code, cp);
  }
  if (from === "cpp") {
    return translateFromCpp(code);
  }
  throw new Error("Iroh.translate: unknown source '" + from + "' — use 'javascript', 'python' or 'cpp'");
}

function translateAsync(code, options) {
  options = options || {};
  let iroh = this;
  let from = options.from || "javascript";
  if (from !== "python") {
    try {
      return Promise.resolve(translate.call(iroh, code, options));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  // Python leg: load child_process by dynamic import so this works
  // in the ESM build too (no sync require there).
  return nodeImport$1("node:child_process").then(
    function(cp) {
      return translateFromPython(code, cp);
    },
    function() {
      throw new Error("Iroh.translateAsync: Python -> JavaScript needs Node.js with python3 on PATH");
    }
  );
}


var _translate = Object.freeze({
	translate: translate,
	translateAsync: translateAsync
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
extend(Iroh, _analyze);
extend(Iroh, _neurons);
extend(Iroh, _vectors);
extend(Iroh, _scan);
extend(Iroh, _live);
extend(Iroh, _direct);
extend(Iroh, _translate);

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

export default iroh;
