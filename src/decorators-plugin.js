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
import { Parser, TokenType } from "acorn";

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

export const DecoratorParser = Parser.extend(decoratorsPlugin);

export function parseWithDecorators(input, options) {
  return DecoratorParser.parse(input, options);
}
