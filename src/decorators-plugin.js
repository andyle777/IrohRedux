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

export const DecoratorParser = Parser.extend(decoratorsPlugin);

export function parseWithDecorators(input, options) {
  return DecoratorParser.parse(input, options);
}
