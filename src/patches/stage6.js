import {
  uBranchHash,
  reserveTempVarId
} from "../utils";

import {
  cloneNode,
  parseExpression,
  injectPatchIntoNode,
  parseExpressionStatement
} from "../helpers";

import STAGE1 from "./stage1";

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

export default STAGE6;
