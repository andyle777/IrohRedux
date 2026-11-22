/**
 * @param {Class} cls
 * @param {Array} prot
 */
function extend(cls, prot) {
  for (let key in prot) {
    if (prot[key] instanceof Function) {
      if (cls.prototype[key] instanceof Function) {
        console.log(`Warning: Overwriting ${cls.name}.prototype.${key}`);
      }
      cls.prototype[key] = prot[key];
    }
  }}

var version$1="1.1.1";

// indent factor
const INDENT_FACTOR = 1;

// minimal debug commands start with this
const DEBUG_KEY = `$`;

// temp variable start with this
const TEMP_VAR_BASE = `Iroh$$x`;

// detect environment
const IS_NODE = (
  (typeof module !== "undefined" && module.exports) &&
  (typeof require !== "undefined")
);
const IS_BROWSER = !IS_NODE;

const VERSION = version$1;

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
//     CALL, FUNCTION, IF, LOOP (LOOP since Amendment A1, the
//     conditional LOOP <Bool-expr> form).
//   basic: irohscript/src/basic_trace.py sink.emit sites — ASSIGN,
//     CALL, FUNCTION, IF, LOOP.
// A language not listed here (or an unknown one) falls back to all
// 30, which is the JavaScript default — and that fallback is the
// reason a consumer must never treat a missing `reachable` field as
// `total`: it would read a non-JS trace as if it were JS.
const REACHABLE_CATEGORIES = {
  javascript: null, // null = all categories (the full engine)
  python: ["ASSIGN", "CATCH", "CALL", "FUNCTION", "IF", "LOOP"],
  cpp: ["CALL", "FUNCTION"],
  irohscript: ["ASSIGN", "CALL", "FUNCTION", "IF", "LOOP"],
  basic: ["ASSIGN", "CALL", "FUNCTION", "IF", "LOOP"],
};

function reachableCategories(language) {
  let list = REACHABLE_CATEGORIES[language];
  if (list === void 0 || list === null) return Object.keys(CATEGORY);
  return list.slice();
}

// Astring is a tiny and fast JavaScript code generator from an ESTree-compliant AST.
//
// Astring was written by David Bonnet and released under an MIT license.
//
// The Git repository for Astring is available at:
// https://github.com/davidbonnet/astring.git
//
// Please use the GitHub bug tracker to report issues:
// https://github.com/davidbonnet/astring/issues

const { stringify } = JSON;

/* c8 ignore if */
if (!String.prototype.repeat) {
  /* c8 ignore next */
  throw new Error(
    'String.prototype.repeat is undefined, see https://github.com/davidbonnet/astring#installation',
  )
}

/* c8 ignore if */
if (!String.prototype.endsWith) {
  /* c8 ignore next */
  throw new Error(
    'String.prototype.endsWith is undefined, see https://github.com/davidbonnet/astring#installation',
  )
}

const OPERATOR_PRECEDENCE = {
  '||': 2,
  '??': 3,
  '&&': 4,
  '|': 5,
  '^': 6,
  '&': 7,
  '==': 8,
  '!=': 8,
  '===': 8,
  '!==': 8,
  '<': 9,
  '>': 9,
  '<=': 9,
  '>=': 9,
  in: 9,
  instanceof: 9,
  '<<': 10,
  '>>': 10,
  '>>>': 10,
  '+': 11,
  '-': 11,
  '*': 12,
  '%': 12,
  '/': 12,
  '**': 13,
};

// Enables parenthesis regardless of precedence
const NEEDS_PARENTHESES = 17;

const EXPRESSIONS_PRECEDENCE = {
  // Definitions
  ArrayExpression: 20,
  TaggedTemplateExpression: 20,
  ThisExpression: 20,
  Identifier: 20,
  PrivateIdentifier: 20,
  Literal: 18,
  TemplateLiteral: 20,
  Super: 20,
  SequenceExpression: 20,
  // Operations
  MemberExpression: 19,
  ChainExpression: 19,
  CallExpression: 19,
  NewExpression: 19,
  // Other definitions
  ArrowFunctionExpression: NEEDS_PARENTHESES,
  ClassExpression: NEEDS_PARENTHESES,
  FunctionExpression: NEEDS_PARENTHESES,
  ObjectExpression: NEEDS_PARENTHESES,
  // Other operations
  UpdateExpression: 16,
  UnaryExpression: 15,
  AwaitExpression: 15,
  BinaryExpression: 14,
  LogicalExpression: 13,
  ConditionalExpression: 4,
  AssignmentExpression: 3,
  YieldExpression: 2,
  RestElement: 1,
};

function formatSequence(state, nodes) {
  /*
  Writes into `state` a sequence of `nodes`.
  */
  const { generator } = state;
  state.write('(');
  if (nodes != null && nodes.length > 0) {
    generator[nodes[0].type](nodes[0], state);
    const { length } = nodes;
    for (let i = 1; i < length; i++) {
      const param = nodes[i];
      state.write(', ');
      generator[param.type](param, state);
    }
  }
  state.write(')');
}

function expressionNeedsParenthesis(state, node, parentNode, isRightHand) {
  const nodePrecedence = state.expressionsPrecedence[node.type];
  if (nodePrecedence === NEEDS_PARENTHESES) {
    return true
  }
  const parentNodePrecedence = state.expressionsPrecedence[parentNode.type];
  if (nodePrecedence !== parentNodePrecedence) {
    // Different node types
    return (
      (!isRightHand &&
        nodePrecedence === 15 &&
        parentNodePrecedence === 14 &&
        parentNode.operator === '**') ||
      nodePrecedence < parentNodePrecedence
    )
  }
  if (nodePrecedence !== 13 && nodePrecedence !== 14) {
    // Not a `LogicalExpression` or `BinaryExpression`
    return false
  }
  if (node.operator === '**' && parentNode.operator === '**') {
    // Exponentiation operator has right-to-left associativity
    return !isRightHand
  }
  if (
    nodePrecedence === 13 &&
    parentNodePrecedence === 13 &&
    (node.operator === '??' || parentNode.operator === '??')
  ) {
    // Nullish coalescing and boolean operators cannot be combined
    return true
  }
  if (isRightHand) {
    // Parenthesis are used if both operators have the same precedence
    return (
      OPERATOR_PRECEDENCE[node.operator] <=
      OPERATOR_PRECEDENCE[parentNode.operator]
    )
  }
  return (
    OPERATOR_PRECEDENCE[node.operator] <
    OPERATOR_PRECEDENCE[parentNode.operator]
  )
}

function formatExpression(state, node, parentNode, isRightHand) {
  /*
  Writes into `state` the provided `node`, adding parenthesis around if the provided `parentNode` needs it. If `node` is a right-hand argument, the provided `isRightHand` parameter should be `true`.
  */
  const { generator } = state;
  if (expressionNeedsParenthesis(state, node, parentNode, isRightHand)) {
    state.write('(');
    generator[node.type](node, state);
    state.write(')');
  } else {
    generator[node.type](node, state);
  }
}

function reindent(state, text, indent, lineEnd) {
  /*
  Writes into `state` the `text` string reindented with the provided `indent`.
  */
  const lines = text.split('\n');
  const end = lines.length - 1;
  state.write(lines[0].trim());
  if (end > 0) {
    state.write(lineEnd);
    for (let i = 1; i < end; i++) {
      state.write(indent + lines[i].trim() + lineEnd);
    }
    state.write(indent + lines[end].trim());
  }
}

function formatComments(state, comments, indent, lineEnd) {
  /*
  Writes into `state` the provided list of `comments`, with the given `indent` and `lineEnd` strings.
  Line comments will end with `"\n"` regardless of the value of `lineEnd`.
  Expects to start on a new unindented line.
  */
  const { length } = comments;
  for (let i = 0; i < length; i++) {
    const comment = comments[i];
    state.write(indent);
    if (comment.type[0] === 'L') {
      // Line comment
      state.write('// ' + comment.value.trim() + '\n', comment);
    } else {
      // Block comment
      state.write('/*');
      reindent(state, comment.value, indent, lineEnd);
      state.write('*/' + lineEnd);
    }
  }
}

function hasCallExpression(node) {
  /*
  Returns `true` if the provided `node` contains a call expression and `false` otherwise.
  */
  let currentNode = node;
  while (currentNode != null) {
    const { type } = currentNode;
    if (type[0] === 'C' && type[1] === 'a') {
      // Is CallExpression
      return true
    } else if (type[0] === 'M' && type[1] === 'e' && type[2] === 'm') {
      // Is MemberExpression
      currentNode = currentNode.object;
    } else {
      return false
    }
  }
}

function formatVariableDeclaration(state, node) {
  /*
  Writes into `state` a variable declaration.
  */
  const { generator } = state;
  const { declarations } = node;
  state.write(node.kind + ' ');
  const { length } = declarations;
  if (length > 0) {
    generator.VariableDeclarator(declarations[0], state);
    for (let i = 1; i < length; i++) {
      state.write(', ');
      generator.VariableDeclarator(declarations[i], state);
    }
  }
}

let ForInStatement,
  FunctionDeclaration,
  RestElement,
  BinaryExpression,
  ArrayExpression,
  BlockStatement;

const GENERATOR = {
  /*
  Default generator.
  */
  Program(node, state) {
    const indent = state.indent.repeat(state.indentLevel);
    const { lineEnd, writeComments } = state;
    if (writeComments && node.comments != null) {
      formatComments(state, node.comments, indent, lineEnd);
    }
    const statements = node.body;
    const { length } = statements;
    for (let i = 0; i < length; i++) {
      const statement = statements[i];
      if (writeComments && statement.comments != null) {
        formatComments(state, statement.comments, indent, lineEnd);
      }
      state.write(indent);
      this[statement.type](statement, state);
      state.write(lineEnd);
    }
    if (writeComments && node.trailingComments != null) {
      formatComments(state, node.trailingComments, indent, lineEnd);
    }
  },
  BlockStatement: (BlockStatement = function (node, state) {
    const indent = state.indent.repeat(state.indentLevel++);
    const { lineEnd, writeComments } = state;
    const statementIndent = indent + state.indent;
    state.write('{');
    const statements = node.body;
    if (statements != null && statements.length > 0) {
      state.write(lineEnd);
      if (writeComments && node.comments != null) {
        formatComments(state, node.comments, statementIndent, lineEnd);
      }
      const { length } = statements;
      for (let i = 0; i < length; i++) {
        const statement = statements[i];
        if (writeComments && statement.comments != null) {
          formatComments(state, statement.comments, statementIndent, lineEnd);
        }
        state.write(statementIndent);
        this[statement.type](statement, state);
        state.write(lineEnd);
      }
      state.write(indent);
    } else {
      if (writeComments && node.comments != null) {
        state.write(lineEnd);
        formatComments(state, node.comments, statementIndent, lineEnd);
        state.write(indent);
      }
    }
    if (writeComments && node.trailingComments != null) {
      formatComments(state, node.trailingComments, statementIndent, lineEnd);
    }
    state.write('}');
    state.indentLevel--;
  }),
  ClassBody: BlockStatement,
  StaticBlock(node, state) {
    state.write('static ');
    this.BlockStatement(node, state);
  },
  EmptyStatement(node, state) {
    state.write(';');
  },
  ExpressionStatement(node, state) {
    const precedence = state.expressionsPrecedence[node.expression.type];
    if (
      precedence === NEEDS_PARENTHESES ||
      (precedence === 3 && node.expression.left.type[0] === 'O')
    ) {
      // Should always have parentheses or is an AssignmentExpression to an ObjectPattern
      state.write('(');
      this[node.expression.type](node.expression, state);
      state.write(')');
    } else {
      this[node.expression.type](node.expression, state);
    }
    state.write(';');
  },
  IfStatement(node, state) {
    state.write('if (');
    this[node.test.type](node.test, state);
    state.write(') ');
    this[node.consequent.type](node.consequent, state);
    if (node.alternate != null) {
      state.write(' else ');
      this[node.alternate.type](node.alternate, state);
    }
  },
  LabeledStatement(node, state) {
    this[node.label.type](node.label, state);
    state.write(': ');
    this[node.body.type](node.body, state);
  },
  BreakStatement(node, state) {
    state.write('break');
    if (node.label != null) {
      state.write(' ');
      this[node.label.type](node.label, state);
    }
    state.write(';');
  },
  ContinueStatement(node, state) {
    state.write('continue');
    if (node.label != null) {
      state.write(' ');
      this[node.label.type](node.label, state);
    }
    state.write(';');
  },
  WithStatement(node, state) {
    state.write('with (');
    this[node.object.type](node.object, state);
    state.write(') ');
    this[node.body.type](node.body, state);
  },
  SwitchStatement(node, state) {
    const indent = state.indent.repeat(state.indentLevel++);
    const { lineEnd, writeComments } = state;
    state.indentLevel++;
    const caseIndent = indent + state.indent;
    const statementIndent = caseIndent + state.indent;
    state.write('switch (');
    this[node.discriminant.type](node.discriminant, state);
    state.write(') {' + lineEnd);
    const { cases: occurences } = node;
    const { length: occurencesCount } = occurences;
    for (let i = 0; i < occurencesCount; i++) {
      const occurence = occurences[i];
      if (writeComments && occurence.comments != null) {
        formatComments(state, occurence.comments, caseIndent, lineEnd);
      }
      if (occurence.test) {
        state.write(caseIndent + 'case ');
        this[occurence.test.type](occurence.test, state);
        state.write(':' + lineEnd);
      } else {
        state.write(caseIndent + 'default:' + lineEnd);
      }
      const { consequent } = occurence;
      const { length: consequentCount } = consequent;
      for (let i = 0; i < consequentCount; i++) {
        const statement = consequent[i];
        if (writeComments && statement.comments != null) {
          formatComments(state, statement.comments, statementIndent, lineEnd);
        }
        state.write(statementIndent);
        this[statement.type](statement, state);
        state.write(lineEnd);
      }
    }
    state.indentLevel -= 2;
    state.write(indent + '}');
  },
  ReturnStatement(node, state) {
    state.write('return');
    if (node.argument) {
      state.write(' ');
      this[node.argument.type](node.argument, state);
    }
    state.write(';');
  },
  ThrowStatement(node, state) {
    state.write('throw ');
    this[node.argument.type](node.argument, state);
    state.write(';');
  },
  TryStatement(node, state) {
    state.write('try ');
    this[node.block.type](node.block, state);
    if (node.handler) {
      const { handler } = node;
      if (handler.param == null) {
        state.write(' catch ');
      } else {
        state.write(' catch (');
        this[handler.param.type](handler.param, state);
        state.write(') ');
      }
      this[handler.body.type](handler.body, state);
    }
    if (node.finalizer) {
      state.write(' finally ');
      this[node.finalizer.type](node.finalizer, state);
    }
  },
  WhileStatement(node, state) {
    state.write('while (');
    this[node.test.type](node.test, state);
    state.write(') ');
    this[node.body.type](node.body, state);
  },
  DoWhileStatement(node, state) {
    state.write('do ');
    this[node.body.type](node.body, state);
    state.write(' while (');
    this[node.test.type](node.test, state);
    state.write(');');
  },
  ForStatement(node, state) {
    state.write('for (');
    if (node.init != null) {
      const { init } = node;
      if (init.type[0] === 'V') {
        formatVariableDeclaration(state, init);
      } else {
        this[init.type](init, state);
      }
    }
    state.write('; ');
    if (node.test) {
      this[node.test.type](node.test, state);
    }
    state.write('; ');
    if (node.update) {
      this[node.update.type](node.update, state);
    }
    state.write(') ');
    this[node.body.type](node.body, state);
  },
  ForInStatement: (ForInStatement = function (node, state) {
    state.write(`for ${node.await ? 'await ' : ''}(`);
    const { left } = node;
    if (left.type[0] === 'V') {
      formatVariableDeclaration(state, left);
    } else {
      this[left.type](left, state);
    }
    // Identifying whether node.type is `ForInStatement` or `ForOfStatement`
    state.write(node.type[3] === 'I' ? ' in ' : ' of ');
    this[node.right.type](node.right, state);
    state.write(') ');
    this[node.body.type](node.body, state);
  }),
  ForOfStatement: ForInStatement,
  DebuggerStatement(node, state) {
    state.write('debugger;', node);
  },
  FunctionDeclaration: (FunctionDeclaration = function (node, state) {
    state.write(
      (node.async ? 'async ' : '') +
        (node.generator ? 'function* ' : 'function ') +
        (node.id ? node.id.name : ''),
      node,
    );
    formatSequence(state, node.params);
    state.write(' ');
    this[node.body.type](node.body, state);
  }),
  FunctionExpression: FunctionDeclaration,
  VariableDeclaration(node, state) {
    formatVariableDeclaration(state, node);
    state.write(';');
  },
  VariableDeclarator(node, state) {
    this[node.id.type](node.id, state);
    if (node.init != null) {
      state.write(' = ');
      this[node.init.type](node.init, state);
    }
  },
  ClassDeclaration(node, state) {
    state.write('class ' + (node.id ? `${node.id.name} ` : ''), node);
    if (node.superClass) {
      state.write('extends ');
      const { superClass } = node;
      const { type } = superClass;
      const precedence = state.expressionsPrecedence[type];
      if (
        (type[0] !== 'C' || type[1] !== 'l' || type[5] !== 'E') &&
        (precedence === NEEDS_PARENTHESES ||
          precedence < state.expressionsPrecedence.ClassExpression)
      ) {
        // Not a ClassExpression that needs parentheses
        state.write('(');
        this[node.superClass.type](superClass, state);
        state.write(')');
      } else {
        this[superClass.type](superClass, state);
      }
      state.write(' ');
    }
    this.ClassBody(node.body, state);
  },
  ImportDeclaration(node, state) {
    state.write('import ');
    const { specifiers, attributes } = node;
    const { length } = specifiers;
    // TODO: Once babili is fixed, put this after condition
    // https://github.com/babel/babili/issues/430
    let i = 0;
    if (length > 0) {
      for (; i < length; ) {
        if (i > 0) {
          state.write(', ');
        }
        const specifier = specifiers[i];
        const type = specifier.type[6];
        if (type === 'D') {
          // ImportDefaultSpecifier
          state.write(specifier.local.name, specifier);
          i++;
        } else if (type === 'N') {
          // ImportNamespaceSpecifier
          state.write('* as ' + specifier.local.name, specifier);
          i++;
        } else {
          // ImportSpecifier
          break
        }
      }
      if (i < length) {
        state.write('{');
        for (;;) {
          const specifier = specifiers[i];
          const { name } = specifier.imported;
          state.write(name, specifier);
          if (name !== specifier.local.name) {
            state.write(' as ' + specifier.local.name);
          }
          if (++i < length) {
            state.write(', ');
          } else {
            break
          }
        }
        state.write('}');
      }
      state.write(' from ');
    }
    this.Literal(node.source, state);

    if (attributes && attributes.length > 0) {
      state.write(' with { ');
      for (let i = 0; i < attributes.length; i++) {
        this.ImportAttribute(attributes[i], state);
        if (i < attributes.length - 1) state.write(', ');
      }

      state.write(' }');
    }
    state.write(';');
  },
  ImportAttribute(node, state) {
    this.Identifier(node.key, state);
    state.write(': ');
    this.Literal(node.value, state);
  },
  ImportExpression(node, state) {
    state.write('import(');
    this[node.source.type](node.source, state);
    state.write(')');
  },
  ExportDefaultDeclaration(node, state) {
    state.write('export default ');
    this[node.declaration.type](node.declaration, state);
    if (
      state.expressionsPrecedence[node.declaration.type] != null &&
      node.declaration.type[0] !== 'F'
    ) {
      // All expression nodes except `FunctionExpression`
      state.write(';');
    }
  },
  ExportNamedDeclaration(node, state) {
    state.write('export ');
    if (node.declaration) {
      this[node.declaration.type](node.declaration, state);
    } else {
      state.write('{');
      const { specifiers } = node,
        { length } = specifiers;
      if (length > 0) {
        for (let i = 0; ; ) {
          const specifier = specifiers[i];
          const { name } = specifier.local;
          state.write(name, specifier);
          if (name !== specifier.exported.name) {
            state.write(' as ' + specifier.exported.name);
          }
          if (++i < length) {
            state.write(', ');
          } else {
            break
          }
        }
      }
      state.write('}');
      if (node.source) {
        state.write(' from ');
        this.Literal(node.source, state);
      }

      if (node.attributes && node.attributes.length > 0) {
        state.write(' with { ');
        for (let i = 0; i < node.attributes.length; i++) {
          this.ImportAttribute(node.attributes[i], state);
          if (i < node.attributes.length - 1) state.write(', ');
        }

        state.write(' }');
      }

      state.write(';');
    }
  },
  ExportAllDeclaration(node, state) {
    if (node.exported != null) {
      state.write('export * as ' + node.exported.name + ' from ');
    } else {
      state.write('export * from ');
    }
    this.Literal(node.source, state);

    if (node.attributes && node.attributes.length > 0) {
      state.write(' with { ');
      for (let i = 0; i < node.attributes.length; i++) {
        this.ImportAttribute(node.attributes[i], state);
        if (i < node.attributes.length - 1) state.write(', ');
      }

      state.write(' }');
    }

    state.write(';');
  },
  MethodDefinition(node, state) {
    if (node.static) {
      state.write('static ');
    }
    const kind = node.kind[0];
    if (kind === 'g' || kind === 's') {
      // Getter or setter
      state.write(node.kind + ' ');
    }
    if (node.value.async) {
      state.write('async ');
    }
    if (node.value.generator) {
      state.write('*');
    }
    if (node.computed) {
      state.write('[');
      this[node.key.type](node.key, state);
      state.write(']');
    } else {
      this[node.key.type](node.key, state);
    }
    formatSequence(state, node.value.params);
    state.write(' ');
    this[node.value.body.type](node.value.body, state);
  },
  ClassExpression(node, state) {
    this.ClassDeclaration(node, state);
  },
  ArrowFunctionExpression(node, state) {
    state.write(node.async ? 'async ' : '', node);
    const { params } = node;
    if (params != null) {
      // Omit parenthesis if only one named parameter
      if (params.length === 1 && params[0].type[0] === 'I') {
        // If params[0].type[0] starts with 'I', it can't be `ImportDeclaration` nor `IfStatement` and thus is `Identifier`
        state.write(params[0].name, params[0]);
      } else {
        formatSequence(state, node.params);
      }
    }
    state.write(' => ');
    if (node.body.type[0] === 'O') {
      // Body is an object expression
      state.write('(');
      this.ObjectExpression(node.body, state);
      state.write(')');
    } else {
      this[node.body.type](node.body, state);
    }
  },
  ThisExpression(node, state) {
    state.write('this', node);
  },
  Super(node, state) {
    state.write('super', node);
  },
  RestElement: (RestElement = function (node, state) {
    state.write('...');
    this[node.argument.type](node.argument, state);
  }),
  SpreadElement: RestElement,
  YieldExpression(node, state) {
    state.write(node.delegate ? 'yield*' : 'yield');
    if (node.argument) {
      state.write(' ');
      this[node.argument.type](node.argument, state);
    }
  },
  AwaitExpression(node, state) {
    state.write('await ', node);
    formatExpression(state, node.argument, node);
  },
  TemplateLiteral(node, state) {
    const { quasis, expressions } = node;
    state.write('`');
    const { length } = expressions;
    for (let i = 0; i < length; i++) {
      const expression = expressions[i];
      const quasi = quasis[i];
      state.write(quasi.value.raw, quasi);
      state.write('${');
      this[expression.type](expression, state);
      state.write('}');
    }
    const quasi = quasis[quasis.length - 1];
    state.write(quasi.value.raw, quasi);
    state.write('`');
  },
  TemplateElement(node, state) {
    state.write(node.value.raw, node);
  },
  TaggedTemplateExpression(node, state) {
    formatExpression(state, node.tag, node);
    this[node.quasi.type](node.quasi, state);
  },
  ArrayExpression: (ArrayExpression = function (node, state) {
    state.write('[');
    if (node.elements.length > 0) {
      const { elements } = node,
        { length } = elements;
      for (let i = 0; ; ) {
        const element = elements[i];
        if (element != null) {
          this[element.type](element, state);
        }
        if (++i < length) {
          state.write(', ');
        } else {
          if (element == null) {
            state.write(', ');
          }
          break
        }
      }
    }
    state.write(']');
  }),
  ArrayPattern: ArrayExpression,
  ObjectExpression(node, state) {
    const indent = state.indent.repeat(state.indentLevel++);
    const { lineEnd, writeComments } = state;
    const propertyIndent = indent + state.indent;
    state.write('{');
    if (node.properties.length > 0) {
      state.write(lineEnd);
      if (writeComments && node.comments != null) {
        formatComments(state, node.comments, propertyIndent, lineEnd);
      }
      const comma = ',' + lineEnd;
      const { properties } = node,
        { length } = properties;
      for (let i = 0; ; ) {
        const property = properties[i];
        if (writeComments && property.comments != null) {
          formatComments(state, property.comments, propertyIndent, lineEnd);
        }
        state.write(propertyIndent);
        this[property.type](property, state);
        if (++i < length) {
          state.write(comma);
        } else {
          break
        }
      }
      state.write(lineEnd);
      if (writeComments && node.trailingComments != null) {
        formatComments(state, node.trailingComments, propertyIndent, lineEnd);
      }
      state.write(indent + '}');
    } else if (writeComments) {
      if (node.comments != null) {
        state.write(lineEnd);
        formatComments(state, node.comments, propertyIndent, lineEnd);
        if (node.trailingComments != null) {
          formatComments(state, node.trailingComments, propertyIndent, lineEnd);
        }
        state.write(indent + '}');
      } else if (node.trailingComments != null) {
        state.write(lineEnd);
        formatComments(state, node.trailingComments, propertyIndent, lineEnd);
        state.write(indent + '}');
      } else {
        state.write('}');
      }
    } else {
      state.write('}');
    }
    state.indentLevel--;
  },
  Property(node, state) {
    if (node.method || node.kind[0] !== 'i') {
      // Either a method or of kind `set` or `get` (not `init`)
      this.MethodDefinition(node, state);
    } else {
      if (!node.shorthand) {
        if (node.computed) {
          state.write('[');
          this[node.key.type](node.key, state);
          state.write(']');
        } else {
          this[node.key.type](node.key, state);
        }
        state.write(': ');
      }
      this[node.value.type](node.value, state);
    }
  },
  PropertyDefinition(node, state) {
    if (node.static) {
      state.write('static ');
    }
    if (node.computed) {
      state.write('[');
    }
    this[node.key.type](node.key, state);
    if (node.computed) {
      state.write(']');
    }
    if (node.value == null) {
      if (node.key.type[0] !== 'F') {
        state.write(';');
      }
      return
    }
    state.write(' = ');
    this[node.value.type](node.value, state);
    state.write(';');
  },
  ObjectPattern(node, state) {
    state.write('{');
    if (node.properties.length > 0) {
      const { properties } = node,
        { length } = properties;
      for (let i = 0; ; ) {
        this[properties[i].type](properties[i], state);
        if (++i < length) {
          state.write(', ');
        } else {
          break
        }
      }
    }
    state.write('}');
  },
  SequenceExpression(node, state) {
    formatSequence(state, node.expressions);
  },
  UnaryExpression(node, state) {
    if (node.prefix) {
      const {
        operator,
        argument,
        argument: { type },
      } = node;
      state.write(operator);
      const needsParentheses = expressionNeedsParenthesis(state, argument, node);
      if (
        !needsParentheses &&
        (operator.length > 1 ||
          (type[0] === 'U' &&
            (type[1] === 'n' || type[1] === 'p') &&
            argument.prefix &&
            argument.operator[0] === operator &&
            (operator === '+' || operator === '-')))
      ) {
        // Large operator or argument is UnaryExpression or UpdateExpression node
        state.write(' ');
      }
      if (needsParentheses) {
        state.write(operator.length > 1 ? ' (' : '(');
        this[type](argument, state);
        state.write(')');
      } else {
        this[type](argument, state);
      }
    } else {
      // FIXME: This case never occurs
      this[node.argument.type](node.argument, state);
      state.write(node.operator);
    }
  },
  UpdateExpression(node, state) {
    // Always applied to identifiers or members, no parenthesis check needed
    if (node.prefix) {
      state.write(node.operator);
      this[node.argument.type](node.argument, state);
    } else {
      this[node.argument.type](node.argument, state);
      state.write(node.operator);
    }
  },
  AssignmentExpression(node, state) {
    this[node.left.type](node.left, state);
    state.write(' ' + node.operator + ' ');
    this[node.right.type](node.right, state);
  },
  AssignmentPattern(node, state) {
    this[node.left.type](node.left, state);
    state.write(' = ');
    this[node.right.type](node.right, state);
  },
  BinaryExpression: (BinaryExpression = function (node, state) {
    const isIn = node.operator === 'in';
    if (isIn) {
      // Avoids confusion in `for` loops initializers
      state.write('(');
    }
    formatExpression(state, node.left, node, false);
    state.write(' ' + node.operator + ' ');
    formatExpression(state, node.right, node, true);
    if (isIn) {
      state.write(')');
    }
  }),
  LogicalExpression: BinaryExpression,
  ConditionalExpression(node, state) {
    const { test } = node;
    const precedence = state.expressionsPrecedence[test.type];
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence <= state.expressionsPrecedence.ConditionalExpression
    ) {
      state.write('(');
      this[test.type](test, state);
      state.write(')');
    } else {
      this[test.type](test, state);
    }
    state.write(' ? ');
    this[node.consequent.type](node.consequent, state);
    state.write(' : ');
    this[node.alternate.type](node.alternate, state);
  },
  NewExpression(node, state) {
    state.write('new ');
    const precedence = state.expressionsPrecedence[node.callee.type];
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence < state.expressionsPrecedence.CallExpression ||
      hasCallExpression(node.callee)
    ) {
      state.write('(');
      this[node.callee.type](node.callee, state);
      state.write(')');
    } else {
      this[node.callee.type](node.callee, state);
    }
    formatSequence(state, node['arguments']);
  },
  CallExpression(node, state) {
    const precedence = state.expressionsPrecedence[node.callee.type];
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence < state.expressionsPrecedence.CallExpression
    ) {
      state.write('(');
      this[node.callee.type](node.callee, state);
      state.write(')');
    } else {
      this[node.callee.type](node.callee, state);
    }
    if (node.optional) {
      state.write('?.');
    }
    formatSequence(state, node['arguments']);
  },
  ChainExpression(node, state) {
    this[node.expression.type](node.expression, state);
  },
  MemberExpression(node, state) {
    const precedence = state.expressionsPrecedence[node.object.type];
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence < state.expressionsPrecedence.MemberExpression
    ) {
      state.write('(');
      this[node.object.type](node.object, state);
      state.write(')');
    } else {
      this[node.object.type](node.object, state);
    }
    if (node.computed) {
      if (node.optional) {
        state.write('?.');
      }
      state.write('[');
      this[node.property.type](node.property, state);
      state.write(']');
    } else {
      if (node.optional) {
        state.write('?.');
      } else {
        state.write('.');
      }
      this[node.property.type](node.property, state);
    }
  },
  MetaProperty(node, state) {
    state.write(node.meta.name + '.' + node.property.name, node);
  },
  Identifier(node, state) {
    state.write(node.name, node);
  },
  PrivateIdentifier(node, state) {
    state.write(`#${node.name}`, node);
  },
  Literal(node, state) {
    if (node.raw != null) {
      // Non-standard property
      state.write(node.raw, node);
    } else if (node.regex != null) {
      this.RegExpLiteral(node, state);
    } else if (node.bigint != null) {
      state.write(node.bigint + 'n', node);
    } else {
      state.write(stringify(node.value), node);
    }
  },
  RegExpLiteral(node, state) {
    const { regex } = node;
    state.write(`/${regex.pattern}/${regex.flags}`, node);
  },
};

const EMPTY_OBJECT = {};

class State {
  constructor(options) {
    const setup = options == null ? EMPTY_OBJECT : options;
    this.output = '';
    // Functional options
    if (setup.output != null) {
      this.output = setup.output;
      this.write = this.writeToStream;
    } else {
      this.output = '';
    }
    this.generator = setup.generator != null ? setup.generator : GENERATOR;
    this.expressionsPrecedence =
      setup.expressionsPrecedence != null
        ? setup.expressionsPrecedence
        : EXPRESSIONS_PRECEDENCE;
    // Formating setup
    this.indent = setup.indent != null ? setup.indent : '  ';
    this.lineEnd = setup.lineEnd != null ? setup.lineEnd : '\n';
    this.indentLevel =
      setup.startingIndentLevel != null ? setup.startingIndentLevel : 0;
    this.writeComments = setup.comments ? setup.comments : false;
    // Source map
    if (setup.sourceMap != null) {
      this.write =
        setup.output == null ? this.writeAndMap : this.writeToStreamAndMap;
      this.sourceMap = setup.sourceMap;
      this.line = 1;
      this.column = 0;
      this.lineEndSize = this.lineEnd.split('\n').length - 1;
      this.mapping = {
        original: null,
        // Uses the entire state to avoid generating ephemeral objects
        generated: this,
        name: undefined,
        source: setup.sourceMap.file || setup.sourceMap._file,
      };
    }
  }

  write(code) {
    this.output += code;
  }

  writeToStream(code) {
    this.output.write(code);
  }

  writeAndMap(code, node) {
    this.output += code;
    this.map(code, node);
  }

  writeToStreamAndMap(code, node) {
    this.output.write(code);
    this.map(code, node);
  }

  map(code, node) {
    if (node != null) {
      const { type } = node;
      if (type[0] === 'L' && type[2] === 'n') {
        // LineComment
        this.column = 0;
        this.line++;
        return
      }
      if (node.loc != null) {
        const { mapping } = this;
        mapping.original = node.loc.start;
        mapping.name = node.name;
        this.sourceMap.addMapping(mapping);
      }
      if (
        (type[0] === 'T' && type[8] === 'E') ||
        (type[0] === 'L' && type[1] === 'i' && typeof node.value === 'string')
      ) {
        // TemplateElement or Literal string node
        const { length } = code;
        let { column, line } = this;
        for (let i = 0; i < length; i++) {
          if (code[i] === '\n') {
            column = 0;
            line++;
          } else {
            column++;
          }
        }
        this.column = column;
        this.line = line;
        return
      }
    }
    const { length } = code;
    const { lineEnd } = this;
    if (length > 0) {
      if (
        this.lineEndSize > 0 &&
        (lineEnd.length === 1
          ? code[length - 1] === lineEnd
          : code.endsWith(lineEnd))
      ) {
        this.line += this.lineEndSize;
        this.column = 0;
      } else {
        this.column += length;
      }
    }
  }

  toString() {
    return this.output
  }
}

function generate$2(node, options) {
  /*
  Returns a string representing the rendered code of the provided AST `node`.
  The `options` are:

  - `indent`: string to use for indentation (defaults to `␣␣`)
  - `lineEnd`: string to use for line endings (defaults to `\n`)
  - `startingIndentLevel`: indent level to start from (defaults to `0`)
  - `comments`: generate comments if `true` (defaults to `false`)
  - `output`: output stream to write the rendered code to (defaults to `null`)
  - `generator`: custom code generator (defaults to `GENERATOR`)
  - `expressionsPrecedence`: custom map of node types and their precedence level (defaults to `EXPRESSIONS_PRECEDENCE`)
  */
  const state = new State(options);
  // Travel through the AST node and generate the code
  state.generator[node.type](node, state);
  return state.output
}

// This file was generated. Do not modify manually!
var astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 7, 9, 32, 4, 318, 1, 31, 4, 33, 15, 71, 10, 50, 3, 123, 2, 54, 14, 32, 10, 3, 1, 11, 3, 46, 10, 8, 0, 46, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 3, 0, 158, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 68, 8, 2, 0, 3, 0, 2, 3, 2, 4, 2, 0, 15, 1, 83, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 7, 19, 58, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 199, 7, 137, 9, 54, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 55, 9, 7, 0, 259, 3, 10, 1, 2, 0, 49, 6, 4, 4, 14, 10, 5350, 0, 7, 14, 11465, 27, 2343, 9, 87, 9, 39, 4, 60, 6, 26, 9, 535, 9, 470, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 4178, 9, 519, 45, 3, 22, 481, 1, 61, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 12, 2, 9, 1, 3, 0, 33, 1, 1357, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 101, 0, 161, 6, 10, 9, 357, 0, 62, 13, 499, 13, 245, 1, 2, 9, 233, 0, 3, 0, 8, 1, 6, 0, 475, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];

// This file was generated. Do not modify manually!
var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 13, 10, 2, 14, 2, 6, 2, 1, 2, 10, 2, 14, 2, 6, 2, 1, 4, 51, 13, 310, 10, 21, 11, 7, 25, 5, 2, 41, 2, 13, 65, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 7, 25, 39, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 39, 27, 10, 22, 251, 41, 7, 1, 17, 5, 18, 21, 18, 28, 11, 0, 9, 21, 43, 17, 47, 20, 28, 22, 13, 52, 58, 1, 3, 0, 14, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 20, 1, 64, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 31, 9, 2, 0, 3, 0, 2, 37, 2, 0, 26, 0, 2, 0, 45, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 38, 6, 186, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 19, 72, 18, 0, 182, 32, 32, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 24, 43, 22, 0, 239, 18, 16, 0, 2, 12, 2, 33, 125, 0, 80, 921, 103, 111, 6, 206, 13, 310, 2314, 96, 16, 1071, 18, 5, 26, 3994, 6, 582, 6842, 29, 1763, 568, 8, 30, 18, 78, 18, 29, 19, 47, 17, 3, 32, 20, 6, 18, 433, 44, 212, 63, 33, 24, 3, 24, 45, 74, 6, 0, 67, 12, 65, 1, 2, 0, 15, 4, 10, 7386, 37, 33, 96, 114, 14, 913, 15, 50, 7710, 3, 2, 6, 2, 1, 2, 296, 10, 0, 30, 2, 3, 0, 15, 4, 8, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 340, 2, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 1845, 129, 15, 6, 55, 50, 49, 61, 147, 44, 11, 6, 17, 0, 322, 29, 19, 43, 485, 27, 229, 29, 3, 0, 208, 30, 2, 2, 2, 1, 2, 6, 3, 4, 10, 1, 225, 6, 2, 3, 2, 1, 2, 14, 2, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42719, 33, 4382, 2, 5773, 3, 7472, 16, 621, 2467, 541, 1507, 4938, 6, 8489, 39815, 11327];

// This file was generated. Do not modify manually!
var nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7-\u05c9\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u0897-\u089f\u08ca-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b53-\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c04\u0c3c\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0cf3\u0d00-\u0d03\u0d3b\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d81-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ece\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1715\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u180f-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1abf-\u1af0\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1dff\u200c\u200d\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\u30fb\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua82c\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua8ff-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f\uff65";

// This file was generated. Do not modify manually!
var nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0558\u0559\u0560-\u0588\u058b\u058c\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u0870-\u0887\u0889-\u088f\u08a0-\u08c9\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u09fc\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c5c\u0c5d\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cdc-\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d04-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u1711\u171f-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1878\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4c\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c8a\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u208f-\u209f\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7dd\ua7e2\ua7f1-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua8fe\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab6c\uab6d\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";

// These are a run-length and offset encoded representation of the
// >0xffff code points that are a valid part of identifiers. The
// offset starts at 0x10000, and each pair of numbers represents an
// offset to the next range, and then a size of the range.

// Reserved word lists for various dialects of the language

var reservedWords = {
  3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
  5: "class enum extends super const export import",
  6: "enum",
  strict: "implements interface let package private protected public static yield",
  strictBind: "eval arguments"
};

// And the keywords

var ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";

var keywords$1 = {
  5: ecma5AndLessKeywords,
  "5module": ecma5AndLessKeywords + " export import",
  6: ecma5AndLessKeywords + " const class extends export import super"
};

var keywordRelationalOperator = /^in(stanceof)?$/;

// ## Character categories

var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

// This has a complexity linear to the value of the code. The
// assumption is that looking up astral identifier characters is
// rare.
function isInAstralSet(code, set) {
  var pos = 0x10000;
  for (var i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) { return false }
    pos += set[i + 1];
    if (pos >= code) { return true }
  }
  return false
}

// Test whether a given character code starts an identifier.

function isIdentifierStart(code, astral) {
  if (code < 65) { return code === 36 }
  if (code < 91) { return true }
  if (code < 97) { return code === 95 }
  if (code < 123) { return true }
  if (code <= 0xffff) { return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code)) }
  if (astral === false) { return false }
  return isInAstralSet(code, astralIdentifierStartCodes)
}

// Test whether a given character is part of an identifier.

function isIdentifierChar(code, astral) {
  if (code < 48) { return code === 36 }
  if (code < 58) { return true }
  if (code < 65) { return false }
  if (code < 91) { return true }
  if (code < 97) { return code === 95 }
  if (code < 123) { return true }
  if (code <= 0xffff) { return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code)) }
  if (astral === false) { return false }
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes)
}

// ## Token types

// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.

// All token type variables start with an underscore, to make them
// easy to recognize.

// The `beforeExpr` property is used to disambiguate between regular
// expressions and divisions. It is set on all token types that can
// be followed by an expression (thus, a slash after them would be a
// regular expression).
//
// The `startsExpr` property is used to check if the token ends a
// `yield` expression. It is set on all token types that either can
// directly start an expression (like a quotation mark) or can
// continue an expression (like the body of a string).
//
// `isLoop` marks a keyword as starting a loop, which is important
// to know when parsing a label, in order to allow or disallow
// continue jumps to that label.

var TokenType = function TokenType(label, conf) {
  if ( conf === void 0 ) conf = {};

  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop || null;
  this.updateContext = null;
};

function binop(name, prec) {
  return new TokenType(name, {beforeExpr: true, binop: prec})
}
var beforeExpr = {beforeExpr: true}, startsExpr = {startsExpr: true};

// Map keyword names to token types.

var keywords = {};

// Succinct definitions of keyword token types
function kw(name, options) {
  if ( options === void 0 ) options = {};

  options.keyword = name;
  return keywords[name] = new TokenType(name, options)
}

var types$1 = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  privateId: new TokenType("privateId", startsExpr),
  eof: new TokenType("eof"),

  // Punctuation token types.
  bracketL: new TokenType("[", {beforeExpr: true, startsExpr: true}),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", {beforeExpr: true, startsExpr: true}),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", {beforeExpr: true, startsExpr: true}),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", {beforeExpr: true, startsExpr: true}),

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  eq: new TokenType("=", {beforeExpr: true, isAssign: true}),
  assign: new TokenType("_=", {beforeExpr: true, isAssign: true}),
  incDec: new TokenType("++/--", {prefix: true, postfix: true, startsExpr: true}),
  prefix: new TokenType("!/~", {beforeExpr: true, prefix: true, startsExpr: true}),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", {beforeExpr: true, binop: 9, prefix: true, startsExpr: true}),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", {beforeExpr: true}),
  coalesce: binop("??", 1),

  // Keyword token types.
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", {isLoop: true, beforeExpr: true}),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", {isLoop: true}),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", {isLoop: true}),
  _with: kw("with"),
  _new: kw("new", {beforeExpr: true, startsExpr: true}),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", {beforeExpr: true, binop: 7}),
  _instanceof: kw("instanceof", {beforeExpr: true, binop: 7}),
  _typeof: kw("typeof", {beforeExpr: true, prefix: true, startsExpr: true}),
  _void: kw("void", {beforeExpr: true, prefix: true, startsExpr: true}),
  _delete: kw("delete", {beforeExpr: true, prefix: true, startsExpr: true})
};

// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.

var lineBreak = /\r\n?|\n|\u2028|\u2029/;
var lineBreakG = new RegExp(lineBreak.source, "g");

function isNewLine(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029
}

function nextLineBreak(code, from, end) {
  if ( end === void 0 ) end = code.length;

  for (var i = from; i < end; i++) {
    var next = code.charCodeAt(i);
    if (isNewLine(next))
      { return i < end - 1 && next === 13 && code.charCodeAt(i + 1) === 10 ? i + 2 : i + 1 }
  }
  return -1
}

var nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;

var ref = Object.prototype;
var hasOwnProperty = ref.hasOwnProperty;
var toString = ref.toString;

var hasOwn = Object.hasOwn || (function (obj, propName) { return (
  hasOwnProperty.call(obj, propName)
); });

var isArray = Array.isArray || (function (obj) { return (
  toString.call(obj) === "[object Array]"
); });

var regexpCache = Object.create(null);

function wordsRegexp(words) {
  return regexpCache[words] || (regexpCache[words] = new RegExp("^(?:" + words.replace(/ /g, "|") + ")$"))
}

function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xFFFF) { return String.fromCharCode(code) }
  code -= 0x10000;
  return String.fromCharCode((code >> 10) + 0xD800, (code & 1023) + 0xDC00)
}

var loneSurrogate = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/;

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

var Position = function Position(line, col) {
  this.line = line;
  this.column = col;
};

Position.prototype.offset = function offset (n) {
  return new Position(this.line, this.column + n)
};

var SourceLocation = function SourceLocation(p, start, end) {
  this.start = start;
  this.end = end;
  if (p.sourceFile !== null) { this.source = p.sourceFile; }
};

// The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

function getLineInfo(input, offset) {
  for (var line = 1, cur = 0;;) {
    var nextBreak = nextLineBreak(input, cur, offset);
    if (nextBreak < 0) { return new Position(line, offset - cur) }
    ++line;
    cur = nextBreak;
  }
}

// A second argument must be given to configure the parser process.
// These options are recognized (only `ecmaVersion` is required):

var defaultOptions = {
  // `ecmaVersion` indicates the ECMAScript version to parse. Must be
  // either 3, 5, 6 (or 2015), 7 (2016), 8 (2017), 9 (2018), 10
  // (2019), 11 (2020), 12 (2021), 13 (2022), 14 (2023), or `"latest"`
  // (the latest version the library supports). This influences
  // support for strict mode, the set of reserved words, and support
  // for new syntax features.
  ecmaVersion: null,
  // `sourceType` indicates the mode the code should be parsed in.
  // Can be either `"script"`, `"module"` or `"commonjs"`. This influences global
  // strict mode and parsing of `import` and `export` declarations.
  sourceType: "script",
  // When set to true, enable strict parsing mode even if `sourceType`
  // is `"script"`.
  strict: false,
  // `onInsertedSemicolon` can be a callback that will be called when
  // a semicolon is automatically inserted. It will be passed the
  // position of the inserted semicolon as an offset, and if
  // `locations` is enabled, it is given the location as a `{line,
  // column}` object as second argument.
  onInsertedSemicolon: null,
  // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
  // trailing commas.
  onTrailingComma: null,
  // By default, reserved words are only enforced if ecmaVersion >= 5.
  // Set `allowReserved` to a boolean value to explicitly turn this on
  // an off. When this option has the value "never", reserved words
  // and keywords can also not be used as property names.
  allowReserved: null,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program, and an import.meta expression
  // in a script isn't considered an error.
  allowImportExportEverywhere: false,
  // By default, await identifiers are allowed to appear at the top-level scope only if ecmaVersion >= 2022.
  // When enabled, await identifiers are allowed to appear at the top-level scope,
  // but they are still not allowed in non-async functions.
  allowAwaitOutsideFunction: null,
  // When enabled, super identifiers are not constrained to
  // appearing in methods and do not raise an error when they appear elsewhere.
  allowSuperOutsideMethod: null,
  // When enabled, hashbang directive in the beginning of file is
  // allowed and treated as a line comment. Enabled by default when
  // `ecmaVersion` >= 2023.
  allowHashBang: false,
  // By default, the parser will verify that private properties are
  // only used in places where they are valid and have been declared.
  // Set this to false to turn such checks off.
  checkPrivateFields: true,
  // When `locations` is on, `loc` properties holding objects with
  // `start` and `end` properties in `{line, column}` form (with
  // line being 1-based and column 0-based) will be attached to the
  // nodes.
  locations: false,
  // Pass an optional `{line, column}` object to use for the start of
  // the parse. This is mostly useful when using `parseExpressionAt`
  // with `locations: true`, to prevent the parser from having to
  // determine the line position at the start position.
  startLocation: null,
  // A function can be passed as `onToken` option, which will
  // cause Acorn to call that function with object in the same
  // format as tokens returned from `tokenizer().getToken()`. Note
  // that you are not allowed to call the parser from the
  // callback—that will corrupt its internal state.
  onToken: null,
  // A function can be passed as `onComment` option, which will
  // cause Acorn to call that function with `(block, text, start,
  // end)` parameters whenever a comment is skipped. `block` is a
  // boolean indicating whether this is a block (`/* */`) comment,
  // `text` is the content of the comment, and `start` and `end` are
  // character offsets that denote the start and end of the comment.
  // When the `locations` option is on, two more parameters are
  // passed, the full `{line, column}` locations of the start and
  // end of the comments. Note that you are not allowed to call the
  // parser from the callback—that will corrupt its internal state.
  // When this option has an array as value, objects representing the
  // comments are pushed to it.
  onComment: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // It is possible to parse multiple files into a single AST by
  // passing the tree produced by parsing the first file as
  // `program` option in subsequent parses. This will add the
  // toplevel forms of the parsed file to the `Program` (top) node
  // of an existing parse tree.
  program: null,
  // When `locations` is on, you can pass this to record the source
  // file in every node's `loc` object.
  sourceFile: null,
  // This value, if given, is stored in every node, whether
  // `locations` is on or off.
  directSourceFile: null,
  // When enabled, parenthesized expressions are represented by
  // (non-standard) ParenthesizedExpression nodes
  preserveParens: false
};

// Interpret and default an options object

var warnedAboutEcmaVersion = false;

function getOptions(opts) {
  var options = {};

  for (var opt in defaultOptions)
    { options[opt] = opts && hasOwn(opts, opt) ? opts[opt] : defaultOptions[opt]; }

  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    if (!warnedAboutEcmaVersion && typeof console === "object" && console.warn) {
      warnedAboutEcmaVersion = true;
      console.warn("Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.");
    }
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }

  if (options.allowReserved == null)
    { options.allowReserved = options.ecmaVersion < 5; }

  if (!opts || opts.allowHashBang == null)
    { options.allowHashBang = options.ecmaVersion >= 14; }

  if (isArray(options.onToken)) {
    var tokens = options.onToken;
    options.onToken = function (token) { return tokens.push(token); };
  }
  if (isArray(options.onComment))
    { options.onComment = pushComment(options, options.onComment); }

  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction)
    { throw new Error("Cannot use allowAwaitOutsideFunction with sourceType: commonjs") }

  return options
}

function pushComment(options, array) {
  return function(block, text, start, end, startLoc, endLoc) {
    var comment = {
      type: block ? "Block" : "Line",
      value: text,
      start: start,
      end: end
    };
    if (options.locations)
      { comment.loc = new SourceLocation(this, startLoc, endLoc); }
    if (options.ranges)
      { comment.range = [start, end]; }
    array.push(comment);
  }
}

// Each scope gets a bitset that may contain these flags
var
    SCOPE_TOP = 1,
    SCOPE_FUNCTION = 2,
    SCOPE_ASYNC = 4,
    SCOPE_GENERATOR = 8,
    SCOPE_ARROW = 16,
    SCOPE_SIMPLE_CATCH = 32,
    SCOPE_SUPER = 64,
    SCOPE_DIRECT_SUPER = 128,
    SCOPE_CLASS_STATIC_BLOCK = 256,
    SCOPE_CLASS_FIELD_INIT = 512,
    SCOPE_SWITCH = 1024,
    SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;

function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0)
}

// Used in checkLVal* and declareName to determine the type of a binding
var
    BIND_NONE = 0, // Not a binding
    BIND_VAR = 1, // Var-style binding
    BIND_LEXICAL = 2, // Let- or const-style binding
    BIND_FUNCTION = 3, // Function declaration
    BIND_SIMPLE_CATCH = 4, // Simple (identifier pattern) catch binding
    BIND_OUTSIDE = 5; // Special case for function names as bound inside the function

var Parser = function Parser(options, input, startPos) {
  this.options = options = getOptions(options);
  this.sourceFile = options.sourceFile;
  this.keywords = wordsRegexp(keywords$1[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5]);
  var reserved = "";
  if (options.allowReserved !== true) {
    reserved = reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3];
    if (options.sourceType === "module") { reserved += " await"; }
  }
  this.reservedWords = wordsRegexp(reserved);
  var reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
  this.reservedWordsStrict = wordsRegexp(reservedStrict);
  this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
  this.input = String(input);

  // Used to signal to callers of `readWord1` whether the word
  // contained any escape sequences. This is needed because words with
  // escape sequences must not be interpreted as keywords.
  this.containsEsc = false;

  // Set up token state

  // The current position of the tokenizer in the input.
  this.pos = startPos || 0;
  this.curLine = 1;
  if (options.startLocation) {
    this.lineStart = this.pos - options.startLocation.column;
    this.curLine = options.startLocation.line;
  } else if (startPos) {
    this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
    if (this.options.locations)
      { this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length; }
  } else {
    this.lineStart = 0;
  }

  // Properties of the current token:
  // Its type
  this.type = types$1.eof;
  // For tokens that include more information than their type, the value
  this.value = null;
  // Its start and end offset
  this.start = this.end = this.pos;
  // And, if locations are used, the {line, column} object
  // corresponding to those offsets
  this.startLoc = this.endLoc = this.curPosition();

  // Position information for the previous token
  this.lastTokEndLoc = this.lastTokStartLoc = null;
  this.lastTokStart = this.lastTokEnd = this.pos;

  // The context stack is used to superficially track syntactic
  // context to predict whether a regular expression is allowed in a
  // given position.
  this.context = this.initialContext();
  this.exprAllowed = true;

  // Figure out if it's a module code.
  this.inModule = options.sourceType === "module";
  this.strict = this.inModule || options.strict === true || this.strictDirective(this.pos);

  // Used to signify the start of a potential arrow function
  this.potentialArrowAt = -1;
  this.potentialArrowInForAwait = false;

  // Positions to delayed-check that yield/await does not exist in default parameters.
  this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
  // Labels in scope.
  this.labels = [];
  // Thus-far undefined exports.
  this.undefinedExports = Object.create(null);

  // If enabled, skip leading hashbang line.
  if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!")
    { this.skipLineComment(2); }

  // Scope tracking for duplicate variable names (see scope.js)
  this.scopeStack = [];
  this.enterScope(
    this.options.sourceType === "commonjs"
      // In commonjs, the top-level scope behaves like a function scope
      ? SCOPE_FUNCTION
      : SCOPE_TOP
  );

  // For RegExp validation
  this.regexpState = null;

  // The stack of private names.
  // Each element has two properties: 'declared' and 'used'.
  // When it exited from the outermost class definition, all used private names must be declared.
  this.privateNameStack = [];
};

var prototypeAccessors = { inFunction: { configurable: true },inGenerator: { configurable: true },inAsync: { configurable: true },canAwait: { configurable: true },allowReturn: { configurable: true },allowSuper: { configurable: true },allowDirectSuper: { configurable: true },treatFunctionsAsVar: { configurable: true },allowNewDotTarget: { configurable: true },allowUsing: { configurable: true },inClassStaticBlock: { configurable: true } };

Parser.prototype.parse = function parse () {
    var this$1$1 = this;

  var node = this.options.program || this.startNode();
  this.nextToken();
  return this.catchStackOverflow(function () { return this$1$1.parseTopLevel(node); })
};

prototypeAccessors.inFunction.get = function () { return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0 };

prototypeAccessors.inGenerator.get = function () { return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0 };

prototypeAccessors.inAsync.get = function () { return (this.currentVarScope().flags & SCOPE_ASYNC) > 0 };

prototypeAccessors.canAwait.get = function () {
  for (var i = this.scopeStack.length - 1; i >= 0; i--) {
    var ref = this.scopeStack[i];
      var flags = ref.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT)) { return false }
    if (flags & SCOPE_FUNCTION) { return (flags & SCOPE_ASYNC) > 0 }
  }
  return (this.inModule && this.options.ecmaVersion >= 13) || this.options.allowAwaitOutsideFunction
};

prototypeAccessors.allowReturn.get = function () {
  if (this.inFunction) { return true }
  if (this.options.allowReturnOutsideFunction && this.currentVarScope().flags & SCOPE_TOP) { return true }
  return false
};

prototypeAccessors.allowSuper.get = function () {
  var ref = this.currentThisScope();
    var flags = ref.flags;
  return (flags & SCOPE_SUPER) > 0 || this.options.allowSuperOutsideMethod
};

prototypeAccessors.allowDirectSuper.get = function () { return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0 };

prototypeAccessors.treatFunctionsAsVar.get = function () { return this.treatFunctionsAsVarInScope(this.currentScope()) };

prototypeAccessors.allowNewDotTarget.get = function () {
  for (var i = this.scopeStack.length - 1; i >= 0; i--) {
    var ref = this.scopeStack[i];
      var flags = ref.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT) ||
        ((flags & SCOPE_FUNCTION) && !(flags & SCOPE_ARROW))) { return true }
  }
  return false
};

prototypeAccessors.allowUsing.get = function () {
  var ref = this.currentScope();
    var flags = ref.flags;
  if (flags & SCOPE_SWITCH) { return false }
  if (!this.inModule && flags & SCOPE_TOP) { return false }
  return true
};

prototypeAccessors.inClassStaticBlock.get = function () {
  return (this.currentVarScope().flags & SCOPE_CLASS_STATIC_BLOCK) > 0
};

Parser.extend = function extend () {
    var plugins = [], len = arguments.length;
    while ( len-- ) plugins[ len ] = arguments[ len ];

  var cls = this;
  for (var i = 0; i < plugins.length; i++) { cls = plugins[i](cls); }
  return cls
};

Parser.parse = function parse (input, options) {
  return new this(options, input).parse()
};

Parser.parseExpressionAt = function parseExpressionAt (input, pos, options) {
  var parser = new this(options, input, pos);
  parser.nextToken();
  return parser.parseExpression()
};

Parser.tokenizer = function tokenizer (input, options) {
  return new this(options, input)
};

Object.defineProperties( Parser.prototype, prototypeAccessors );

var pp$9 = Parser.prototype;

// ## Parser utilities

var literal = /^(?:'((?:\\[^]|[^'\\])*?)'|"((?:\\[^]|[^"\\])*?)")/;
pp$9.strictDirective = function(start) {
  if (this.options.ecmaVersion < 5) { return false }
  for (;;) {
    // Try to find string literal.
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    var match = literal.exec(this.input.slice(start));
    if (!match) { return false }
    if ((match[1] || match[2]) === "use strict") {
      skipWhiteSpace.lastIndex = start + match[0].length;
      var spaceAfter = skipWhiteSpace.exec(this.input), end = spaceAfter.index + spaceAfter[0].length;
      var next = this.input.charAt(end);
      return next === ";" || next === "}" ||
        (lineBreak.test(spaceAfter[0]) &&
         !(/[(`.[+\-/*%<>=,?^&]/.test(next) ||
           next === "!" && this.input.charAt(end + 1) === "=" ||
           next === "i" && keywordOpAt(this, end)))
    }
    start += match[0].length;

    // Skip semicolon, if any.
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    if (this.input[start] === ";")
      { start++; }
  }
};

// Scan for `in` or `instanceof` at the given position, knowing that
// there's an `i` there.
function keywordOpAt(parser, pos) {
  var end = pos + 1, stop = Math.min(parser.input.length, pos + 11);
  while (end < stop) {
    var ch = parser.fullCharCodeAt(end);
    if (!isIdentifierChar(ch, true)) { break }
    end += ch <= 0xffff ? 1 : 2;
  }
  return end === pos + 2 && parser.input.slice(pos, end) === "in" ||
    end === pos + 10 && parser.input.slice(pos, end) === "instanceof"
}

// Predicate that tests whether the next token is of the given
// type, and if yes, consumes it as a side effect.

pp$9.eat = function(type) {
  if (this.type === type) {
    this.next();
    return true
  } else {
    return false
  }
};

// Tests whether parsed token is a contextual keyword.

pp$9.isContextual = function(name) {
  return this.type === types$1.name && this.value === name && !this.containsEsc
};

// Consumes contextual keyword if possible.

pp$9.eatContextual = function(name) {
  if (!this.isContextual(name)) { return false }
  this.next();
  return true
};

pp$9.catchStackOverflow = function(f) {
  try {
    return f()
  } catch (e) {
    if (e instanceof Error && (/\bstack\b.*\b(exceeded|overflow)\b/i.test(e.message) || /\btoo much recursion\b/i.test(e.message)))
      { this.raise(this.start, "Not enough stack space to parse input"); }
    else
      { throw e }
  }
};

// Asserts that following token is given contextual keyword.

pp$9.expectContextual = function(name) {
  if (!this.eatContextual(name)) { this.unexpected(); }
};

// Test whether a semicolon can be inserted at the current position.

pp$9.canInsertSemicolon = function() {
  return this.type === types$1.eof ||
    this.type === types$1.braceR ||
    lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
};

pp$9.insertSemicolon = function() {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon)
      { this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc); }
    return true
  }
};

// Consume a semicolon, or, failing that, see if we are allowed to
// pretend that there is a semicolon at this position.

pp$9.semicolon = function() {
  if (!this.eat(types$1.semi) && !this.insertSemicolon()) { this.unexpected(); }
};

pp$9.afterTrailingComma = function(tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma)
      { this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc); }
    if (!notNext)
      { this.next(); }
    return true
  }
};

// Expect a token of a given type. If found, consume it, otherwise,
// raise an unexpected token error.

pp$9.expect = function(type) {
  this.eat(type) || this.unexpected();
};

// Raise an unexpected token error.

pp$9.unexpected = function(pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token");
};

var DestructuringErrors = function DestructuringErrors() {
  this.shorthandAssign =
  this.trailingComma =
  this.parenthesizedAssign =
  this.parenthesizedBind =
  this.doubleProto =
    -1;
};

pp$9.checkPatternErrors = function(refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) { return }
  if (refDestructuringErrors.trailingComma > -1)
    { this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element"); }
  var parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
  if (parens > -1) { this.raiseRecoverable(parens, isAssign ? "Assigning to rvalue" : "Parenthesized pattern"); }
};

pp$9.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) { return false }
  var shorthandAssign = refDestructuringErrors.shorthandAssign;
  var doubleProto = refDestructuringErrors.doubleProto;
  if (!andThrow) { return shorthandAssign >= 0 || doubleProto >= 0 }
  if (shorthandAssign >= 0)
    { this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns"); }
  if (doubleProto >= 0)
    { this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property"); }
};

pp$9.checkYieldAwaitInDefaultParams = function() {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos))
    { this.raise(this.yieldPos, "Yield expression cannot be a default value"); }
  if (this.awaitPos)
    { this.raise(this.awaitPos, "Await expression cannot be a default value"); }
};

pp$9.isSimpleAssignTarget = function(expr) {
  if (expr.type === "ParenthesizedExpression")
    { return this.isSimpleAssignTarget(expr.expression) }
  return expr.type === "Identifier" || expr.type === "MemberExpression"
};

var pp$8 = Parser.prototype;

// ### Statement parsing

// Parse a program. Initializes the parser, reads any number of
// statements, and wraps them in a Program node.  Optionally takes a
// `program` argument.  If present, the statements will be appended
// to its body instead of creating a new node.

pp$8.parseTopLevel = function(node) {
  var exports$1 = Object.create(null);
  if (!node.body) { node.body = []; }
  while (this.type !== types$1.eof) {
    var stmt = this.parseStatement(null, true, exports$1);
    node.body.push(stmt);
  }
  if (this.inModule)
    { for (var i = 0, list = Object.keys(this.undefinedExports); i < list.length; i += 1)
      {
        var name = list[i];

        this.raiseRecoverable(this.undefinedExports[name].start, ("Export '" + name + "' is not defined"));
      } }
  this.adaptDirectivePrologue(node.body);
  this.next();
  node.sourceType = this.options.sourceType === "commonjs" ? "script" : this.options.sourceType;
  return this.finishNode(node, "Program")
};

var loopLabel = {kind: "loop"}, switchLabel = {kind: "switch"};

pp$8.isLet = function(context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) { return false }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, nextCh = this.fullCharCodeAt(next);
  // For ambiguous cases, determine if a LexicalDeclaration (or only a
  // Statement) is allowed here. If context is not empty then only a Statement
  // is allowed. However, `let [` is an explicit negative lookahead for
  // ExpressionStatement, so special-case it first.
  if (nextCh === 91 || nextCh === 92) { return true } // '[', '\'
  if (context) { return false }

  if (nextCh === 123) { return true } // '{'
  if (isIdentifierStart(nextCh)) {
    var start = next;
    do { next += nextCh <= 0xffff ? 1 : 2; }
    while (isIdentifierChar(nextCh = this.fullCharCodeAt(next)))
    if (nextCh === 92) { return true }
    var ident = this.input.slice(start, next);
    if (!keywordRelationalOperator.test(ident)) { return true }
  }
  return false
};

// check 'async [no LineTerminator here] function'
// - 'async /*foo*/ function' is OK.
// - 'async /*\n*/ function' is invalid.
pp$8.isAsyncFunction = function() {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async"))
    { return false }

  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, after;
  return !lineBreak.test(this.input.slice(this.pos, next)) &&
    this.input.slice(next, next + 8) === "function" &&
    (next + 8 === this.input.length ||
     !(isIdentifierChar(after = this.fullCharCodeAt(next + 8)) || after === 92 /* '\' */))
};

pp$8.isUsingKeyword = function(isAwaitUsing, isFor) {
  if (this.options.ecmaVersion < 17 || !this.isContextual(isAwaitUsing ? "await" : "using"))
    { return false }

  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length;

  if (lineBreak.test(this.input.slice(this.pos, next))) { return false }

  if (isAwaitUsing) {
    var usingEndPos = next + 5 /* using */, after;
    if (this.input.slice(next, usingEndPos) !== "using" ||
      usingEndPos === this.input.length ||
      isIdentifierChar(after = this.fullCharCodeAt(usingEndPos)) ||
      after === 92 /* '\' */
    ) { return false }

    skipWhiteSpace.lastIndex = usingEndPos;
    var skipAfterUsing = skipWhiteSpace.exec(this.input);
    next = usingEndPos + skipAfterUsing[0].length;
    if (skipAfterUsing && lineBreak.test(this.input.slice(usingEndPos, next))) { return false }
  }

  var ch = this.fullCharCodeAt(next);
  if (!isIdentifierStart(ch) && ch !== 92 /* '\' */) { return false }
  var idStart = next;
  do { next += ch <= 0xffff ? 1 : 2; }
  while (isIdentifierChar(ch = this.fullCharCodeAt(next)))
  if (ch === 92) { return true }
  var id = this.input.slice(idStart, next);
  if (keywordRelationalOperator.test(id)) { return false }
  if (isFor && !isAwaitUsing && id === "of") {
    // Look ahead for using declaration with initializer, i.e., `for (using of = ...)`
    skipWhiteSpace.lastIndex = next;
    var skipAfterOf = skipWhiteSpace.exec(this.input);
    next = next + skipAfterOf[0].length;
    if (this.input.charCodeAt(next) !== 61 /* '=' */ ||
      // Check for ==, === and => operators
      (ch = this.input.charCodeAt(next + 1)) === 61 /* '=' */ || ch === 62 /* '>' */) {
      return false
    }
  }
  return true
};

pp$8.isAwaitUsing = function(isFor) {
  return this.isUsingKeyword(true, isFor)
};

pp$8.isUsing = function(isFor) {
  return this.isUsingKeyword(false, isFor)
};

// Parse a single statement.
//
// If expecting a statement and finding a slash operator, parse a
// regular expression literal. This is to handle cases like
// `if (foo) /blah/.exec(foo)`, where looking at the previous token
// does not help.

pp$8.parseStatement = function(context, topLevel, exports$1) {
  var starttype = this.type, node = this.startNode(), kind;

  if (this.isLet(context)) {
    starttype = types$1._var;
    kind = "let";
  }

  // Most types of statements are recognized by the keyword they
  // start with. Many are trivial to parse, some require a bit of
  // complexity.

  switch (starttype) {
  case types$1._break: case types$1._continue: return this.parseBreakContinueStatement(node, starttype.keyword)
  case types$1._debugger: return this.parseDebuggerStatement(node)
  case types$1._do: return this.parseDoStatement(node)
  case types$1._for: return this.parseForStatement(node)
  case types$1._function:
    // Function as sole body of either an if statement or a labeled statement
    // works, but not when it is part of a labeled statement that is the sole
    // body of an if statement.
    if ((context && (this.strict || context !== "if" && context !== "label")) && this.options.ecmaVersion >= 6) { this.unexpected(); }
    return this.parseFunctionStatement(node, false, !context)
  case types$1._class:
    if (context) { this.unexpected(); }
    return this.parseClass(node, true)
  case types$1._if: return this.parseIfStatement(node)
  case types$1._return: return this.parseReturnStatement(node)
  case types$1._switch: return this.parseSwitchStatement(node)
  case types$1._throw: return this.parseThrowStatement(node)
  case types$1._try: return this.parseTryStatement(node)
  case types$1._const: case types$1._var:
    kind = kind || this.value;
    if (context && kind !== "var") { this.unexpected(); }
    return this.parseVarStatement(node, kind)
  case types$1._while: return this.parseWhileStatement(node)
  case types$1._with: return this.parseWithStatement(node)
  case types$1.braceL: return this.parseBlock(true, node)
  case types$1.semi: return this.parseEmptyStatement(node)
  case types$1._export:
  case types$1._import:
    if (this.options.ecmaVersion > 10 && starttype === types$1._import) {
      skipWhiteSpace.lastIndex = this.pos;
      var skip = skipWhiteSpace.exec(this.input);
      var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
      if (nextCh === 40 || nextCh === 46) // '(' or '.'
        { return this.parseExpressionStatement(node, this.parseExpression()) }
    }

    if (!this.options.allowImportExportEverywhere) {
      if (!topLevel)
        { this.raise(this.start, "'import' and 'export' may only appear at the top level"); }
      if (!this.inModule)
        { this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'"); }
    }
    return starttype === types$1._import ? this.parseImport(node) : this.parseExport(node, exports$1)

    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
  default:
    if (this.isAsyncFunction()) {
      if (context) { this.unexpected(); }
      this.next();
      return this.parseFunctionStatement(node, true, !context)
    }

    var usingKind = this.isAwaitUsing(false) ? "await using" : this.isUsing(false) ? "using" : null;
    if (usingKind) {
      if (!this.allowUsing) {
        this.raise(this.start, "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement");
      }
      if (context) {
        // Cases like `for (;;) using x = ...;`, `if (true) await using x = ...;`, etc. are not allowed.
        this.raise(this.start, "Using declaration is not allowed in single-statement positions");
      }
      if (usingKind === "await using") {
        if (!this.canAwait) {
          this.raise(this.start, "Await using cannot appear outside of async function");
        }
        this.next();
      }
      this.next();
      this.parseVar(node, false, usingKind);
      this.semicolon();
      return this.finishNode(node, "VariableDeclaration")
    }

    var maybeName = this.value, expr = this.parseExpression();
    if (starttype === types$1.name && expr.type === "Identifier" && this.eat(types$1.colon))
      { return this.parseLabeledStatement(node, maybeName, expr, context) }
    else { return this.parseExpressionStatement(node, expr) }
  }
};

pp$8.parseBreakContinueStatement = function(node, keyword) {
  var isBreak = keyword === "break";
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) { node.label = null; }
  else if (this.type !== types$1.name) { this.unexpected(); }
  else {
    node.label = this.parseIdent();
    this.semicolon();
  }

  // Verify that there is an actual destination to break or
  // continue to.
  var i = 0;
  for (; i < this.labels.length; ++i) {
    var lab = this.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) { break }
      if (node.label && isBreak) { break }
    }
  }
  if (i === this.labels.length) { this.raise(node.start, "Unsyntactic " + keyword); }
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement")
};

pp$8.parseDebuggerStatement = function(node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement")
};

pp$8.parseDoStatement = function(node) {
  this.next();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("do");
  this.labels.pop();
  this.expect(types$1._while);
  node.test = this.parseParenExpression();
  if (this.options.ecmaVersion >= 6)
    { this.eat(types$1.semi); }
  else
    { this.semicolon(); }
  return this.finishNode(node, "DoWhileStatement")
};

// Disambiguating between a `for` and a `for`/`in` or `for`/`of`
// loop is non-trivial. Basically, we have to parse the init `var`
// statement or expression, disallowing the `in` operator (see
// the second parameter to `parseExpression`), and then check
// whether the next token is `in` or `of`. When there is no init
// part (semicolon immediately after the opening parenthesis), it
// is a regular `for` loop.

pp$8.parseForStatement = function(node) {
  this.next();
  var awaitAt = (this.options.ecmaVersion >= 9 && this.canAwait && this.eatContextual("await")) ? this.lastTokStart : -1;
  this.labels.push(loopLabel);
  this.enterScope(0);
  this.expect(types$1.parenL);
  if (this.type === types$1.semi) {
    if (awaitAt > -1) { this.unexpected(awaitAt); }
    return this.parseFor(node, null)
  }
  var isLet = this.isLet();
  if (this.type === types$1._var || this.type === types$1._const || isLet) {
    var init$1 = this.startNode(), kind = isLet ? "let" : this.value;
    this.next();
    this.parseVar(init$1, true, kind);
    this.finishNode(init$1, "VariableDeclaration");
    return this.parseForAfterInit(node, init$1, awaitAt)
  }
  var startsWithLet = this.isContextual("let"), isForOf = false;

  var usingKind = this.isUsing(true) ? "using" : this.isAwaitUsing(true) ? "await using" : null;
  if (usingKind) {
    var init$2 = this.startNode();
    this.next();
    if (usingKind === "await using") {
      if (!this.canAwait) {
        this.raise(this.start, "Await using cannot appear outside of async function");
      }
      this.next();
    }
    this.parseVar(init$2, true, usingKind);
    this.finishNode(init$2, "VariableDeclaration");
    return this.parseForAfterInit(node, init$2, awaitAt)
  }
  var containsEsc = this.containsEsc;
  var refDestructuringErrors = new DestructuringErrors;
  var initPos = this.start;
  var init = awaitAt > -1
    ? this.parseExprSubscripts(refDestructuringErrors, "await")
    : this.parseExpression(true, refDestructuringErrors);
  if (this.type === types$1._in || (isForOf = this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
    if (awaitAt > -1) { // implies `ecmaVersion >= 9` (see declaration of awaitAt)
      if (this.type === types$1._in) { this.unexpected(awaitAt); }
      node.await = true;
    } else if (isForOf && this.options.ecmaVersion >= 8) {
      if (init.start === initPos && !containsEsc && init.type === "Identifier" && init.name === "async") { this.unexpected(); }
      else if (this.options.ecmaVersion >= 9) { node.await = false; }
    }
    if (startsWithLet && isForOf) { this.raise(init.start, "The left-hand side of a for-of loop may not start with 'let'."); }
    this.toAssignable(init, false, refDestructuringErrors);
    this.checkLValPattern(init);
    return this.parseForIn(node, init)
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (awaitAt > -1) { this.unexpected(awaitAt); }
  return this.parseFor(node, init)
};

// Helper method to parse for loop after variable initialization
pp$8.parseForAfterInit = function(node, init, awaitAt) {
  if ((this.type === types$1._in || (this.options.ecmaVersion >= 6 && this.isContextual("of"))) && init.declarations.length === 1) {
    if (this.type === types$1._in) {
      if ((init.kind === "using" || init.kind === "await using") && !init.declarations[0].init) {
        this.raise(this.start, "Using declaration is not allowed in for-in loops");
      }
      if (this.options.ecmaVersion >= 9 && awaitAt > -1) { this.unexpected(awaitAt); }
    } else if (this.options.ecmaVersion >= 9) { node.await = awaitAt > -1; }
    return this.parseForIn(node, init)
  }
  if (awaitAt > -1) { this.unexpected(awaitAt); }
  return this.parseFor(node, init)
};

pp$8.parseFunctionStatement = function(node, isAsync, declarationPosition) {
  this.next();
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync)
};

pp$8.parseIfStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  // allow function declarations in branches, but only in non-strict mode
  node.consequent = this.parseStatement("if");
  node.alternate = this.eat(types$1._else) ? this.parseStatement("if") : null;
  return this.finishNode(node, "IfStatement")
};

pp$8.parseReturnStatement = function(node) {
  if (!this.allowReturn)
    { this.raise(this.start, "'return' outside of function"); }
  this.next();

  // In `return` (and `break`/`continue`), the keywords with
  // optional arguments, we eagerly look for a semicolon or the
  // possibility to insert one.

  if (this.eat(types$1.semi) || this.insertSemicolon()) { node.argument = null; }
  else { node.argument = this.parseExpression(); this.semicolon(); }
  return this.finishNode(node, "ReturnStatement")
};

pp$8.parseSwitchStatement = function(node) {
  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(types$1.braceL);
  this.labels.push(switchLabel);
  this.enterScope(SCOPE_SWITCH);

  // Statements under must be grouped (by label) in SwitchCase
  // nodes. `cur` is used to keep the node that we are currently
  // adding statements to.

  var cur;
  for (var sawDefault = false; this.type !== types$1.braceR;) {
    if (this.type === types$1._case || this.type === types$1._default) {
      var isCase = this.type === types$1._case;
      if (cur) { this.finishNode(cur, "SwitchCase"); }
      node.cases.push(cur = this.startNode());
      cur.consequent = [];
      this.next();
      if (isCase) {
        cur.test = this.parseExpression();
      } else {
        if (sawDefault) { this.raiseRecoverable(this.lastTokStart, "Multiple default clauses"); }
        sawDefault = true;
        cur.test = null;
      }
      this.expect(types$1.colon);
    } else {
      if (!cur) { this.unexpected(); }
      cur.consequent.push(this.parseStatement(null));
    }
  }
  this.exitScope();
  if (cur) { this.finishNode(cur, "SwitchCase"); }
  this.next(); // Closing brace
  this.labels.pop();
  return this.finishNode(node, "SwitchStatement")
};

pp$8.parseThrowStatement = function(node) {
  this.next();
  if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start)))
    { this.raise(this.lastTokEnd, "Illegal newline after throw"); }
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement")
};

// Reused empty array added for node fields that are always empty.

var empty$1 = [];

pp$8.parseCatchClauseParam = function() {
  var param = this.parseBindingAtom();
  var simple = param.type === "Identifier";
  this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
  this.checkLValPattern(param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
  this.expect(types$1.parenR);

  return param
};

pp$8.parseTryStatement = function(node) {
  this.next();
  node.block = this.parseBlock();
  node.handler = null;
  if (this.type === types$1._catch) {
    var clause = this.startNode();
    this.next();
    if (this.eat(types$1.parenL)) {
      clause.param = this.parseCatchClauseParam();
    } else {
      if (this.options.ecmaVersion < 10) { this.unexpected(); }
      clause.param = null;
      this.enterScope(0);
    }
    clause.body = this.parseBlock(false);
    this.exitScope();
    node.handler = this.finishNode(clause, "CatchClause");
  }
  node.finalizer = this.eat(types$1._finally) ? this.parseBlock() : null;
  if (!node.handler && !node.finalizer)
    { this.raise(node.start, "Missing catch or finally clause"); }
  return this.finishNode(node, "TryStatement")
};

pp$8.parseVarStatement = function(node, kind, allowMissingInitializer) {
  this.next();
  this.parseVar(node, false, kind, allowMissingInitializer);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration")
};

pp$8.parseWhileStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("while");
  this.labels.pop();
  return this.finishNode(node, "WhileStatement")
};

pp$8.parseWithStatement = function(node) {
  if (this.strict) { this.raise(this.start, "'with' in strict mode"); }
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement("with");
  return this.finishNode(node, "WithStatement")
};

pp$8.parseEmptyStatement = function(node) {
  this.next();
  return this.finishNode(node, "EmptyStatement")
};

pp$8.parseLabeledStatement = function(node, maybeName, expr, context) {
  for (var i$1 = 0, list = this.labels; i$1 < list.length; i$1 += 1)
    {
    var label = list[i$1];

    if (label.name === maybeName)
      { this.raise(expr.start, "Label '" + maybeName + "' is already declared");
  } }
  var kind = this.type.isLoop ? "loop" : this.type === types$1._switch ? "switch" : null;
  for (var i = this.labels.length - 1; i >= 0; i--) {
    var label$1 = this.labels[i];
    if (label$1.statementStart === node.start) {
      // Update information about previous labels on this node
      label$1.statementStart = this.start;
      label$1.kind = kind;
    } else { break }
  }
  this.labels.push({name: maybeName, kind: kind, statementStart: this.start});
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement")
};

pp$8.parseExpressionStatement = function(node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement")
};

// Parse a semicolon-enclosed block of statements, handling `"use
// strict"` declarations when `allowStrict` is true (used for
// function bodies).

pp$8.parseBlock = function(createNewLexicalScope, node, exitStrict) {
  if ( createNewLexicalScope === void 0 ) createNewLexicalScope = true;
  if ( node === void 0 ) node = this.startNode();

  node.body = [];
  this.expect(types$1.braceL);
  if (createNewLexicalScope) { this.enterScope(0); }
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  if (exitStrict) { this.strict = false; }
  this.next();
  if (createNewLexicalScope) { this.exitScope(); }
  return this.finishNode(node, "BlockStatement")
};

// Parse a regular `for` loop. The disambiguation code in
// `parseStatement` will already have parsed the init statement or
// expression.

pp$8.parseFor = function(node, init) {
  node.init = init;
  this.expect(types$1.semi);
  node.test = this.type === types$1.semi ? null : this.parseExpression();
  this.expect(types$1.semi);
  node.update = this.type === types$1.parenR ? null : this.parseExpression();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, "ForStatement")
};

// Parse a `for`/`in` and `for`/`of` loop, which are almost
// same from parser's perspective.

pp$8.parseForIn = function(node, init) {
  var isForIn = this.type === types$1._in;
  this.next();

  if (
    init.type === "VariableDeclaration" &&
    init.declarations[0].init != null &&
    (
      !isForIn ||
      this.options.ecmaVersion < 8 ||
      this.strict ||
      init.kind !== "var" ||
      init.declarations[0].id.type !== "Identifier"
    )
  ) {
    this.raise(
      init.start,
      ((isForIn ? "for-in" : "for-of") + " loop variable declaration may not have an initializer")
    );
  }
  node.left = init;
  node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement")
};

// Parse a list of variable declarations.

pp$8.parseVar = function(node, isFor, kind, allowMissingInitializer) {
  node.declarations = [];
  node.kind = kind;
  for (;;) {
    var decl = this.startNode();
    this.parseVarId(decl, kind);
    if (this.eat(types$1.eq)) {
      decl.init = this.parseMaybeAssign(isFor);
    } else if (!allowMissingInitializer && kind === "const" && !(this.type === types$1._in || (this.options.ecmaVersion >= 6 && this.isContextual("of")))) {
      this.unexpected();
    } else if (!allowMissingInitializer && (kind === "using" || kind === "await using") && this.options.ecmaVersion >= 17 && this.type !== types$1._in && !this.isContextual("of")) {
      this.raise(this.lastTokEnd, ("Missing initializer in " + kind + " declaration"));
    } else if (!allowMissingInitializer && decl.id.type !== "Identifier" && !(isFor && (this.type === types$1._in || this.isContextual("of")))) {
      this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
    if (!this.eat(types$1.comma)) { break }
  }
  return node
};

pp$8.parseVarId = function(decl, kind) {
  decl.id = kind === "using" || kind === "await using"
    ? this.parseIdent()
    : this.parseBindingAtom();

  this.checkLValPattern(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
};

var FUNC_STATEMENT = 1, FUNC_HANGING_STATEMENT = 2, FUNC_NULLABLE_ID = 4;

// Parse a function declaration or literal (depending on the
// `statement & FUNC_STATEMENT`).

// Remove `allowExpressionBody` for 7.0.0, as it is only called with false
pp$8.parseFunction = function(node, statement, allowExpressionBody, isAsync, forInit) {
  this.initFunction(node);
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === types$1.star && (statement & FUNC_HANGING_STATEMENT))
      { this.unexpected(); }
    node.generator = this.eat(types$1.star);
  }
  if (this.options.ecmaVersion >= 8)
    { node.async = !!isAsync; }

  if (statement & FUNC_STATEMENT) {
    node.id = (statement & FUNC_NULLABLE_ID) && this.type !== types$1.name ? null : this.parseIdent();
    if (node.id && !(statement & FUNC_HANGING_STATEMENT))
      // If it is a regular function declaration in sloppy mode, then it is
      // subject to Annex B semantics (BIND_FUNCTION). Otherwise, the binding
      // mode depends on properties of the current scope (see
      // treatFunctionsAsVar).
      { this.checkLValSimple(node.id, (this.strict || node.generator || node.async) ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION); }
  }

  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(node.async, node.generator));

  if (!(statement & FUNC_STATEMENT))
    { node.id = this.type === types$1.name ? this.parseIdent() : null; }

  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody, false, forInit);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, (statement & FUNC_STATEMENT) ? "FunctionDeclaration" : "FunctionExpression")
};

pp$8.parseFunctionParams = function(node) {
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
};

// Parse a class declaration or literal (depending on the
// `isStatement` parameter).

pp$8.parseClass = function(node, isStatement) {
  this.next();

  // ecma-262 14.6 Class Definitions
  // A class definition is always strict mode code.
  var oldStrict = this.strict;
  this.strict = true;

  this.parseClassId(node, isStatement);
  this.parseClassSuper(node);
  var privateNameMap = this.enterClassBody();
  var classBody = this.startNode();
  var hadConstructor = false;
  classBody.body = [];
  this.expect(types$1.braceL);
  while (this.type !== types$1.braceR) {
    var element = this.parseClassElement(node.superClass !== null);
    if (element) {
      classBody.body.push(element);
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) { this.raiseRecoverable(element.start, "Duplicate constructor in the same class"); }
        hadConstructor = true;
      } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
        this.raiseRecoverable(element.key.start, ("Identifier '#" + (element.key.name) + "' has already been declared"));
      }
    }
  }
  this.strict = oldStrict;
  this.next();
  node.body = this.finishNode(classBody, "ClassBody");
  this.exitClassBody();
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression")
};

pp$8.parseClassElement = function(constructorAllowsSuper) {
  if (this.eat(types$1.semi)) { return null }

  var ecmaVersion = this.options.ecmaVersion;
  var node = this.startNode();
  var keyName = "";
  var isGenerator = false;
  var isAsync = false;
  var kind = "method";
  var isStatic = false;

  if (this.eatContextual("static")) {
    // Parse static init block
    if (ecmaVersion >= 13 && this.eat(types$1.braceL)) {
      this.parseClassStaticBlock(node);
      return node
    }
    if (this.isClassElementNameStart() || this.type === types$1.star) {
      isStatic = true;
    } else {
      keyName = "static";
    }
  }
  node.static = isStatic;
  if (!keyName && ecmaVersion >= 8 && this.eatContextual("async")) {
    if ((this.isClassElementNameStart() || this.type === types$1.star) && !this.canInsertSemicolon()) {
      isAsync = true;
    } else {
      keyName = "async";
    }
  }
  if (!keyName && (ecmaVersion >= 9 || !isAsync) && this.eat(types$1.star)) {
    isGenerator = true;
  }
  if (!keyName && !isAsync && !isGenerator) {
    var lastValue = this.value;
    if (this.eatContextual("get") || this.eatContextual("set")) {
      if (this.isClassElementNameStart()) {
        kind = lastValue;
      } else {
        keyName = lastValue;
      }
    }
  }

  // Parse element name
  if (keyName) {
    // 'async', 'get', 'set', or 'static' were not a keyword contextually.
    // The last token is any of those. Make it the element name.
    node.computed = false;
    node.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc);
    node.key.name = keyName;
    this.finishNode(node.key, "Identifier");
  } else {
    this.parseClassElementName(node);
  }

  // Parse element value
  if (ecmaVersion < 13 || this.type === types$1.parenL || kind !== "method" || isGenerator || isAsync) {
    var isConstructor = !node.static && checkKeyName(node, "constructor");
    var allowsDirectSuper = isConstructor && constructorAllowsSuper;
    // Couldn't move this check into the 'parseClassMethod' method for backward compatibility.
    if (isConstructor && kind !== "method") { this.raise(node.key.start, "Constructor can't have get/set modifier"); }
    node.kind = isConstructor ? "constructor" : kind;
    this.parseClassMethod(node, isGenerator, isAsync, allowsDirectSuper);
  } else {
    this.parseClassField(node);
  }

  return node
};

pp$8.isClassElementNameStart = function() {
  return (
    this.type === types$1.name ||
    this.type === types$1.privateId ||
    this.type === types$1.num ||
    this.type === types$1.string ||
    this.type === types$1.bracketL ||
    this.type.keyword
  )
};

pp$8.parseClassElementName = function(element) {
  if (this.type === types$1.privateId) {
    if (this.value === "constructor") {
      this.raise(this.start, "Classes can't have an element named '#constructor'");
    }
    element.computed = false;
    element.key = this.parsePrivateIdent();
  } else {
    this.parsePropertyName(element);
  }
};

pp$8.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
  // Check key and flags
  var key = method.key;
  if (method.kind === "constructor") {
    if (isGenerator) { this.raise(key.start, "Constructor can't be a generator"); }
    if (isAsync) { this.raise(key.start, "Constructor can't be an async method"); }
  } else if (method.static && checkKeyName(method, "prototype")) {
    this.raise(key.start, "Classes may not have a static property named prototype");
  }

  // Parse value
  var value = method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);

  // Check value
  if (method.kind === "get" && value.params.length !== 0)
    { this.raiseRecoverable(value.start, "getter should have no params"); }
  if (method.kind === "set" && value.params.length !== 1)
    { this.raiseRecoverable(value.start, "setter should have exactly one param"); }
  if (method.kind === "set" && value.params[0].type === "RestElement")
    { this.raiseRecoverable(value.params[0].start, "Setter cannot use rest params"); }

  return this.finishNode(method, "MethodDefinition")
};

pp$8.parseClassField = function(field) {
  if (checkKeyName(field, "constructor")) {
    this.raise(field.key.start, "Classes can't have a field named 'constructor'");
  } else if (field.static && checkKeyName(field, "prototype")) {
    this.raise(field.key.start, "Classes can't have a static field named 'prototype'");
  }

  if (this.eat(types$1.eq)) {
    // To raise SyntaxError if 'arguments' exists in the initializer.
    this.enterScope(SCOPE_CLASS_FIELD_INIT | SCOPE_SUPER);
    field.value = this.parseMaybeAssign();
    this.exitScope();
  } else {
    field.value = null;
  }
  this.semicolon();

  return this.finishNode(field, "PropertyDefinition")
};

pp$8.parseClassStaticBlock = function(node) {
  node.body = [];

  var oldLabels = this.labels;
  this.labels = [];
  this.enterScope(SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER);
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  this.next();
  this.exitScope();
  this.labels = oldLabels;

  return this.finishNode(node, "StaticBlock")
};

pp$8.parseClassId = function(node, isStatement) {
  if (this.type === types$1.name) {
    node.id = this.parseIdent();
    if (isStatement)
      { this.checkLValSimple(node.id, BIND_LEXICAL, false); }
  } else {
    if (isStatement === true)
      { this.unexpected(); }
    node.id = null;
  }
};

pp$8.parseClassSuper = function(node) {
  node.superClass = this.eat(types$1._extends) ? this.parseExprSubscripts(null, false) : null;
};

pp$8.enterClassBody = function() {
  var element = {declared: Object.create(null), used: []};
  this.privateNameStack.push(element);
  return element.declared
};

pp$8.exitClassBody = function() {
  var ref = this.privateNameStack.pop();
  var declared = ref.declared;
  var used = ref.used;
  if (!this.options.checkPrivateFields) { return }
  var len = this.privateNameStack.length;
  var parent = len === 0 ? null : this.privateNameStack[len - 1];
  for (var i = 0; i < used.length; ++i) {
    var id = used[i];
    if (!hasOwn(declared, id.name)) {
      if (parent) {
        parent.used.push(id);
      } else {
        this.raiseRecoverable(id.start, ("Private field '#" + (id.name) + "' must be declared in an enclosing class"));
      }
    }
  }
};

function isPrivateNameConflicted(privateNameMap, element) {
  var name = element.key.name;
  var curr = privateNameMap[name];

  var next = "true";
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) {
    next = (element.static ? "s" : "i") + element.kind;
  }

  // `class { get #a(){}; static set #a(_){} }` is also conflict.
  if (
    curr === "iget" && next === "iset" ||
    curr === "iset" && next === "iget" ||
    curr === "sget" && next === "sset" ||
    curr === "sset" && next === "sget"
  ) {
    privateNameMap[name] = "true";
    return false
  } else if (!curr) {
    privateNameMap[name] = next;
    return false
  } else {
    return true
  }
}

function checkKeyName(node, name) {
  var computed = node.computed;
  var key = node.key;
  return !computed && (
    key.type === "Identifier" && key.name === name ||
    key.type === "Literal" && key.value === name
  )
}

// Parses module export declaration.

pp$8.parseExportAllDeclaration = function(node, exports$1) {
  if (this.options.ecmaVersion >= 11) {
    if (this.eatContextual("as")) {
      node.exported = this.parseModuleExportName();
      this.checkExport(exports$1, node.exported, this.lastTokStart);
    } else {
      node.exported = null;
    }
  }
  this.expectContextual("from");
  if (this.type !== types$1.string) { this.unexpected(); }
  node.source = this.parseExprAtom();
  if (this.options.ecmaVersion >= 16)
    { node.attributes = this.parseWithClause(); }
  this.semicolon();
  return this.finishNode(node, "ExportAllDeclaration")
};

pp$8.parseExport = function(node, exports$1) {
  this.next();
  // export * from '...'
  if (this.eat(types$1.star)) {
    return this.parseExportAllDeclaration(node, exports$1)
  }
  if (this.eat(types$1._default)) { // export default ...
    this.checkExport(exports$1, "default", this.lastTokStart);
    node.declaration = this.parseExportDefaultDeclaration();
    return this.finishNode(node, "ExportDefaultDeclaration")
  }
  // export var|const|let|function|class ...
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseExportDeclaration(node);
    if (node.declaration.type === "VariableDeclaration")
      { this.checkVariableExport(exports$1, node.declaration.declarations); }
    else
      { this.checkExport(exports$1, node.declaration.id, node.declaration.id.start); }
    node.specifiers = [];
    node.source = null;
    if (this.options.ecmaVersion >= 16)
      { node.attributes = []; }
  } else { // export { x, y as z } [from '...']
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers(exports$1);
    if (this.eatContextual("from")) {
      if (this.type !== types$1.string) { this.unexpected(); }
      node.source = this.parseExprAtom();
      if (this.options.ecmaVersion >= 16)
        { node.attributes = this.parseWithClause(); }
    } else {
      for (var i = 0, list = node.specifiers; i < list.length; i += 1) {
        // check for keywords used as local names
        var spec = list[i];

        this.checkUnreserved(spec.local);
        // check if export is defined
        this.checkLocalExport(spec.local);

        if (spec.local.type === "Literal") {
          this.raise(spec.local.start, "A string literal cannot be used as an exported binding without `from`.");
        }
      }

      node.source = null;
      if (this.options.ecmaVersion >= 16)
        { node.attributes = []; }
    }
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration")
};

pp$8.parseExportDeclaration = function(node) {
  return this.parseStatement(null)
};

pp$8.parseExportDefaultDeclaration = function() {
  var isAsync;
  if (this.type === types$1._function || (isAsync = this.isAsyncFunction())) {
    var fNode = this.startNode();
    this.next();
    if (isAsync) { this.next(); }
    return this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync)
  } else if (this.type === types$1._class) {
    var cNode = this.startNode();
    return this.parseClass(cNode, "nullableID")
  } else {
    var declaration = this.parseMaybeAssign();
    this.semicolon();
    return declaration
  }
};

pp$8.checkExport = function(exports$1, name, pos) {
  if (!exports$1) { return }
  if (typeof name !== "string")
    { name = name.type === "Identifier" ? name.name : name.value; }
  if (hasOwn(exports$1, name))
    { this.raiseRecoverable(pos, "Duplicate export '" + name + "'"); }
  exports$1[name] = true;
};

pp$8.checkPatternExport = function(exports$1, pat) {
  var type = pat.type;
  if (type === "Identifier")
    { this.checkExport(exports$1, pat, pat.start); }
  else if (type === "ObjectPattern")
    { for (var i = 0, list = pat.properties; i < list.length; i += 1)
      {
        var prop = list[i];

        this.checkPatternExport(exports$1, prop);
      } }
  else if (type === "ArrayPattern")
    { for (var i$1 = 0, list$1 = pat.elements; i$1 < list$1.length; i$1 += 1) {
      var elt = list$1[i$1];

        if (elt) { this.checkPatternExport(exports$1, elt); }
    } }
  else if (type === "Property")
    { this.checkPatternExport(exports$1, pat.value); }
  else if (type === "AssignmentPattern")
    { this.checkPatternExport(exports$1, pat.left); }
  else if (type === "RestElement")
    { this.checkPatternExport(exports$1, pat.argument); }
};

pp$8.checkVariableExport = function(exports$1, decls) {
  if (!exports$1) { return }
  for (var i = 0, list = decls; i < list.length; i += 1)
    {
    var decl = list[i];

    this.checkPatternExport(exports$1, decl.id);
  }
};

pp$8.shouldParseExportStatement = function() {
  return this.type.keyword === "var" ||
    this.type.keyword === "const" ||
    this.type.keyword === "class" ||
    this.type.keyword === "function" ||
    this.isLet() ||
    this.isAsyncFunction()
};

// Parses a comma-separated list of module exports.

pp$8.parseExportSpecifier = function(exports$1) {
  var node = this.startNode();
  node.local = this.parseModuleExportName();

  node.exported = this.eatContextual("as") ? this.parseModuleExportName() : node.local;
  this.checkExport(
    exports$1,
    node.exported,
    node.exported.start
  );

  return this.finishNode(node, "ExportSpecifier")
};

pp$8.parseExportSpecifiers = function(exports$1) {
  var nodes = [], first = true;
  // export { x, y as z } [from '...']
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) { break }
    } else { first = false; }

    nodes.push(this.parseExportSpecifier(exports$1));
  }
  return nodes
};

// Parses import declaration.

pp$8.parseImport = function(node) {
  this.next();

  // import '...'
  if (this.type === types$1.string) {
    node.specifiers = empty$1;
    node.source = this.parseExprAtom();
  } else {
    node.specifiers = this.parseImportSpecifiers();
    this.expectContextual("from");
    node.source = this.type === types$1.string ? this.parseExprAtom() : this.unexpected();
  }
  if (this.options.ecmaVersion >= 16)
    { node.attributes = this.parseWithClause(); }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration")
};

// Parses a comma-separated list of module imports.

pp$8.parseImportSpecifier = function() {
  var node = this.startNode();
  node.imported = this.parseModuleExportName();

  if (this.eatContextual("as")) {
    node.local = this.parseIdent();
  } else {
    this.checkUnreserved(node.imported);
    node.local = node.imported;
  }
  this.checkLValSimple(node.local, BIND_LEXICAL);

  return this.finishNode(node, "ImportSpecifier")
};

pp$8.parseImportDefaultSpecifier = function() {
  // import defaultObj, { x, y as z } from '...'
  var node = this.startNode();
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportDefaultSpecifier")
};

pp$8.parseImportNamespaceSpecifier = function() {
  var node = this.startNode();
  this.next();
  this.expectContextual("as");
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportNamespaceSpecifier")
};

pp$8.parseImportSpecifiers = function() {
  var nodes = [], first = true;
  if (this.type === types$1.name) {
    nodes.push(this.parseImportDefaultSpecifier());
    if (!this.eat(types$1.comma)) { return nodes }
  }
  if (this.type === types$1.star) {
    nodes.push(this.parseImportNamespaceSpecifier());
    return nodes
  }
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) { break }
    } else { first = false; }

    nodes.push(this.parseImportSpecifier());
  }
  return nodes
};

pp$8.parseWithClause = function() {
  var nodes = [];
  if (!this.eat(types$1._with)) {
    return nodes
  }
  this.expect(types$1.braceL);
  var attributeKeys = {};
  var first = true;
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) { break }
    } else { first = false; }

    var attr = this.parseImportAttribute();
    var keyName = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
    if (hasOwn(attributeKeys, keyName))
      { this.raiseRecoverable(attr.key.start, "Duplicate attribute key '" + keyName + "'"); }
    attributeKeys[keyName] = true;
    nodes.push(attr);
  }
  return nodes
};

pp$8.parseImportAttribute = function() {
  var node = this.startNode();
  node.key = this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
  this.expect(types$1.colon);
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.value = this.parseExprAtom();
  return this.finishNode(node, "ImportAttribute")
};

pp$8.parseModuleExportName = function() {
  if (this.options.ecmaVersion >= 13 && this.type === types$1.string) {
    var stringLiteral = this.parseLiteral(this.value);
    if (loneSurrogate.test(stringLiteral.value)) {
      this.raise(stringLiteral.start, "An export name cannot include a lone surrogate.");
    }
    return stringLiteral
  }
  return this.parseIdent(true)
};

// Set `ExpressionStatement#directive` property for directive prologues.
pp$8.adaptDirectivePrologue = function(statements) {
  for (var i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1);
  }
};
pp$8.isDirectiveCandidate = function(statement) {
  return (
    this.options.ecmaVersion >= 5 &&
    statement.type === "ExpressionStatement" &&
    statement.expression.type === "Literal" &&
    typeof statement.expression.value === "string" &&
    // Reject parenthesized strings.
    (this.input[statement.start] === "\"" || this.input[statement.start] === "'")
  )
};

var pp$7 = Parser.prototype;

// Convert existing expression atom to assignable pattern
// if possible.

pp$7.toAssignable = function(node, isBinding, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
    case "Identifier":
      if (this.inAsync && node.name === "await")
        { this.raise(node.start, "Cannot use 'await' as identifier inside an async function"); }
      break

    case "ObjectPattern":
    case "ArrayPattern":
    case "AssignmentPattern":
    case "RestElement":
      break

    case "ObjectExpression":
      node.type = "ObjectPattern";
      if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
      for (var i = 0, list = node.properties; i < list.length; i += 1) {
        var prop = list[i];

      this.toAssignable(prop, isBinding);
        // Early error:
        //   AssignmentRestProperty[Yield, Await] :
        //     `...` DestructuringAssignmentTarget[Yield, Await]
        //
        //   It is a Syntax Error if |DestructuringAssignmentTarget| is an |ArrayLiteral| or an |ObjectLiteral|.
        if (
          prop.type === "RestElement" &&
          (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")
        ) {
          this.raise(prop.argument.start, "Unexpected token");
        }
      }
      break

    case "Property":
      // AssignmentProperty has type === "Property"
      if (node.kind !== "init") { this.raise(node.key.start, "Object pattern can't contain getter or setter"); }
      this.toAssignable(node.value, isBinding);
      break

    case "ArrayExpression":
      node.type = "ArrayPattern";
      if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
      this.toAssignableList(node.elements, isBinding);
      break

    case "SpreadElement":
      node.type = "RestElement";
      this.toAssignable(node.argument, isBinding);
      if (node.argument.type === "AssignmentPattern")
        { this.raise(node.argument.start, "Rest elements cannot have a default value"); }
      break

    case "AssignmentExpression":
      if (node.operator !== "=") { this.raise(node.left.end, "Only '=' operator can be used for specifying default value."); }
      node.type = "AssignmentPattern";
      delete node.operator;
      this.toAssignable(node.left, isBinding);
      break

    case "ParenthesizedExpression":
      this.toAssignable(node.expression, isBinding, refDestructuringErrors);
      break

    case "ChainExpression":
      this.raiseRecoverable(node.start, "Optional chaining cannot appear in left-hand side");
      break

    case "MemberExpression":
      if (!isBinding) { break }

    default:
      this.raise(node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
  return node
};

// Convert list of expression atoms to binding list.

pp$7.toAssignableList = function(exprList, isBinding) {
  var end = exprList.length;
  for (var i = 0; i < end; i++) {
    var elt = exprList[i];
    if (elt) { this.toAssignable(elt, isBinding); }
  }
  if (end) {
    var last = exprList[end - 1];
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier")
      { this.unexpected(last.argument.start); }
  }
  return exprList
};

// Parses spread element.

pp$7.parseSpread = function(refDestructuringErrors) {
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
  return this.finishNode(node, "SpreadElement")
};

pp$7.parseRestBinding = function() {
  var node = this.startNode();
  this.next();

  // RestElement inside of a function parameter must be an identifier
  if (this.options.ecmaVersion === 6 && this.type !== types$1.name)
    { this.unexpected(); }

  node.argument = this.parseBindingAtom();

  return this.finishNode(node, "RestElement")
};

// Parses lvalue (assignable) atom.

pp$7.parseBindingAtom = function() {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
    case types$1.bracketL:
      var node = this.startNode();
      this.next();
      node.elements = this.parseBindingList(types$1.bracketR, true, true);
      return this.finishNode(node, "ArrayPattern")

    case types$1.braceL:
      return this.parseObj(true)
    }
  }
  return this.parseIdent()
};

pp$7.parseBindingList = function(close, allowEmpty, allowTrailingComma, allowModifiers) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (first) { first = false; }
    else { this.expect(types$1.comma); }
    if (allowEmpty && this.type === types$1.comma) {
      elts.push(null);
    } else if (allowTrailingComma && this.afterTrailingComma(close)) {
      break
    } else if (this.type === types$1.ellipsis) {
      var rest = this.parseRestBinding();
      this.parseBindingListItem(rest);
      elts.push(rest);
      if (this.type === types$1.comma) { this.raiseRecoverable(this.start, "Comma is not permitted after the rest element"); }
      this.expect(close);
      break
    } else {
      elts.push(this.parseAssignableListItem(allowModifiers));
    }
  }
  return elts
};

pp$7.parseAssignableListItem = function(allowModifiers) {
  var elem = this.parseMaybeDefault(this.start, this.startLoc);
  this.parseBindingListItem(elem);
  return elem
};

pp$7.parseBindingListItem = function(param) {
  return param
};

// Parses assignment pattern around given atom if possible.

pp$7.parseMaybeDefault = function(startPos, startLoc, left) {
  left = left || this.parseBindingAtom();
  if (this.options.ecmaVersion < 6 || !this.eat(types$1.eq)) { return left }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.right = this.parseMaybeAssign();
  return this.finishNode(node, "AssignmentPattern")
};

// The following three functions all verify that a node is an lvalue —
// something that can be bound, or assigned to. In order to do so, they perform
// a variety of checks:
//
// - Check that none of the bound/assigned-to identifiers are reserved words.
// - Record name declarations for bindings in the appropriate scope.
// - Check duplicate argument names, if checkClashes is set.
//
// If a complex binding pattern is encountered (e.g., object and array
// destructuring), the entire pattern is recursively checked.
//
// There are three versions of checkLVal*() appropriate for different
// circumstances:
//
// - checkLValSimple() shall be used if the syntactic construct supports
//   nothing other than identifiers and member expressions. Parenthesized
//   expressions are also correctly handled. This is generally appropriate for
//   constructs for which the spec says
//
//   > It is a Syntax Error if AssignmentTargetType of [the production] is not
//   > simple.
//
//   It is also appropriate for checking if an identifier is valid and not
//   defined elsewhere, like import declarations or function/class identifiers.
//
//   Examples where this is used include:
//     a += …;
//     import a from '…';
//   where a is the node to be checked.
//
// - checkLValPattern() shall be used if the syntactic construct supports
//   anything checkLValSimple() supports, as well as object and array
//   destructuring patterns. This is generally appropriate for constructs for
//   which the spec says
//
//   > It is a Syntax Error if [the production] is neither an ObjectLiteral nor
//   > an ArrayLiteral and AssignmentTargetType of [the production] is not
//   > simple.
//
//   Examples where this is used include:
//     (a = …);
//     const a = …;
//     try { … } catch (a) { … }
//   where a is the node to be checked.
//
// - checkLValInnerPattern() shall be used if the syntactic construct supports
//   anything checkLValPattern() supports, as well as default assignment
//   patterns, rest elements, and other constructs that may appear within an
//   object or array destructuring pattern.
//
//   As a special case, function parameters also use checkLValInnerPattern(),
//   as they also support defaults and rest constructs.
//
// These functions deliberately support both assignment and binding constructs,
// as the logic for both is exceedingly similar. If the node is the target of
// an assignment, then bindingType should be set to BIND_NONE. Otherwise, it
// should be set to the appropriate BIND_* constant, like BIND_VAR or
// BIND_LEXICAL.
//
// If the function is called with a non-BIND_NONE bindingType, then
// additionally a checkClashes object may be specified to allow checking for
// duplicate argument names. checkClashes is ignored if the provided construct
// is an assignment (i.e., bindingType is BIND_NONE).

pp$7.checkLValSimple = function(expr, bindingType, checkClashes) {
  if ( bindingType === void 0 ) bindingType = BIND_NONE;

  var isBind = bindingType !== BIND_NONE;

  switch (expr.type) {
  case "Identifier":
    if (this.strict && this.reservedWordsStrictBind.test(expr.name))
      { this.raiseRecoverable(expr.start, (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode"); }
    if (isBind) {
      if (bindingType === BIND_LEXICAL && expr.name === "let")
        { this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name"); }
      if (checkClashes) {
        if (hasOwn(checkClashes, expr.name))
          { this.raiseRecoverable(expr.start, "Argument name clash"); }
        checkClashes[expr.name] = true;
      }
      if (bindingType !== BIND_OUTSIDE) { this.declareName(expr.name, bindingType, expr.start); }
    }
    break

  case "ChainExpression":
    this.raiseRecoverable(expr.start, "Optional chaining cannot appear in left-hand side");
    break

  case "MemberExpression":
    if (isBind) { this.raiseRecoverable(expr.start, "Binding member expression"); }
    break

  case "ParenthesizedExpression":
    if (isBind) { this.raiseRecoverable(expr.start, "Binding parenthesized expression"); }
    return this.checkLValSimple(expr.expression, bindingType, checkClashes)

  default:
    this.raise(expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
};

pp$7.checkLValPattern = function(expr, bindingType, checkClashes) {
  if ( bindingType === void 0 ) bindingType = BIND_NONE;

  switch (expr.type) {
  case "ObjectPattern":
    for (var i = 0, list = expr.properties; i < list.length; i += 1) {
      var prop = list[i];

    this.checkLValInnerPattern(prop, bindingType, checkClashes);
    }
    break

  case "ArrayPattern":
    for (var i$1 = 0, list$1 = expr.elements; i$1 < list$1.length; i$1 += 1) {
      var elem = list$1[i$1];

    if (elem) { this.checkLValInnerPattern(elem, bindingType, checkClashes); }
    }
    break

  default:
    this.checkLValSimple(expr, bindingType, checkClashes);
  }
};

pp$7.checkLValInnerPattern = function(expr, bindingType, checkClashes) {
  if ( bindingType === void 0 ) bindingType = BIND_NONE;

  switch (expr.type) {
  case "Property":
    // AssignmentProperty has type === "Property"
    this.checkLValInnerPattern(expr.value, bindingType, checkClashes);
    break

  case "AssignmentPattern":
    this.checkLValPattern(expr.left, bindingType, checkClashes);
    break

  case "RestElement":
    this.checkLValPattern(expr.argument, bindingType, checkClashes);
    break

  default:
    this.checkLValPattern(expr, bindingType, checkClashes);
  }
};

// The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design


var TokContext = function TokContext(token, isExpr, preserveSpace, override, generator) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
  this.generator = !!generator;
};

var types = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, function (p) { return p.tryReadTemplateToken(); }),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true)
};

var pp$6 = Parser.prototype;

pp$6.initialContext = function() {
  return [types.b_stat]
};

pp$6.curContext = function() {
  return this.context[this.context.length - 1]
};

pp$6.braceIsBlock = function(prevType) {
  var parent = this.curContext();
  if (parent === types.f_expr || parent === types.f_stat)
    { return true }
  if (prevType === types$1.colon && (parent === types.b_stat || parent === types.b_expr))
    { return !parent.isExpr }

  // The check for `tt.name && exprAllowed` detects whether we are
  // after a `yield` or `of` construct. See the `updateContext` for
  // `tt.name`.
  if (prevType === types$1._return || prevType === types$1.name && this.exprAllowed)
    { return lineBreak.test(this.input.slice(this.lastTokEnd, this.start)) }
  if (prevType === types$1._else || prevType === types$1.semi || prevType === types$1.eof || prevType === types$1.parenR || prevType === types$1.arrow)
    { return true }
  if (prevType === types$1.braceL)
    { return parent === types.b_stat }
  if (prevType === types$1._var || prevType === types$1._const || prevType === types$1.name)
    { return false }
  return !this.exprAllowed
};

pp$6.inGeneratorContext = function() {
  for (var i = this.context.length - 1; i >= 1; i--) {
    var context = this.context[i];
    if (context.token === "function")
      { return context.generator }
  }
  return false
};

pp$6.updateContext = function(prevType) {
  var update, type = this.type;
  if (type.keyword && prevType === types$1.dot)
    { this.exprAllowed = false; }
  else if (update = type.updateContext)
    { update.call(this, prevType); }
  else
    { this.exprAllowed = type.beforeExpr; }
};

// Used to handle edge cases when token context could not be inferred correctly during tokenization phase

pp$6.overrideContext = function(tokenCtx) {
  if (this.curContext() !== tokenCtx) {
    this.context[this.context.length - 1] = tokenCtx;
  }
};

// Token-specific context update code

types$1.parenR.updateContext = types$1.braceR.updateContext = function() {
  if (this.context.length === 1) {
    this.exprAllowed = true;
    return
  }
  var out = this.context.pop();
  if (out === types.b_stat && this.curContext().token === "function") {
    out = this.context.pop();
  }
  this.exprAllowed = !out.isExpr;
};

types$1.braceL.updateContext = function(prevType) {
  this.context.push(this.braceIsBlock(prevType) ? types.b_stat : types.b_expr);
  this.exprAllowed = true;
};

types$1.dollarBraceL.updateContext = function() {
  this.context.push(types.b_tmpl);
  this.exprAllowed = true;
};

types$1.parenL.updateContext = function(prevType) {
  var statementParens = prevType === types$1._if || prevType === types$1._for || prevType === types$1._with || prevType === types$1._while;
  this.context.push(statementParens ? types.p_stat : types.p_expr);
  this.exprAllowed = true;
};

types$1.incDec.updateContext = function() {
  // tokExprAllowed stays unchanged
};

types$1._function.updateContext = types$1._class.updateContext = function(prevType) {
  if (prevType.beforeExpr && prevType !== types$1._else &&
      !(prevType === types$1.semi && this.curContext() !== types.p_stat) &&
      !(prevType === types$1._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) &&
      !((prevType === types$1.colon || prevType === types$1.braceL) && this.curContext() === types.b_stat))
    { this.context.push(types.f_expr); }
  else
    { this.context.push(types.f_stat); }
  this.exprAllowed = false;
};

types$1.colon.updateContext = function() {
  if (this.curContext().token === "function") { this.context.pop(); }
  this.exprAllowed = true;
};

types$1.backQuote.updateContext = function() {
  if (this.curContext() === types.q_tmpl)
    { this.context.pop(); }
  else
    { this.context.push(types.q_tmpl); }
  this.exprAllowed = false;
};

types$1.star.updateContext = function(prevType) {
  if (prevType === types$1._function) {
    var index = this.context.length - 1;
    if (this.context[index] === types.f_expr)
      { this.context[index] = types.f_expr_gen; }
    else
      { this.context[index] = types.f_gen; }
  }
  this.exprAllowed = true;
};

types$1.name.updateContext = function(prevType) {
  var allowed = false;
  if (this.options.ecmaVersion >= 6 && prevType !== types$1.dot) {
    if (this.value === "of" && !this.exprAllowed ||
        this.value === "yield" && this.inGeneratorContext())
      { allowed = true; }
  }
  this.exprAllowed = allowed;
};

// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser


var pp$5 = Parser.prototype;

// Check if property name clashes with already added.
// Object/class getters and setters are not allowed to clash —
// either with each other or with an init property — and in
// strict mode, init properties are also not allowed to be repeated.

pp$5.checkPropClash = function(prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement")
    { return }
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand))
    { return }
  var key = prop.key;
  var name;
  switch (key.type) {
  case "Identifier": name = key.name; break
  case "Literal": name = String(key.value); break
  default: return
  }
  var kind = prop.kind;
  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) {
            refDestructuringErrors.doubleProto = key.start;
          }
        } else {
          this.raiseRecoverable(key.start, "Redefinition of __proto__ property");
        }
      }
      propHash.proto = true;
    }
    return
  }
  name = "$" + name;
  var other = propHash[name];
  if (other) {
    var redefinition;
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition)
      { this.raiseRecoverable(key.start, "Redefinition of property"); }
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    };
  }
  other[kind] = true;
};

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function(s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initalization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).

pp$5.parseExpression = function(forInit, refDestructuringErrors) {
  var this$1$1 = this;

  return this.catchStackOverflow(function () {
    var startPos = this$1$1.start, startLoc = this$1$1.startLoc;
    var expr = this$1$1.parseMaybeAssign(forInit, refDestructuringErrors);
    if (this$1$1.type === types$1.comma) {
      var node = this$1$1.startNodeAt(startPos, startLoc);
      node.expressions = [expr];
      while (this$1$1.eat(types$1.comma)) { node.expressions.push(this$1$1.parseMaybeAssign(forInit, refDestructuringErrors)); }
      return this$1$1.finishNode(node, "SequenceExpression")
    }
    return expr
  })
};

// Parse an assignment expression. This includes applications of
// operators like `+=`.

pp$5.parseMaybeAssign = function(forInit, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) { return this.parseYield(forInit) }
    // The tokenizer will assume an expression is allowed after
    // `yield`, but this isn't that kind of yield
    else { this.exprAllowed = false; }
  }

  var ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    oldDoubleProto = refDestructuringErrors.doubleProto;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
  } else {
    refDestructuringErrors = new DestructuringErrors;
    ownDestructuringErrors = true;
  }

  var startPos = this.start, startLoc = this.startLoc;
  if (this.type === types$1.parenL || this.type === types$1.name) {
    this.potentialArrowAt = this.start;
    this.potentialArrowInForAwait = forInit === "await";
  }
  var left = this.parseMaybeConditional(forInit, refDestructuringErrors);
  if (afterLeftParse) { left = afterLeftParse.call(this, left, startPos, startLoc); }
  if (this.type.isAssign) {
    var node = this.startNodeAt(startPos, startLoc);
    node.operator = this.value;
    if (this.type === types$1.eq)
      { left = this.toAssignable(left, false, refDestructuringErrors); }
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
      // reset these when detected inside this expression
      if (refDestructuringErrors.shorthandAssign >= left.start) { refDestructuringErrors.shorthandAssign = -1; }
      if (refDestructuringErrors.doubleProto >= left.start) { refDestructuringErrors.doubleProto = -1; }
    }
    if (this.type === types$1.eq)
      { this.checkLValPattern(left); }
    else
      { this.checkLValSimple(left); }
    node.left = left;
    this.next();
    node.right = this.parseMaybeAssign(forInit);
    if (oldDoubleProto > -1) { refDestructuringErrors.doubleProto = oldDoubleProto; }
    return this.finishNode(node, "AssignmentExpression")
  } else {
    if (ownDestructuringErrors) { this.checkExpressionErrors(refDestructuringErrors, true); }
  }
  if (oldParenAssign > -1) { refDestructuringErrors.parenthesizedAssign = oldParenAssign; }
  if (oldTrailingComma > -1) { refDestructuringErrors.trailingComma = oldTrailingComma; }
  return left
};

// Parse a ternary conditional (`?:`) operator.

pp$5.parseMaybeConditional = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprOps(forInit, refDestructuringErrors);
  if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
  if (!(expr.type === "ArrowFunctionExpression" && expr.start === startPos) && this.eat(types$1.question)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(types$1.colon);
    node.alternate = this.parseMaybeAssign(forInit);
    return this.finishNode(node, "ConditionalExpression")
  }
  return expr
};

// Start the precedence parser.

pp$5.parseExprOps = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeUnary(refDestructuringErrors, false, false, forInit);
  if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, forInit)
};

// Parse binary operators with the operator precedence parsing
// algorithm. `left` is the left-hand side of the operator.
// `minPrec` provides context that allows the function to stop and
// defer further parser to one of its callers when it encounters an
// operator that has a lower precedence than the set it is parsing.

pp$5.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, forInit) {
  var prec = this.type.binop;
  if (prec != null && (!forInit || this.type !== types$1._in)) {
    if (prec > minPrec) {
      var logical = this.type === types$1.logicalOR || this.type === types$1.logicalAND;
      var coalesce = this.type === types$1.coalesce;
      if (coalesce) {
        // Handle the precedence of `tt.coalesce` as equal to the range of logical expressions.
        // In other words, `node.right` shouldn't contain logical expressions in order to check the mixed error.
        prec = types$1.logicalAND.binop;
      }
      var op = this.value;
      this.next();
      var startPos = this.start, startLoc = this.startLoc;
      var right = this.parseExprOp(this.parseMaybeUnary(null, false, false, forInit), startPos, startLoc, prec, forInit);
      var node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce);
      if ((logical && this.type === types$1.coalesce) || (coalesce && (this.type === types$1.logicalOR || this.type === types$1.logicalAND))) {
        this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
      }
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, forInit)
    }
  }
  return left
};

pp$5.buildBinary = function(startPos, startLoc, left, right, op, logical) {
  if (right.type === "PrivateIdentifier") { this.raise(right.start, "Private identifier can only be left side of binary expression"); }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression")
};

// Parse unary operators, both prefix and postfix.

pp$5.parseMaybeUnary = function(refDestructuringErrors, sawUnary, incDec, forInit) {
  var startPos = this.start, startLoc = this.startLoc, expr;
  if (this.isContextual("await") && this.canAwait) {
    expr = this.parseAwait(forInit);
    sawUnary = true;
  } else if (this.type.prefix) {
    var node = this.startNode(), update = this.type === types$1.incDec;
    node.operator = this.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(null, true, update, forInit);
    this.checkExpressionErrors(refDestructuringErrors, true);
    if (update) { this.checkLValSimple(node.argument); }
    else if (this.strict && node.operator === "delete" && isLocalVariableAccess(node.argument))
      { this.raiseRecoverable(node.start, "Deleting local variable in strict mode"); }
    else if (node.operator === "delete" && isPrivateFieldAccess(node.argument))
      { this.raiseRecoverable(node.start, "Private fields can not be deleted"); }
    else { sawUnary = true; }
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else if (!sawUnary && this.type === types$1.privateId) {
    if ((forInit || this.privateNameStack.length === 0) && this.options.checkPrivateFields) { this.unexpected(); }
    expr = this.parsePrivateIdent();
    // only could be private fields in 'in', such as #x in obj
    if (this.type !== types$1._in) { this.unexpected(); }
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors, forInit);
    if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
    while (this.type.postfix && !this.canInsertSemicolon()) {
      var node$1 = this.startNodeAt(startPos, startLoc);
      node$1.operator = this.value;
      node$1.prefix = false;
      node$1.argument = expr;
      this.checkLValSimple(expr);
      this.next();
      expr = this.finishNode(node$1, "UpdateExpression");
    }
  }

  if (!incDec && !(expr.type === "ArrowFunctionExpression" && expr.start === startPos) && this.eat(types$1.starstar)) {
    if (sawUnary)
      { this.unexpected(this.lastTokStart); }
    else
      { return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false, false, forInit), "**", false) }
  } else {
    return expr
  }
};

function isLocalVariableAccess(node) {
  return (
    node.type === "Identifier" ||
    node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression)
  )
}

function isPrivateFieldAccess(node) {
  return (
    node.type === "MemberExpression" && node.property.type === "PrivateIdentifier" ||
    node.type === "ChainExpression" && isPrivateFieldAccess(node.expression) ||
    node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression)
  )
}

// Parse call, dot, and `[]`-subscript expressions.

pp$5.parseExprSubscripts = function(refDestructuringErrors, forInit) {
  var startPos = this.start, startLoc = this.startLoc;
  var oldDoubleProto = -1, oldShorthandAssign = -1;
  if (refDestructuringErrors) {
    oldDoubleProto = refDestructuringErrors.doubleProto;
    oldShorthandAssign = refDestructuringErrors.shorthandAssign;
    refDestructuringErrors.doubleProto = refDestructuringErrors.shorthandAssign = -1;
  }
  var expr = this.parseExprAtom(refDestructuringErrors, forInit);
  if (expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")")
    { return expr }
  var result = this.parseSubscripts(expr, startPos, startLoc, false, forInit);
  if (refDestructuringErrors) {
    if (result.end > expr.end) {
      this.checkExpressionErrors(refDestructuringErrors, true);
      if (refDestructuringErrors.parenthesizedAssign >= result.start) { refDestructuringErrors.parenthesizedAssign = -1; }
      if (refDestructuringErrors.parenthesizedBind >= result.start) { refDestructuringErrors.parenthesizedBind = -1; }
      if (refDestructuringErrors.trailingComma >= result.start) { refDestructuringErrors.trailingComma = -1; }
    }
    if (oldDoubleProto > -1) { refDestructuringErrors.doubleProto = oldDoubleProto; }
    if (oldShorthandAssign > -1) { refDestructuringErrors.shorthandAssign = oldShorthandAssign; }
  }
  return result
};

pp$5.parseSubscripts = function(base, startPos, startLoc, noCalls, forInit) {
  var maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" &&
      this.lastTokEnd === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 &&
      this.potentialArrowAt === base.start;
  var optionalChained = false;

  while (true) {
    var element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit);

    if (element.optional) { optionalChained = true; }
    if (element.end === base.end || element.type === "ArrowFunctionExpression") {
      if (optionalChained) {
        var chainNode = this.startNodeAt(startPos, startLoc);
        chainNode.expression = element;
        element = this.finishNode(chainNode, "ChainExpression");
      }
      return element
    }

    base = element;
    maybeAsyncArrow = false;
  }
};

pp$5.shouldParseAsyncArrow = function() {
  return !this.canInsertSemicolon() && this.eat(types$1.arrow)
};

pp$5.parseSubscriptAsyncArrow = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true, forInit)
};

pp$5.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit) {
  var optionalSupported = this.options.ecmaVersion >= 11;
  var optional = optionalSupported && this.eat(types$1.questionDot);
  if (noCalls && optional) { this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions"); }

  var computed = this.eat(types$1.bracketL);
  if (computed || (optional && this.type !== types$1.parenL && this.type !== types$1.backQuote) || this.eat(types$1.dot)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.object = base;
    if (computed) {
      node.property = this.parseExpression();
      this.expect(types$1.bracketR);
    } else if (this.type === types$1.privateId && base.type !== "Super") {
      node.property = this.parsePrivateIdent();
    } else {
      node.property = this.parseIdent(this.options.allowReserved !== "never");
    }
    node.computed = !!computed;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = this.finishNode(node, "MemberExpression");
  } else if (!noCalls && this.eat(types$1.parenL)) {
    var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    var exprList = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors);
    if (maybeAsyncArrow && !optional && this.shouldParseAsyncArrow()) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      if (this.awaitIdentPos > 0)
        { this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function"); }
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.parseSubscriptAsyncArrow(startPos, startLoc, exprList, forInit)
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
    var node$1 = this.startNodeAt(startPos, startLoc);
    node$1.callee = base;
    node$1.arguments = exprList;
    if (optionalSupported) {
      node$1.optional = optional;
    }
    base = this.finishNode(node$1, "CallExpression");
  } else if (this.type === types$1.backQuote) {
    if (optional || optionalChained) {
      this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions");
    }
    var node$2 = this.startNodeAt(startPos, startLoc);
    node$2.tag = base;
    node$2.quasi = this.parseTemplate({isTagged: true});
    base = this.finishNode(node$2, "TaggedTemplateExpression");
  }
  return base
};

// Parse an atomic expression — either a single token that is an
// expression, an expression started by a keyword like `function` or
// `new`, or an expression wrapped in punctuation like `()`, `[]`,
// or `{}`.

pp$5.parseExprAtom = function(refDestructuringErrors, forInit, forNew) {
  // If a division operator appears in an expression position, the
  // tokenizer got confused, and we force it to read a regexp instead.
  if (this.type === types$1.slash) { this.readRegexp(); }

  var node, canBeArrow = this.potentialArrowAt === this.start;
  switch (this.type) {
  case types$1._super:
    if (!this.allowSuper)
      { this.raise(this.start, "'super' keyword outside a method"); }
    node = this.startNode();
    this.next();
    if (this.type === types$1.parenL && !this.allowDirectSuper)
      { this.raise(node.start, "super() call outside constructor of a subclass"); }
    // The `super` keyword can appear at below:
    // SuperProperty:
    //     super [ Expression ]
    //     super . IdentifierName
    // SuperCall:
    //     super ( Arguments )
    if (this.type !== types$1.dot && this.type !== types$1.bracketL && this.type !== types$1.parenL)
      { this.unexpected(); }
    return this.finishNode(node, "Super")

  case types$1._this:
    node = this.startNode();
    this.next();
    return this.finishNode(node, "ThisExpression")

  case types$1.name:
    var startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc;
    var id = this.parseIdent(false);
    if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(types$1._function)) {
      this.overrideContext(types.f_expr);
      return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true, forInit)
    }
    if (canBeArrow && !this.canInsertSemicolon()) {
      if (this.eat(types$1.arrow))
        { return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false, forInit) }
      if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === types$1.name && !containsEsc &&
          (!this.potentialArrowInForAwait || this.value !== "of" || this.containsEsc)) {
        id = this.parseIdent(false);
        if (this.canInsertSemicolon() || !this.eat(types$1.arrow))
          { this.unexpected(); }
        return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true, forInit)
      }
    }
    return id

  case types$1.regexp:
    var value = this.value;
    node = this.parseLiteral(value.value);
    node.regex = {pattern: value.pattern, flags: value.flags};
    return node

  case types$1.num: case types$1.string:
    return this.parseLiteral(this.value)

  case types$1._null: case types$1._true: case types$1._false:
    node = this.startNode();
    node.value = this.type === types$1._null ? null : this.type === types$1._true;
    node.raw = this.type.keyword;
    this.next();
    return this.finishNode(node, "Literal")

  case types$1.parenL:
    var start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow, forInit);
    if (refDestructuringErrors) {
      if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr))
        { refDestructuringErrors.parenthesizedAssign = start; }
      if (refDestructuringErrors.parenthesizedBind < 0)
        { refDestructuringErrors.parenthesizedBind = start; }
    }
    return expr

  case types$1.bracketL:
    node = this.startNode();
    this.next();
    node.elements = this.parseExprList(types$1.bracketR, true, true, refDestructuringErrors);
    return this.finishNode(node, "ArrayExpression")

  case types$1.braceL:
    this.overrideContext(types.b_expr);
    return this.parseObj(false, refDestructuringErrors)

  case types$1._function:
    node = this.startNode();
    this.next();
    return this.parseFunction(node, 0)

  case types$1._class:
    return this.parseClass(this.startNode(), false)

  case types$1._new:
    return this.parseNew()

  case types$1.backQuote:
    return this.parseTemplate()

  case types$1._import:
    if (this.options.ecmaVersion >= 11) {
      return this.parseExprImport(forNew)
    } else {
      return this.unexpected()
    }

  default:
    return this.parseExprAtomDefault()
  }
};

pp$5.parseExprAtomDefault = function() {
  this.unexpected();
};

pp$5.parseExprImport = function(forNew) {
  var node = this.startNode();

  // Consume `import` as an identifier for `import.meta`.
  // Because `this.parseIdent(true)` doesn't check escape sequences, it needs the check of `this.containsEsc`.
  if (this.containsEsc) { this.raiseRecoverable(this.start, "Escape sequence in keyword import"); }
  this.next();

  if (this.type === types$1.parenL && !forNew) {
    return this.parseDynamicImport(node)
  } else if (this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "import";
    node.meta = this.finishNode(meta, "Identifier");
    return this.parseImportMeta(node)
  } else {
    this.unexpected();
  }
};

pp$5.parseDynamicImport = function(node) {
  this.next(); // skip `(`

  // Parse node.source.
  node.source = this.parseMaybeAssign();

  if (this.options.ecmaVersion >= 16) {
    if (!this.eat(types$1.parenR)) {
      this.expect(types$1.comma);
      if (!this.afterTrailingComma(types$1.parenR)) {
        node.options = this.parseMaybeAssign();
        if (!this.eat(types$1.parenR)) {
          this.expect(types$1.comma);
          if (!this.afterTrailingComma(types$1.parenR)) {
            this.unexpected();
          }
        }
      } else {
        node.options = null;
      }
    } else {
      node.options = null;
    }
  } else {
    // Verify ending.
    if (!this.eat(types$1.parenR)) {
      var errorPos = this.start;
      if (this.eat(types$1.comma) && this.eat(types$1.parenR)) {
        this.raiseRecoverable(errorPos, "Trailing comma is not allowed in import()");
      } else {
        this.unexpected(errorPos);
      }
    }
  }

  return this.finishNode(node, "ImportExpression")
};

pp$5.parseImportMeta = function(node) {
  this.next(); // skip `.`

  var containsEsc = this.containsEsc;
  node.property = this.parseIdent(true);

  if (node.property.name !== "meta")
    { this.raiseRecoverable(node.property.start, "The only valid meta property for import is 'import.meta'"); }
  if (containsEsc)
    { this.raiseRecoverable(node.start, "'import.meta' must not contain escaped characters"); }
  if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere)
    { this.raiseRecoverable(node.start, "Cannot use 'import.meta' outside a module"); }

  return this.finishNode(node, "MetaProperty")
};

pp$5.parseLiteral = function(value) {
  var node = this.startNode();
  node.value = value;
  node.raw = this.input.slice(this.start, this.end);
  if (node.raw.charCodeAt(node.raw.length - 1) === 110)
    { node.bigint = node.value != null ? node.value.toString() : node.raw.slice(0, -1).replace(/_/g, ""); }
  this.next();
  return this.finishNode(node, "Literal")
};

pp$5.parseParenExpression = function() {
  this.expect(types$1.parenL);
  var val = this.parseExpression();
  this.expect(types$1.parenR);
  return val
};

pp$5.shouldParseArrow = function(exprList) {
  return !this.canInsertSemicolon()
};

pp$5.parseParenAndDistinguishExpression = function(canBeArrow, forInit) {
  var startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8;
  if (this.options.ecmaVersion >= 6) {
    this.next();

    var innerStartPos = this.start, innerStartLoc = this.startLoc;
    var exprList = [], first = true, lastIsComma = false;
    var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    // Do not save awaitIdentPos to allow checking awaits nested in parameters
    while (this.type !== types$1.parenR) {
      first ? first = false : this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(types$1.parenR, true)) {
        lastIsComma = true;
        break
      } else if (this.type === types$1.ellipsis) {
        spreadStart = this.start;
        exprList.push(this.parseParenItem(this.parseRestBinding()));
        if (this.type === types$1.comma) {
          this.raiseRecoverable(
            this.start,
            "Comma is not permitted after the rest element"
          );
        }
        break
      } else {
        exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem));
      }
    }
    var innerEndPos = this.lastTokEnd, innerEndLoc = this.lastTokEndLoc;
    this.expect(types$1.parenR);

    if (canBeArrow && this.shouldParseArrow(exprList) && this.eat(types$1.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseParenArrowList(startPos, startLoc, exprList, forInit)
    }

    if (!exprList.length || lastIsComma) { this.unexpected(this.lastTokStart); }
    if (spreadStart) { this.unexpected(spreadStart); }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;

    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = this.parseParenExpression();
  }

  if (this.options.preserveParens) {
    var par = this.startNodeAt(startPos, startLoc);
    par.expression = val;
    return this.finishNode(par, "ParenthesizedExpression")
  } else {
    return val
  }
};

pp$5.parseParenItem = function(item) {
  return item
};

pp$5.parseParenArrowList = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, false, forInit)
};

// New's precedence is slightly tricky. It must allow its argument to
// be a `[]` or dot subscript expression, but not a call — at least,
// not without wrapping it in parentheses. Thus, it uses the noCalls
// argument to parseSubscripts to prevent it from consuming the
// argument list.

var empty = [];

pp$5.parseNew = function() {
  if (this.containsEsc) { this.raiseRecoverable(this.start, "Escape sequence in keyword new"); }
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion >= 6 && this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "new";
    node.meta = this.finishNode(meta, "Identifier");
    this.next();
    var containsEsc = this.containsEsc;
    node.property = this.parseIdent(true);
    if (node.property.name !== "target")
      { this.raiseRecoverable(node.property.start, "The only valid meta property for new is 'new.target'"); }
    if (containsEsc)
      { this.raiseRecoverable(node.start, "'new.target' must not contain escaped characters"); }
    if (!this.allowNewDotTarget)
      { this.raiseRecoverable(node.start, "'new.target' can only be used in functions and class static block"); }
    return this.finishNode(node, "MetaProperty")
  }
  var startPos = this.start, startLoc = this.startLoc;
  node.callee = this.parseSubscripts(this.parseExprAtom(null, false, true), startPos, startLoc, true, false);
  if (node.callee.type === "Super")
    { this.raiseRecoverable(startPos, "Invalid use of 'super'"); }
  if (this.eat(types$1.parenL)) { node.arguments = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false); }
  else { node.arguments = empty; }
  return this.finishNode(node, "NewExpression")
};

// Parse template expression.

pp$5.parseTemplateElement = function(ref) {
  var isTagged = ref.isTagged;

  var elem = this.startNode();
  if (this.type === types$1.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: this.value.replace(/\r\n?/g, "\n"),
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
      cooked: this.value
    };
  }
  this.next();
  elem.tail = this.type === types$1.backQuote;
  return this.finishNode(elem, "TemplateElement")
};

pp$5.parseTemplate = function(ref) {
  if ( ref === void 0 ) ref = {};
  var isTagged = ref.isTagged; if ( isTagged === void 0 ) isTagged = false;

  var node = this.startNode();
  this.next();
  node.expressions = [];
  var curElt = this.parseTemplateElement({isTagged: isTagged});
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (this.type === types$1.eof) { this.raise(this.pos, "Unterminated template literal"); }
    this.expect(types$1.dollarBraceL);
    node.expressions.push(this.parseExpression());
    this.expect(types$1.braceR);
    node.quasis.push(curElt = this.parseTemplateElement({isTagged: isTagged}));
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral")
};

pp$5.isAsyncProp = function(prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" &&
    (this.type === types$1.name || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword || (this.options.ecmaVersion >= 9 && this.type === types$1.star)) &&
    !lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
};

// Parse an object literal or binding pattern.

pp$5.parseObj = function(isPattern, refDestructuringErrors) {
  var node = this.startNode(), first = true, propHash = {};
  node.properties = [];
  this.next();
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.options.ecmaVersion >= 5 && this.afterTrailingComma(types$1.braceR)) { break }
    } else { first = false; }

    var prop = this.parseProperty(isPattern, refDestructuringErrors);
    if (!isPattern) { this.checkPropClash(prop, propHash, refDestructuringErrors); }
    node.properties.push(prop);
  }
  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression")
};

pp$5.parseProperty = function(isPattern, refDestructuringErrors) {
  var prop = this.startNode(), isGenerator, isAsync, startPos, startLoc;
  if (this.options.ecmaVersion >= 9 && this.eat(types$1.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      return this.finishNode(prop, "RestElement")
    }
    // Parse argument.
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
    // To disallow trailing comma via `this.toAssignable()`.
    if (this.type === types$1.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start;
    }
    // Finish
    return this.finishNode(prop, "SpreadElement")
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern)
      { isGenerator = this.eat(types$1.star); }
  }
  var containsEsc = this.containsEsc;
  this.parsePropertyName(prop);
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    isAsync = true;
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(types$1.star);
    this.parsePropertyName(prop);
  } else {
    isAsync = false;
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
  return this.finishNode(prop, "Property")
};

pp$5.parseGetterSetter = function(prop) {
  var kind = prop.key.name;
  this.parsePropertyName(prop);
  prop.value = this.parseMethod(false);
  prop.kind = kind;
  var paramCount = prop.kind === "get" ? 0 : 1;
  if (prop.value.params.length !== paramCount) {
    var start = prop.value.start;
    if (prop.kind === "get")
      { this.raiseRecoverable(start, "getter should have no params"); }
    else
      { this.raiseRecoverable(start, "setter should have exactly one param"); }
  } else {
    if (prop.kind === "set" && prop.value.params[0].type === "RestElement")
      { this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params"); }
  }
};

pp$5.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === types$1.colon)
    { this.unexpected(); }

  if (this.eat(types$1.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
    prop.kind = "init";
  } else if (this.options.ecmaVersion >= 6 && this.type === types$1.parenL) {
    if (isPattern) { this.unexpected(); }
    prop.method = true;
    prop.value = this.parseMethod(isGenerator, isAsync);
    prop.kind = "init";
  } else if (!isPattern && !containsEsc &&
             this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" &&
             (prop.key.name === "get" || prop.key.name === "set") &&
             (this.type !== types$1.comma && this.type !== types$1.braceR && this.type !== types$1.eq)) {
    if (isGenerator || isAsync) { this.unexpected(); }
    this.parseGetterSetter(prop);
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) { this.unexpected(); }
    this.checkUnreserved(prop.key);
    if (prop.key.name === "await" && !this.awaitIdentPos)
      { this.awaitIdentPos = startPos; }
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else if (this.type === types$1.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0)
        { refDestructuringErrors.shorthandAssign = this.start; }
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else {
      prop.value = this.copyNode(prop.key);
    }
    prop.kind = "init";
    prop.shorthand = true;
  } else { this.unexpected(); }
};

pp$5.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(types$1.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types$1.bracketR);
      return prop.key
    } else {
      prop.computed = false;
    }
  }
  return prop.key = this.type === types$1.num || this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never")
};

// Initialize empty function node.

pp$5.initFunction = function(node) {
  node.id = null;
  if (this.options.ecmaVersion >= 6) { node.generator = node.expression = false; }
  if (this.options.ecmaVersion >= 8) { node.async = false; }
};

// Parse object or class method.

pp$5.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
  var node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;

  this.initFunction(node);
  if (this.options.ecmaVersion >= 6)
    { node.generator = isGenerator; }
  if (this.options.ecmaVersion >= 8)
    { node.async = !!isAsync; }

  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));

  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
  this.parseFunctionBody(node, false, true, false);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "FunctionExpression")
};

// Parse arrow function expression with given parameters.

pp$5.parseArrowExpression = function(node, params, isAsync, forInit) {
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;

  this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8) { node.async = !!isAsync; }

  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;

  node.params = this.toAssignableList(params, true);
  this.parseFunctionBody(node, true, false, forInit);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "ArrowFunctionExpression")
};

// Parse function body and check parameters.

pp$5.parseFunctionBody = function(node, isArrowFunction, isMethod, forInit) {
  var isExpression = isArrowFunction && this.type !== types$1.braceL;
  var oldStrict = this.strict, useStrict = false;

  if (isExpression) {
    node.body = this.parseMaybeAssign(forInit);
    node.expression = true;
    this.checkParams(node, false);
  } else {
    var nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end);
      // If this is a strict mode function, verify that argument names
      // are not repeated, and it does not try to bind the words `eval`
      // or `arguments`.
      if (useStrict && nonSimple)
        { this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list"); }
    }
    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    var oldLabels = this.labels;
    this.labels = [];
    if (useStrict) { this.strict = true; }

    // Add the params to varDeclaredNames to ensure that an error is thrown
    // if a let/const declaration in the function clashes with one of the params.
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
    // Ensure the function name isn't a forbidden identifier in strict mode, e.g. 'eval'
    if (this.strict && node.id) { this.checkLValSimple(node.id, BIND_OUTSIDE); }
    node.body = this.parseBlock(false, undefined, useStrict && !oldStrict);
    node.expression = false;
    this.adaptDirectivePrologue(node.body.body);
    this.labels = oldLabels;
  }
  this.exitScope();
};

pp$5.isSimpleParamList = function(params) {
  for (var i = 0, list = params; i < list.length; i += 1)
    {
    var param = list[i];

    if (param.type !== "Identifier") { return false
  } }
  return true
};

// Checks function params for various disallowed patterns such as using "eval"
// or "arguments" and duplicate parameters.

pp$5.checkParams = function(node, allowDuplicates) {
  var nameHash = Object.create(null);
  for (var i = 0, list = node.params; i < list.length; i += 1)
    {
    var param = list[i];

    this.checkLValInnerPattern(param, BIND_VAR, allowDuplicates ? null : nameHash);
  }
};

// Parses a comma-separated list of expressions, and returns them as
// an array. `close` is the token type that ends the list, and
// `allowEmpty` can be turned on to allow subsequent commas with
// nothing in between them to be parsed as `null` (which is needed
// for array literals).

pp$5.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (!first) {
      this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(close)) { break }
    } else { first = false; }

    var elt = (void 0);
    if (allowEmpty && this.type === types$1.comma)
      { elt = null; }
    else if (this.type === types$1.ellipsis) {
      elt = this.parseSpread(refDestructuringErrors);
      if (refDestructuringErrors && this.type === types$1.comma && refDestructuringErrors.trailingComma < 0)
        { refDestructuringErrors.trailingComma = this.start; }
    } else {
      elt = this.parseMaybeAssign(false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts
};

pp$5.checkUnreserved = function(ref) {
  var start = ref.start;
  var end = ref.end;
  var name = ref.name;

  if (this.inGenerator && name === "yield")
    { this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator"); }
  if (this.inAsync && name === "await")
    { this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function"); }
  if (!(this.currentThisScope().flags & SCOPE_VAR) && name === "arguments")
    { this.raiseRecoverable(start, "Cannot use 'arguments' in class field initializer"); }
  if (this.inClassStaticBlock && (name === "arguments" || name === "await"))
    { this.raise(start, ("Cannot use " + name + " in class static initialization block")); }
  if (this.keywords.test(name))
    { this.raise(start, ("Unexpected keyword '" + name + "'")); }
  if (this.options.ecmaVersion < 6 &&
    this.input.slice(start, end).indexOf("\\") !== -1) { return }
  var re = this.strict ? this.reservedWordsStrict : this.reservedWords;
  if (re.test(name)) {
    if (!this.inAsync && name === "await")
      { this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function"); }
    this.raiseRecoverable(start, ("The keyword '" + name + "' is reserved"));
  }
};

// Parse the next token as an identifier. If `liberal` is true (used
// when parsing properties), it will also convert keywords into
// identifiers.

pp$5.parseIdent = function(liberal) {
  var node = this.parseIdentNode();
  this.next(!!liberal);
  this.finishNode(node, "Identifier");
  if (!liberal) {
    this.checkUnreserved(node);
    if (node.name === "await" && !this.awaitIdentPos)
      { this.awaitIdentPos = node.start; }
  }
  return node
};

pp$5.parseIdentNode = function() {
  var node = this.startNode();
  if (this.type === types$1.name) {
    node.name = this.value;
  } else if (this.type.keyword) {
    node.name = this.type.keyword;

    // To fix https://github.com/acornjs/acorn/issues/575
    // `class` and `function` keywords push new context into this.context.
    // But there is no chance to pop the context if the keyword is consumed as an identifier such as a property name.
    // If the previous token is a dot, this does not apply because the context-managing code already ignored the keyword
    if ((node.name === "class" || node.name === "function") &&
      (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
      this.context.pop();
    }
    this.type = types$1.name;
  } else {
    this.unexpected();
  }
  return node
};

pp$5.parsePrivateIdent = function() {
  var node = this.startNode();
  if (this.type === types$1.privateId) {
    node.name = this.value;
  } else {
    this.unexpected();
  }
  this.next();
  this.finishNode(node, "PrivateIdentifier");

  // For validating existence
  if (this.options.checkPrivateFields) {
    if (this.privateNameStack.length === 0) {
      this.raise(node.start, ("Private field '#" + (node.name) + "' must be declared in an enclosing class"));
    } else {
      this.privateNameStack[this.privateNameStack.length - 1].used.push(node);
    }
  }

  return node
};

// Parses yield expression inside generator.

pp$5.parseYield = function(forInit) {
  if (!this.yieldPos) { this.yieldPos = this.start; }

  var node = this.startNode();
  this.next();
  if (this.type === types$1.semi || this.canInsertSemicolon() || (this.type !== types$1.star && !this.type.startsExpr)) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(types$1.star);
    node.argument = this.parseMaybeAssign(forInit);
  }
  return this.finishNode(node, "YieldExpression")
};

pp$5.parseAwait = function(forInit) {
  if (!this.awaitPos) { this.awaitPos = this.start; }

  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary(null, true, false, forInit);
  return this.finishNode(node, "AwaitExpression")
};

var pp$4 = Parser.prototype;

// This function is used to raise exceptions on parse errors. It
// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

pp$4.raise = function(pos, message) {
  var loc = getLineInfo(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  if (this.sourceFile) {
    message += " in " + this.sourceFile;
  }
  var err = new SyntaxError(message);
  err.pos = pos; err.loc = loc; err.raisedAt = this.pos;
  throw err
};

pp$4.raiseRecoverable = pp$4.raise;

pp$4.curPosition = function() {
  if (this.options.locations) {
    return new Position(this.curLine, this.pos - this.lineStart)
  }
};

var pp$3 = Parser.prototype;

var Scope$1 = function Scope(flags) {
  this.flags = flags;
  // A list of var-declared names in the current lexical scope
  this.var = [];
  // A list of lexically-declared names in the current lexical scope
  this.lexical = [];
  // A list of lexically-declared FunctionDeclaration names in the current lexical scope
  this.functions = [];
};

// The functions in this module keep track of declared variables in the current scope in order to detect duplicate variable names.

pp$3.enterScope = function(flags) {
  this.scopeStack.push(new Scope$1(flags));
};

pp$3.exitScope = function() {
  this.scopeStack.pop();
};

// The spec says:
// > At the top level of a function, or script, function declarations are
// > treated like var declarations rather than like lexical declarations.
pp$3.treatFunctionsAsVarInScope = function(scope) {
  return (scope.flags & SCOPE_FUNCTION) || !this.inModule && (scope.flags & SCOPE_TOP)
};

pp$3.declareName = function(name, bindingType, pos) {
  var redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    var scope = this.currentScope();
    redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (this.inModule && (scope.flags & SCOPE_TOP))
      { delete this.undefinedExports[name]; }
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    var scope$1 = this.currentScope();
    scope$1.lexical.push(name);
  } else if (bindingType === BIND_FUNCTION) {
    var scope$2 = this.currentScope();
    if (this.treatFunctionsAsVar)
      { redeclared = scope$2.lexical.indexOf(name) > -1; }
    else
      { redeclared = scope$2.lexical.indexOf(name) > -1 || scope$2.var.indexOf(name) > -1; }
    scope$2.functions.push(name);
  } else {
    for (var i = this.scopeStack.length - 1; i >= 0; --i) {
      var scope$3 = this.scopeStack[i];
      if (scope$3.lexical.indexOf(name) > -1 && !((scope$3.flags & SCOPE_SIMPLE_CATCH) && scope$3.lexical[0] === name) ||
          !this.treatFunctionsAsVarInScope(scope$3) && scope$3.functions.indexOf(name) > -1) {
        redeclared = true;
        break
      }
      scope$3.var.push(name);
      if (this.inModule && (scope$3.flags & SCOPE_TOP))
        { delete this.undefinedExports[name]; }
      if (scope$3.flags & SCOPE_VAR) { break }
    }
  }
  if (redeclared) { this.raiseRecoverable(pos, ("Identifier '" + name + "' has already been declared")); }
};

pp$3.checkLocalExport = function(id) {
  // scope.functions must be empty as Module code is always strict.
  if (this.scopeStack[0].lexical.indexOf(id.name) === -1 &&
      this.scopeStack[0].var.indexOf(id.name) === -1) {
    this.undefinedExports[id.name] = id;
  }
};

pp$3.currentScope = function() {
  return this.scopeStack[this.scopeStack.length - 1]
};

pp$3.currentVarScope = function() {
  for (var i = this.scopeStack.length - 1;; i--) {
    var scope = this.scopeStack[i];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK)) { return scope }
  }
};

// Could be useful for `this`, `new.target`, `super()`, `super.property`, and `super[property]`.
pp$3.currentThisScope = function() {
  for (var i = this.scopeStack.length - 1;; i--) {
    var scope = this.scopeStack[i];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK) &&
        !(scope.flags & SCOPE_ARROW)) { return scope }
  }
};

var Node = function Node(parser, pos, loc) {
  this.type = "";
  this.start = pos;
  this.end = 0;
  if (parser.options.locations)
    { this.loc = new SourceLocation(parser, loc); }
  if (parser.options.directSourceFile)
    { this.sourceFile = parser.options.directSourceFile; }
  if (parser.options.ranges)
    { this.range = [pos, 0]; }
};

// Start an AST node, attaching a start offset.

var pp$2 = Parser.prototype;

pp$2.startNode = function() {
  return new Node(this, this.start, this.startLoc)
};

pp$2.startNodeAt = function(pos, loc) {
  return new Node(this, pos, loc)
};

// Finish an AST node, adding `type` and `end` properties.

function finishNodeAt(node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (this.options.locations)
    { node.loc.end = loc; }
  if (this.options.ranges)
    { node.range[1] = pos; }
  return node
}

pp$2.finishNode = function(node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc)
};

// Finish node at given position

pp$2.finishNodeAt = function(node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc)
};

pp$2.copyNode = function(node) {
  var newNode = new Node(this, node.start, this.startLoc);
  for (var prop in node) { newNode[prop] = node[prop]; }
  return newNode
};

// This file was generated by "bin/generate-unicode-script-values.js". Do not modify manually!
var scriptValuesAddedInUnicode = "Berf Beria_Erfe Gara Garay Gukh Gurung_Khema Hrkt Katakana_Or_Hiragana Kawi Kirat_Rai Krai Nag_Mundari Nagm Ol_Onal Onao Sidetic Sidt Sunu Sunuwar Tai_Yo Tayo Todhri Todr Tolong_Siki Tols Tulu_Tigalari Tutg Unknown Zzzz";

// This file contains Unicode properties extracted from the ECMAScript specification.
// The lists are extracted like so:
// $$('#table-binary-unicode-properties > figure > table > tbody > tr > td:nth-child(1) code').map(el => el.innerText)

// #table-binary-unicode-properties
var ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
var ecma10BinaryProperties = ecma9BinaryProperties + " Extended_Pictographic";
var ecma11BinaryProperties = ecma10BinaryProperties;
var ecma12BinaryProperties = ecma11BinaryProperties + " EBase EComp EMod EPres ExtPict";
var ecma13BinaryProperties = ecma12BinaryProperties;
var ecma14BinaryProperties = ecma13BinaryProperties;

var unicodeBinaryProperties = {
  9: ecma9BinaryProperties,
  10: ecma10BinaryProperties,
  11: ecma11BinaryProperties,
  12: ecma12BinaryProperties,
  13: ecma13BinaryProperties,
  14: ecma14BinaryProperties
};

// #table-binary-unicode-properties-of-strings
var ecma14BinaryPropertiesOfStrings = "Basic_Emoji Emoji_Keycap_Sequence RGI_Emoji_Modifier_Sequence RGI_Emoji_Flag_Sequence RGI_Emoji_Tag_Sequence RGI_Emoji_ZWJ_Sequence RGI_Emoji";

var unicodeBinaryPropertiesOfStrings = {
  9: "",
  10: "",
  11: "",
  12: "",
  13: "",
  14: ecma14BinaryPropertiesOfStrings
};

// #table-unicode-general-category-values
var unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";

// #table-unicode-script-values
var ecma9ScriptValues = "Adlam Adlm Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
var ecma10ScriptValues = ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd";
var ecma11ScriptValues = ecma10ScriptValues + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho";
var ecma12ScriptValues = ecma11ScriptValues + " Chorasmian Chrs Diak Dives_Akuru Khitan_Small_Script Kits Yezi Yezidi";
var ecma13ScriptValues = ecma12ScriptValues + " Cypro_Minoan Cpmn Old_Uyghur Ougr Tangsa Tnsa Toto Vithkuqi Vith";
var ecma14ScriptValues = ecma13ScriptValues + " " + scriptValuesAddedInUnicode;

var unicodeScriptValues = {
  9: ecma9ScriptValues,
  10: ecma10ScriptValues,
  11: ecma11ScriptValues,
  12: ecma12ScriptValues,
  13: ecma13ScriptValues,
  14: ecma14ScriptValues
};

var data = {};
function buildUnicodeData(ecmaVersion) {
  var d = data[ecmaVersion] = {
    binary: wordsRegexp(unicodeBinaryProperties[ecmaVersion] + " " + unicodeGeneralCategoryValues),
    binaryOfStrings: wordsRegexp(unicodeBinaryPropertiesOfStrings[ecmaVersion]),
    nonBinary: {
      General_Category: wordsRegexp(unicodeGeneralCategoryValues),
      Script: wordsRegexp(unicodeScriptValues[ecmaVersion])
    }
  };
  d.nonBinary.Script_Extensions = d.nonBinary.Script;

  d.nonBinary.gc = d.nonBinary.General_Category;
  d.nonBinary.sc = d.nonBinary.Script;
  d.nonBinary.scx = d.nonBinary.Script_Extensions;
}

for (var i = 0, list = [9, 10, 11, 12, 13, 14]; i < list.length; i += 1) {
  var ecmaVersion = list[i];

  buildUnicodeData(ecmaVersion);
}

var pp$1 = Parser.prototype;

// Track disjunction structure to determine whether a duplicate
// capture group name is allowed because it is in a separate branch.
var BranchID = function BranchID(parent, base) {
  // Parent disjunction branch
  this.parent = parent;
  // Identifies this set of sibling branches
  this.base = base || this;
};

BranchID.prototype.separatedFrom = function separatedFrom (alt) {
  // A branch is separate from another branch if they or any of
  // their parents are siblings in a given disjunction
  for (var self = this; self; self = self.parent) {
    for (var other = alt; other; other = other.parent) {
      if (self.base === other.base && self !== other) { return true }
    }
  }
  return false
};

BranchID.prototype.sibling = function sibling () {
  return new BranchID(this.parent, this.base)
};

var RegExpValidationState = function RegExpValidationState(parser) {
  this.parser = parser;
  this.validFlags = "gim" + (parser.options.ecmaVersion >= 6 ? "uy" : "") + (parser.options.ecmaVersion >= 9 ? "s" : "") + (parser.options.ecmaVersion >= 13 ? "d" : "") + (parser.options.ecmaVersion >= 15 ? "v" : "");
  this.unicodeProperties = data[parser.options.ecmaVersion >= 14 ? 14 : parser.options.ecmaVersion];
  this.source = "";
  this.flags = "";
  this.start = 0;
  this.switchU = false;
  this.switchV = false;
  this.switchN = false;
  this.pos = 0;
  this.lastIntValue = 0;
  this.lastStringValue = "";
  this.lastAssertionIsQuantifiable = false;
  this.numCapturingParens = 0;
  this.maxBackReference = 0;
  this.groupNames = Object.create(null);
  this.backReferenceNames = [];
  this.branchID = null;
};

RegExpValidationState.prototype.reset = function reset (start, pattern, flags) {
  var unicodeSets = flags.indexOf("v") !== -1;
  var unicode = flags.indexOf("u") !== -1;
  this.start = start | 0;
  this.source = pattern + "";
  this.flags = flags;
  if (unicodeSets && this.parser.options.ecmaVersion >= 15) {
    this.switchU = true;
    this.switchV = true;
    this.switchN = true;
  } else {
    this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
    this.switchV = false;
    this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
  }
};

RegExpValidationState.prototype.raise = function raise (message) {
  this.parser.raiseRecoverable(this.start, ("Invalid regular expression: /" + (this.source) + "/: " + message));
};

// If u flag is given, this returns the code point at the index (it combines a surrogate pair).
// Otherwise, this returns the code unit of the index (can be a part of a surrogate pair).
RegExpValidationState.prototype.at = function at (i, forceU) {
    if ( forceU === void 0 ) forceU = false;

  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return -1
  }
  var c = s.charCodeAt(i);
  if (!(forceU || this.switchU) || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l) {
    return c
  }
  var next = s.charCodeAt(i + 1);
  return next >= 0xDC00 && next <= 0xDFFF ? (c << 10) + next - 0x35FDC00 : c
};

RegExpValidationState.prototype.nextIndex = function nextIndex (i, forceU) {
    if ( forceU === void 0 ) forceU = false;

  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return l
  }
  var c = s.charCodeAt(i), next;
  if (!(forceU || this.switchU) || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l ||
      (next = s.charCodeAt(i + 1)) < 0xDC00 || next > 0xDFFF) {
    return i + 1
  }
  return i + 2
};

RegExpValidationState.prototype.current = function current (forceU) {
    if ( forceU === void 0 ) forceU = false;

  return this.at(this.pos, forceU)
};

RegExpValidationState.prototype.lookahead = function lookahead (forceU) {
    if ( forceU === void 0 ) forceU = false;

  return this.at(this.nextIndex(this.pos, forceU), forceU)
};

RegExpValidationState.prototype.advance = function advance (forceU) {
    if ( forceU === void 0 ) forceU = false;

  this.pos = this.nextIndex(this.pos, forceU);
};

RegExpValidationState.prototype.eat = function eat (ch, forceU) {
    if ( forceU === void 0 ) forceU = false;

  if (this.current(forceU) === ch) {
    this.advance(forceU);
    return true
  }
  return false
};

RegExpValidationState.prototype.eatChars = function eatChars (chs, forceU) {
    if ( forceU === void 0 ) forceU = false;

  var pos = this.pos;
  for (var i = 0, list = chs; i < list.length; i += 1) {
    var ch = list[i];

      var current = this.at(pos, forceU);
    if (current === -1 || current !== ch) {
      return false
    }
    pos = this.nextIndex(pos, forceU);
  }
  this.pos = pos;
  return true
};

/**
 * Validate the flags part of a given RegExpLiteral.
 *
 * @param {RegExpValidationState} state The state to validate RegExp.
 * @returns {void}
 */
pp$1.validateRegExpFlags = function(state) {
  var validFlags = state.validFlags;
  var flags = state.flags;

  var u = false;
  var v = false;

  for (var i = 0; i < flags.length; i++) {
    var flag = flags.charAt(i);
    if (validFlags.indexOf(flag) === -1) {
      this.raise(state.start, "Invalid regular expression flag");
    }
    if (flags.indexOf(flag, i + 1) > -1) {
      this.raise(state.start, "Duplicate regular expression flag");
    }
    if (flag === "u") { u = true; }
    if (flag === "v") { v = true; }
  }
  if (this.options.ecmaVersion >= 15 && u && v) {
    this.raise(state.start, "Invalid regular expression flag");
  }
};

function hasProp(obj) {
  for (var _ in obj) { return true }
  return false
}

/**
 * Validate the pattern part of a given RegExpLiteral.
 *
 * @param {RegExpValidationState} state The state to validate RegExp.
 * @returns {void}
 */
pp$1.validateRegExpPattern = function(state) {
  this.regexp_pattern(state);

  // The goal symbol for the parse is |Pattern[~U, ~N]|. If the result of
  // parsing contains a |GroupName|, reparse with the goal symbol
  // |Pattern[~U, +N]| and use this result instead. Throw a *SyntaxError*
  // exception if _P_ did not conform to the grammar, if any elements of _P_
  // were not matched by the parse, or if any Early Error conditions exist.
  if (!state.switchN && this.options.ecmaVersion >= 9 && hasProp(state.groupNames)) {
    state.switchN = true;
    this.regexp_pattern(state);
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Pattern
pp$1.regexp_pattern = function(state) {
  state.pos = 0;
  state.lastIntValue = 0;
  state.lastStringValue = "";
  state.lastAssertionIsQuantifiable = false;
  state.numCapturingParens = 0;
  state.maxBackReference = 0;
  state.groupNames = Object.create(null);
  state.backReferenceNames.length = 0;
  state.branchID = null;

  this.regexp_disjunction(state);

  if (state.pos !== state.source.length) {
    // Make the same messages as V8.
    if (state.eat(0x29 /* ) */)) {
      state.raise("Unmatched ')'");
    }
    if (state.eat(0x5D /* ] */) || state.eat(0x7D /* } */)) {
      state.raise("Lone quantifier brackets");
    }
  }
  if (state.maxBackReference > state.numCapturingParens) {
    state.raise("Invalid escape");
  }
  for (var i = 0, list = state.backReferenceNames; i < list.length; i += 1) {
    var name = list[i];

    if (!state.groupNames[name]) {
      state.raise("Invalid named capture referenced");
    }
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Disjunction
pp$1.regexp_disjunction = function(state) {
  var trackDisjunction = this.options.ecmaVersion >= 16;
  if (trackDisjunction) { state.branchID = new BranchID(state.branchID, null); }
  this.regexp_alternative(state);
  while (state.eat(0x7C /* | */)) {
    if (trackDisjunction) { state.branchID = state.branchID.sibling(); }
    this.regexp_alternative(state);
  }
  if (trackDisjunction) { state.branchID = state.branchID.parent; }

  // Make the same message as V8.
  if (this.regexp_eatQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  if (state.eat(0x7B /* { */)) {
    state.raise("Lone quantifier brackets");
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Alternative
pp$1.regexp_alternative = function(state) {
  while (state.pos < state.source.length && this.regexp_eatTerm(state)) {}
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Term
pp$1.regexp_eatTerm = function(state) {
  if (this.regexp_eatAssertion(state)) {
    // Handle `QuantifiableAssertion Quantifier` alternative.
    // `state.lastAssertionIsQuantifiable` is true if the last eaten Assertion
    // is a QuantifiableAssertion.
    if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
      // Make the same message as V8.
      if (state.switchU) {
        state.raise("Invalid quantifier");
      }
    }
    return true
  }

  if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
    this.regexp_eatQuantifier(state);
    return true
  }

  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Assertion
pp$1.regexp_eatAssertion = function(state) {
  var start = state.pos;
  state.lastAssertionIsQuantifiable = false;

  // ^, $
  if (state.eat(0x5E /* ^ */) || state.eat(0x24 /* $ */)) {
    return true
  }

  // \b \B
  if (state.eat(0x5C /* \ */)) {
    if (state.eat(0x42 /* B */) || state.eat(0x62 /* b */)) {
      return true
    }
    state.pos = start;
  }

  // Lookahead / Lookbehind
  if (state.eat(0x28 /* ( */) && state.eat(0x3F /* ? */)) {
    var lookbehind = false;
    if (this.options.ecmaVersion >= 9) {
      lookbehind = state.eat(0x3C /* < */);
    }
    if (state.eat(0x3D /* = */) || state.eat(0x21 /* ! */)) {
      this.regexp_disjunction(state);
      if (!state.eat(0x29 /* ) */)) {
        state.raise("Unterminated group");
      }
      state.lastAssertionIsQuantifiable = !lookbehind;
      return true
    }
  }

  state.pos = start;
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Quantifier
pp$1.regexp_eatQuantifier = function(state, noError) {
  if ( noError === void 0 ) noError = false;

  if (this.regexp_eatQuantifierPrefix(state, noError)) {
    state.eat(0x3F /* ? */);
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-QuantifierPrefix
pp$1.regexp_eatQuantifierPrefix = function(state, noError) {
  return (
    state.eat(0x2A /* * */) ||
    state.eat(0x2B /* + */) ||
    state.eat(0x3F /* ? */) ||
    this.regexp_eatBracedQuantifier(state, noError)
  )
};
pp$1.regexp_eatBracedQuantifier = function(state, noError) {
  var start = state.pos;
  if (state.eat(0x7B /* { */)) {
    var min = 0, max = -1;
    if (this.regexp_eatDecimalDigits(state)) {
      min = state.lastIntValue;
      if (state.eat(0x2C /* , */) && this.regexp_eatDecimalDigits(state)) {
        max = state.lastIntValue;
      }
      if (state.eat(0x7D /* } */)) {
        // SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-term
        if (max !== -1 && max < min && !noError) {
          state.raise("numbers out of order in {} quantifier");
        }
        return true
      }
    }
    if (state.switchU && !noError) {
      state.raise("Incomplete quantifier");
    }
    state.pos = start;
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Atom
pp$1.regexp_eatAtom = function(state) {
  return (
    this.regexp_eatPatternCharacters(state) ||
    state.eat(0x2E /* . */) ||
    this.regexp_eatReverseSolidusAtomEscape(state) ||
    this.regexp_eatCharacterClass(state) ||
    this.regexp_eatUncapturingGroup(state) ||
    this.regexp_eatCapturingGroup(state)
  )
};
pp$1.regexp_eatReverseSolidusAtomEscape = function(state) {
  var start = state.pos;
  if (state.eat(0x5C /* \ */)) {
    if (this.regexp_eatAtomEscape(state)) {
      return true
    }
    state.pos = start;
  }
  return false
};
pp$1.regexp_eatUncapturingGroup = function(state) {
  var start = state.pos;
  if (state.eat(0x28 /* ( */)) {
    if (state.eat(0x3F /* ? */)) {
      if (this.options.ecmaVersion >= 16) {
        var addModifiers = this.regexp_eatModifiers(state);
        var hasHyphen = state.eat(0x2D /* - */);
        if (addModifiers || hasHyphen) {
          for (var i = 0; i < addModifiers.length; i++) {
            var modifier = addModifiers.charAt(i);
            if (addModifiers.indexOf(modifier, i + 1) > -1) {
              state.raise("Duplicate regular expression modifiers");
            }
          }
          if (hasHyphen) {
            var removeModifiers = this.regexp_eatModifiers(state);
            if (!addModifiers && !removeModifiers && state.current() === 0x3A /* : */) {
              state.raise("Invalid regular expression modifiers");
            }
            for (var i$1 = 0; i$1 < removeModifiers.length; i$1++) {
              var modifier$1 = removeModifiers.charAt(i$1);
              if (
                removeModifiers.indexOf(modifier$1, i$1 + 1) > -1 ||
                addModifiers.indexOf(modifier$1) > -1
              ) {
                state.raise("Duplicate regular expression modifiers");
              }
            }
          }
        }
      }
      if (state.eat(0x3A /* : */)) {
        this.regexp_disjunction(state);
        if (state.eat(0x29 /* ) */)) {
          return true
        }
        state.raise("Unterminated group");
      }
    }
    state.pos = start;
  }
  return false
};
pp$1.regexp_eatCapturingGroup = function(state) {
  if (state.eat(0x28 /* ( */)) {
    if (this.options.ecmaVersion >= 9) {
      this.regexp_groupSpecifier(state);
    } else if (state.current() === 0x3F /* ? */) {
      state.raise("Invalid group");
    }
    this.regexp_disjunction(state);
    if (state.eat(0x29 /* ) */)) {
      state.numCapturingParens += 1;
      return true
    }
    state.raise("Unterminated group");
  }
  return false
};
// RegularExpressionModifiers ::
//   [empty]
//   RegularExpressionModifiers RegularExpressionModifier
pp$1.regexp_eatModifiers = function(state) {
  var modifiers = "";
  var ch = 0;
  while ((ch = state.current()) !== -1 && isRegularExpressionModifier(ch)) {
    modifiers += codePointToString(ch);
    state.advance();
  }
  return modifiers
};
// RegularExpressionModifier :: one of
//   `i` `m` `s`
function isRegularExpressionModifier(ch) {
  return ch === 0x69 /* i */ || ch === 0x6d /* m */ || ch === 0x73 /* s */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedAtom
pp$1.regexp_eatExtendedAtom = function(state) {
  return (
    state.eat(0x2E /* . */) ||
    this.regexp_eatReverseSolidusAtomEscape(state) ||
    this.regexp_eatCharacterClass(state) ||
    this.regexp_eatUncapturingGroup(state) ||
    this.regexp_eatCapturingGroup(state) ||
    this.regexp_eatInvalidBracedQuantifier(state) ||
    this.regexp_eatExtendedPatternCharacter(state)
  )
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-InvalidBracedQuantifier
pp$1.regexp_eatInvalidBracedQuantifier = function(state) {
  if (this.regexp_eatBracedQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-SyntaxCharacter
pp$1.regexp_eatSyntaxCharacter = function(state) {
  var ch = state.current();
  if (isSyntaxCharacter(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }
  return false
};
function isSyntaxCharacter(ch) {
  return (
    ch === 0x24 /* $ */ ||
    ch >= 0x28 /* ( */ && ch <= 0x2B /* + */ ||
    ch === 0x2E /* . */ ||
    ch === 0x3F /* ? */ ||
    ch >= 0x5B /* [ */ && ch <= 0x5E /* ^ */ ||
    ch >= 0x7B /* { */ && ch <= 0x7D /* } */
  )
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-PatternCharacter
// But eat eager.
pp$1.regexp_eatPatternCharacters = function(state) {
  var start = state.pos;
  var ch = 0;
  while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
    state.advance();
  }
  return state.pos !== start
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedPatternCharacter
pp$1.regexp_eatExtendedPatternCharacter = function(state) {
  var ch = state.current();
  if (
    ch !== -1 &&
    ch !== 0x24 /* $ */ &&
    !(ch >= 0x28 /* ( */ && ch <= 0x2B /* + */) &&
    ch !== 0x2E /* . */ &&
    ch !== 0x3F /* ? */ &&
    ch !== 0x5B /* [ */ &&
    ch !== 0x5E /* ^ */ &&
    ch !== 0x7C /* | */
  ) {
    state.advance();
    return true
  }
  return false
};

// GroupSpecifier ::
//   [empty]
//   `?` GroupName
pp$1.regexp_groupSpecifier = function(state) {
  if (state.eat(0x3F /* ? */)) {
    if (!this.regexp_eatGroupName(state)) { state.raise("Invalid group"); }
    var trackDisjunction = this.options.ecmaVersion >= 16;
    var known = state.groupNames[state.lastStringValue];
    if (known) {
      if (trackDisjunction) {
        for (var i = 0, list = known; i < list.length; i += 1) {
          var altID = list[i];

          if (!altID.separatedFrom(state.branchID))
            { state.raise("Duplicate capture group name"); }
        }
      } else {
        state.raise("Duplicate capture group name");
      }
    }
    if (trackDisjunction) {
      (known || (state.groupNames[state.lastStringValue] = [])).push(state.branchID);
    } else {
      state.groupNames[state.lastStringValue] = true;
    }
  }
};

// GroupName ::
//   `<` RegExpIdentifierName `>`
// Note: this updates `state.lastStringValue` property with the eaten name.
pp$1.regexp_eatGroupName = function(state) {
  state.lastStringValue = "";
  if (state.eat(0x3C /* < */)) {
    if (this.regexp_eatRegExpIdentifierName(state) && state.eat(0x3E /* > */)) {
      return true
    }
    state.raise("Invalid capture group name");
  }
  return false
};

// RegExpIdentifierName ::
//   RegExpIdentifierStart
//   RegExpIdentifierName RegExpIdentifierPart
// Note: this updates `state.lastStringValue` property with the eaten name.
pp$1.regexp_eatRegExpIdentifierName = function(state) {
  state.lastStringValue = "";
  if (this.regexp_eatRegExpIdentifierStart(state)) {
    state.lastStringValue += codePointToString(state.lastIntValue);
    while (this.regexp_eatRegExpIdentifierPart(state)) {
      state.lastStringValue += codePointToString(state.lastIntValue);
    }
    return true
  }
  return false
};

// RegExpIdentifierStart ::
//   UnicodeIDStart
//   `$`
//   `_`
//   `\` RegExpUnicodeEscapeSequence[+U]
pp$1.regexp_eatRegExpIdentifierStart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);

  if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierStart(ch)) {
    state.lastIntValue = ch;
    return true
  }

  state.pos = start;
  return false
};
function isRegExpIdentifierStart(ch) {
  return isIdentifierStart(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */
}

// RegExpIdentifierPart ::
//   UnicodeIDContinue
//   `$`
//   `_`
//   `\` RegExpUnicodeEscapeSequence[+U]
//   <ZWNJ>
//   <ZWJ>
pp$1.regexp_eatRegExpIdentifierPart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);

  if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierPart(ch)) {
    state.lastIntValue = ch;
    return true
  }

  state.pos = start;
  return false
};
function isRegExpIdentifierPart(ch) {
  return isIdentifierChar(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */ || ch === 0x200C /* <ZWNJ> */ || ch === 0x200D /* <ZWJ> */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-AtomEscape
pp$1.regexp_eatAtomEscape = function(state) {
  if (
    this.regexp_eatBackReference(state) ||
    this.regexp_eatCharacterClassEscape(state) ||
    this.regexp_eatCharacterEscape(state) ||
    (state.switchN && this.regexp_eatKGroupName(state))
  ) {
    return true
  }
  if (state.switchU) {
    // Make the same message as V8.
    if (state.current() === 0x63 /* c */) {
      state.raise("Invalid unicode escape");
    }
    state.raise("Invalid escape");
  }
  return false
};
pp$1.regexp_eatBackReference = function(state) {
  var start = state.pos;
  if (this.regexp_eatDecimalEscape(state)) {
    var n = state.lastIntValue;
    if (state.switchU) {
      // For SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-atomescape
      if (n > state.maxBackReference) {
        state.maxBackReference = n;
      }
      return true
    }
    if (n <= state.numCapturingParens) {
      return true
    }
    state.pos = start;
  }
  return false
};
pp$1.regexp_eatKGroupName = function(state) {
  if (state.eat(0x6B /* k */)) {
    if (this.regexp_eatGroupName(state)) {
      state.backReferenceNames.push(state.lastStringValue);
      return true
    }
    state.raise("Invalid named reference");
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-CharacterEscape
pp$1.regexp_eatCharacterEscape = function(state) {
  return (
    this.regexp_eatControlEscape(state) ||
    this.regexp_eatCControlLetter(state) ||
    this.regexp_eatZero(state) ||
    this.regexp_eatHexEscapeSequence(state) ||
    this.regexp_eatRegExpUnicodeEscapeSequence(state, false) ||
    (!state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state)) ||
    this.regexp_eatIdentityEscape(state)
  )
};
pp$1.regexp_eatCControlLetter = function(state) {
  var start = state.pos;
  if (state.eat(0x63 /* c */)) {
    if (this.regexp_eatControlLetter(state)) {
      return true
    }
    state.pos = start;
  }
  return false
};
pp$1.regexp_eatZero = function(state) {
  if (state.current() === 0x30 /* 0 */ && !isDecimalDigit(state.lookahead())) {
    state.lastIntValue = 0;
    state.advance();
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ControlEscape
pp$1.regexp_eatControlEscape = function(state) {
  var ch = state.current();
  if (ch === 0x74 /* t */) {
    state.lastIntValue = 0x09; /* \t */
    state.advance();
    return true
  }
  if (ch === 0x6E /* n */) {
    state.lastIntValue = 0x0A; /* \n */
    state.advance();
    return true
  }
  if (ch === 0x76 /* v */) {
    state.lastIntValue = 0x0B; /* \v */
    state.advance();
    return true
  }
  if (ch === 0x66 /* f */) {
    state.lastIntValue = 0x0C; /* \f */
    state.advance();
    return true
  }
  if (ch === 0x72 /* r */) {
    state.lastIntValue = 0x0D; /* \r */
    state.advance();
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ControlLetter
pp$1.regexp_eatControlLetter = function(state) {
  var ch = state.current();
  if (isControlLetter(ch)) {
    state.lastIntValue = ch % 0x20;
    state.advance();
    return true
  }
  return false
};
function isControlLetter(ch) {
  return (
    (ch >= 0x41 /* A */ && ch <= 0x5A /* Z */) ||
    (ch >= 0x61 /* a */ && ch <= 0x7A /* z */)
  )
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-RegExpUnicodeEscapeSequence
pp$1.regexp_eatRegExpUnicodeEscapeSequence = function(state, forceU) {
  if ( forceU === void 0 ) forceU = false;

  var start = state.pos;
  var switchU = forceU || state.switchU;

  if (state.eat(0x75 /* u */)) {
    if (this.regexp_eatFixedHexDigits(state, 4)) {
      var lead = state.lastIntValue;
      if (switchU && lead >= 0xD800 && lead <= 0xDBFF) {
        var leadSurrogateEnd = state.pos;
        if (state.eat(0x5C /* \ */) && state.eat(0x75 /* u */) && this.regexp_eatFixedHexDigits(state, 4)) {
          var trail = state.lastIntValue;
          if (trail >= 0xDC00 && trail <= 0xDFFF) {
            state.lastIntValue = (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000;
            return true
          }
        }
        state.pos = leadSurrogateEnd;
        state.lastIntValue = lead;
      }
      return true
    }
    if (
      switchU &&
      state.eat(0x7B /* { */) &&
      this.regexp_eatHexDigits(state) &&
      state.eat(0x7D /* } */) &&
      isValidUnicode(state.lastIntValue)
    ) {
      return true
    }
    if (switchU) {
      state.raise("Invalid unicode escape");
    }
    state.pos = start;
  }

  return false
};
function isValidUnicode(ch) {
  return ch >= 0 && ch <= 0x10FFFF
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-IdentityEscape
pp$1.regexp_eatIdentityEscape = function(state) {
  if (state.switchU) {
    if (this.regexp_eatSyntaxCharacter(state)) {
      return true
    }
    if (state.eat(0x2F /* / */)) {
      state.lastIntValue = 0x2F; /* / */
      return true
    }
    return false
  }

  var ch = state.current();
  if (ch !== 0x63 /* c */ && (!state.switchN || ch !== 0x6B /* k */)) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }

  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalEscape
pp$1.regexp_eatDecimalEscape = function(state) {
  state.lastIntValue = 0;
  var ch = state.current();
  if (ch >= 0x31 /* 1 */ && ch <= 0x39 /* 9 */) {
    do {
      state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
      state.advance();
    } while ((ch = state.current()) >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */)
    return true
  }
  return false
};

// Return values used by character set parsing methods, needed to
// forbid negation of sets that can match strings.
var CharSetNone = 0; // Nothing parsed
var CharSetOk = 1; // Construct parsed, cannot contain strings
var CharSetString = 2; // Construct parsed, can contain strings

// https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClassEscape
pp$1.regexp_eatCharacterClassEscape = function(state) {
  var ch = state.current();

  if (isCharacterClassEscape(ch)) {
    state.lastIntValue = -1;
    state.advance();
    return CharSetOk
  }

  var negate = false;
  if (
    state.switchU &&
    this.options.ecmaVersion >= 9 &&
    ((negate = ch === 0x50 /* P */) || ch === 0x70 /* p */)
  ) {
    state.lastIntValue = -1;
    state.advance();
    var result;
    if (
      state.eat(0x7B /* { */) &&
      (result = this.regexp_eatUnicodePropertyValueExpression(state)) &&
      state.eat(0x7D /* } */)
    ) {
      if (negate && result === CharSetString) { state.raise("Invalid property name"); }
      return result
    }
    state.raise("Invalid property name");
  }

  return CharSetNone
};

function isCharacterClassEscape(ch) {
  return (
    ch === 0x64 /* d */ ||
    ch === 0x44 /* D */ ||
    ch === 0x73 /* s */ ||
    ch === 0x53 /* S */ ||
    ch === 0x77 /* w */ ||
    ch === 0x57 /* W */
  )
}

// UnicodePropertyValueExpression ::
//   UnicodePropertyName `=` UnicodePropertyValue
//   LoneUnicodePropertyNameOrValue
pp$1.regexp_eatUnicodePropertyValueExpression = function(state) {
  var start = state.pos;

  // UnicodePropertyName `=` UnicodePropertyValue
  if (this.regexp_eatUnicodePropertyName(state) && state.eat(0x3D /* = */)) {
    var name = state.lastStringValue;
    if (this.regexp_eatUnicodePropertyValue(state)) {
      var value = state.lastStringValue;
      this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
      return CharSetOk
    }
  }
  state.pos = start;

  // LoneUnicodePropertyNameOrValue
  if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
    var nameOrValue = state.lastStringValue;
    return this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue)
  }
  return CharSetNone
};

pp$1.regexp_validateUnicodePropertyNameAndValue = function(state, name, value) {
  if (!hasOwn(state.unicodeProperties.nonBinary, name))
    { state.raise("Invalid property name"); }
  if (!state.unicodeProperties.nonBinary[name].test(value))
    { state.raise("Invalid property value"); }
};

pp$1.regexp_validateUnicodePropertyNameOrValue = function(state, nameOrValue) {
  if (state.unicodeProperties.binary.test(nameOrValue)) { return CharSetOk }
  if (state.switchV && state.unicodeProperties.binaryOfStrings.test(nameOrValue)) { return CharSetString }
  state.raise("Invalid property name");
};

// UnicodePropertyName ::
//   UnicodePropertyNameCharacters
pp$1.regexp_eatUnicodePropertyName = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyNameCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== ""
};

function isUnicodePropertyNameCharacter(ch) {
  return isControlLetter(ch) || ch === 0x5F /* _ */
}

// UnicodePropertyValue ::
//   UnicodePropertyValueCharacters
pp$1.regexp_eatUnicodePropertyValue = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyValueCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== ""
};
function isUnicodePropertyValueCharacter(ch) {
  return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch)
}

// LoneUnicodePropertyNameOrValue ::
//   UnicodePropertyValueCharacters
pp$1.regexp_eatLoneUnicodePropertyNameOrValue = function(state) {
  return this.regexp_eatUnicodePropertyValue(state)
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClass
pp$1.regexp_eatCharacterClass = function(state) {
  if (state.eat(0x5B /* [ */)) {
    var negate = state.eat(0x5E /* ^ */);
    var result = this.regexp_classContents(state);
    if (!state.eat(0x5D /* ] */))
      { state.raise("Unterminated character class"); }
    if (negate && result === CharSetString)
      { state.raise("Negated character class may contain strings"); }
    return true
  }
  return false
};

// https://tc39.es/ecma262/#prod-ClassContents
// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassRanges
pp$1.regexp_classContents = function(state) {
  if (state.current() === 0x5D /* ] */) { return CharSetOk }
  if (state.switchV) { return this.regexp_classSetExpression(state) }
  this.regexp_nonEmptyClassRanges(state);
  return CharSetOk
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRanges
// https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRangesNoDash
pp$1.regexp_nonEmptyClassRanges = function(state) {
  while (this.regexp_eatClassAtom(state)) {
    var left = state.lastIntValue;
    if (state.eat(0x2D /* - */) && this.regexp_eatClassAtom(state)) {
      var right = state.lastIntValue;
      if (state.switchU && (left === -1 || right === -1)) {
        state.raise("Invalid character class");
      }
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
    }
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtom
// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtomNoDash
pp$1.regexp_eatClassAtom = function(state) {
  var start = state.pos;

  if (state.eat(0x5C /* \ */)) {
    if (this.regexp_eatClassEscape(state)) {
      return true
    }
    if (state.switchU) {
      // Make the same message as V8.
      var ch$1 = state.current();
      if (ch$1 === 0x63 /* c */ || isOctalDigit(ch$1)) {
        state.raise("Invalid class escape");
      }
      state.raise("Invalid escape");
    }
    state.pos = start;
  }

  var ch = state.current();
  if (ch !== 0x5D /* ] */) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }

  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassEscape
pp$1.regexp_eatClassEscape = function(state) {
  var start = state.pos;

  if (state.eat(0x62 /* b */)) {
    state.lastIntValue = 0x08; /* <BS> */
    return true
  }

  if (state.switchU && state.eat(0x2D /* - */)) {
    state.lastIntValue = 0x2D; /* - */
    return true
  }

  if (!state.switchU && state.eat(0x63 /* c */)) {
    if (this.regexp_eatClassControlLetter(state)) {
      return true
    }
    state.pos = start;
  }

  return (
    this.regexp_eatCharacterClassEscape(state) ||
    this.regexp_eatCharacterEscape(state)
  )
};

// https://tc39.es/ecma262/#prod-ClassSetExpression
// https://tc39.es/ecma262/#prod-ClassUnion
// https://tc39.es/ecma262/#prod-ClassIntersection
// https://tc39.es/ecma262/#prod-ClassSubtraction
pp$1.regexp_classSetExpression = function(state) {
  var result = CharSetOk, subResult;
  if (this.regexp_eatClassSetRange(state)) ; else if (subResult = this.regexp_eatClassSetOperand(state)) {
    if (subResult === CharSetString) { result = CharSetString; }
    // https://tc39.es/ecma262/#prod-ClassIntersection
    var start = state.pos;
    while (state.eatChars([0x26, 0x26] /* && */)) {
      if (
        state.current() !== 0x26 /* & */ &&
        (subResult = this.regexp_eatClassSetOperand(state))
      ) {
        if (subResult !== CharSetString) { result = CharSetOk; }
        continue
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) { return result }
    // https://tc39.es/ecma262/#prod-ClassSubtraction
    while (state.eatChars([0x2D, 0x2D] /* -- */)) {
      if (this.regexp_eatClassSetOperand(state)) { continue }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) { return result }
  } else {
    state.raise("Invalid character in character class");
  }
  // https://tc39.es/ecma262/#prod-ClassUnion
  for (;;) {
    if (this.regexp_eatClassSetRange(state)) { continue }
    subResult = this.regexp_eatClassSetOperand(state);
    if (!subResult) { return result }
    if (subResult === CharSetString) { result = CharSetString; }
  }
};

// https://tc39.es/ecma262/#prod-ClassSetRange
pp$1.regexp_eatClassSetRange = function(state) {
  var start = state.pos;
  if (this.regexp_eatClassSetCharacter(state)) {
    var left = state.lastIntValue;
    if (state.eat(0x2D /* - */) && this.regexp_eatClassSetCharacter(state)) {
      var right = state.lastIntValue;
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
      return true
    }
    state.pos = start;
  }
  return false
};

// https://tc39.es/ecma262/#prod-ClassSetOperand
pp$1.regexp_eatClassSetOperand = function(state) {
  if (this.regexp_eatClassSetCharacter(state)) { return CharSetOk }
  return this.regexp_eatClassStringDisjunction(state) || this.regexp_eatNestedClass(state)
};

// https://tc39.es/ecma262/#prod-NestedClass
pp$1.regexp_eatNestedClass = function(state) {
  var start = state.pos;
  if (state.eat(0x5B /* [ */)) {
    var negate = state.eat(0x5E /* ^ */);
    var result = this.regexp_classContents(state);
    if (state.eat(0x5D /* ] */)) {
      if (negate && result === CharSetString) {
        state.raise("Negated character class may contain strings");
      }
      return result
    }
    state.pos = start;
  }
  if (state.eat(0x5C /* \ */)) {
    var result$1 = this.regexp_eatCharacterClassEscape(state);
    if (result$1) {
      return result$1
    }
    state.pos = start;
  }
  return null
};

// https://tc39.es/ecma262/#prod-ClassStringDisjunction
pp$1.regexp_eatClassStringDisjunction = function(state) {
  var start = state.pos;
  if (state.eatChars([0x5C, 0x71] /* \q */)) {
    if (state.eat(0x7B /* { */)) {
      var result = this.regexp_classStringDisjunctionContents(state);
      if (state.eat(0x7D /* } */)) {
        return result
      }
    } else {
      // Make the same message as V8.
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return null
};

// https://tc39.es/ecma262/#prod-ClassStringDisjunctionContents
pp$1.regexp_classStringDisjunctionContents = function(state) {
  var result = this.regexp_classString(state);
  while (state.eat(0x7C /* | */)) {
    if (this.regexp_classString(state) === CharSetString) { result = CharSetString; }
  }
  return result
};

// https://tc39.es/ecma262/#prod-ClassString
// https://tc39.es/ecma262/#prod-NonEmptyClassString
pp$1.regexp_classString = function(state) {
  var count = 0;
  while (this.regexp_eatClassSetCharacter(state)) { count++; }
  return count === 1 ? CharSetOk : CharSetString
};

// https://tc39.es/ecma262/#prod-ClassSetCharacter
pp$1.regexp_eatClassSetCharacter = function(state) {
  var start = state.pos;
  if (state.eat(0x5C /* \ */)) {
    if (
      this.regexp_eatCharacterEscape(state) ||
      this.regexp_eatClassSetReservedPunctuator(state)
    ) {
      return true
    }
    if (state.eat(0x62 /* b */)) {
      state.lastIntValue = 0x08; /* <BS> */
      return true
    }
    state.pos = start;
    return false
  }
  var ch = state.current();
  if (ch < 0 || ch === state.lookahead() && isClassSetReservedDoublePunctuatorCharacter(ch)) { return false }
  if (isClassSetSyntaxCharacter(ch)) { return false }
  state.advance();
  state.lastIntValue = ch;
  return true
};

// https://tc39.es/ecma262/#prod-ClassSetReservedDoublePunctuator
function isClassSetReservedDoublePunctuatorCharacter(ch) {
  return (
    ch === 0x21 /* ! */ ||
    ch >= 0x23 /* # */ && ch <= 0x26 /* & */ ||
    ch >= 0x2A /* * */ && ch <= 0x2C /* , */ ||
    ch === 0x2E /* . */ ||
    ch >= 0x3A /* : */ && ch <= 0x40 /* @ */ ||
    ch === 0x5E /* ^ */ ||
    ch === 0x60 /* ` */ ||
    ch === 0x7E /* ~ */
  )
}

// https://tc39.es/ecma262/#prod-ClassSetSyntaxCharacter
function isClassSetSyntaxCharacter(ch) {
  return (
    ch === 0x28 /* ( */ ||
    ch === 0x29 /* ) */ ||
    ch === 0x2D /* - */ ||
    ch === 0x2F /* / */ ||
    ch >= 0x5B /* [ */ && ch <= 0x5D /* ] */ ||
    ch >= 0x7B /* { */ && ch <= 0x7D /* } */
  )
}

// https://tc39.es/ecma262/#prod-ClassSetReservedPunctuator
pp$1.regexp_eatClassSetReservedPunctuator = function(state) {
  var ch = state.current();
  if (isClassSetReservedPunctuator(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }
  return false
};

// https://tc39.es/ecma262/#prod-ClassSetReservedPunctuator
function isClassSetReservedPunctuator(ch) {
  return (
    ch === 0x21 /* ! */ ||
    ch === 0x23 /* # */ ||
    ch === 0x25 /* % */ ||
    ch === 0x26 /* & */ ||
    ch === 0x2C /* , */ ||
    ch === 0x2D /* - */ ||
    ch >= 0x3A /* : */ && ch <= 0x3E /* > */ ||
    ch === 0x40 /* @ */ ||
    ch === 0x60 /* ` */ ||
    ch === 0x7E /* ~ */
  )
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassControlLetter
pp$1.regexp_eatClassControlLetter = function(state) {
  var ch = state.current();
  if (isDecimalDigit(ch) || ch === 0x5F /* _ */) {
    state.lastIntValue = ch % 0x20;
    state.advance();
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
pp$1.regexp_eatHexEscapeSequence = function(state) {
  var start = state.pos;
  if (state.eat(0x78 /* x */)) {
    if (this.regexp_eatFixedHexDigits(state, 2)) {
      return true
    }
    if (state.switchU) {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalDigits
pp$1.regexp_eatDecimalDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isDecimalDigit(ch = state.current())) {
    state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
    state.advance();
  }
  return state.pos !== start
};
function isDecimalDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigits
pp$1.regexp_eatHexDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isHexDigit(ch = state.current())) {
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return state.pos !== start
};
function isHexDigit(ch) {
  return (
    (ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */) ||
    (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) ||
    (ch >= 0x61 /* a */ && ch <= 0x66 /* f */)
  )
}
function hexToInt(ch) {
  if (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) {
    return 10 + (ch - 0x41 /* A */)
  }
  if (ch >= 0x61 /* a */ && ch <= 0x66 /* f */) {
    return 10 + (ch - 0x61 /* a */)
  }
  return ch - 0x30 /* 0 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-LegacyOctalEscapeSequence
// Allows only 0-377(octal) i.e. 0-255(decimal).
pp$1.regexp_eatLegacyOctalEscapeSequence = function(state) {
  if (this.regexp_eatOctalDigit(state)) {
    var n1 = state.lastIntValue;
    if (this.regexp_eatOctalDigit(state)) {
      var n2 = state.lastIntValue;
      if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
        state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
      } else {
        state.lastIntValue = n1 * 8 + n2;
      }
    } else {
      state.lastIntValue = n1;
    }
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-OctalDigit
pp$1.regexp_eatOctalDigit = function(state) {
  var ch = state.current();
  if (isOctalDigit(ch)) {
    state.lastIntValue = ch - 0x30; /* 0 */
    state.advance();
    return true
  }
  state.lastIntValue = 0;
  return false
};
function isOctalDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x37 /* 7 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-Hex4Digits
// https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigit
// And HexDigit HexDigit in https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
pp$1.regexp_eatFixedHexDigits = function(state, length) {
  var start = state.pos;
  state.lastIntValue = 0;
  for (var i = 0; i < length; ++i) {
    var ch = state.current();
    if (!isHexDigit(ch)) {
      state.pos = start;
      return false
    }
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return true
};

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

var Token = function Token(p) {
  this.type = p.type;
  this.value = p.value;
  this.start = p.start;
  this.end = p.end;
  if (p.options.locations)
    { this.loc = new SourceLocation(p, p.startLoc, p.endLoc); }
  if (p.options.ranges)
    { this.range = [p.start, p.end]; }
};

// ## Tokenizer

var pp = Parser.prototype;

// Move to the next token

pp.next = function(ignoreEscapeSequenceInKeyword) {
  if (!ignoreEscapeSequenceInKeyword && this.type.keyword && this.containsEsc)
    { this.raiseRecoverable(this.start, "Escape sequence in keyword " + this.type.keyword); }
  if (this.options.onToken)
    { this.options.onToken(new Token(this)); }

  this.lastTokEnd = this.end;
  this.lastTokStart = this.start;
  this.lastTokEndLoc = this.endLoc;
  this.lastTokStartLoc = this.startLoc;
  this.nextToken();
};

pp.getToken = function() {
  this.next();
  return new Token(this)
};

// If we're in an ES6 environment, make parsers iterable
if (typeof Symbol !== "undefined")
  { pp[Symbol.iterator] = function() {
    var this$1$1 = this;

    return {
      next: function () {
        var token = this$1$1.getToken();
        return {
          done: token.type === types$1.eof,
          value: token
        }
      }
    }
  }; }

// Toggle strict mode. Re-reads the next number or string to please
// pedantic tests (`"use strict"; 010;` should fail).

// Read a single token, updating the parser object's token-related
// properties.

pp.nextToken = function() {
  var curContext = this.curContext();
  if (!curContext || !curContext.preserveSpace) { this.skipSpace(); }

  this.start = this.pos;
  if (this.options.locations) { this.startLoc = this.curPosition(); }
  if (this.pos >= this.input.length) { return this.finishToken(types$1.eof) }

  if (curContext.override) { return curContext.override(this) }
  else { this.readToken(this.fullCharCodeAtPos()); }
};

pp.readToken = function(code) {
  // Identifier or keyword. '\uXXXX' sequences are allowed in
  // identifiers, so '\' also dispatches to that.
  if (isIdentifierStart(code, this.options.ecmaVersion >= 6) || code === 92 /* '\' */)
    { return this.readWord() }

  return this.getTokenFromCode(code)
};

pp.fullCharCodeAt = function(pos) {
  var code = this.input.charCodeAt(pos);
  if (code <= 0xd7ff || code >= 0xdc00) { return code }
  var next = this.input.charCodeAt(pos + 1);
  return next <= 0xdbff || next >= 0xe000 ? code : (code << 10) + next - 0x35fdc00
};

pp.fullCharCodeAtPos = function() {
  return this.fullCharCodeAt(this.pos)
};

pp.skipBlockComment = function() {
  var startLoc = this.options.onComment && this.curPosition();
  var start = this.pos, end = this.input.indexOf("*/", this.pos += 2);
  if (end === -1) { this.raise(this.pos - 2, "Unterminated comment"); }
  this.pos = end + 2;
  if (this.options.locations) {
    for (var nextBreak = (void 0), pos = start; (nextBreak = nextLineBreak(this.input, pos, this.pos)) > -1;) {
      ++this.curLine;
      pos = this.lineStart = nextBreak;
    }
  }
  if (this.options.onComment)
    { this.options.onComment(true, this.input.slice(start + 2, end), start, this.pos,
                           startLoc, this.curPosition()); }
};

pp.skipLineComment = function(startSkip) {
  var start = this.pos;
  var startLoc = this.options.onComment && this.curPosition();
  var ch = this.input.charCodeAt(this.pos += startSkip);
  while (this.pos < this.input.length && !isNewLine(ch)) {
    ch = this.input.charCodeAt(++this.pos);
  }
  if (this.options.onComment)
    { this.options.onComment(false, this.input.slice(start + startSkip, this.pos), start, this.pos,
                           startLoc, this.curPosition()); }
};

// Called at the start of the parse and after every token. Skips
// whitespace and comments, and.

pp.skipSpace = function() {
  loop: while (this.pos < this.input.length) {
    var ch = this.input.charCodeAt(this.pos);
    switch (ch) {
    case 32: case 160: // ' '
      ++this.pos;
      break
    case 13:
      if (this.input.charCodeAt(this.pos + 1) === 10) {
        ++this.pos;
      }
    case 10: case 8232: case 8233:
      ++this.pos;
      if (this.options.locations) {
        ++this.curLine;
        this.lineStart = this.pos;
      }
      break
    case 47: // '/'
      switch (this.input.charCodeAt(this.pos + 1)) {
      case 42: // '*'
        this.skipBlockComment();
        break
      case 47:
        this.skipLineComment(2);
        break
      default:
        break loop
      }
      break
    default:
      if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
        ++this.pos;
      } else {
        break loop
      }
    }
  }
};

// Called at the end of every token. Sets `end`, `val`, and
// maintains `context` and `exprAllowed`, and skips the space after
// the token, so that the next one's `start` will point at the
// right position.

pp.finishToken = function(type, val) {
  this.end = this.pos;
  if (this.options.locations) { this.endLoc = this.curPosition(); }
  var prevType = this.type;
  this.type = type;
  this.value = val;

  this.updateContext(prevType);
};

// ### Token reading

// This is the function that is called to fetch the next token. It
// is somewhat obscure, because it works in character codes rather
// than characters, and because operator parsing has been inlined
// into it.
//
// All in the name of speed.
//
pp.readToken_dot = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) { return this.readNumber(true) }
  var next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) { // 46 = dot '.'
    this.pos += 3;
    return this.finishToken(types$1.ellipsis)
  } else {
    ++this.pos;
    return this.finishToken(types$1.dot)
  }
};

pp.readToken_slash = function() { // '/'
  var next = this.input.charCodeAt(this.pos + 1);
  if (this.exprAllowed) { ++this.pos; return this.readRegexp() }
  if (next === 61) { return this.finishOp(types$1.assign, 2) }
  return this.finishOp(types$1.slash, 1)
};

pp.readToken_mult_modulo_exp = function(code) { // '%*'
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  var tokentype = code === 42 ? types$1.star : types$1.modulo;

  // exponentiation operator ** and **=
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = types$1.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }

  if (next === 61) { return this.finishOp(types$1.assign, size + 1) }
  return this.finishOp(tokentype, size)
};

pp.readToken_pipe_amp = function(code) { // '|&'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (this.options.ecmaVersion >= 12) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) { return this.finishOp(types$1.assign, 3) }
    }
    return this.finishOp(code === 124 ? types$1.logicalOR : types$1.logicalAND, 2)
  }
  if (next === 61) { return this.finishOp(types$1.assign, 2) }
  return this.finishOp(code === 124 ? types$1.bitwiseOR : types$1.bitwiseAND, 1)
};

pp.readToken_caret = function() { // '^'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) { return this.finishOp(types$1.assign, 2) }
  return this.finishOp(types$1.bitwiseXOR, 1)
};

pp.readToken_plus_min = function(code) { // '+-'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 &&
        (this.lastTokEnd === 0 || lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
      // A `-->` line comment
      this.skipLineComment(3);
      this.skipSpace();
      return this.nextToken()
    }
    return this.finishOp(types$1.incDec, 2)
  }
  if (next === 61) { return this.finishOp(types$1.assign, 2) }
  return this.finishOp(types$1.plusMin, 1)
};

pp.readToken_lt_gt = function(code) { // '<>'
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  if (next === code) {
    size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
    if (this.input.charCodeAt(this.pos + size) === 61) { return this.finishOp(types$1.assign, size + 1) }
    return this.finishOp(types$1.bitShift, size)
  }
  if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 &&
      this.input.charCodeAt(this.pos + 3) === 45) {
    // `<!--`, an XML-style comment that should be interpreted as a line comment
    this.skipLineComment(4);
    this.skipSpace();
    return this.nextToken()
  }
  if (next === 61) { size = 2; }
  return this.finishOp(types$1.relational, size)
};

pp.readToken_eq_excl = function(code) { // '=!'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) { return this.finishOp(types$1.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2) }
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) { // '=>'
    this.pos += 2;
    return this.finishToken(types$1.arrow)
  }
  return this.finishOp(code === 61 ? types$1.eq : types$1.prefix, 1)
};

pp.readToken_question = function() { // '?'
  var ecmaVersion = this.options.ecmaVersion;
  if (ecmaVersion >= 11) {
    var next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) { return this.finishOp(types$1.questionDot, 2) }
    }
    if (next === 63) {
      if (ecmaVersion >= 12) {
        var next2$1 = this.input.charCodeAt(this.pos + 2);
        if (next2$1 === 61) { return this.finishOp(types$1.assign, 3) }
      }
      return this.finishOp(types$1.coalesce, 2)
    }
  }
  return this.finishOp(types$1.question, 1)
};

pp.readToken_numberSign = function() { // '#'
  var ecmaVersion = this.options.ecmaVersion;
  var code = 35; // '#'
  if (ecmaVersion >= 13) {
    ++this.pos;
    code = this.fullCharCodeAtPos();
    if (isIdentifierStart(code, true) || code === 92 /* '\' */) {
      return this.finishToken(types$1.privateId, this.readWord1())
    }
  }

  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};

pp.getTokenFromCode = function(code) {
  switch (code) {
  // The interpretation of a dot depends on whether it is followed
  // by a digit or another two dots.
  case 46: // '.'
    return this.readToken_dot()

  // Punctuation tokens.
  case 40: ++this.pos; return this.finishToken(types$1.parenL)
  case 41: ++this.pos; return this.finishToken(types$1.parenR)
  case 59: ++this.pos; return this.finishToken(types$1.semi)
  case 44: ++this.pos; return this.finishToken(types$1.comma)
  case 91: ++this.pos; return this.finishToken(types$1.bracketL)
  case 93: ++this.pos; return this.finishToken(types$1.bracketR)
  case 123: ++this.pos; return this.finishToken(types$1.braceL)
  case 125: ++this.pos; return this.finishToken(types$1.braceR)
  case 58: ++this.pos; return this.finishToken(types$1.colon)

  case 96: // '`'
    if (this.options.ecmaVersion < 6) { break }
    ++this.pos;
    return this.finishToken(types$1.backQuote)

  case 48: // '0'
    var next = this.input.charCodeAt(this.pos + 1);
    if (next === 120 || next === 88) { return this.readRadixNumber(16) } // '0x', '0X' - hex number
    if (this.options.ecmaVersion >= 6) {
      if (next === 111 || next === 79) { return this.readRadixNumber(8) } // '0o', '0O' - octal number
      if (next === 98 || next === 66) { return this.readRadixNumber(2) } // '0b', '0B' - binary number
    }

  // Anything else beginning with a digit is an integer, octal
  // number, or float.
  case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
    return this.readNumber(false)

  // Quotes produce strings.
  case 34: case 39: // '"', "'"
    return this.readString(code)

  // Operators are parsed inline in tiny state machines. '=' (61) is
  // often referred to. `finishOp` simply skips the amount of
  // characters it is given as second argument, and returns a token
  // of the type given by its first argument.
  case 47: // '/'
    return this.readToken_slash()

  case 37: case 42: // '%*'
    return this.readToken_mult_modulo_exp(code)

  case 124: case 38: // '|&'
    return this.readToken_pipe_amp(code)

  case 94: // '^'
    return this.readToken_caret()

  case 43: case 45: // '+-'
    return this.readToken_plus_min(code)

  case 60: case 62: // '<>'
    return this.readToken_lt_gt(code)

  case 61: case 33: // '=!'
    return this.readToken_eq_excl(code)

  case 63: // '?'
    return this.readToken_question()

  case 126: // '~'
    return this.finishOp(types$1.prefix, 1)

  case 35: // '#'
    return this.readToken_numberSign()
  }

  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};

pp.finishOp = function(type, size) {
  var str = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finishToken(type, str)
};

pp.readRegexp = function() {
  var escaped, inClass, start = this.pos;
  for (;;) {
    if (this.pos >= this.input.length) { this.raise(start, "Unterminated regular expression"); }
    var ch = this.input.charAt(this.pos);
    if (lineBreak.test(ch)) { this.raise(start, "Unterminated regular expression"); }
    if (!escaped) {
      if (ch === "[") { inClass = true; }
      else if (ch === "]" && inClass) { inClass = false; }
      else if (ch === "/" && !inClass) { break }
      escaped = ch === "\\";
    } else { escaped = false; }
    ++this.pos;
  }
  var pattern = this.input.slice(start, this.pos);
  ++this.pos;
  var flagsStart = this.pos;
  var flags = this.readWord1();
  if (this.containsEsc) { this.unexpected(flagsStart); }

  // Validate pattern
  var state = this.regexpState || (this.regexpState = new RegExpValidationState(this));
  state.reset(start, pattern, flags);
  this.validateRegExpFlags(state);
  this.validateRegExpPattern(state);

  // Create Literal#value property value.
  var value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch (e) {
    // ESTree requires null if it failed to instantiate RegExp object.
    // https://github.com/estree/estree/blob/a27003adf4fd7bfad44de9cef372a2eacd527b1c/es5.md#regexpliteral
  }

  return this.finishToken(types$1.regexp, {pattern: pattern, flags: flags, value: value})
};

// Read an integer in the given radix. Return null if zero digits
// were read, the integer value otherwise. When `len` is given, this
// will return `null` unless the integer has exactly `len` digits.

pp.readInt = function(radix, len, maybeLegacyOctalNumericLiteral) {
  // `len` is used for character escape sequences. In that case, disallow separators.
  var allowSeparators = this.options.ecmaVersion >= 12 && len === undefined;

  // `maybeLegacyOctalNumericLiteral` is true if it doesn't have prefix (0x,0o,0b)
  // and isn't fraction part nor exponent part. In that case, if the first digit
  // is zero then disallow separators.
  var isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && this.input.charCodeAt(this.pos) === 48;

  var start = this.pos, total = 0, lastCode = 0;
  for (var i = 0, e = len == null ? Infinity : len; i < e; ++i, ++this.pos) {
    var code = this.input.charCodeAt(this.pos), val = (void 0);

    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral) { this.raiseRecoverable(this.pos, "Numeric separator is not allowed in legacy octal numeric literals"); }
      if (lastCode === 95) { this.raiseRecoverable(this.pos, "Numeric separator must be exactly one underscore"); }
      if (i === 0) { this.raiseRecoverable(this.pos, "Numeric separator is not allowed at the first of digits"); }
      lastCode = code;
      continue
    }

    if (code >= 97) { val = code - 97 + 10; } // a
    else if (code >= 65) { val = code - 65 + 10; } // A
    else if (code >= 48 && code <= 57) { val = code - 48; } // 0-9
    else { val = Infinity; }
    if (val >= radix) { break }
    lastCode = code;
    total = total * radix + val;
  }

  if (allowSeparators && lastCode === 95) { this.raiseRecoverable(this.pos - 1, "Numeric separator is not allowed at the last of digits"); }
  if (this.pos === start || len != null && this.pos - start !== len) { return null }

  return total
};

function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) {
    return parseInt(str, 8)
  }

  // `parseFloat(value)` stops parsing at the first numeric separator then returns a wrong value.
  return parseFloat(str.replace(/_/g, ""))
}

function stringToBigInt(str) {
  if (typeof BigInt !== "function") {
    return null
  }

  // `BigInt(value)` throws syntax error if the string contains numeric separators.
  return BigInt(str.replace(/_/g, ""))
}

pp.readRadixNumber = function(radix) {
  var start = this.pos;
  this.pos += 2; // 0x
  var val = this.readInt(radix);
  if (val == null) { this.raise(this.start + 2, "Expected number in radix " + radix); }
  if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
    val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
  } else if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }
  return this.finishToken(types$1.num, val)
};

// Read an integer, octal integer, or floating-point number.

pp.readNumber = function(startsWithDot) {
  var start = this.pos;
  if (!startsWithDot && this.readInt(10, undefined, true) === null) { this.raise(start, "Invalid number"); }
  var octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) { this.raise(start, "Invalid number"); }
  var next = this.input.charCodeAt(this.pos);
  if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
    var val$1 = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
    if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }
    return this.finishToken(types$1.num, val$1)
  }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) { octal = false; }
  if (next === 46 && !octal) { // '.'
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) { // 'eE'
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) { ++this.pos; } // '+-'
    if (this.readInt(10) === null) { this.raise(start, "Invalid number"); }
  }
  if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }

  var val = stringToNumber(this.input.slice(start, this.pos), octal);
  return this.finishToken(types$1.num, val)
};

// Read a string value, interpreting backslash-escapes.

pp.readCodePoint = function() {
  var ch = this.input.charCodeAt(this.pos), code;

  if (ch === 123) { // '{'
    if (this.options.ecmaVersion < 6) { this.unexpected(); }
    var codePos = ++this.pos;
    code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
    ++this.pos;
    if (code > 0x10FFFF) { this.invalidStringToken(codePos, "Code point out of bounds"); }
  } else {
    code = this.readHexChar(4);
  }
  return code
};

pp.readString = function(quote) {
  var out = "", chunkStart = ++this.pos;
  for (;;) {
    if (this.pos >= this.input.length) { this.raise(this.start, "Unterminated string constant"); }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === quote) { break }
    if (ch === 92) { // '\'
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(false);
      chunkStart = this.pos;
    } else if (ch === 0x2028 || ch === 0x2029) {
      if (this.options.ecmaVersion < 10) { this.raise(this.start, "Unterminated string constant"); }
      ++this.pos;
      if (this.options.locations) {
        this.curLine++;
        this.lineStart = this.pos;
      }
    } else {
      if (isNewLine(ch)) { this.raise(this.start, "Unterminated string constant"); }
      ++this.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(types$1.string, out)
};

// Reads template string tokens.

var INVALID_TEMPLATE_ESCAPE_ERROR = {};

pp.tryReadTemplateToken = function() {
  this.inTemplateElement = true;
  try {
    this.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      this.readInvalidTemplateToken();
    } else {
      throw err
    }
  }

  this.inTemplateElement = false;
};

pp.invalidStringToken = function(position, message) {
  if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR
  } else {
    this.raise(position, message);
  }
};

pp.readTmplToken = function() {
  var out = "", chunkStart = this.pos;
  for (;;) {
    if (this.pos >= this.input.length) { this.raise(this.start, "Unterminated template"); }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === 96 || ch === 36 && this.input.charCodeAt(this.pos + 1) === 123) { // '`', '${'
      if (this.pos === this.start && (this.type === types$1.template || this.type === types$1.invalidTemplate)) {
        if (ch === 36) {
          this.pos += 2;
          return this.finishToken(types$1.dollarBraceL)
        } else {
          ++this.pos;
          return this.finishToken(types$1.backQuote)
        }
      }
      out += this.input.slice(chunkStart, this.pos);
      return this.finishToken(types$1.template, out)
    }
    if (ch === 92) { // '\'
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(true);
      chunkStart = this.pos;
    } else if (isNewLine(ch)) {
      out += this.input.slice(chunkStart, this.pos);
      ++this.pos;
      switch (ch) {
      case 13:
        if (this.input.charCodeAt(this.pos) === 10) { ++this.pos; }
      case 10:
        out += "\n";
        break
      default:
        out += String.fromCharCode(ch);
        break
      }
      if (this.options.locations) {
        ++this.curLine;
        this.lineStart = this.pos;
      }
      chunkStart = this.pos;
    } else {
      ++this.pos;
    }
  }
};

// Reads a template token to search for the end, without validating any escape sequences
pp.readInvalidTemplateToken = function() {
  for (; this.pos < this.input.length; this.pos++) {
    switch (this.input[this.pos]) {
    case "\\":
      ++this.pos;
      break

    case "$":
      if (this.input[this.pos + 1] !== "{") { break }
      // fall through
    case "`":
      return this.finishToken(types$1.invalidTemplate, this.input.slice(this.start, this.pos))

    case "\r":
      if (this.input[this.pos + 1] === "\n") { ++this.pos; }
      // fall through
    case "\n": case "\u2028": case "\u2029":
      ++this.curLine;
      this.lineStart = this.pos + 1;
      break
    }
  }
  this.raise(this.start, "Unterminated template");
};

// Used to read escaped characters

pp.readEscapedChar = function(inTemplate) {
  var ch = this.input.charCodeAt(++this.pos);
  ++this.pos;
  switch (ch) {
  case 110: return "\n" // 'n' -> '\n'
  case 114: return "\r" // 'r' -> '\r'
  case 120: return String.fromCharCode(this.readHexChar(2)) // 'x'
  case 117: return codePointToString(this.readCodePoint()) // 'u'
  case 116: return "\t" // 't' -> '\t'
  case 98: return "\b" // 'b' -> '\b'
  case 118: return "\u000b" // 'v' -> '\u000b'
  case 102: return "\f" // 'f' -> '\f'
  case 13: if (this.input.charCodeAt(this.pos) === 10) { ++this.pos; } // '\r\n'
  case 10: // ' \n'
    if (this.options.locations) { this.lineStart = this.pos; ++this.curLine; }
    return ""
  case 56:
  case 57:
    if (this.strict) {
      this.invalidStringToken(
        this.pos - 1,
        "Invalid escape sequence"
      );
    }
    if (inTemplate) {
      var codePos = this.pos - 1;

      this.invalidStringToken(
        codePos,
        "Invalid escape sequence in template string"
      );
    }
  default:
    if (ch >= 48 && ch <= 55) {
      var octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
      var octal = parseInt(octalStr, 8);
      if (octal > 255) {
        octalStr = octalStr.slice(0, -1);
        octal = parseInt(octalStr, 8);
      }
      this.pos += octalStr.length - 1;
      ch = this.input.charCodeAt(this.pos);
      if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
        this.invalidStringToken(
          this.pos - 1 - octalStr.length,
          inTemplate
            ? "Octal literal in template string"
            : "Octal literal in strict mode"
        );
      }
      return String.fromCharCode(octal)
    }
    if (isNewLine(ch)) {
      // Unicode new line characters after \ get removed from output in both
      // template literals and strings
      if (this.options.locations) { this.lineStart = this.pos; ++this.curLine; }
      return ""
    }
    return String.fromCharCode(ch)
  }
};

// Used to read character escape sequences ('\x', '\u', '\U').

pp.readHexChar = function(len) {
  var codePos = this.pos;
  var n = this.readInt(16, len);
  if (n === null) { this.invalidStringToken(codePos, "Bad character escape sequence"); }
  return n
};

// Read an identifier, and return it as a string. Sets `this.containsEsc`
// to whether the word contained a '\u' escape.
//
// Incrementally adds only escaped chars, adding other chunks as-is
// as a micro-optimization.

pp.readWord1 = function() {
  this.containsEsc = false;
  var word = "", first = true, chunkStart = this.pos;
  var astral = this.options.ecmaVersion >= 6;
  while (this.pos < this.input.length) {
    var ch = this.fullCharCodeAtPos();
    if (isIdentifierChar(ch, astral)) {
      this.pos += ch <= 0xffff ? 1 : 2;
    } else if (ch === 92) { // "\"
      this.containsEsc = true;
      word += this.input.slice(chunkStart, this.pos);
      var escStart = this.pos;
      if (this.input.charCodeAt(++this.pos) !== 117) // "u"
        { this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX"); }
      ++this.pos;
      var esc = this.readCodePoint();
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral))
        { this.invalidStringToken(escStart, "Invalid Unicode escape"); }
      word += codePointToString(esc);
      chunkStart = this.pos;
    } else {
      break
    }
    first = false;
  }
  return word + this.input.slice(chunkStart, this.pos)
};

// Read an identifier or keyword token. Will check for reserved
// words when necessary.

pp.readWord = function() {
  var word = this.readWord1();
  var type = types$1.name;
  if (this.keywords.test(word)) {
    type = keywords[word];
  }
  return this.finishToken(type, word)
};

// Acorn is a tiny, fast JavaScript parser written in JavaScript.
//
// Acorn was written by Marijn Haverbeke, Ingvar Stepanyan, and
// various contributors and released under an MIT license.
//
// Git repositories for Acorn are available at
//
//     http://marijnhaverbeke.nl/git/acorn
//     https://github.com/acornjs/acorn.git
//
// Please use the [github bug tracker][ghbt] to report issues.
//
// [ghbt]: https://github.com/acornjs/acorn/issues


var version = "8.19.0";

Parser.acorn = {
  Parser: Parser,
  version: version,
  defaultOptions: defaultOptions,
  Position: Position,
  SourceLocation: SourceLocation,
  getLineInfo: getLineInfo,
  Node: Node,
  TokenType: TokenType,
  tokTypes: types$1,
  keywordTypes: keywords,
  TokContext: TokContext,
  tokContexts: types,
  isIdentifierChar: isIdentifierChar,
  isIdentifierStart: isIdentifierStart,
  Token: Token,
  isNewLine: isNewLine,
  lineBreak: lineBreak,
  lineBreakG: lineBreakG,
  nonASCIIwhitespace: nonASCIIwhitespace
};

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
// Reset the patch counters at the start of a patch run (Stage.patch).
// They are module-level counters, so without this the hashes, temp
// variable names and $$ANON_ names in one trace depend on how many
// traces this process has already run — the same program traced twice
// in one process got different event hashes, and analyze() embeds
// those hashes in its findings, so its output was not byte-stable
// across calls in one process. Patching is synchronous, so no two
// patch runs can interleave and collide; every counter is consumed
// only inside one patch run (hashes, temp vars, anonymous-function
// names, frame and patcher uids), so resetting per run is safe.
function resetPatchCounters() {
  utvidx = 1;
  uidx = 1;
  ubidx = 1;
}
function parse$1(input, options) {
  // Same default as helpers.parse: Acorn 8 requires ecmaVersion.
  // "latest" + allowHashBang: see helpers.parse.
  return parseWithDecorators(input, Object.assign({ ecmaVersion: "latest", allowHashBang: true }, options));
}
function generate$1() {
  return generate$2.apply(null, arguments);
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

var _utils = /*#__PURE__*/Object.freeze({
  __proto__: null,
  eventToJSON: eventToJSON,
  generate: generate$1,
  parse: parse$1,
  reserveTempVarId: reserveTempVarId,
  resetPatchCounters: resetPatchCounters,
  safeValue: safeValue,
  uBranchHash: uBranchHash,
  uid: uid
});

// AST walker module for ESTree compatible trees


// A recursive walk is one where your functions override the default
// walkers. They can modify and replace the state parameter that's
// threaded through the walk, and can opt how and whether to walk
// their child nodes (by calling their third argument on these
// nodes).
function recursive(node, state, funcs, baseVisitor, override) {
  var visitor = funcs ? make(funcs, baseVisitor || undefined) : baseVisitor
  ;(function c(node, st, override) {
    visitor[override || node.type](node, st, c);
  })(node, state, override);
}

// A full walk triggers the callback on each node
function full(node, callback, baseVisitor, state, override) {
  if (!baseVisitor) { baseVisitor = base; }
  var last
  ;(function c(node, st, override) {
    var type = override || node.type;
    visitNode(baseVisitor, type, node, st, c);
    if (last !== node) {
      callback(node, st, type);
      last = node;
    }
  })(node, state, override);
}

// Used to create a custom walker. Will fill in all missing node
// type properties with the defaults.
function make(funcs, baseVisitor) {
  var visitor = Object.create(baseVisitor || base);
  for (var type in funcs) { visitor[type] = funcs[type]; }
  return visitor
}

function skipThrough(node, st, c) { c(node, st); }
function ignore(_node, _st, _c) {}

function visitNode(baseVisitor, type, node, st, c) {
  if (baseVisitor[type] == null) { throw new Error(("No walker function defined for node type " + type)) }
  baseVisitor[type](node, st, c);
}

// Node walkers.

var base = {};

base.Program = base.BlockStatement = base.StaticBlock = function (node, st, c) {
  for (var i = 0, list = node.body; i < list.length; i += 1)
    {
    var stmt = list[i];

    c(stmt, st, "Statement");
  }
};
base.Statement = skipThrough;
base.EmptyStatement = ignore;
base.ExpressionStatement = base.ParenthesizedExpression = base.ChainExpression =
  function (node, st, c) { return c(node.expression, st, "Expression"); };
base.IfStatement = function (node, st, c) {
  c(node.test, st, "Expression");
  c(node.consequent, st, "Statement");
  if (node.alternate) { c(node.alternate, st, "Statement"); }
};
base.LabeledStatement = function (node, st, c) { return c(node.body, st, "Statement"); };
base.BreakStatement = base.ContinueStatement = ignore;
base.WithStatement = function (node, st, c) {
  c(node.object, st, "Expression");
  c(node.body, st, "Statement");
};
base.SwitchStatement = function (node, st, c) {
  c(node.discriminant, st, "Expression");
  for (var i = 0, list = node.cases; i < list.length; i += 1) {
    var cs = list[i];

    c(cs, st);
  }
};
base.SwitchCase = function (node, st, c) {
  if (node.test) { c(node.test, st, "Expression"); }
  for (var i = 0, list = node.consequent; i < list.length; i += 1)
    {
    var cons = list[i];

    c(cons, st, "Statement");
  }
};
base.ReturnStatement = base.YieldExpression = base.AwaitExpression = function (node, st, c) {
  if (node.argument) { c(node.argument, st, "Expression"); }
};
base.ThrowStatement = base.SpreadElement =
  function (node, st, c) { return c(node.argument, st, "Expression"); };
base.TryStatement = function (node, st, c) {
  c(node.block, st, "Statement");
  if (node.handler) { c(node.handler, st); }
  if (node.finalizer) { c(node.finalizer, st, "Statement"); }
};
base.CatchClause = function (node, st, c) {
  if (node.param) { c(node.param, st, "Pattern"); }
  c(node.body, st, "Statement");
};
base.WhileStatement = base.DoWhileStatement = function (node, st, c) {
  c(node.test, st, "Expression");
  c(node.body, st, "Statement");
};
base.ForStatement = function (node, st, c) {
  if (node.init) { c(node.init, st, "ForInit"); }
  if (node.test) { c(node.test, st, "Expression"); }
  if (node.update) { c(node.update, st, "Expression"); }
  c(node.body, st, "Statement");
};
base.ForInStatement = base.ForOfStatement = function (node, st, c) {
  c(node.left, st, "ForInit");
  c(node.right, st, "Expression");
  c(node.body, st, "Statement");
};
base.ForInit = function (node, st, c) {
  if (node.type === "VariableDeclaration") { c(node, st); }
  else { c(node, st, "Expression"); }
};
base.DebuggerStatement = ignore;

base.FunctionDeclaration = function (node, st, c) { return c(node, st, "Function"); };
base.VariableDeclaration = function (node, st, c) {
  for (var i = 0, list = node.declarations; i < list.length; i += 1)
    {
    var decl = list[i];

    c(decl, st);
  }
};
base.VariableDeclarator = function (node, st, c) {
  c(node.id, st, "Pattern");
  if (node.init) { c(node.init, st, "Expression"); }
};

base.Function = function (node, st, c) {
  if (node.id) { c(node.id, st, "Pattern"); }
  for (var i = 0, list = node.params; i < list.length; i += 1)
    {
    var param = list[i];

    c(param, st, "Pattern");
  }
  c(node.body, st, node.expression ? "Expression" : "Statement");
};

base.Pattern = function (node, st, c) {
  if (node.type === "Identifier")
    { c(node, st, "VariablePattern"); }
  else if (node.type === "MemberExpression")
    { c(node, st, "MemberPattern"); }
  else
    { c(node, st); }
};
base.VariablePattern = ignore;
base.MemberPattern = skipThrough;
base.RestElement = function (node, st, c) { return c(node.argument, st, "Pattern"); };
base.ArrayPattern = function (node, st, c) {
  for (var i = 0, list = node.elements; i < list.length; i += 1) {
    var elt = list[i];

    if (elt) { c(elt, st, "Pattern"); }
  }
};
base.ObjectPattern = function (node, st, c) {
  for (var i = 0, list = node.properties; i < list.length; i += 1) {
    var prop = list[i];

    if (prop.type === "Property") {
      if (prop.computed) { c(prop.key, st, "Expression"); }
      c(prop.value, st, "Pattern");
    } else if (prop.type === "RestElement") {
      c(prop.argument, st, "Pattern");
    }
  }
};

base.Expression = skipThrough;
base.ThisExpression = base.Super = base.MetaProperty = ignore;
base.ArrayExpression = function (node, st, c) {
  for (var i = 0, list = node.elements; i < list.length; i += 1) {
    var elt = list[i];

    if (elt) { c(elt, st, "Expression"); }
  }
};
base.ObjectExpression = function (node, st, c) {
  for (var i = 0, list = node.properties; i < list.length; i += 1)
    {
    var prop = list[i];

    c(prop, st);
  }
};
base.FunctionExpression = base.ArrowFunctionExpression = base.FunctionDeclaration;
base.SequenceExpression = function (node, st, c) {
  for (var i = 0, list = node.expressions; i < list.length; i += 1)
    {
    var expr = list[i];

    c(expr, st, "Expression");
  }
};
base.TemplateLiteral = function (node, st, c) {
  for (var i = 0, list = node.quasis; i < list.length; i += 1)
    {
    var quasi = list[i];

    c(quasi, st);
  }

  for (var i$1 = 0, list$1 = node.expressions; i$1 < list$1.length; i$1 += 1)
    {
    var expr = list$1[i$1];

    c(expr, st, "Expression");
  }
};
base.TemplateElement = ignore;
base.UnaryExpression = base.UpdateExpression = function (node, st, c) {
  c(node.argument, st, "Expression");
};
base.BinaryExpression = base.LogicalExpression = function (node, st, c) {
  c(node.left, st, "Expression");
  c(node.right, st, "Expression");
};
base.AssignmentExpression = base.AssignmentPattern = function (node, st, c) {
  c(node.left, st, "Pattern");
  c(node.right, st, "Expression");
};
base.ConditionalExpression = function (node, st, c) {
  c(node.test, st, "Expression");
  c(node.consequent, st, "Expression");
  c(node.alternate, st, "Expression");
};
base.NewExpression = base.CallExpression = function (node, st, c) {
  c(node.callee, st, "Expression");
  if (node.arguments)
    { for (var i = 0, list = node.arguments; i < list.length; i += 1)
      {
        var arg = list[i];

        c(arg, st, "Expression");
      } }
};
base.MemberExpression = function (node, st, c) {
  c(node.object, st, "Expression");
  if (node.computed) { c(node.property, st, "Expression"); }
};
base.ExportNamedDeclaration = base.ExportDefaultDeclaration = function (node, st, c) {
  if (node.declaration)
    { c(node.declaration, st, node.type === "ExportNamedDeclaration" || node.declaration.id ? "Statement" : "Expression"); }
  if (node.source) { c(node.source, st, "Expression"); }
  if (node.attributes)
    { for (var i = 0, list = node.attributes; i < list.length; i += 1)
      {
        var attr = list[i];

        c(attr, st);
      } }
};
base.ExportAllDeclaration = function (node, st, c) {
  if (node.exported)
    { c(node.exported, st); }
  c(node.source, st, "Expression");
  if (node.attributes)
    { for (var i = 0, list = node.attributes; i < list.length; i += 1)
      {
        var attr = list[i];

        c(attr, st);
      } }
};
base.ImportAttribute = function (node, st, c) {
  c(node.value, st, "Expression");
};
base.ImportDeclaration = function (node, st, c) {
  for (var i = 0, list = node.specifiers; i < list.length; i += 1)
    {
    var spec = list[i];

    c(spec, st);
  }
  c(node.source, st, "Expression");
  if (node.attributes)
    { for (var i$1 = 0, list$1 = node.attributes; i$1 < list$1.length; i$1 += 1)
      {
        var attr = list$1[i$1];

        c(attr, st);
      } }
};
base.ImportExpression = function (node, st, c) {
  c(node.source, st, "Expression");
  if (node.options) { c(node.options, st, "Expression"); }
};
base.ImportSpecifier = base.ImportDefaultSpecifier = base.ImportNamespaceSpecifier = base.Identifier = base.PrivateIdentifier = base.Literal = ignore;

base.TaggedTemplateExpression = function (node, st, c) {
  c(node.tag, st, "Expression");
  c(node.quasi, st, "Expression");
};
base.ClassDeclaration = base.ClassExpression = function (node, st, c) { return c(node, st, "Class"); };
base.Class = function (node, st, c) {
  if (node.id) { c(node.id, st, "Pattern"); }
  if (node.superClass) { c(node.superClass, st, "Expression"); }
  c(node.body, st);
};
base.ClassBody = function (node, st, c) {
  for (var i = 0, list = node.body; i < list.length; i += 1)
    {
    var elt = list[i];

    c(elt, st);
  }
};
base.MethodDefinition = base.PropertyDefinition = base.Property = function (node, st, c) {
  if (node.computed) { c(node.key, st, "Expression"); }
  if (node.value) { c(node.value, st, "Expression"); }
};

function instructionToString(n) {
  for (let key in INSTR) {
    let value = INSTR[key];
    if (value === n) return key;
  }  console.warn(`Unexpected instruction value ${n}`);
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
  body.unshift(patch);
}
function resolveCallee(node) {
  node.type;
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
  }  return "undefined";
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
  }  return node;
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
function parse(input, options) {
  // Acorn 8 requires ecmaVersion; default it so every internal
  // parseExpression/parseExpressionStatement call parses modern syntax
  // instead of warning and falling back to ES2020. "latest" tracks the
  // newest syntax Acorn supports (ES2025 RegExp modifiers, `using`
  // declarations, import attributes); allowHashBang lets traced scripts
  // start with a #! line. Callers may still override ecmaVersion via
  // options.
  return parseWithDecorators(input, Object.assign({ ecmaVersion: "latest", allowHashBang: true }, options));
}
function generate() {
  return generate$2.apply(null, arguments);
}
function parseExpression(input) {
  let node = parse(input);
  let result = node.body[0].expression;
  deepMagicPatch(result);
  return result;
}
function parseExpressionStatement(input) {
  let node = parse(input);
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
  }  return -1;
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
    }    return frame;
  }
  getDepth() {
    let depth = 0;
    let frame = this;
    while (true) {
      if (frame.isGlobal()) break;
      frame = frame.parent;
      depth++;
    }    return depth;
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
    }    return ctx;
  }
  getLoopContext() {
    let ctx = this;
    while (true) {
      if (ctx.isLoop) break;
      ctx = ctx.parent;
    }    return ctx;
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
  }};

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
  }};

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
  }  node.magic = true;
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
  }  node.magic = true;
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
  }  // patch
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
  }};

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
  }};

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
  }};

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
  }};

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
  // skip the last property and manually
  // access it inside the debug function
  if (arg.type === "MemberExpression") {
    if (arg.property.type === "Identifier") {
      if (arg.computed) {
        arg.property;
      } else {
        ({
          magic: true,
          type: "Literal",
          value: arg.property.name
        });
      }
    } else {
      arg.property;
    }
    arg.object;
  }
  // identifier based assignment
  // fixed up below by turning into assign expr again
  else if (arg.type === "Identifier") {
    parseExpression(null);
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
  }};

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
  }};

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
  }};

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

  cloneNode(node.test);
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
  }};

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
  (
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
    isSwitchStatement(child.type);
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
  }};

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
    let hash = nextHash();
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
          let hash = nextHash();
          patcher.nodes[hash] = { hash: hash, node: cloneNode(dec) };
          let resTemp = temp();
          applyStmts.push(stmt(magic({
            type: "AssignmentExpression",
            operator: "=",
            left: ident(resTemp),
            right: applyCall(patcher, hash, dec.expression, ident(valueTemp), makeContext()),
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
    let hash = nextHash();
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
  let hash = nextHash();
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
    }  }
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
  }}
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
  }}
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
  }}

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
}function DEBUG_IF_ENTER(hash, value) {
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
}function DEBUG_IF_LEAVE(hash) {
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
}function DEBUG_ELSE_LEAVE(hash) {
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
}function DEBUG_LOOP_ENTER(hash, id, kind) {
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
}function DEBUG_LOOP_LEAVE(hash, entered, kind) {
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
}function DEBUG_CONTINUE(hash, label, ctx) {
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
}function DEBUG_SWITCH_ENTER(hash) {
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
}function DEBUG_SWITCH_LEAVE(hash) {
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
}function DEBUG_CASE_ENTER(hash, value, isDefault) {
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
}function DEBUG_CASE_LEAVE(hash) {
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
  }  // A callee that is not a function (e.g. a method the runtime does
  // not have yet, like Math.sumPrecise on Node 24) must fail exactly
  // like untraced code: `TypeError: <callee> is not a function`.
  // Reading root.name first would mask it with an Iroh-internal
  // "Cannot read properties of undefined (reading 'name')" (or, for a
  // non-function value like 1, "before.call.apply is not a function").
  // No CALL event fires: like an optional call that never happens, a
  // call that cannot happen is not an event. The callee source text
  // comes from the original input, so the message matches the engine's.
  if (typeof root !== "function") {
    let calleeSource = null;
    if (node && node.callee && typeof node.callee.start === "number" && typeof node.callee.end === "number" && typeof this.input === "string") {
      calleeSource = this.input.slice(node.callee.start, node.callee.end);
    }
    throw new TypeError((calleeSource || "callee") + " is not a function");
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
}function DEBUG_FUNCTION_LEAVE(hash, ctx) {
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
}function DEBUG_FUNCTION_RETURN(hash, name, value) {

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
}function DEBUG_VAR_INIT(hash, name, value) {
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
  // A constructor that is not a function (e.g. `new null()`,
  // `new 5()`) must fail exactly like untraced code: `TypeError:
  // <callee> is not a constructor`. Reading ctor.name first would
  // mask it with an Iroh-internal "Cannot read properties of null
  // (reading 'name')" (or, for a non-function value like 5,
  // "event.ctor is not a constructor"). No OP_NEW event fires: like
  // a call that cannot happen, a construction that cannot happen is
  // not an event. The callee source text comes from the original
  // input, so the message matches the engine's. (Same family as the
  // DEBUG_FUNCTION_CALL fix in the ES2026 probe.)
  if (typeof ctor !== "function") {
    let node = this.nodes[hash] ? this.nodes[hash].node : null;
    let ctorSource = null;
    if (node && node.callee && typeof node.callee.start === "number" && typeof node.callee.end === "number" && typeof this.input === "string") {
      ctorSource = this.input.slice(node.callee.start, node.callee.end);
    }
    throw new TypeError((ctorSource || "ctor") + " is not a constructor");
  }

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
}function DEBUG_OP_NEW_END(hash, self, ret) {
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
}// method enter not available before super
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
}function DEBUG_METHOD_LEAVE(hash, cls, isConstructor) {
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
}function DEBUG_TRY_LEAVE(hash) {

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
}function DEBUG_CATCH_LEAVE(hash) {
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
}function DEBUG_FINAL_LEAVE(hash) {
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
}function DEBUG_BLOCK_LEAVE(hash) {
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
  }  // API
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
}function DEBUG_PROGRAM_LEAVE(hash, ret) {
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
}function DEBUG_PROGRAM_FRAME_VALUE(value) {
  //console.log(value);
}

var _debug = /*#__PURE__*/Object.freeze({
  __proto__: null,
  DEBUG_ALLOC: DEBUG_ALLOC,
  DEBUG_ASSIGN: DEBUG_ASSIGN,
  DEBUG_AWAIT: DEBUG_AWAIT,
  DEBUG_BINARY: DEBUG_BINARY,
  DEBUG_BLOCK_ENTER: DEBUG_BLOCK_ENTER,
  DEBUG_BLOCK_LEAVE: DEBUG_BLOCK_LEAVE,
  DEBUG_BREAK: DEBUG_BREAK,
  DEBUG_CASE_ENTER: DEBUG_CASE_ENTER,
  DEBUG_CASE_LEAVE: DEBUG_CASE_LEAVE,
  DEBUG_CASE_TEST: DEBUG_CASE_TEST,
  DEBUG_CATCH_ENTER: DEBUG_CATCH_ENTER,
  DEBUG_CATCH_LEAVE: DEBUG_CATCH_LEAVE,
  DEBUG_CONTINUE: DEBUG_CONTINUE,
  DEBUG_ELSE_ENTER: DEBUG_ELSE_ENTER,
  DEBUG_ELSE_LEAVE: DEBUG_ELSE_LEAVE,
  DEBUG_FINAL_ENTER: DEBUG_FINAL_ENTER,
  DEBUG_FINAL_LEAVE: DEBUG_FINAL_LEAVE,
  DEBUG_FUNCTION_CALL: DEBUG_FUNCTION_CALL,
  DEBUG_FUNCTION_ENTER: DEBUG_FUNCTION_ENTER,
  DEBUG_FUNCTION_LEAVE: DEBUG_FUNCTION_LEAVE,
  DEBUG_FUNCTION_RETURN: DEBUG_FUNCTION_RETURN,
  DEBUG_IF_ENTER: DEBUG_IF_ENTER,
  DEBUG_IF_LEAVE: DEBUG_IF_LEAVE,
  DEBUG_IF_TEST: DEBUG_IF_TEST,
  DEBUG_LITERAL: DEBUG_LITERAL,
  DEBUG_LOGICAL: DEBUG_LOGICAL,
  DEBUG_LOOP_ENTER: DEBUG_LOOP_ENTER,
  DEBUG_LOOP_LEAVE: DEBUG_LOOP_LEAVE,
  DEBUG_LOOP_TEST: DEBUG_LOOP_TEST,
  DEBUG_MEMBER_EXPR: DEBUG_MEMBER_EXPR,
  DEBUG_METHOD_ENTER: DEBUG_METHOD_ENTER,
  DEBUG_METHOD_LEAVE: DEBUG_METHOD_LEAVE,
  DEBUG_OP_NEW: DEBUG_OP_NEW,
  DEBUG_OP_NEW_END: DEBUG_OP_NEW_END,
  DEBUG_PROGRAM_ENTER: DEBUG_PROGRAM_ENTER,
  DEBUG_PROGRAM_FRAME_VALUE: DEBUG_PROGRAM_FRAME_VALUE,
  DEBUG_PROGRAM_LEAVE: DEBUG_PROGRAM_LEAVE,
  DEBUG_SUPER: DEBUG_SUPER,
  DEBUG_SUPER_FIX: DEBUG_SUPER_FIX,
  DEBUG_SWITCH_ENTER: DEBUG_SWITCH_ENTER,
  DEBUG_SWITCH_LEAVE: DEBUG_SWITCH_LEAVE,
  DEBUG_SWITCH_TEST: DEBUG_SWITCH_TEST,
  DEBUG_TERNARY: DEBUG_TERNARY,
  DEBUG_THIS: DEBUG_THIS,
  DEBUG_TRY_ENTER: DEBUG_TRY_ENTER,
  DEBUG_TRY_LEAVE: DEBUG_TRY_LEAVE,
  DEBUG_UNARY: DEBUG_UNARY,
  DEBUG_UPDATE: DEBUG_UPDATE,
  DEBUG_VAR_DECLARE: DEBUG_VAR_DECLARE,
  DEBUG_VAR_INIT: DEBUG_VAR_INIT
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
  event.type;
  let category = event.category;
  // invalid listener
  if (!this.listeners.hasOwnProperty(category)) {
    console.error(`Unexpected trigger category ${category}`);
    return;
  }  let listeners = this.listeners[category];
  // no listeners are attached
  if (listeners.length <= 0) return;
  for (let ii = 0; ii < listeners.length; ++ii) {
    let listener = listeners[ii];
    listener.trigger(event, trigger);
  }};

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

// Detach every listener this Stage holds, so the listener callbacks —
// which close over the recorded events — become unreachable. A Stage
// is only needed while its program runs; after the run the caller
// holds the events it wants. Called by releaseTraceRun in
// src/setup.js (1.1.1: before that, every Stage stayed registered in
// Iroh.stages forever and the closures kept the whole trace alive,
// ~137 bytes/event, unbounded in a long-lived process). Idempotent.
Stage.prototype.release = function() {
  for (let key in this.listeners) {
    if (!this.listeners.hasOwnProperty(key)) continue;
    this.listeners[key].length = 0;
  }
};

Stage.prototype.generateListeners = function() {
  for (let key in CATEGORY) {
    let bit = CATEGORY[key];
    this.listeners[bit] = [];
  }};

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
    {
      this[key] = this.links[name].fn;
    }
  }};

Stage.prototype.getLink = function(name) {
  name = "$" + name;
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
  }};

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
  }};

Stage.prototype.leaveFrameUntilHash = function(hash) {
  while (true) {
    if (this.frame.hash === hash) break;
    this.manuallyLeaveFrame(this.frame);
  }};

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
  }  console.assert(
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
  }  if (
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
  }  console.assert(
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
  }  if (silent) return (frame.type === INSTR.TRY_ENTER ? frame : null);
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
  }  if (silent) return (frame.type === INSTR.CATCH_ENTER ? frame : null);
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
  }  if (silent) return (frame.type === INSTR.FINAL_ENTER ? frame : null);
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
  }  console.assert(
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
  }  return frame;
};

Stage.prototype.getFrameByHashFrom = function(frm, hash) {
  let frame = frm;
  while (true) {
    if (frame.hash === hash) break;
    if (frame.isGlobal()) return null;
    frame = frame.parent;
  }  return frame;
};

Stage.prototype.patch = function(input) {
  // Fresh counters per patch run: the hash, temp-var and anonymous-
  // function counters are module-level, so without this the same
  // program patched twice in one process gets different hashes and
  // different generated names (see resetPatchCounters in utils.js).
  resetPatchCounters();
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
  let ast = parse(input, {
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
  return generate(ast, {
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
  }}
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
          parse(code, {
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
  // 1.1.1 (M4): an opt-in cap on recorded events. No timeout exists by
  // design, so this is the patch answer to a runaway: once the cap is
  // passed the listener throws, the run stops, and the error carries
  // the partial events (same shape as the director's stop). A program
  // that catches every thrown value can defeat the stop the same way
  // it defeats a director stop — the next event throws again, so it
  // cannot make progress past an instrumented point without catching.
  let maxEvents = options.maxEvents;
  if (maxEvents !== void 0 && maxEvents !== null) {
    if (typeof maxEvents !== "number" || maxEvents <= 0 || maxEvents !== Math.floor(maxEvents)) {
      throw new Error("options.maxEvents must be a positive integer");
    }
  }
  // Indexed loops, not for...of: the browser bundle is transpiled by
  // buble, which cannot compile for...of.
  for (let ii = 0; ii < names.length; ++ii) {
    let listener = stage.addListener(iroh[names[ii]]);
    for (let jj = 0; jj < TRACE_TRIGGERS.length; ++jj) {
      let trigger = TRACE_TRIGGERS[jj];
      listener.on(trigger, (event) => {
        let line = iroh.eventToJSON(event, trigger);
        events.push(line);
        if (maxEvents !== void 0 && maxEvents !== null && events.length > maxEvents) {
          let err = new Error("Trace stopped: maxEvents (" + maxEvents + ") reached after " + events.length + " events");
          err.maxEvents = maxEvents;
          throw err;
        }
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
    releaseTraceRun(this, run);
    throw e;
  }
  releaseTraceRun(this, run);
  return { events: run.events, result: result };
}
// Release a trace run's Stage after the run has settled: detach its
// listeners and drop it from the Iroh stages registry. Before 1.1.1
// every Stage stayed registered forever, and the listener closures
// kept the whole recorded trace alive — ~137 bytes/event retained
// after the caller dropped the result, unbounded in a long-lived
// process tracing varied programs. The returned events array is the
// same object the caller already holds, so output is unchanged; only
// retention changes. Idempotent: safe to call twice (module runs
// release in importTracedModule's cleanup and again in the director's
// finish). A Stage is only needed while its program runs — the
// generated script reads it through the registry during evaluation,
// never after.
function releaseTraceRun(iroh, run) {
  if (!run || !run.stage) return;
  if (typeof run.stage.release === "function") run.stage.release();
  if (iroh && iroh.stages) delete iroh.stages[run.stage.key];
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
const runInternals = { createTraceRun, compileRunner, importTracedModule, attachTraceEvents, releaseTraceRun };

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
    releaseTraceRun(this, run);
    throw e;
  }
  let out = { events: run.events, result: result };
  if (result && typeof result.then === "function") {
    // The run is not over until the promise settles: async
    // continuations may still fire events. Release only then.
    let iroh = this;
    return result.then(
      (value) => {
        out.result = value;
        releaseTraceRun(iroh, run);
        return out;
      },
      // Like the sync path, an async failure carries the events that
      // fired before it — otherwise the trace of a rejected program is
      // lost entirely.
      (err) => {
        attachTraceEvents(err, out.events);
        releaseTraceRun(iroh, run);
        throw err;
      }
    );
  }
  releaseTraceRun(this, run);
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
function nodeImport$1(specifier) {
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
    nodeImport$1("node:fs"),
    nodeImport$1("node:os"),
    nodeImport$1("node:path"),
    nodeImport$1("node:url"),
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
      // The import has settled: the generated module has read its
      // stage through the registry, and nothing reads it after.
      // Release it here (1.1.1) — this covers traceModule and
      // directModule alike.
      releaseTraceRun(iroh, run);
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
    return nodeImport$1(fileUrl).then(
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

var _setup = /*#__PURE__*/Object.freeze({
  __proto__: null,
  generateCategoryBits: generateCategoryBits,
  greet: greet,
  runInternals: runInternals,
  setup: setup,
  trace: trace,
  traceAsync: traceAsync,
  traceModule: traceModule
});

// GENERATED — do not edit by hand. Source: irohscript/core/perceptron.iroh
// Regenerate with: npm run codegen:irohscript
// (IrohScript -> JavaScript, src/irohscript-codegen.js; division/modulo are Python-style.)
function Features() { return { calls: 0, depth: 0, repeat: 0, imbalance: 0, mix: 0 }; }
function Weights() { return { w0: 0, w1: 0, w2: 0, w3: 0, w4: 0, bias: 0 }; }
function PredictScore(f, w) {
  return w.bias + w.w0 * f.calls + w.w1 * f.depth + w.w2 * f.repeat + w.w3 * f.imbalance + w.w4 * f.mix;
}
function PredictLabel(score) {
  if (score >= 0) {
    return "hot";
  } else {
    return "normal";
  }
}

var model={featureNames:["calls","depth","repeat","imbalance","mix"],weights:[[0.1218,0.1037,0.1217,-0.0253,0.0328]],bias:[-0.1]};var personalityMatrix = {model:model};

// Tiny neuron layer for IrohRedux 0.8.0 — a single perceptron over
// trace-window features, pure JavaScript, no dependencies.
//
// The scoring core (the dot product and the label) is IrohScript,
// compiled to JavaScript: irohscript/core/perceptron.iroh ->
// src/neurons-irohscript.js (regenerate with
// `npm run codegen:irohscript`). What stays here: feature extraction
// (it walks the event stream with a set — IrohScript 3.0 has no
// bounded loop and no dictionary yet), training (it loops over
// samples), and the four-decimal rounding, which is a presentation
// rule of this module, not the neuron's math.

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
// 100/100. The portable JSON is their source of truth; there is no
// randomness at runtime.
// train() exists so the perceptron can be re-trained or checked in
// tests; it is deterministic (fixed order, fixed learning rate, no
// shuffling).

const MODEL = personalityMatrix.model;
const FEATURE_NAMES = MODEL.featureNames;

// Keep the runtime and the portable JSON model on the same weights.
const DEFAULT_WEIGHTS = MODEL.weights[0];
const DEFAULT_BIAS = MODEL.bias[0];

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
    // The scoring core is IrohScript, compiled to JavaScript
    // (irohscript/core/perceptron.iroh -> src/neurons-irohscript.js).
    // The label is read off the rounded score, exactly as before:
    // Predict's own label (from the raw score) is not used here, so a
    // raw -0.00001 still rounds to -0 and reads "hot", as it always did.
    let f = Features();
    f.calls = x[0] || 0;
    f.depth = x[1] || 0;
    f.repeat = x[2] || 0;
    f.imbalance = x[3] || 0;
    f.mix = x[4] || 0;
    let ww = Weights();
    ww.w0 = w[0];
    ww.w1 = w[1];
    ww.w2 = w[2];
    ww.w3 = w[3];
    ww.w4 = w[4];
    ww.bias = b;
    let score = Math.round(PredictScore(f, ww) * 10000) / 10000;
    return { score: score, label: PredictLabel(score) };
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

var _neurons = /*#__PURE__*/Object.freeze({
  __proto__: null,
  DEFAULT_BIAS: DEFAULT_BIAS,
  DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
  FEATURE_NAMES: FEATURE_NAMES,
  classifyWindow: classifyWindow,
  createPerceptron: createPerceptron,
  extractFeatures: extractFeatures
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
    for (let ii = 0; ii + n <= callNames.length; ++ii) {
      let seq = callNames.slice(ii, ii + n).join("\n");
      if (counts[seq] === void 0) {
        counts[seq] = 0;
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

  // Unclosed frames (1.1.1, M3): a generator closed early
  // (.return() / .close()) leaves a FUNCTION_ENTER with no matching
  // FUNCTION_LEAVE or FUNCTION_RETURN — the tracer cannot observe the
  // close, so the frame dangles. The call depth is still correct (the
  // yield already dropped it), and the analysis treats an ENTER still
  // open at the end of the trace as closed, with this note, rather
  // than silently dropping it. A plain function closes with
  // FUNCTION_RETURN; a generator run to completion closes with
  // FUNCTION_LEAVE.
  let openFrames = [];
  for (let ii = 0; ii < events.length; ++ii) {
    let e = events[ii];
    if (e.event === "FUNCTION_ENTER") {
      openFrames.push({
        name: e.name || null,
        indent: typeof e.indent === "number" ? e.indent : null,
      });
    } else if (e.event === "FUNCTION_LEAVE" || e.event === "FUNCTION_RETURN") {
      let popped = false;
      for (let jj = openFrames.length - 1; jj >= 0; --jj) {
        if (
          openFrames[jj].indent === e.indent ||
          openFrames[jj].indent === null ||
          typeof e.indent !== "number"
        ) {
          openFrames.splice(jj, 1);
          popped = true;
          break;
        }
      }
      if (!popped && openFrames.length > 0) openFrames.pop();
    }
  }
  let unclosedFrames = openFrames.length > 0
    ? {
        count: openFrames.length,
        frames: openFrames.map((f) => f.name),
        note: "Frames still open at the end of the trace (e.g. a generator closed early with .return()/.close()) — treated as closed. The call depth is unaffected: the yield already dropped the frame.",
      }
    : null;

  // --- Scorecard -------------------------------------------------------
  // Coverage: categories fired vs the categories this tracer can
  // reach (1.1.1, F4). The denominator is the reachable set for the
  // trace's language, not the whole model: a C++ trace firing CALL
  // and FUNCTION is 2 of 2 reachable, not 2 of 30. `missingCategories`
  // lists the reachable categories that did NOT fire — the ones a
  // reader could have seen but did not. A consumer must never treat
  // a missing `reachable` field as `total`: that would read a
  // non-JS trace as if it were JavaScript.
  let language = options.language || "javascript";
  let reachableList = reachableCategories(language);
  let reachableSet = {};
  for (let ii = 0; ii < reachableList.length; ++ii) reachableSet[reachableList[ii]] = true;
  let totalCategories = Object.keys(CATEGORY).length;
  let firedSet = {};
  for (let ii = 0; ii < events.length; ++ii) {
    if (events[ii].category) firedSet[events[ii].category] = true;
  }
  let firedCategories = Object.keys(firedSet).sort();
  let missingCategories = [];
  for (let ii = 0; ii < reachableList.length; ++ii) {
    if (!firedSet[reachableList[ii]]) missingCategories.push(reachableList[ii]);
  }
  let coverage = {
    fired: firedCategories.length,
    reachable: reachableList.length,
    total: totalCategories,
    value: reachableList.length > 0
      ? Math.round((firedCategories.length / reachableList.length) * 10000) / 10000
      : 0,
    firedCategories: firedCategories,
    missingCategories: missingCategories,
    note: firedCategories.length + " of " + reachableList.length + " reachable for a " + language +
      " trace (" + totalCategories + " exist in the model). Assumes an unfiltered trace (events: ALL). A trace collected with an events filter scores the filter, not the toolkit.",
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
    unclosedFrames: unclosedFrames,
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

var _analyze = /*#__PURE__*/Object.freeze({
  __proto__: null,
  ANALYZE_DEFAULTS: ANALYZE_DEFAULTS,
  analyze: analyze,
  analyzeModule: analyzeModule,
  analyzeTrace: analyzeTrace,
  analyzeTraceAsync: analyzeTraceAsync
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
// `options.language` (default "javascript") picks the reachable
// set for the coverage feature (1.1.1, F4): the coverage feature is
// fired / reachable, not fired / total, so a function-level C++
// trace is not penalised for the categories its tracer cannot emit.
function toVector(events, options) {
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

var _vectors = /*#__PURE__*/Object.freeze({
  __proto__: null,
  VECTOR_FEATURE_NAMES: VECTOR_FEATURE_NAMES,
  compareVectors: compareVectors,
  cosineSimilarity: cosineSimilarity,
  euclideanDistance: euclideanDistance,
  toVector: toVector
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
  let vectors = toVector(events, { language: options.language || "javascript" });
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
    unclosedFrames: analysis.summary.unclosedFrames,
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

var _scan = /*#__PURE__*/Object.freeze({
  __proto__: null,
  SCAN_DEFAULTS: SCAN_DEFAULTS,
  scan: scan,
  scanModule: scanModule,
  scanTrace: scanTrace,
  scanTraceAsync: scanTraceAsync
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

var _live = /*#__PURE__*/Object.freeze({
  __proto__: null,
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
  options.onEvent;
  let onDirective = options.onDirective;
  let pending = []; // issued set/skip entries not yet applied
  let log = []; // the audit log: every directive, with its outcome
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
    // The record is built: the director has read the events, and the
    // returned record holds the same events array. Release the Stage
    // (1.1.1) — the module path already released in
    // importTracedModule's cleanup; the release is idempotent.
    runInternals.releaseTraceRun(iroh, run);
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
      runInternals.releaseTraceRun(iroh, run);
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
    runInternals.releaseTraceRun(iroh, run);
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

var _direct = /*#__PURE__*/Object.freeze({
  __proto__: null,
  direct: direct,
  directAsync: directAsync,
  directModule: directModule,
  runawayGuard: runawayGuard
});

// Input synthesiser for IrohRedux — generate concrete inputs that
// drive a program down each branch, on the live wire:
//
//   Iroh.synthesize(code, { entry, seeds, maxRuns, onProgress })
//     -> { entry, inputs, coverage, runs, uncovered, findings, summary }
//
// Concolic-style, with no SMT solver available: run the program under
// trace with seed inputs, collect branch outcomes from the trace
// events, then solve for the inputs that flip each uncovered branch.
// The v1 solver is deliberately small and honest about it: for a
// numeric comparison it computes the boundary value (x > 10 -> 11 and
// 10), for equality it uses the observed constant (x === 7 -> 7), for
// a string equality the observed string, for && / || it targets each
// side, and for a bare parameter it uses truthy/falsy (1 / 0). Seeds
// plus guided mutation are the fallback. Every run counts against
// the budget (default 50), and a branch the solver cannot flip is
// reported with its reason — never hidden, never claimed.
//
// Live wire integration (src/live.js): each run streams through its
// own liveAnalyzer, so HOT_LOOP and friends fire mid-run and stream
// out through onProgress as live-finding events. The target list is
// the aggregate analyzer's ONE_SIDED_BRANCH findings: after each run
// the events of all runs so far are fed (hashes remapped to the
// branch site's source position, because the instrumenter's hashes
// are per-Stage) into a fresh liveAnalyzer, and finish() gives the
// one-sided branches — the branches that still need an input. Only
// the ONE_SIDED_BRANCH findings are taken from the aggregate: its
// other findings would conflate separate runs (loop iterations add
// up across runs). Capped loop-test flips (see below) are filtered
// out of the aggregate stream — they are the tool's intervention,
// not the program's behaviour.
//
// Runaway protection: a candidate input may make a loop never end.
// Each run caps every loop at loopCap true tests (default 10,000):
// the next LOOP_TEST is flipped to false, the run is marked capped,
// and the flipped test is NOT counted as branch coverage — the input
// did not cover the exit arm, the cap did. The flip uses the same
// mechanism as the director (src/direct.js): the DEBUG functions
// return the event's value after listeners fire, so mutating the raw
// event in rawOnEvent changes the running program.
//
// Limits (also in CHANGELOG.md): scripts only, synchronous entry
// functions (no top-level await, no modules, no async entry —
// traceAsync()/traceModule() have no synthesis hook in v1); seeds
// must be JSON values; the solver handles direct parameter-vs-literal
// comparisons, .length against a numeric literal, && / || / ! and
// bare parameters — compound expressions, calls, and anything that
// is not an input parameter are reported, not solved. Switch cases
// are covered in the same pass (see below).
//
// Branch model: a site is a condition evaluation point, keyed by its
// kind and the source position of its test. if / loop / ternary sites
// have two arms (true/false); a switch case has one arm (matched),
// and the default has one arm (reached). Coverage is arms covered /
// arms total, with the site count alongside — every number carries
// its denominator.


const SYNTHESIZE_DEFAULTS = {
  maxRuns: 50,
  loopCap: 10000,
};

const SOLVER_DEPTH_LIMIT = 4;
const STATEMENT_PREVIEW_CHARS = 200;

// --- generic AST walk (same shape as analyze.js inspectSource) -------
function walk(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let ii = 0; ii < node.length; ++ii) walk(node[ii], visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  let keys = Object.keys(node);
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
    walk(node[key], visit);
  }
}

function sourceOf(program, node) {
  if (!node || typeof node.start !== "number" || typeof node.end !== "number") return null;
  return program.slice(node.start, node.end);
}

// --- entry function ----------------------------------------------------
// The function under test: a top-level function declaration, or a
// top-level const/let/var holding a function or arrow function.
function resolveEntry(ast, entry) {
  let body = ast.body || [];
  for (let ii = 0; ii < body.length; ++ii) {
    let st = body[ii];
    if (st.type === "FunctionDeclaration" && st.id && st.id.name === entry) {
      return st;
    }
    if (st.type === "VariableDeclaration") {
      for (let jj = 0; jj < st.declarations.length; ++jj) {
        let d = st.declarations[jj];
        if (
          d.id && d.id.name === entry && d.init &&
          (d.init.type === "FunctionExpression" || d.init.type === "ArrowFunctionExpression")
        ) {
          return d.init;
        }
      }
    }
  }
  return null;
}

function paramList(fnNode) {
  let params = [];
  for (let ii = 0; ii < fnNode.params.length; ++ii) {
    let p = fnNode.params[ii];
    if (p.type === "Identifier") params.push({ name: p.name, pattern: false });
    else params.push({ name: null, pattern: true });
  }
  return params;
}

function paramIndex(params, name) {
  for (let ii = 0; ii < params.length; ++ii) {
    if (!params[ii].pattern && params[ii].name === name) return ii;
  }
  return -1;
}

// --- switch map ----------------------------------------------------------
// From the source AST: every case, keyed the same way the trace maps
// it (case test start, or the case start for default), with the
// discriminant and the case value so the solver can target it.
function buildSwitchMap(ast) {
  let map = {};
  walk(ast, function(node) {
    if (node.type !== "SwitchStatement") return;
    for (let ii = 0; ii < node.cases.length; ++ii) {
      let cs = node.cases[ii];
      let key = cs.test ? "case:" + cs.test.start : "default:" + cs.start;
      map[key] = {
        discriminant: node.discriminant,
        caseValue: cs.test || null,
        caseNode: cs,
        isDefault: !cs.test,
      };
    }
  });
  return map;
}

// --- argument serialization ----------------------------------------------
// Seeds must be JSON values: the call is built as source text, so a
// function, symbol, bigint, or a nested undefined / non-finite number
// cannot be written down. Loud failure now, not a silently wrong call.
function validateJsonValue(value, where) {
  if (value === null) return;
  let t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("synthesize() seeds must be JSON values — " + where + " is " + String(value));
    }
    return;
  }
  if (t === "undefined") {
    throw new Error("synthesize() seeds must be JSON values — " + where + " is undefined (only a top-level argument may be undefined)");
  }
  if (Array.isArray(value)) {
    for (let ii = 0; ii < value.length; ++ii) validateJsonValue(value[ii], where + "[" + ii + "]");
    return;
  }
  if (t === "object") {
    let keys = Object.keys(value);
    for (let ii = 0; ii < keys.length; ++ii) validateJsonValue(value[keys[ii]], where + "." + keys[ii]);
    return;
  }
  throw new Error("synthesize() seeds must be JSON values — " + where + " is a " + t);
}

function serializeArg(value) {
  if (value === void 0) return "undefined";
  validateJsonValue(value, "seed value");
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

// --- solver: boundary values ----------------------------------------------
function differentValue(literal) {
  if (typeof literal === "number") return literal + 1;
  if (typeof literal === "string") return literal === "" ? "x" : "";
  if (typeof literal === "boolean") return !literal;
  if (literal === null) return 0;
  return 1;
}

// Values for the parameter that make `param <op> literal` come out
// `want`. Numbers only for the ordered comparisons; equality works
// for any literal type. Returns an array, or null when the operator
// cannot be solved for this literal.
function boundaryValues(operator, literal, want) {
  if (operator === ">" || operator === ">=" || operator === "<" || operator === "<=") {
    if (typeof literal !== "number") return null;
  }
  if (operator === ">") return want ? [literal + 1] : [literal];
  if (operator === ">=") return want ? [literal] : [literal - 1];
  if (operator === "<") return want ? [literal - 1] : [literal];
  if (operator === "<=") return want ? [literal] : [literal + 1];
  if (operator === "===" || operator === "==") return want ? [literal] : [differentValue(literal)];
  if (operator === "!==" || operator === "!=") return want ? [differentValue(literal)] : [literal];
  return null;
}

// String values whose .length makes `param.length <op> literal` come
// out `want`. Returns an array, or null when no string length can
// satisfy it (e.g. length < 0).
function lengthValues(operator, literal, want) {
  if (typeof literal !== "number" || literal < 0 || Math.floor(literal) !== literal) return null;
  let n;
  if (operator === ">") n = want ? literal + 1 : literal;
  else if (operator === ">=") n = want ? literal : literal - 1;
  else if (operator === "<") n = want ? literal - 1 : literal;
  else if (operator === "<=") n = want ? literal : literal + 1;
  else if (operator === "===" || operator === "==") n = want ? literal : literal + 1;
  else if (operator === "!==" || operator === "!=") n = want ? literal + 1 : literal;
  else return null;
  if (n < 0) return null;
  return ["a".repeat(n)];
}

function flipComparison(operator) {
  if (operator === "<") return ">";
  if (operator === ">") return "<";
  if (operator === "<=") return ">=";
  if (operator === ">=") return "<=";
  if (operator === "===" || operator === "==" || operator === "!==" || operator === "!=") return operator;
  return null;
}

const COMPARISON_OPS = [">", ">=", "<", "<=", "===", "==", "!==", "!="];

function isNondeterministic(node, program) {
  let found = false;
  walk(node, function(child) {
    if (found) return;
    if (child.type === "CallExpression" || child.type === "NewExpression") {
      let src = sourceOf(program, child);
      if (src && (/Date\.now/.test(src) || /Math\.random/.test(src) || /new Date/.test(src))) {
        found = true;
      }
    }
  });
  return found;
}

// Solve `testNode` for the outcome `want` (true/false), starting
// from `args` (the witness run's arguments). Returns
// { candidates: [argArray, ...] } or { reason: "..." }. A candidate
// is a full replacement argument list; the run verifies it — the
// solver proposes, the trace disposes.
function solveTest(node, want, args, params, counterStarts, program, depth) {
  if (depth > SOLVER_DEPTH_LIMIT) {
    return { reason: "condition nests deeper than the v1 solver follows (" + SOLVER_DEPTH_LIMIT + " levels)" };
  }
  if (!node) return { reason: "condition is missing" };
  if (isNondeterministic(node, program)) {
    return { reason: "condition depends on a nondeterministic source (" + sourceOf(program, node) + ") — no input can steer it" };
  }
  if (node.type === "Literal") {
    return { reason: "condition is the constant " + sourceOf(program, node) + " — no input can change it" };
  }
  if (node.type === "UnaryExpression" && node.operator === "!") {
    return solveTest(node.argument, !want, args, params, counterStarts, program, depth + 1);
  }
  if (node.type === "UnaryExpression") {
    return { reason: "condition is a unary '" + node.operator + "' expression — the v1 solver handles '!' only" };
  }
  if (node.type === "Identifier") {
    let idx = paramIndex(params, node.name);
    if (idx < 0) {
      return { reason: "condition reads '" + node.name + "', which is not an input parameter" };
    }
    // Truthiness works across types: any truthy value takes the true
    // arm, any falsy value the false arm.
    let next = args.slice();
    next[idx] = want ? 1 : 0;
    return { candidates: [next] };
  }
  if (node.type === "LogicalExpression") {
    if (node.operator === "&&") {
      if (want) {
        let left = solveTest(node.left, true, args, params, counterStarts, program, depth + 1);
        if (left.reason) return left;
        let right = solveTest(node.right, true, left.candidates[0], params, counterStarts, program, depth + 1);
        if (right.reason) return right;
        return { candidates: right.candidates };
      }
      let left = solveTest(node.left, false, args, params, counterStarts, program, depth + 1);
      let right = solveTest(node.right, false, args, params, counterStarts, program, depth + 1);
      let cands = [];
      if (left.candidates) cands = cands.concat(left.candidates);
      if (right.candidates) cands = cands.concat(right.candidates);
      if (cands.length > 0) return { candidates: cands };
      return { reason: left.reason || right.reason || "neither side of '&&' can be made false" };
    }
    if (node.operator === "||") {
      if (!want) {
        let left = solveTest(node.left, false, args, params, counterStarts, program, depth + 1);
        if (left.reason) return left;
        let right = solveTest(node.right, false, left.candidates[0], params, counterStarts, program, depth + 1);
        if (right.reason) return right;
        return { candidates: right.candidates };
      }
      let left = solveTest(node.left, true, args, params, counterStarts, program, depth + 1);
      let right = solveTest(node.right, true, args, params, counterStarts, program, depth + 1);
      let cands = [];
      if (left.candidates) cands = cands.concat(left.candidates);
      if (right.candidates) cands = cands.concat(right.candidates);
      if (cands.length > 0) return { candidates: cands };
      return { reason: left.reason || right.reason || "neither side of '||' can be made true" };
    }
    return { reason: "condition uses '" + node.operator + "' — the v1 solver handles '&&' and '||' only" };
  }
  if (node.type === "BinaryExpression") {
    return solveComparison(node, want, args, params, counterStarts, program);
  }
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    return { reason: "condition calls " + sourceOf(program, node) + " — the solver cannot invert calls" };
  }
  if (node.type === "MemberExpression") {
    return { reason: "condition reads " + sourceOf(program, node) + " — the solver handles direct parameter comparisons and .length only" };
  }
  return { reason: "condition has the form " + node.type + " — the v1 solver does not handle it" };
}

function solveComparison(node, want, args, params, counterStarts, program) {
  let op = node.operator;
  if (COMPARISON_OPS.indexOf(op) < 0) {
    if (op === "in" || op === "instanceof") {
      return { reason: "condition uses '" + op + "' — the v1 solver handles comparisons only" };
    }
    return { reason: "condition is a compound expression over inputs (" + sourceOf(program, node) + ") — v1 solves direct parameter-vs-literal comparisons only" };
  }
  let left = node.left;
  let right = node.right;
  let operator = op;
  // A loop counter with a known start value (for (let i = 0; ...) or
  // the nearest preceding literal assignment) reads as that value on
  // the first test, so `i < n` solves as `0 < n`.
  if (left.type === "Identifier" && counterStarts && counterStarts[left.name] !== void 0) {
    left = { type: "Literal", value: counterStarts[left.name] };
  } else if (right.type === "Identifier" && counterStarts && counterStarts[right.name] !== void 0) {
    right = { type: "Literal", value: counterStarts[right.name] };
    operator = flipComparison(operator);
    if (operator === null) return { reason: "cannot flip operator '" + op + "'" };
  }
  // param.length vs a numeric literal.
  if (
    left.type === "MemberExpression" && left.object.type === "Identifier" &&
    left.property && left.property.name === "length" && !left.computed
  ) {
    return solveLengthComparison(left.object.name, operator, right, want, args, params, program);
  }
  if (
    right.type === "MemberExpression" && right.object.type === "Identifier" &&
    right.property && right.property.name === "length" && !right.computed
  ) {
    let flipped = flipComparison(operator);
    if (flipped === null) return { reason: "cannot flip operator '" + op + "'" };
    return solveLengthComparison(right.object.name, flipped, left, want, args, params, program);
  }
  let paramSide = null;
  let litSide = null;
  let paramOnLeft = true;
  if (left.type === "Identifier" && right.type === "Literal") {
    paramSide = left;
    litSide = right;
    paramOnLeft = true;
  } else if (right.type === "Identifier" && left.type === "Literal") {
    paramSide = right;
    litSide = left;
    paramOnLeft = false;
  } else {
    if (left.type === "Identifier" && paramIndex(params, left.name) >= 0) {
      return { reason: "condition compares two inputs (" + sourceOf(program, node) + ") — v1 solves parameter-vs-literal comparisons only" };
    }
    if (right.type === "Identifier" && paramIndex(params, right.name) >= 0) {
      return { reason: "condition compares two inputs (" + sourceOf(program, node) + ") — v1 solves parameter-vs-literal comparisons only" };
    }
    if (left.type === "Identifier") {
      return { reason: "condition reads '" + left.name + "', which is not an input parameter" };
    }
    if (right.type === "Identifier") {
      return { reason: "condition reads '" + right.name + "', which is not an input parameter" };
    }
    return { reason: "condition is a compound expression over inputs (" + sourceOf(program, node) + ") — v1 solves direct parameter-vs-literal comparisons only" };
  }
  let idx = paramIndex(params, paramSide.name);
  if (idx < 0) {
    return { reason: "condition reads '" + paramSide.name + "', which is not an input parameter" };
  }
  if (!paramOnLeft) {
    operator = flipComparison(operator);
    if (operator === null) return { reason: "cannot flip operator '" + op + "'" };
  }
  let values = boundaryValues(operator, litSide.value, want);
  if (values === null) {
    return { reason: "condition compares a parameter with a non-numeric literal (" + sourceOf(program, node) + ") — v1 solves numeric bounds and equality only" };
  }
  let out = [];
  for (let ii = 0; ii < values.length; ++ii) {
    let next = args.slice();
    next[idx] = values[ii];
    out.push(next);
  }
  return { candidates: out };
}

function solveLengthComparison(paramName, operator, litNode, want, args, params, program) {
  let idx = paramIndex(params, paramName);
  if (idx < 0) {
    return { reason: "condition reads '" + paramName + ".length', and '" + paramName + "' is not an input parameter" };
  }
  if (!litNode || litNode.type !== "Literal" || typeof litNode.value !== "number") {
    return { reason: "condition compares .length with a non-literal (" + sourceOf(program, litNode) + ") — v1 solves .length against numeric literals only" };
  }
  let values = lengthValues(operator, litNode.value, want);
  if (values === null) {
    return { reason: "no string length satisfies " + paramName + ".length " + operator + " " + litNode.value + " for the wanted arm" };
  }
  let out = [];
  for (let ii = 0; ii < values.length; ++ii) {
    let next = args.slice();
    next[idx] = values[ii];
    out.push(next);
  }
  return { candidates: out };
}

// --- loop counter start values -------------------------------------------
// The value a loop counter starts with: the for-init, or the nearest
// preceding literal assignment to that name in the source. Only
// literal numbers count — anything else is not a start the solver
// can trust.
function counterStartsFor(loopNode, ast) {
  let best = {};
  function note(name, value, start) {
    if (!best[name] || start > best[name].start) {
      best[name] = { start: start, value: value };
    }
  }
  if (loopNode.type === "ForStatement" && loopNode.init) {
    let init = loopNode.init;
    if (init.type === "VariableDeclaration") {
      for (let ii = 0; ii < init.declarations.length; ++ii) {
        let d = init.declarations[ii];
        if (d.id && d.id.type === "Identifier" && d.init && d.init.type === "Literal" && typeof d.init.value === "number") {
          note(d.id.name, d.init.value, d.start);
        }
      }
    } else if (init.type === "AssignmentExpression" && init.operator === "=" &&
        init.left.type === "Identifier" && init.right.type === "Literal" && typeof init.right.value === "number") {
      note(init.left.name, init.right.value, init.start);
    }
  }
  walk(ast, function(node) {
    if (node.start >= loopNode.start) return;
    if (node.type === "VariableDeclaration") {
      for (let ii = 0; ii < node.declarations.length; ++ii) {
        let d = node.declarations[ii];
        if (d.id && d.id.type === "Identifier" && d.init && d.init.type === "Literal" && typeof d.init.value === "number") {
          note(d.id.name, d.init.value, d.start);
        }
      }
    }
    if (node.type === "AssignmentExpression" && node.operator === "=" &&
        node.left.type === "Identifier" && node.right.type === "Literal" && typeof node.right.value === "number") {
      note(node.left.name, node.right.value, node.start);
    }
  });
  let starts = {};
  let names = Object.keys(best);
  for (let ii = 0; ii < names.length; ++ii) starts[names[ii]] = best[names[ii]].value;
  return starts;
}

// --- guided mutation fallback ---------------------------------------------
// One small change per argument, in order. Tried once per site, after
// the solver gives up — a nudge that sometimes stumbles onto the
// arm the solver could not compute.
function mutations(args) {
  let out = [];
  for (let ii = 0; ii < args.length; ++ii) {
    let v = args[ii];
    if (typeof v === "number") {
      out.push(withArg(args, ii, v + 1));
      out.push(withArg(args, ii, v - 1));
      out.push(withArg(args, ii, 0));
    } else if (typeof v === "string") {
      out.push(withArg(args, ii, ""));
      out.push(withArg(args, ii, v + "x"));
    } else if (typeof v === "boolean") {
      out.push(withArg(args, ii, !v));
    } else if (v === null || v === void 0) {
      out.push(withArg(args, ii, 1));
      out.push(withArg(args, ii, ""));
    }
  }
  return out;
}

function withArg(args, index, value) {
  let next = args.slice();
  next[index] = value;
  return next;
}

// --- branch sites ----------------------------------------------------------
// A site is a condition evaluation point, keyed by kind and the source
// position of its test — positions are stable across runs (the entry
// call is appended after the code under test), while the
// instrumenter's hashes are per-Stage and are not.
function siteInfoForEvent(stage, event) {
  if (typeof event.hash !== "number" || !stage.nodes || !stage.nodes[event.hash]) return null;
  let node = stage.nodes[event.hash].node;
  if (!node) return null;
  if (event.event === "IF_TEST" && event.trigger === "test") {
    if (!node.test) return null;
    return { kind: "if", node: node, testNode: node.test, arm: event.value === true ? "true" : "false" };
  }
  if (event.event === "LOOP_TEST" && event.trigger === "test") {
    return { kind: "loop", node: node, testNode: node.test || null, arm: event.value === true ? "true" : "false" };
  }
  if (event.event === "TERNARY" && event.trigger === "fire") {
    if (!node.test) return null;
    return { kind: "ternary", node: node, testNode: node.test, arm: event.test === true ? "true" : "false" };
  }
  return null;
}

function siteInfoForCase(stage, event) {
  if (event.event !== "CASE_ENTER" || event.trigger !== "enter") return null;
  if (typeof event.hash !== "number" || !stage.nodes || !stage.nodes[event.hash]) return null;
  let node = stage.nodes[event.hash].node;
  if (!node) return null;
  return { kind: "case", node: node, testNode: node.test || null, arm: "matched" };
}

// Solve a switch-case target: the discriminant must equal the case
// value (or, for default, match no case value).
function solveCaseTarget(site, args, params) {
  if (site.isDefault) {
    let idx = paramIndex(params, site.discriminantName);
    if (idx < 0 || !site.caseLiterals) {
      return { reason: "default arm cannot be targeted: the discriminant is not a bare input parameter" };
    }
    let lits = site.caseLiterals;
    if (lits.length === 0) return { candidates: [args.slice()] };
    let allNumbers = true;
    let allStrings = true;
    for (let ii = 0; ii < lits.length; ++ii) {
      if (typeof lits[ii] !== "number") allNumbers = false;
      if (typeof lits[ii] !== "string") allStrings = false;
    }
    let next = args.slice();
    if (allNumbers) {
      let max = lits[0];
      for (let ii = 1; ii < lits.length; ++ii) if (lits[ii] > max) max = lits[ii];
      next[idx] = max + 1;
      return { candidates: [next] };
    }
    if (allStrings) {
      let candidate = "no-match";
      let n = 2;
      while (lits.indexOf(candidate) !== -1) candidate = "no-match-" + n++;
      next[idx] = candidate;
      return { candidates: [next] };
    }
    return { reason: "default arm cannot be targeted: the case values mix types, so no single non-matching value is evident" };
  }
  if (!site.discriminant || !site.caseValue) {
    return { reason: "switch case cannot be solved: no discriminant or case value recorded" };
  }
  // Bare parameter === literal case value.
  if (site.discriminant.type === "Identifier" && site.caseValue.type === "Literal") {
    let idx = paramIndex(params, site.discriminant.name);
    if (idx < 0) {
      return { reason: "switch discriminant reads '" + site.discriminant.name + "', which is not an input parameter" };
    }
    let next = args.slice();
    next[idx] = site.caseValue.value;
    return { candidates: [next] };
  }
  // param.length === numeric literal case value.
  if (
    site.discriminant.type === "MemberExpression" &&
    site.discriminant.object.type === "Identifier" &&
    site.discriminant.property && site.discriminant.property.name === "length" &&
    !site.discriminant.computed && site.caseValue.type === "Literal" &&
    typeof site.caseValue.value === "number"
  ) {
    let idx = paramIndex(params, site.discriminant.object.name);
    if (idx < 0) {
      return { reason: "switch discriminant reads '" + site.discriminant.object.name + ".length', which is not an input parameter" };
    }
    let next = args.slice();
    next[idx] = "a".repeat(site.caseValue.value);
    return { candidates: [next] };
  }
  return { reason: "switch case cannot be solved: the discriminant is not a bare parameter or .length against a literal case value" };
}

// --- the synthesiser ---------------------------------------------------------
function synthesize(code, options) {
  let iroh = this;
  options = options || {};
  if (typeof code !== "string") {
    throw new Error("synthesize() needs the program as a string");
  }
  let entry = options.entry;
  if (typeof entry !== "string" || entry === "") {
    throw new Error("synthesize() needs options.entry — the name of the function under test");
  }
  let maxRuns = options.maxRuns === void 0 ? SYNTHESIZE_DEFAULTS.maxRuns : options.maxRuns;
  let loopCap = options.loopCap === void 0 ? SYNTHESIZE_DEFAULTS.loopCap : options.loopCap;
  if (typeof maxRuns !== "number" || maxRuns < 1 || Math.floor(maxRuns) !== maxRuns) {
    throw new Error("synthesize() maxRuns must be a positive integer, got " + maxRuns);
  }
  if (typeof loopCap !== "number" || loopCap < 1 || Math.floor(loopCap) !== loopCap) {
    throw new Error("synthesize() loopCap must be a positive integer, got " + loopCap);
  }
  let onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  let analyzeOptions = options.analyze || {};
  let liveThresholds = {};
  if (analyzeOptions.source === void 0) liveThresholds.source = code;
  else liveThresholds.source = analyzeOptions.source;
  if (analyzeOptions.hotLoopThreshold !== void 0) liveThresholds.hotLoopThreshold = analyzeOptions.hotLoopThreshold;
  if (analyzeOptions.deepRecursionThreshold !== void 0) liveThresholds.deepRecursionThreshold = analyzeOptions.deepRecursionThreshold;
  if (analyzeOptions.repeatSequenceMinOccurrences !== void 0) liveThresholds.repeatSequenceMinOccurrences = analyzeOptions.repeatSequenceMinOccurrences;
  if (analyzeOptions.oneSidedMinTests !== void 0) liveThresholds.oneSidedMinTests = analyzeOptions.oneSidedMinTests;

  let ast;
  try {
    ast = parse$1(code);
  } catch (e) {
    throw new Error("synthesize() cannot parse the code: " + e.message);
  }
  let entryNode = resolveEntry(ast, entry);
  if (!entryNode) {
    throw new Error("synthesize() entry \"" + entry + "\" not found as a top-level function in the code");
  }
  let params = paramList(entryNode);
  // Clean AST nodes by source span, for resolving a branch's test
  // expression. The stage's stored clones are NOT clean: the patch
  // stages run in the order 2, 7, 4, 5, 1, 3, 6, 8, and stage 1
  // wraps every literal in a DEBUG_LITERAL call — so a clone made in
  // stage 8 (ternary) already contains wrapped literals, while the
  // if/loop clones (stages 2/7) were made before the wrapping. The
  // positions are identical in both parses (the entry call is appended
  // after the code under test), so the span keys the clean node.
  let nodeBySpan = {};
  walk(ast, function(node) {
    if (typeof node.start !== "number" || typeof node.end !== "number") return;
    let key = node.start + ":" + node.end;
    if (!nodeBySpan[key]) nodeBySpan[key] = [];
    nodeBySpan[key].push(node);
  });
  function cleanNode(stageNode) {
    if (!stageNode || typeof stageNode.start !== "number" || typeof stageNode.end !== "number") return stageNode;
    let list = nodeBySpan[stageNode.start + ":" + stageNode.end];
    if (!list) return stageNode;
    for (let ii = 0; ii < list.length; ++ii) {
      if (list[ii].type === stageNode.type) return list[ii];
    }
    return list[0];
  }
  let switchMap = buildSwitchMap(ast);
  // Case literals per switch, for the default arm: the discriminant
  // values a non-matching input must avoid. Keyed by the switch's
  // discriminant start.
  let switchCases = {};
  walk(ast, function(node) {
    if (node.type !== "SwitchStatement") return;
    let lits = [];
    let discName = node.discriminant.type === "Identifier" ? node.discriminant.name : null;
    for (let ii = 0; ii < node.cases.length; ++ii) {
      if (node.cases[ii].test && node.cases[ii].test.type === "Literal") {
        lits.push(node.cases[ii].test.value);
      }
    }
    switchCases[node.discriminant.start] = { literals: lits, discriminantName: discName };
  });

  let seeds = options.seeds === void 0 ? [[]] : options.seeds;
  if (!Array.isArray(seeds)) {
    throw new Error("synthesize() seeds must be an array of argument arrays");
  }
  for (let ii = 0; ii < seeds.length; ++ii) {
    if (!Array.isArray(seeds[ii])) {
      throw new Error("synthesize() seed " + ii + " is not an array of arguments");
    }
    for (let jj = 0; jj < seeds[ii].length; ++jj) serializeArg(seeds[ii][jj]);
  }

  let sites = {};
  let siteOrder = [];
  let allRuns = [];
  let inputs = [];
  let tried = {};
  let agenda = [];
  for (let ii = 0; ii < seeds.length; ++ii) agenda.push({ args: seeds[ii].slice(), via: "seed" });
  let runIndex = 0;
  let synthesizedCount = 0;

  // A progress listener is observational: it must never break a run.
  function emit(ev) {
    if (!onProgress) return;
    try {
      onProgress(ev);
    } catch (e) {
      // Deliberate: progress is a report, not a control channel.
    }
  }

  function getOrCreateSite(info, program) {
    let key;
    if (info.kind === "case") {
      key = info.testNode ? "case:" + info.testNode.start : "default:" + info.node.start;
    } else {
      key = info.kind + ":" + (info.testNode ? info.testNode.start : info.node.start);
    }
    let site = sites[key];
    if (site) return site;
    let statement = sourceOf(program, info.node);
    if (statement && statement.length > STATEMENT_PREVIEW_CHARS) {
      statement = statement.slice(0, STATEMENT_PREVIEW_CHARS) + "…";
    }
    if (info.kind === "case") {
      let sw = switchMap[key];
      let condition = info.testNode
        ? "switch discriminant === " + sourceOf(program, info.testNode)
        : "switch default (no case matched)";
      let discInfo = null;
      if (sw && sw.discriminant) {
        discInfo = switchCases[sw.discriminant.start] || null;
      }
      site = {
        id: key,
        kind: "case",
        condition: condition,
        statement: statement,
        location: info.testNode
          ? { start: info.testNode.start, end: info.testNode.end }
          : { start: info.node.start, end: info.node.end },
        arms: ["matched"],
        counts: { matched: 0 },
        coveredBy: { matched: null },
        covered: false,
        witnessArgs: null,
        witnessRun: null,
        attempted: { matched: false },
        reasons: { matched: null },
        mutationTried: false,
        discriminant: sw ? sw.discriminant : null,
        caseValue: sw ? sw.caseValue : null,
        isDefault: sw ? sw.isDefault : !info.testNode,
        discriminantName: discInfo ? discInfo.discriminantName : null,
        caseLiterals: discInfo ? discInfo.literals : null,
      };
    } else {
      let condition = info.testNode
        ? sourceOf(program, info.testNode)
        : "true (no test)";
      site = {
        id: key,
        kind: info.kind,
        condition: condition,
        statement: statement,
        location: info.testNode
          ? { start: info.testNode.start, end: info.testNode.end }
          : { start: info.node.start, end: info.node.end },
        arms: ["true", "false"],
        counts: { "true": 0, "false": 0 },
        coveredBy: { "true": null, "false": null },
        covered: false,
        witnessArgs: null,
        witnessRun: null,
        attempted: { "true": false, "false": false },
        reasons: { "true": null, "false": null },
        mutationTried: false,
        // The clean test node (see cleanNode): the stage's stored
        // clone may contain patch-wrapped children, which the solver
        // cannot read.
        testNode: cleanNode(info.testNode),
        counterStarts: info.kind === "loop" ? counterStartsFor(info.node, ast) : {},
      };
    }
    sites[key] = site;
    siteOrder.push(key);
    return site;
  }

  function siteByLocationStart(start) {
    for (let ii = 0; ii < siteOrder.length; ++ii) {
      let site = sites[siteOrder[ii]];
      if (site.location && site.location.start === start) return site;
    }
    return null;
  }

  // The aggregate live analyzer's ONE_SIDED_BRANCH findings are the
  // target list. Hashes are remapped to the branch site's source
  // position first — the instrumenter's hashes are per-Stage, so the
  // same branch has a different hash in every run. Capped flips are
  // filtered out: they are the tool's intervention, not the program.
  // Only ONE_SIDED_BRANCH is taken from the aggregate — its other
  // findings would conflate separate runs (loop iterations add up).
  function remapEvent(line, stage) {
    if (line.event !== "IF_TEST" && line.event !== "LOOP_TEST" && line.event !== "TERNARY") return line;
    if (typeof line.hash !== "number" || !stage.nodes || !stage.nodes[line.hash]) return line;
    let node = stage.nodes[line.hash].node;
    if (!node) return line;
    let canonical = node.test && typeof node.test.start === "number" ? node.test.start : node.start;
    let copy = Object.assign({}, line);
    copy.hash = canonical;
    return copy;
  }

  function aggregateOneSided() {
    let agg = liveAnalyzer(liveThresholds);
    for (let rr = 0; rr < allRuns.length; ++rr) {
      let runRec = allRuns[rr];
      for (let ee = 0; ee < runRec.events.length; ++ee) {
        let line = runRec.events[ee];
        if (line.capped) continue;
        agg.feed(remapEvent(line, runRec.stage));
      }
    }
    let fin = agg.finish();
    let out = [];
    for (let ii = 0; ii < fin.findings.length; ++ii) {
      if (fin.findings[ii].code === "ONE_SIDED_BRANCH") out.push(fin.findings[ii]);
    }
    return out;
  }

  function runCandidate(args, runNo) {
    let program = code + "\n" + entry + "(" + args.map(serializeArg).join(", ") + ");";
    let live = liveAnalyzer(liveThresholds);
    let loopCounts = {};
    let capped = false;
    let run = runInternals.createTraceRun(iroh, program, {
      events: "ALL",
      rawOnEvent: function(raw, trigger, line) {
        if (raw.type === INSTR.LOOP_TEST && trigger === "test" && raw.value === true) {
          let key = String(raw.hash);
          loopCounts[key] = (loopCounts[key] || 0) + 1;
          if (loopCounts[key] > loopCap) {
            capped = true;
            raw.value = false;
            line.value = false;
            line.capped = true;
          }
        }
      },
      onEvent: function(line) {
        let fired = live.feed(line);
        for (let ii = 0; ii < fired.length; ++ii) {
          emit({ type: "live-finding", run: runNo, finding: fired[ii] });
        }
      },
    });
    let stage = run.stage;
    let runner = runInternals.compileRunner(iroh, stage, false);
    let result = void 0;
    let error = null;
    try {
      result = runner(iroh);
    } catch (e) {
      error = e;
      runInternals.attachTraceEvents(e, run.events);
    }
    let liveSummary = live.finish();
    return {
      run: runNo,
      args: args.slice(),
      program: program,
      stage: stage,
      events: run.events,
      result: result,
      error: error,
      capped: capped,
      liveFindings: liveSummary.findings,
    };
  }

  function updateSites(runRec) {
    let newly = [];
    let events = runRec.events;
    for (let ii = 0; ii < events.length; ++ii) {
      let ev = events[ii];
      if (ev.capped) continue;
      let info = null;
      let isCase = false;
      if (
        (ev.event === "IF_TEST" && ev.trigger === "test") ||
        (ev.event === "LOOP_TEST" && ev.trigger === "test") ||
        (ev.event === "TERNARY" && ev.trigger === "fire")
      ) {
        info = siteInfoForEvent(runRec.stage, ev);
      } else if (ev.event === "CASE_ENTER" && ev.trigger === "enter") {
        info = siteInfoForCase(runRec.stage, ev);
        isCase = info !== null;
      }
      if (!info) continue;
      let site = getOrCreateSite(info, runRec.program);
      let arm = info.arm;
      let before = site.counts[arm];
      site.counts[arm] += 1;
      if (before === 0) {
        site.coveredBy[arm] = runRec.run;
        newly.push({ branch: site.id, arm: arm });
        emit({ type: "branch-covered", branch: site.id, arm: arm, run: runRec.run, args: runRec.args.slice() });
      }
      site.witnessArgs = runRec.args.slice();
      site.witnessRun = runRec.run;
      if (isCase) {
        if (site.counts.matched > 0) site.covered = true;
      } else if (site.counts["true"] > 0 && site.counts["false"] > 0) {
        site.covered = true;
      }
    }
    return newly;
  }

  function solveForTarget(target) {
    let site = target.site;
    let witness = site.witnessArgs || [];
    let args = witness.slice();
    while (args.length < params.length) args.push(void 0);
    if (site.kind === "case") {
      return solveCaseTarget(site, args, params);
    }
    if (!site.testNode) {
      return { reason: "loop has no test expression — it always runs, so the exit arm cannot be covered by an input" };
    }
    return solveTest(site.testNode, target.arm === "true", args, params, site.counterStarts || {}, code, 0);
  }

  function pushAgenda(args, via) {
    let key = JSON.stringify(args);
    if (tried[key]) return false;
    for (let ii = 0; ii < agenda.length; ++ii) {
      if (JSON.stringify(agenda[ii].args) === key) return false;
    }
    agenda.push({ args: args.slice(), via: via });
    return true;
  }

  function pickTarget(oneSided) {
    for (let ii = 0; ii < oneSided.length; ++ii) {
      let f = oneSided[ii];
      let site = f.evidence && typeof f.evidence.hash === "number"
        ? siteByLocationStart(f.evidence.hash)
        : null;
      if (!site) continue;
      for (let aa = 0; aa < site.arms.length; ++aa) {
        let arm = site.arms[aa];
        if (site.counts[arm] === 0 && !site.attempted[arm]) return { site: site, arm: arm };
      }
    }
    // Fallback: a branch tested too few times for the analyzer to call
    // one-sided (fewer than oneSidedMinTests tests) is targeted from
    // the table directly.
    for (let ii = 0; ii < siteOrder.length; ++ii) {
      let site = sites[siteOrder[ii]];
      for (let aa = 0; aa < site.arms.length; ++aa) {
        let arm = site.arms[aa];
        if (site.counts[arm] === 0 && !site.attempted[arm]) return { site: site, arm: arm };
      }
    }
    return null;
  }

  // Register every switch case up front: a case no run ever matches
  // still counts as a branch. Without this the total would silently
  // shrink to the cases the seeds happened to hit.
  let switchKeys = Object.keys(switchMap);
  for (let ii = 0; ii < switchKeys.length; ++ii) {
    let sw = switchMap[switchKeys[ii]];
    getOrCreateSite({ kind: "case", node: sw.caseNode, testNode: sw.caseValue }, code);
  }

  // --- main loop -----------------------------------------------------------
  while (runIndex < maxRuns) {
    if (agenda.length === 0) {
      let oneSided = aggregateOneSided();
      let target = pickTarget(oneSided);
      if (!target) break;
      let solved = solveForTarget(target);
      if (solved.candidates && solved.candidates.length > 0) {
        let added = 0;
        for (let ii = 0; ii < solved.candidates.length; ++ii) {
          if (pushAgenda(solved.candidates[ii], "solver")) added += 1;
        }
        if (added === 0) {
          target.site.attempted[target.arm] = true;
          target.site.reasons[target.arm] = solved.reason || "the solver's candidates were already tried";
        }
      } else {
        target.site.attempted[target.arm] = true;
        target.site.reasons[target.arm] = solved.reason || "the solver produced no candidate";
        if (!target.site.mutationTried) {
          target.site.mutationTried = true;
          let muts = mutations(target.site.witnessArgs || []);
          for (let ii = 0; ii < muts.length; ++ii) pushAgenda(muts[ii], "mutation");
        }
      }
      continue;
    }
    let item = agenda.shift();
    let key = JSON.stringify(item.args);
    if (tried[key]) continue;
    tried[key] = true;
    let runRec = runCandidate(item.args, runIndex);
    runIndex += 1;
    allRuns.push(runRec);
    let newly = updateSites(runRec);
    let inputRec = {
      args: runRec.args.slice(),
      run: runRec.run,
      result: safeValue(runRec.result, 3, new Set()),
      error: runRec.error ? (runRec.error.message || String(runRec.error)) : null,
      capped: runRec.capped,
      covers: newly.map(function(n) { return n.branch + ":" + n.arm; }),
      via: item.via,
    };
    inputs.push(inputRec);
    if (item.via !== "seed") synthesizedCount += 1;
    emit({
      type: "run",
      run: runRec.run,
      args: runRec.args.slice(),
      result: inputRec.result,
      error: inputRec.error,
      capped: runRec.capped,
      newlyCovered: newly,
    });
  }

  // --- report ----------------------------------------------------------------
  let coveredArms = 0;
  let totalArms = 0;
  let branches = [];
  let uncovered = [];
  for (let ii = 0; ii < siteOrder.length; ++ii) {
    let site = sites[siteOrder[ii]];
    let publicArms = [];
    for (let aa = 0; aa < site.arms.length; ++aa) {
      let arm = site.arms[aa];
      totalArms += 1;
      let isCovered = site.counts[arm] > 0;
      if (isCovered) coveredArms += 1;
      publicArms.push({
        arm: arm,
        observed: site.counts[arm],
        covered: isCovered,
        coveredBy: site.coveredBy[arm],
      });
      if (!isCovered) {
        let reason = site.reasons[arm];
        if (!reason) {
          reason = "not targeted: the run budget of " + maxRuns + " was exhausted after " + runIndex + " runs";
        }
        uncovered.push({
          id: site.id,
          kind: site.kind,
          condition: site.condition,
          statement: site.statement,
          location: site.location,
          arm: arm,
          reason: reason,
          observed: site.counts[arm],
        });
      }
    }
    branches.push({
      id: site.id,
      kind: site.kind,
      condition: site.condition,
      statement: site.statement,
      location: site.location,
      arms: publicArms,
      covered: site.covered,
      reasons: site.reasons,
    });
  }

  // Findings: the final aggregate ONE_SIDED_BRANCH findings first
  // (they carry their branch), then the per-run live findings —
  // deduped by code + branch site + message. The site is canonical
  // (the condition's source position): a per-run finding's hash is
  // its own Stage's hash, so the same loop would otherwise appear
  // once per run that never entered it.
  function canonicalHash(stage, hash) {
    if (typeof hash !== "number" || !stage || !stage.nodes || !stage.nodes[hash]) return hash;
    let node = stage.nodes[hash].node;
    if (!node) return hash;
    return node.test && typeof node.test.start === "number" ? node.test.start : node.start;
  }
  function findingKey(f, stage) {
    let h = "";
    if (f.evidence) {
      if (typeof f.evidence.hash === "number") {
        h = String(canonicalHash(stage, f.evidence.hash));
      } else if (Array.isArray(f.evidence.hashes)) {
        let parts = [];
        for (let ii = 0; ii < f.evidence.hashes.length; ++ii) {
          parts.push(String(canonicalHash(stage, f.evidence.hashes[ii])));
        }
        h = parts.join(",");
      }
    }
    return f.code + "|" + h + "|" + f.message;
  }
  let findings = [];
  let seenFinding = {};
  function addFinding(f, stage) {
    let key = findingKey(f, stage);
    if (seenFinding[key]) return;
    seenFinding[key] = true;
    findings.push(f);
  }
  let finalOneSided = aggregateOneSided();
  for (let ii = 0; ii < finalOneSided.length; ++ii) {
    let f = finalOneSided[ii];
    let copy = Object.assign({}, f);
    let site = f.evidence && typeof f.evidence.hash === "number"
      ? siteByLocationStart(f.evidence.hash)
      : null;
    if (site) {
      copy.branch = site.id;
      copy.condition = site.condition;
    }
    // The aggregate hash is already canonical (a source position).
    addFinding(copy, null);
  }
  for (let rr = 0; rr < allRuns.length; ++rr) {
    let lf = allRuns[rr].liveFindings;
    for (let ii = 0; ii < lf.length; ++ii) addFinding(lf[ii], allRuns[rr].stage);
  }

  // Every candidate run's Stage is released now that the findings are
  // built (site info was resolved from the stages above). The stages
  // are needed during synthesis — remapEvent and the site lookups read
  // them per run — so they cannot be released per run, only here at
  // the end. Before 1.1.1 every one stayed registered in Iroh.stages
  // forever, so a synthesis over many runs retained every trace.
  for (let rr = 0; rr < allRuns.length; ++rr) {
    runInternals.releaseTraceRun(iroh, allRuns[rr]);
  }

  let coverage = {
    covered: coveredArms,
    total: totalArms,
    value: totalArms > 0 ? Math.round((coveredArms / totalArms) * 10000) / 10000 : 1,
    sites: siteOrder.length,
    branches: branches,
  };
  return {
    entry: entry,
    inputs: inputs,
    coverage: coverage,
    runs: { used: runIndex, budget: maxRuns },
    uncovered: uncovered,
    findings: findings,
    summary: {
      branchesCovered: coveredArms,
      branchesTotal: totalArms,
      sites: siteOrder.length,
      inputsRun: inputs.length,
      inputsSynthesized: synthesizedCount,
      runsUsed: runIndex,
      runsBudget: maxRuns,
      uncoveredBranches: uncovered.length,
    },
  };
}

var _synth = /*#__PURE__*/Object.freeze({
  __proto__: null,
  SYNTHESIZE_DEFAULTS: SYNTHESIZE_DEFAULTS,
  synthesize: synthesize
});

// Shared Python bridge for the IrohScript bootstrap (the Level 0
// Python compiler in irohscript/). Used by the translator
// (src/translate.js) and the IrohScript -> JavaScript code generator
// (src/irohscript-codegen.js). Nothing in this file is wired onto the
// public Iroh object: src/index.js does not import it, so these
// helpers stay internal. The browser bundle has no python3 and no
// require: getChildProcessSync() returns null there and callers throw
// a clear error (see the async path for the ESM alternative).
//
// Division/modulo note: the AST helper compiles with the bootstrap,
// whose semantics are Python-style (7/2 = 3.5, -5 % 3 = 1). The code
// generator preserves that with __iroh_pymod for MOD and plain / for
// DIV (JavaScript / is float division, the same as Python's). If Andy
// ever calls C++-style (truncated) instead, the flip is one helper
// function in the code generator, not a change here.

// Locate the IrohScript sources (the Python bootstrap lives in the
// repo at irohscript/). Resolution order: options.irohscriptHome,
// IROHSCRIPT_HOME, <cwd>/irohscript, <cwd> itself when it already is
// the irohscript directory.
function irohscriptHomeCandidates(options) {
  let out = [];
  function push(h) {
    if (h && out.indexOf(h) === -1) out.push(h);
  }
  if (options && options.irohscriptHome) push(options.irohscriptHome);
  if (typeof process !== "undefined" && process.env && process.env.IROHSCRIPT_HOME) {
    push(process.env.IROHSCRIPT_HOME);
  }
  if (typeof process !== "undefined" && process.cwd) {
    try {
      push(process.cwd() + "/irohscript");
      push(process.cwd());
    } catch (e) {}
  }
  return out;
}

// Run one of the embedded Python helpers (below) against `code`.
// The helper gets the irohscript directory as argv[1] and the source
// on stdin, and prints JSON on stdout. Candidates are tried in order
// until one resolves the import; any other failure is the real error
// (a compile error in the source, or a broken helper).
function runIrohscriptPython(code, options, childProcess, helper, what) {
  let candidates = irohscriptHomeCandidates(options);
  for (let ii = 0; ii < candidates.length; ++ii) {
    let stdout;
    try {
      stdout = childProcess.execFileSync("python3", ["-c", helper, candidates[ii]], {
        input: code,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e) {
      if (e.code === "ENOENT") {
        throw new Error("Iroh.translate: python3 was not found on PATH (needed to parse " + what + " source)");
      }
      let stderr = e.stderr ? String(e.stderr) : "";
      if (stderr.indexOf("ModuleNotFoundError") !== -1 || stderr.indexOf("No module named") !== -1) {
        continue;
      }
      let lines = stderr.split("\n").filter(function(l) { return l.trim() !== ""; });
      let last = lines.length > 0 ? lines[lines.length - 1] : (e.message || String(e));
      throw new Error("Iroh.translate: " + what + " failed: " + last);
    }
    return JSON.parse(stdout);
  }
  throw new Error("Iroh.translate: IrohScript sources not found (looked for irohscript/src/compiler.py) — run from the IrohRedux checkout, set IROHSCRIPT_HOME, or pass { irohscriptHome }");
}

// stdlib-only Python helper: reads IrohScript source on stdin,
// compiles it with the bootstrap compiler, writes the AST as JSON on
// stdout (warnings go to stderr). No hand-rolled IrohScript parser
// on the JS side — the bootstrap is the authority, the same way
// Python -> JS uses Python's own ast module. The AST JSON is
// ast_with_conds: to_dict() plus the Amendment A1 Loop ``cond``
// (golden to_dict stays cond-free; the translator needs the
// condition to lower the conditional LOOP).
const IROHSCRIPT_AST_HELPER = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "from src.compiler import IrohCompiler",
  "from src.ast_nodes import ast_with_conds",
  "src = sys.stdin.read()",
  "try:",
  "    result = IrohCompiler().compile(src)",
  "except Exception as exc:",
  "    sys.stderr.write('CompileError: %s\\n' % (exc,))",
  "    sys.exit(1)",
  "for w in result.warnings:",
  "    sys.stderr.write('warning: %s\\n' % (w,))",
  "sys.stdout.write(json.dumps(ast_with_conds(result.ast)))",
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
function nodeImport(specifier) {
  return new Function("s", "return import(s);")(specifier);
}

// Hybrid translation engine for IrohRedux — JavaScript <-> Python /
// C++ / IrohScript / BASIC.
//
//   Iroh.translate(code, { from, to })      -> { code, report } (sync)
//   Iroh.translateAsync(code, { from, to }) -> Promise of the same
//
// `from` defaults to "javascript"; `to` is "python" | "cpp" |
// "javascript" | "irohscript" | "basic". The JavaScript-out leg is hybrid: the AST (static)
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

// 1.1.1 patch (Fix Spec 3.7): verify the emitted Python actually
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
        // The synthesized __iroh_jsdiv call (JS "/" to Python, A10) keeps
        // its VALUE JS-shaped but is typed double at boundaries so the
        // string paths format through __iroh_jsnum exactly like a traced
        // double. The C++ leg never synthesizes this call.
        if (name === "__iroh_jsdiv") return "double";
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
  let needs = { math: false, random: false, cmath: false, algorithm: false, stdexcept: false, cstdlib: false, sysexit: false, vectorHelper: false, unsupportedHelper: false, cout: false, jsmod: false, jsnum: false, jsbool: false, jsdiv: false };
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

  // Python helper (A10): the type a && / || VALUE has. JS returns the
  // left operand when falsy and the right otherwise, so the value's type
  // is the operands' common type when they agree. Python's and/or already
  // preserve the operand value (so a homogeneous non-bool pair needs NO
  // "true"/"false" ternary — that path is for real booleans, the result of
  // comparisons). Mixed or unknown operands resolve to null: honest
  // unknown, handled per-boundary.
  function pyLogicalType(node) {
    if (node.type !== "LogicalExpression") return inferType(node, ctx);
    let lt = pyLogicalType(node.left);
    let rt = pyLogicalType(node.right);
    if (lt !== null && lt === rt) return lt;
    return null;
  }

  // Python helper: render an expression as a string for concatenation.
  // Python "+" refuses str + number at runtime, so non-strings must be
  // converted — str() for ints, the JS "true"/"false" ternary for
  // bools, __iroh_jsnum for doubles (str() formats 1e16 as "1e+16",
  // where JS prints "10000000000000000").
  function pyStringOf(node) {
    let t = inferType(node, ctx);
    if (node.type === "LogicalExpression") t = pyLogicalType(node);
    let s = expr(node);
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
    if (node.type === "LogicalExpression") {
      // Mixed/unknown operands (A10): Python's and/or preserve the
      // operand like JS &&/||, but str + number is a TypeError, so coerce
      // with str() — JS String()'s closest honest neighbour — instead of
      // assuming a string.
      return "str(" + s + ")";
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
    let s = expr(node);
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
      // 1.1.1 patch (Fix Spec 3.5 Option 1): concatenation, NOT an
      // f-string. Property P1 (spec 3.2): on Python before 3.12 a
      // replacement field cannot contain the delimiter quote, a
      // backslash, # or an unbalanced brace/colon — and every branch
      // that pushed a raw expression into {...} violated it in
      // principle (string literals, ternaries of strings, literal
      // text + a field all emitted SyntaxErrors on 3.9-3.11 while
      // the report said ok). Concatenation has no delimiter rules:
      // the expression sits in ordinary parentheses. Literal text
      // is emitted with JSON.stringify — a real serialiser, not the
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
          // A10: a && / || interpolates as its VALUE (the operand), not
          // as a forced bool — homogeneous bools still render "true"/
          // "false" exactly like before.
          if (e.type === "LogicalExpression") t = pyLogicalType(e);
          if (t === "std::string") {
            parts.push(expr(e));
          } else if (t === "int") {
            parts.push("str(" + expr(e) + ")");
          } else if (t === "bool") {
            // A bool interpolates as "true"/"false" (Python str()
            // would print "True"). Route through the helper, same
            // pattern as __iroh_jsnum for doubles.
            needs.jsbool = true;
            parts.push("__iroh_jsbool(" + expr(e) + ")");
          } else if (t === "double") {
            needs.jsnum = true;
            parts.push("__iroh_jsnum(" + expr(e) + ")");
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
            parts.push("str(" + expr(e) + ")");
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
        if (t === "std::string") parts.push(expr(e));
        else if (t === "int") parts.push("std::to_string(" + expr(e) + ")");
        else if (t === "bool") parts.push("((" + expr(e) + ') ? "true" : "false")');
        else if (t === "double") {
          needs.jsnum = true;
          parts.push("__iroh_jsnum(" + expr(e) + ")");
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
    let obj = expr(node.object);
    if (!node.computed) {
      let prop = node.property.name !== void 0 ? node.property.name : node.property.value;
      if (prop === "length") {
        if (isPy) return "len(" + obj + ")";
        return obj + ".size()";
      }
      return obj + "." + prop;
    }
    return obj + "[" + expr(node.property) + "]";
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
          } else if ((a.type === "LogicalExpression" ? pyLogicalType(a) : inferType(a, ctx)) === "bool") {
            args.push('("true" if ' + expr(a) + ' else "false")');
          } else if (inferType(a, ctx) === "double") {
            // print() uses str(), which formats 1e16 as "1e+16"
            // where JS prints "10000000000000000".
            needs.jsnum = true;
            args.push("__iroh_jsnum(" + expr(a) + ")");
          } else {
            args.push(expr(a));
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
      let args = node.arguments.map(function(a) { return expr(a); }).join(", ");
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
          return "(" + node.arguments.map(function(a) { return expr(a); }).join(" ** ") + ")";
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
        if (isPy) return "int(" + expr(node.arguments[0]) + ")";
        return "std::stoi(" + expr(node.arguments[0]) + ")";
      }
      if (name === "parseFloat") {
        if (isPy) return "float(" + expr(node.arguments[0]) + ")";
        return "std::stod(" + expr(node.arguments[0]) + ")";
      }
      if (name === "String") {
        if (isPy) {
          let at = inferType(node.arguments[0], ctx);
          if (at === "double") {
            // str() formats 1e16 as "1e+16"; JS prints "10000000000000000".
            needs.jsnum = true;
            return "__iroh_jsnum(" + expr(node.arguments[0]) + ")";
          }
          if (at === "bool") {
            // str(True) is "True"; JS String(true) is "true".
            return '("true" if ' + expr(node.arguments[0]) + ' else "false")';
          }
          if (at && at.indexOf("std::vector<") === 0) {
            return unsupportedExpr(
              "String() of an array in Python (JS joins with commas; Python str() prints brackets)",
              "CallExpression"
            );
          }
          return "str(" + expr(node.arguments[0]) + ")";
        }
        // std::to_string prints doubles with 6 decimals ("1.500000"),
        // unlike JS String(1.5) ("1.5") — route doubles through the
        // JS number formatter. std::to_string(true) is "1", not
        // "true" — bools get the ternary. Ints and strings keep
        // std::to_string.
        if (inferType(node.arguments[0], ctx) === "double") {
          needs.jsnum = true;
          return "__iroh_jsnum(" + expr(node.arguments[0]) + ")";
        }
        if (inferType(node.arguments[0], ctx) === "bool") {
          return "std::string(((" + expr(node.arguments[0]) + ') ? "true" : "false"))';
        }
        return "std::to_string(" + expr(node.arguments[0]) + ")";
      }
      if (name === "Number") {
        if (isPy) return "float(" + expr(node.arguments[0]) + ")";
        return "std::stod(" + expr(node.arguments[0]) + ")";
      }
      if (name === "Boolean") {
        if (isPy) return "bool(" + expr(node.arguments[0]) + ")";
        return unsupportedExpr("Boolean() has no direct C++ equivalent in v1", "CallExpression");
      }
      let args = [];
      for (let ii = 0; ii < node.arguments.length; ++ii) {
        let a = node.arguments[ii];
        if (a.type === "SpreadElement") {
          return unsupportedExpr("spread arguments", "CallExpression");
        }
        args.push(expr(a));
      }
      return name + "(" + args.join(", ") + ")";
    }
    // Member calls: arr.push(x), str.toUpperCase(), ...
    if (node.callee.type === "MemberExpression") {
      let prop = node.callee.computed
        ? null
        : (node.callee.property.name !== void 0 ? node.callee.property.name : node.callee.property.value);
      // process.exit(code): the program ends. It only ever reaches
      // this emitter from a BASIC END/STOP (the BASIC leg emits it)
      // or from user JS calling it directly. Python gets sys.exit
      // (with an import), C++ gets std::exit (with <cstdlib>) — both
      // end the program in any context, so code after the call stays
      // unreachable exactly as in the source. No arg means code 0.
      if (node.callee.object.type === "Identifier" && node.callee.object.name === "process" && prop === "exit") {
        let code = node.arguments.length > 0 ? expr(node.arguments[0]) : "0";
        if (isPy) {
          needs.sysexit = true;
          return "sys.exit(" + code + ")";
        }
        needs.cstdlib = true;
        return "std::exit(" + code + ")";
      }
      let obj = expr(node.callee.object);
      if (prop === "push") {
        let args = node.arguments.map(function(a) { return expr(a); }).join(", ");
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
        return paren(expr(node.left), node.left, 13) + " ** " + paren(expr(node.right), node.right, 13);
      }
      needs.cmath = true;
      return "std::pow(" + expr(node.left) + ", " + expr(node.right) + ")";
    }
    if (op === "%") {
      if (isPy) {
        // JS % is the truncated remainder; Python % is floored (it
        // takes the divisor's sign). math.fmod has the right sign but
        // returns a float, which would print "-2.0" where JS prints
        // "-2" — so use the truncating identity through a helper,
        // which keeps ints int and floats float.
        needs.jsmod = true;
        return "__iroh_jsmod(" + expr(node.left) + ", " + expr(node.right) + ")";
      }
      // C++ % is truncated like JS, but only for integers — % on
      // doubles does not compile. Route double operands through
      // std::fmod (also truncated, so the semantics match).
      let lt = inferType(node.left, ctx);
      let rt = inferType(node.right, ctx);
      if (lt === "double" || rt === "double") {
        needs.cmath = true;
        return "std::fmod(" + expr(node.left) + ", " + expr(node.right) + ")";
      }
    }
    if (op === "/" && isPy) {
      // A10: JS "/" to Python. Python's "/" ALWAYS yields a float, so
      // an even division printed "3.0" where JS prints "3", and the
      // float-ness then leaked into every downstream product
      // (f = 6/2; f * 2 printed "6.0"). Keep the VALUE JS-shaped through
      // a helper (the __iroh_jsmod doctrine): an integral quotient within
      // the safe-integer range comes back int — it prints bare, str()s
      // bare, and stays int-exact in later arithmetic — while anything
      // else comes back float. The emitted call is typed "double" by
      // inferType, so string boundaries format through __iroh_jsnum
      // exactly like a traced double. Division by zero still raises
      // Python's ZeroDivisionError, surfaced by the verify block — the
      // same accepted gap as "%" (documented by design).
      needs.jsdiv = true;
      return "__iroh_jsdiv(" + expr(node.left) + ", " + expr(node.right) + ")";
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
      paren(expr(node.left), node.left, myPrec) +
      " " + outOp + " " +
      paren(expr(node.right), node.right, myPrec)
    );
  }

  function expr(node, parentPrec) {
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
            parts.push(expr(el));
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
        return binaryExpr(node);
      case "UnaryExpression": {
        if (node.operator === "typeof" || node.operator === "void" || node.operator === "delete") {
          return unsupportedExpr("unary operator " + node.operator + " is not in the v1 scope", "UnaryExpression");
        }
        let op = node.operator === "!" && isPy ? "not " : node.operator;
        let arg = expr(node.argument);
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
        let arg = expr(node.argument);
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
        let left = expr(node.left);
        let right = expr(node.right);
        return left + " " + op + " " + right;
      }
      case "ConditionalExpression": {
        if (isPy) {
          return expr(node.consequent) + " if " + expr(node.test) + " else " + expr(node.alternate);
        }
        return expr(node.test) + " ? " + expr(node.consequent) + " : " + expr(node.alternate);
      }
      case "TemplateLiteral":
        return templateLiteral(node);
      case "SequenceExpression": {
        if (isPy) {
          return unsupportedExpr("comma (sequence) expressions have no Python equivalent", "SequenceExpression");
        }
        let parts = node.expressions.map(function(e) { return expr(e); });
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
        out.push(p.left.name + " = " + expr(p.right));
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
      let def = p.type === "AssignmentPattern" ? " = " + expr(p.right) : "";
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
    // Classic numeric for: for (let i = A; i <op> B; update), or
    // for (i = A; i <op> B; update) with i declared earlier (the
    // BASIC leg emits the second form so the loop variable stays
    // visible after the loop, the way BASIC scoping works).
    let name = null;
    let start = null;
    if (node.init && node.init.type === "VariableDeclaration") {
      if (node.init.declarations.length !== 1) return null;
      let decl = node.init.declarations[0];
      if (decl.id.type !== "Identifier" || !decl.init) return null;
      name = decl.id.name;
      start = decl.init;
    } else if (node.init && node.init.type === "AssignmentExpression" && node.init.operator === "=" && node.init.left.type === "Identifier") {
      name = node.init.left.name;
      start = node.init.right;
    } else return null;
    if (!node.test || node.test.type !== "BinaryExpression") return null;
    let test = node.test;
    if (test.left.type !== "Identifier" || test.left.name !== name) return null;
    if (["<", "<=", ">", ">="].indexOf(test.operator) === -1) return null;
    let step = null;
    let upd = node.update;
    if (!upd) return null;
    if (upd.type === "UpdateExpression" && upd.argument.type === "Identifier" && upd.argument.name === name) {
      step = upd.operator === "++" ? 1 : -1;
    } else if (upd.type === "AssignmentExpression" && upd.left.type === "Identifier" && upd.left.name === name) {
      if (upd.operator === "+=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = upd.right.value;
      else if (upd.operator === "-=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = -upd.right.value;
      else return null;
    } else return null;
    return { name: name, start: start, op: test.operator, end: test.right, step: step };
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
            emitLine(d.id.name + " = " + (d.init ? expr(d.init) : "None"));
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
                parts.push(expr(d.init.elements[jj]));
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
            emitLine(kind + d.id.name + " = " + expr(d.init) + ";");
          }
        }
        return;
      }
      case "FunctionDeclaration": {
        emitFunction(node, node.id.name);
        return;
      }
      case "ReturnStatement": {
        if (isPy) emitLine(node.argument ? "return " + expr(node.argument) : "return");
        else emitLine(node.argument ? "return " + expr(node.argument) + ";" : "return;");
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
            else if (inferType(a, ctx) === "bool") piece = "((" + expr(a) + ') ? "true" : "false")';
            else if (inferType(a, ctx) === "double") {
              // std::cout defaults to 6 significant digits ("0.3"
              // for 0.1 + 0.2); JS prints "0.30000000000000004".
              needs.jsnum = true;
              piece = "__iroh_jsnum(" + expr(a) + ")";
            }
            else if (a.type === "ArrayExpression" || (inferType(a, ctx) || "").indexOf("std::vector<") === 0) {
              needs.vectorHelper = true;
              piece = null;
              emitLine("__iroh_print_vec(" + expr(a) + ");");
            } else piece = expr(a);
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
          emitLine(expr(e.argument) + (e.operator === "++" ? " += 1" : " -= 1"));
          return;
        }
        if (isPy) {
          let s = expr(e);
          // console.log in Python is a single print() expression.
          emitLine(s);
        } else {
          emitLine(expr(e) + ";");
        }
        return;
      }
      case "IfStatement": {
        counts.conditionals += 1;
        if (isPy) {
          emitLine("if " + expr(node.test) + ":");
          emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { body: [node.consequent] });
          let alt = node.alternate;
          while (alt) {
            if (alt.type === "IfStatement") {
              emitLine("elif " + expr(alt.test) + ":");
              emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { body: [alt.consequent] });
              alt = alt.alternate;
            } else {
              emitLine("else:");
              emitBody(alt.type === "BlockStatement" ? alt : { body: [alt] });
              alt = null;
            }
          }
        } else {
          emitLine("if (" + expr(node.test) + ") {");
          emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { body: [node.consequent] });
          emitLine("}");
          let alt = node.alternate;
          if (alt) {
            if (alt.type === "IfStatement") {
              // else-if: emit as `} else if (...) {` — simplest is to
              // re-enter with the alternate as an if, on the else line.
              lines[lines.length - 1] = indentStr() + "} else if (" + expr(alt.test) + ") {";
              emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { body: [alt.consequent] });
              emitLine("}");
              if (alt.alternate) {
                lines[lines.length - 1] = indentStr() + "} else {";
                emitBody(alt.alternate.type === "BlockStatement" ? alt.alternate : { body: [alt.alternate] });
                emitLine("}");
              }
            } else {
              lines[lines.length - 1] = indentStr() + "} else {";
              emitBody(alt.type === "BlockStatement" ? alt : { body: [alt] });
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
          let start = expr(pat.start);
          let end = expr(pat.end);
          let rangeArgs = start + ", " + end;
          if (pat.op === "<=") rangeArgs = start + ", " + end + " + 1";
          else if (pat.op === ">=") rangeArgs = start + ", " + end + " - 1";
          if (pat.step !== 1 && pat.step !== -1) rangeArgs += ", " + pat.step;
          else if (pat.op === ">" || pat.op === ">=") rangeArgs += ", -1";
          emitLine("for " + pat.name + " in range(" + rangeArgs + "):");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
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
              init = "auto " + d.id.name + " = " + expr(d.init);
            } else init = expr(node.init);
          }
          emitLine("for (" + init + "; " + (node.test ? expr(node.test) : "") + "; " + (node.update ? expr(node.update) : "") + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "ForOfStatement": {
        counts.loops += 1;
        let target = node.left.declarations ? node.left.declarations[0].id.name : (node.left.name || "?");
        if (isPy) {
          emitLine("for " + target + " in " + expr(node.right) + ":");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
        } else {
          // Amendment A6 (2026-11-22): a C++ string literal in a
          // range-for decays to a char array INCLUDING the NUL
          // terminator, which the source program's iterator never
          // yields — wrap it in std::string so the walk is exact.
          let iterText = expr(node.right);
          if (node.right.type === "Literal" && typeof node.right.value === "string") {
            iterText = "std::string(" + iterText + ")";
          }
          emitLine("for (auto " + target + " : " + iterText + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
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
          emitLine("while " + expr(node.test) + ":");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
        } else {
          emitLine("while (" + expr(node.test) + ") {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
          emitLine("}");
        }
        return;
      }
      case "DoWhileStatement": {
        counts.loops += 1;
        if (isPy) {
          emitLine("while True:");
          indentLevel += 1;
          let body = node.body.type === "BlockStatement" ? node.body : { body: [node.body] };
          for (let ii = 0; ii < body.body.length; ++ii) stmt(body.body[ii]);
          emitLine("if not (" + expr(node.test) + "):");
          indentLevel += 1;
          emitLine("break");
          indentLevel -= 2;
        } else {
          emitLine("do {");
          emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
          emitLine("} while (" + expr(node.test) + ");");
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
              emitLine(kw + " " + expr(node.discriminant) + " == " + expr(c.test) + ":");
            }
            indentLevel += 1;
            for (let jj = 0; jj < c.consequent.length; ++jj) {
              if (c.consequent[jj].type === "BreakStatement") continue; // no break in if/elif chains
              stmt(c.consequent[jj]);
            }
            indentLevel -= 1;
          }
        } else {
          emitLine("switch (" + expr(node.discriminant) + ") {");
          indentLevel += 1;
          for (let ii = 0; ii < node.cases.length; ++ii) {
            let c = node.cases[ii];
            if (c.test === null) emitLine("default:");
            else emitLine("case " + expr(c.test) + ":");
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
      if (needs.sysexit) header.push("import sys");
      if (needs.jsmod) {
        // JS % is the truncated remainder; Python % is floored.
        // int(a / b) truncates toward zero, so this keeps ints int
        // and floats float, matching JS output exactly.
        header.push("def __iroh_jsmod(a, b):");
        header.push("    return a - int(a / b) * b");
        header.push("");
      }
      if (needs.jsdiv) {
        // JS Number -> JS-shaped quotient (A10): Python's "/" always
        // yields a float, so an even division must come back int to
        // print bare and stay int-exact in later arithmetic. Only an
        // integral quotient within the safe-integer range converts
        // (beyond it a float formats through __iroh_jsnum exactly the
        // way JS String(v) does); anything else stays float. NaN and
        // inf never reach int(q): a NaN fails q != q and falls straight
        // through to return, and an inf fails the safe-range bounds,
        // where Python's int(inf) would raise OverflowError — so the
        // guard comes first. Every token here (a/b, !=, chained
        // comparison, int(), ==) also back-translates to JavaScript:
        // the JS->Python->JS round-trip property lowers this def to a
        // working JS function (isinstance/float would not).
        header.push("def __iroh_jsdiv(a, b):");
        header.push("    q = a / b");
        header.push("    if q != q:");
        header.push("        return q");
        header.push("    if -9007199254740992 <= q <= 9007199254740992:");
        header.push("        i = int(q)");
        header.push("        if i == q:");
        header.push("            return i");
        header.push("    return q");
        header.push("");
      }
      if (needs.jsbool) {
        // JS bool -> string: "true"/"false". A helper, not an inline
        // ternary, so the double quotes never sit inside an f-string
        // replacement field (SyntaxError on Python < 3.12, PEP 701).
        header.push("def __iroh_jsbool(v):");
        header.push("    return \"true\" if v else \"false\"");
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
    if (needs.cstdlib) header.push("#include <cstdlib>");
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
      // __iroh_jsnum uses std::isnan / std::isinf, so it needs
      // <cmath> — but only if the main header did not already emit it
      // (a program that both uses Math and prints a Number used to get
      // the include twice).
      if (!needs.cmath) header.push("#include <cmath>");
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
  // unavailable). 1.1.1 (M6): options.evidence: "none" skips the run
  // entirely (static-only) — for programs with side effects, or when
  // the caller does not want the program executed at all. The report
  // says so, and types come from static inference or hints only.
  let evidenceMode = options.evidence === void 0 ? "trace" : options.evidence;
  if (evidenceMode !== "trace" && evidenceMode !== "none") {
    throw new Error("Iroh.translate: options.evidence must be 'trace' or 'none'");
  }
  let events = [];
  if (evidenceMode === "none") {
    report.notes.push("Dynamic trace evidence skipped (options.evidence: 'none'); types come from static inference or hints only.");
  } else {
  // The evidence trace must not leak the program's
  // output: translate() is a pure function, so the tracer's output
  // is silenced for the duration. Note the program's console.log
  // runs natively (the instrumenter does not rewrite it — Iroh.log
  // is only the fixtures' explicit print), so the global
  // console.log is swapped, not just Iroh.log.
  // process.exit is stubbed too, for the same reason: a translated
  // BASIC program ends with process.exit(0) (its END), and the
  // evidence trace runs the program in-process — without the stub,
  // translating a BASIC program with END killed the host process
  // silently (exit 0, no output, no error). The stub throws a
  // sentinel instead; trace() attaches the events gathered before
  // the END to the thrown error, so the evidence is kept and the
  // program ending is not mistaken for a failure. (In a browser
  // there is no process to stub, and a process.exit in the traced
  // code falls through to the evidence-unavailable path.)
  let originalLog = iroh.log;
  let originalConsoleLog = typeof console !== "undefined" ? console.log : null;
  let originalExit = (typeof process !== "undefined" && process && typeof process.exit === "function") ? process.exit : null;
  iroh.log = function() {};
  if (originalConsoleLog) console.log = function() {};
  if (originalExit) {
    process.exit = function(code) {
      let err = new Error("__iroh_end");
      err.__iroh_end = true;
      err.__iroh_exit_code = code;
      throw err;
    };
  }
  try {
    events = iroh.trace(code).events;
  } catch (e) {
    if (e && e.__iroh_end) {
      events = e.events || [];
    } else {
      report.notes.push(
        "Dynamic trace evidence unavailable (" + (e.message || String(e)) + "); types come from static inference or hints only."
      );
    }
  } finally {
    iroh.log = originalLog;
    if (originalConsoleLog) console.log = originalConsoleLog;
    if (originalExit) process.exit = originalExit;
  }
  }
  let env = buildTraceEnv(events);
  let emitter;
  if (to === "irohscript" || to === "basic") {
    emitter = makeIrohJSEmitter(to, report, env, options.types || null);
  } else {
    emitter = makeJSEmitter(to, report, env, options.types || null);
  }
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
    if (to === "cpp") {
      report.notes.push(
        "Function(s) never called in the trace (" + uncalled.join(", ") +
        "): C++ parameter types for them came from a type hint, or the function was reported unsupported."
      );
    } else {
      report.notes.push(
        "Function(s) never called in the trace (" + uncalled.join(", ") +
        "): parameter types for them came from a type hint, or were omitted."
      );
    }
  }
  // 1.1.1 patch (Fix Spec 3.7): the verify block. Only the Python
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
    let base = t.value;
    if (base === "const" || base === "static" || base === "unsigned" || base === "signed") {
      next();
      let inner = parseType();
      if (!inner) throw new CppParseError("expected a type after '" + base + "'");
      return inner; // qualifiers are dropped (int is int)
    }
    let result = null;
    if (base === "auto" || base === "void" || base === "int" || base === "long" || base === "short" ||
        base === "double" || base === "float" || base === "bool" || base === "char" || base === "size_t") {
      next();
      if (base === "long" || base === "short" || base === "size_t") result = "int";
      else if (base === "float") result = "double";
      else result = base;
    } else if (base === "string") { next(); result = "std::string"; }
    else if (base === "std") {
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
    } else if (base === "vector") {
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
    peek();
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
        parseType();
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
        emitBody(node.consequent.type === "BlockStatement" ? node.consequent : { body: [node.consequent] });
        emitLine("}");
        let alt = node.alternate;
        while (alt) {
          if (alt.type === "IfStatement") {
            lines[lines.length - 1] = indentStr() + "} else if (" + expr(alt.test) + ") {";
            emitBody(alt.consequent.type === "BlockStatement" ? alt.consequent : { body: [alt.consequent] });
            emitLine("}");
            alt = alt.alternate;
          } else {
            lines[lines.length - 1] = indentStr() + "} else {";
            emitBody(alt.type === "BlockStatement" ? alt : { body: [alt] });
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
        emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
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
        emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
        emitLine("}");
        return;
      }
      case "WhileStatement":
        emitLine("while (" + expr(node.test) + ") {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
        emitLine("}");
        return;
      case "DoWhileStatement":
        emitLine("do {");
        emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
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

// ------------------------------------------------------------------
// IrohScript and BASIC (1.0.1 rework, part 2) — the translator learns
// the two new languages, both directions, and --translate accepts
// them. The design follows the 0.8.0 engine's rules: unsupported
// constructs are reported with a loud throwing stub, never silently
// mistranslated; every assumption cites its evidence.
//
// Legs:
//   IrohScript -> JavaScript: the IrohScript AST (from the bootstrap
//     compiler, via python3) is walked statically — the source's own
//     type annotations carry the types, so no trace is needed
//     (staticOnly: true).
//   BASIC -> JavaScript: the BASIC parse tree (from basic.py, via
//     python3) is walked statically (staticOnly: true). GOSUB
//     subroutines become functions; a GOTO lowers through the
//     program-counter dispatch machine (Amendment A7) — a jump into
//     a loop body or a subroutine is a loud stub, not a guess.
//   JavaScript -> IrohScript / BASIC: the JS emitter below walks the
//     Acorn AST with trace evidence, the way the Python/C++ legs do
//     (hybrid, staticOnly: false). IrohScript has no for-loop and no
//     arrays in v1, BASIC has no while loop and no real functions —
//     what cannot be expressed is a loud stub, not a guess.
//   Anything -> Python / C++ from IrohScript or BASIC, and
//     Python / C++ -> IrohScript or BASIC, go two-hop via JavaScript
//     (the JS leg in the middle is traced for its types, exactly as
//     the direct JS -> Python/C++ leg is). The report says so.
//   --direct stays JavaScript-only: the script tracers (Python, C++,
//     IrohScript, BASIC) run under spawnSync, so no directive can
//     reach them mid-run — the same limit Python/C++ already have.
//     Parity, not a gap introduced here.
// ------------------------------------------------------------------




// stdlib-only Python helper: reads BASIC source on stdin, parses it
// with basic.py's own parser, writes the parse tree as JSON on
// stdout (tuples become lists). No hand-rolled BASIC parser here.
const BASIC_AST_HELPER = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1] + '/src')",
  "from basic import parse_program",
  "def conv(v):",
  "    if isinstance(v, tuple):",
  "        return [conv(x) for x in v]",
  "    if isinstance(v, list):",
  "        return [conv(x) for x in v]",
  "    return v",
  "src = sys.stdin.read()",
  "try:",
  "    prog = parse_program(src)",
  "except Exception as exc:",
  "    sys.stderr.write('BasicError: %s\\n' % (exc,))",
  "    sys.exit(1)",
  "sys.stdout.write(json.dumps(conv(prog)))",
].join("\n");

// Default value for an IrohScript type (for LET with no initializer
// and for STRUCT field defaults). null means "a constructor call".
function irohTypeDefault$1(typeName) {
  if (typeName === "Int" || typeName === "Float") return "0";
  if (typeName === "String") return '""';
  if (typeName === "Bool") return "false";
  if (typeName && typeName.indexOf("Vector") === 0) return "[]";
  return null;
}

// IrohScript AST (JSON, node-tagged) -> JavaScript. Static-only: the
// source's type annotations carry the types, and the AST keeps the
// source's structure (Let/If/FunctionDef/Conditional/Action/Intent).
function makeIrohAstJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let needs = { pymod: false, action: false, intent: false };
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  let noted = {};
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  function noteOnce(key, text) {
    if (!noted[key]) { noted[key] = true; report.notes.push(text); }
  }
  function stubStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    emitLine("throw new Error(" + JSON.stringify("IrohRedux: " + detail) + ");");
  }
  let BIN_PREC = { OR: 1, AND: 2, EQ: 3, NEQ: 3, LT: 3, LE: 3, GT: 3, GE: 3, ADD: 4, SUB: 4, MUL: 5, DIV: 5, MOD: 5 };
  function exprPrec(node) {
    if (!node || typeof node !== "object") return 7;
    if (node.node === "BinOp") return BIN_PREC[node.op] || 1;
    if (node.node === "UnaryOp") return 6;
    return 7;
  }
  function expr(node, parentPrec) {
    if (!node || typeof node !== "object") return "undefined";
    let prec = exprPrec(node);
    let out = "";
    if (node.node === "Literal") {
      if (typeof node.value === "string") out = JSON.stringify(node.value);
      else if (typeof node.value === "number" || typeof node.value === "boolean") out = String(node.value);
      else if (node.value === null || node.value === void 0) out = "null";
      else out = JSON.stringify(node.value);
    } else if (node.node === "Name") {
      out = node.name;
    } else if (node.node === "BinOp") {
      if (node.op === "MOD") {
        needs.pymod = true;
        out = "__iroh_pymod(" + expr(node.left, 7) + ", " + expr(node.right, 7) + ")";
      } else {
        let map = { ADD: "+", SUB: "-", MUL: "*", DIV: "/", EQ: "===", NEQ: "!==", LT: "<", LE: "<=", GT: ">", GE: ">=", AND: "&&", OR: "||" };
        out = expr(node.left, prec) + " " + (map[node.op] || node.op) + " " + expr(node.right, prec + 1);
      }
    } else if (node.node === "UnaryOp") {
      out = (node.op === "NOT" ? "!" : "-") + expr(node.operand, 6);
    } else if (node.node === "Call") {
      out = expr(node.callee, 7) + "(" + node.args.map(function(a) { return expr(a, 0); }).join(", ") + ")";
    } else if (node.node === "MemberAccess") {
      out = expr(node.object, 7) + "." + node.member;
    } else {
      markUnsupported(report, node.node || "expression", "expression node '" + (node.node || "?") + "' is not in the v1 scope");
      out = "(function() { throw new Error(" + JSON.stringify("IrohRedux: expression '" + (node.node || "?") + "' is not in the v1 scope") + "); })()";
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function emitBlock(stmts) {
    indentLevel += 1;
    for (let ii = 0; ii < stmts.length; ++ii) stmt(stmts[ii]);
    indentLevel -= 1;
  }
  function stmt(node) {
    if (!node || typeof node.node !== "string") return;
    if (node.node === "Let" || node.node === "Const") {
      counts.variables += 1;
      let kw = node.node === "Const" ? "const " : "let ";
      if (node.value === null || node.value === void 0) {
        if (node.type) {
          let dflt = irohTypeDefault$1(node.type);
          if (dflt !== null) { emitLine(kw + node.name + " = " + dflt + ";"); return; }
          emitLine(kw + node.name + " = " + node.type + "();");
          return;
        }
        emitLine(kw + node.name + ";");
        return;
      }
      emitLine(kw + node.name + " = " + expr(node.value, 0) + ";");
      return;
    }
    if (node.node === "Assign") {
      emitLine(expr(node.target, 0) + " = " + expr(node.value, 0) + ";");
      return;
    }
    if (node.node === "Print") {
      counts.outputs += 1;
      emitLine("console.log(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "Action") {
      needs.action = true;
      emitLine("__iroh_action(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "If") {
      counts.conditionals += 1;
      emitLine("if (" + expr(node.cond, 0) + ") {");
      emitBlock(node.then);
      if (node.else && node.else.length > 0) {
        emitLine("} else {");
        emitBlock(node.else);
      }
      emitLine("}");
      return;
    }
    if (node.node === "Conditional") {
      counts.conditionals += 1;
      needs.action = true;
      emitLine("if (" + expr(node.condition, 0) + ") {");
      indentLevel += 1;
      emitLine("__iroh_action(" + expr(node.action, 0) + ");");
      indentLevel -= 1;
      emitLine("}");
      return;
    }
    if (node.node === "Loop") {
      // Amendment A2 (2026-11-21): the conditional LOOP <Bool-expr>
      // (Amendment A1) lowers to a while loop — same test-first
      // semantics. The legacy bare LOOP has no exit rule and stays
      // a loud stub.
      if (node.cond === null || node.cond === void 0) {
        stubStmt("the legacy bare IrohScript LOOP has no exit rule (Amendment A1 kept it a run-time error), so it cannot translate; the conditional LOOP <Bool-expr> form can", "Loop");
        return;
      }
      counts.loops += 1;
      emitLine("while (" + expr(node.cond, 0) + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "FunctionDef") {
      counts.functions += 1;
      let params = node.params.map(function(p) { return p.name; }).join(", ");
      emitLine("function " + node.name + "(" + params + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "Return") {
      emitLine(node.value ? "return " + expr(node.value, 0) + ";" : "return;");
      return;
    }
    if (node.node === "StructDef") {
      let fields = node.fields.map(function(f) {
        let dflt = irohTypeDefault$1(f.type);
        return f.name + ": " + (dflt !== null ? dflt : f.type + "()");
      }).join(", ");
      emitLine("function " + node.name + "() { return { " + fields + " }; }");
      return;
    }
    if (node.node === "EnumDef") {
      let members = node.members.map(function(m) { return m + ": " + JSON.stringify(m); }).join(", ");
      emitLine("var " + node.name + " = { " + members + " };");
      return;
    }
    if (node.node === "Import") {
      noteOnce("import-" + node.name, "IMPORT '" + node.name + "' has no runtime effect (namespaces are runtime extensions); the import was dropped.");
      return;
    }
    if (node.node === "Intent") {
      needs.intent = true;
      emitLine("__iroh_intent(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "Call") {
      emitLine(expr(node, 0) + ";");
      return;
    }
    stubStmt("statement node '" + node.node + "' is not in the v1 scope", node.node);
  }
  function run(ast) {
    let stmts = ast.statements || [];
    let fns = [];
    let rest = [];
    for (let ii = 0; ii < stmts.length; ++ii) {
      if (stmts[ii].node === "FunctionDef") fns.push(stmts[ii]);
      else rest.push(stmts[ii]);
    }
    for (let ii = 0; ii < fns.length; ++ii) stmt(fns[ii]);
    if (fns.length > 0 && rest.length > 0) lines.push("");
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    let header = [];
    if (needs.pymod) {
      header.push("function __iroh_pymod(a, b) { return ((a % b) + b) % b; }");
      header.push("");
    }
    if (needs.action) {
      header.push("var __iroh_actions = [];");
      header.push("function __iroh_action(v) { __iroh_actions.push(v); console.log(v); }");
      header.push("");
    }
    if (needs.intent) {
      header.push("var __iroh_intents = [];");
      header.push("function __iroh_intent(v) { __iroh_intents.push(v); }");
      header.push("");
    }
    return { text: header.concat(lines).join("\n") + "\n", counts: counts };
  }
  return { run: run, counts: counts };
}

// BASIC parse tree (JSON lists, from basic.py) -> JavaScript.
// Static-only. The program is flattened into slots in line order;
// GOSUB subroutines become hoisted functions, FOR/NEXT becomes a
// for loop, and a program containing a GOTO lowers its mainline
// through the pc-dispatch machine (Amendment A7): __pc walks the
// slots the way basic.py's interpreter walks them, one case per
// basic block. What the machine cannot represent stays a loud stub.
function makeBasicJSEmitter(report) {
  let lines = [];
  let indentLevel = 0;
  let needs = { pymod: false, input: false, dim: false };
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  let declared = {};
  let dimmed = {};
  let noted = {};
  let subTargets = [];
  let stepCounter = 0;
  // Amendment A7: pc-dispatch plan, set by run() when the program
  // contains a GOTO. byTarget maps each GOTO target line to
  // { slot, ok, reason }; caseStarts are the flat slots the machine
  // opens cases at (the valid labels plus the mainline start);
  // decls collects program-wide names for the `var` hoist (a case
  // can be re-entered, so `let` inside the machine would redeclare).
  let gotoPlan = null;
  let curInSub = false;
  // Amendment A8: BASIC has one program-wide variable namespace —
  // basic.py's interpreter keeps a single program-wide vars dict,
  // and a GOSUB body's variables are not private to the subroutine.
  // A name first declared inside a subroutine body hoists to a
  // program-level var (initialized like an untouched BASIC read:
  // 0 for numbers, "" for string names) so the subroutine, the
  // mainline, and the pc-dispatch machine share one binding.
  let progDecls = [];
  let progDeclSet = {};
  // `kind` says why the name hoists: "sub" (Amendment A8, first
  // declared inside a GOSUB subroutine body), "read" (Amendment A9,
  // read before any assignment — basic.py reads an unwritten
  // variable as 0, or "" for string names, while an undeclared
  // JavaScript binding would crash, so the name hoists initialized
  // the BASIC way instead), or "for" (Amendment A11, a FOR loop
  // variable first declared inside another loop's body — the same
  // flat rule: a block-scoped `let` there dies with a ReferenceError
  // on a later mainline read, so it hoists too).
  function progHoist(name, kind) {
    if (!progDeclSet[name]) {
      progDeclSet[name] = true;
      progDecls.push(name);
      if (kind === "read") {
        noteOnce("unwritten-read:" + name, "the BASIC program reads variable '" + name + "' before any assignment (BASIC reads an unwritten variable as 0, or \"\" for string names), so the name hoists to a program-level var initialized that way");
      } else if (kind === "for") {
        noteOnce("for-namespace:" + name, "the BASIC program declares loop variable '" + name + "' inside another loop's body: BASIC has one program-wide variable namespace (basic.py's interpreter keeps a single program-wide vars dict), so the name hoists to a program-level var instead of a block-scoped let inside the loop body");
      } else {
        noteOnce("sub-namespace", "the BASIC program declares a variable inside a GOSUB subroutine: BASIC has one program-wide variable namespace (basic.py's interpreter keeps a single program-wide vars dict), so the declaration hoists to a program-level var shared with the mainline instead of a function-scoped let");
      }
    }
  }
  // Does the expression read `name`? Walks the BASIC expression
  // tuples exactly (["var", name], ["bin", op, l, r], ["un", op,
  // x], ["arr", name, [idx...]]) — never a regex over emitted
  // text, so a name like X never matches a read of X$.
  function readsName(node, name) {
    if (!node || !Array.isArray(node)) return false;
    if (node[0] === "var" && node[1] === name) return true;
    for (let ii = 0; ii < node.length; ++ii) {
      if (Array.isArray(node[ii]) && readsName(node[ii], name)) return true;
    }
    return false;
  }
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  function noteOnce(key, text) {
    if (!noted[key]) { noted[key] = true; report.notes.push(text); }
  }
  function stubStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    emitLine("throw new Error(" + JSON.stringify("IrohRedux: " + detail) + ");");
  }
  // Declaration sites in dispatch mode: the machine can re-enter a
  // case, so main-flow declarations hoist as `var` ahead of it and
  // the site itself becomes a bare assignment. Subroutine bodies
  // write the program-wide namespace (Amendment A8): a name first
  // declared in a subroutine hoists to a program-level var, and the
  // site becomes a bare assignment against that shared binding.
  function dispatchDecl() {
    return !!gotoPlan && !curInSub;
  }
  function hoistDecl(name) {
    // A program-level hoist (Amendment A8) already places the name
    // in scope for the machine, so the machine needs no var of its own.
    if (gotoPlan && !curInSub && !progDeclSet[name]) gotoPlan.decls.push(name);
  }
  let BIN_PREC = { OR: 1, AND: 2, "=": 3, "<>": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 };
  function exprPrec(node) {
    if (!node || !Array.isArray(node)) return 7;
    if (node[0] === "bin") return BIN_PREC[node[1]] || 1;
    if (node[0] === "un") return 6;
    return 7;
  }
  function expr(node, parentPrec) {
    if (!node || !Array.isArray(node)) return "undefined";
    let prec = exprPrec(node);
    let out = "";
    if (node[0] === "num" || node[0] === "str") {
      out = JSON.stringify(node[1]);
    } else if (node[0] === "var") {
      // Amendment A9: a read of a name that has no declaration yet
      // is a read of an unwritten BASIC variable (0, or "" for a
      // string name): hoist it program-level instead of emitting a
      // reference to a binding that does not exist in the lowered
      // JavaScript. Marking it declared keeps a later LET a bare
      // assignment against the hoisted var (a `let` there would
      // redeclare the program-level `var` in the same scope).
      if (!declared[node[1]] && !dimmed[node[1]]) {
        declared[node[1]] = true;
        progHoist(node[1], "read");
      }
      out = node[1];
    } else if (node[0] === "arr") {
      if (!dimmed[node[1]]) {
        markUnsupported(report, "ArrayExpression", "array '" + node[1] + "' is used without DIM");
        out = "(function() { throw new Error(" + JSON.stringify("IrohRedux: array '" + node[1] + "' is used without DIM") + "); })()";
      } else {
        out = node[1];
        for (let ii = 0; ii < node[2].length; ++ii) out += "[" + expr(node[2][ii], 0) + "]";
      }
    } else if (node[0] === "bin") {
      let op = node[1];
      if (op === "%") {
        needs.pymod = true;
        out = "__iroh_pymod(" + expr(node[2], 7) + ", " + expr(node[3], 7) + ")";
      } else {
        let map = { "=": "===", "<>": "!==", AND: "&&", OR: "||" };
        let jsOp = map[op] || op;
        out = expr(node[2], prec) + " " + jsOp + " " + expr(node[3], prec + 1);
      }
    } else if (node[0] === "un") {
      out = (node[1] === "NOT" ? "!" : "-") + expr(node[2], 6);
    } else {
      markUnsupported(report, "expression", "expression '" + node[0] + "' is not in the v1 scope");
      out = "(function() { throw new Error(" + JSON.stringify("IrohRedux: expression '" + node[0] + "' is not in the v1 scope") + "); })()";
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function emitPrint(items) {
    counts.outputs += 1;
    if (!items || items.length === 0) { emitLine("console.log();"); return; }
    let parts = [];
    let trailing = false;
    for (let ii = 0; ii < items.length; ++ii) {
      let item = items[ii];
      let sep = item.length > 1 ? item[1] : null;
      parts.push(expr(item[0], 0));
      if (sep === ";") { parts.push('""'); trailing = true; }
      else if (sep === ",") {
        noteOnce("print-zone", "PRINT with ',' moves to the next print zone (14 columns); translated as a tab.");
        parts.push('"\\t"');
        trailing = true;
      } else {
        trailing = false;
      }
    }
    let joined = parts.join(" + ");
    if (trailing) {
      noteOnce("print-trailing", "PRINT with a trailing separator writes without a newline (process.stdout.write, Node-only).");
      emitLine("process.stdout.write(" + joined + ");");
    } else {
      emitLine("console.log(" + joined + ");");
    }
  }
  // Emit a sequence of BASIC statements (a flat slot range, or one
  // IF branch list). `inSub` is true inside a GOSUB subroutine body;
  // `isFlat` is true when `items` is the program's flat slot array
  // (so subroutine ranges are skipped there, never inside a branch).
  function emitSeq(items, from, to, subRanges, inSub, isFlat) {
    curInSub = inSub;
    let ii = from;
    while (ii < to) {
      if (isFlat) {
        let skipped = false;
        for (let kk = 0; kk < subTargets.length; ++kk) {
          let range = subRanges[subTargets[kk]];
          if (range && ii >= range.start && ii < range.end) { ii = range.end; skipped = true; break; }
        }
        if (skipped) continue;
      }
      let s = items[ii].stmt;
      let kind = s[0];
      if (kind === "rem") { ii += 1; continue; }
      if (kind === "let") {
        counts.variables += 1;
        hoistDecl(s[1]);
        if (!declared[s[1]]) {
          declared[s[1]] = true;
          // Amendment A9: LET A = A + 1 reads A before the lowered
          // binding has a value; basic.py reads the unwritten A as
          // 0 (or ""), so hoist it like any unwritten read instead
          // of emitting the TDZ-crashing `let A = A + 1`.
          if (curInSub) progHoist(s[1], "sub");
          else if (readsName(s[2], s[1])) progHoist(s[1], "read");
          emitLine((dispatchDecl() || progDeclSet[s[1]] ? "" : "let ") + s[1] + " = " + expr(s[2], 0) + ";");
        }
        else emitLine(s[1] + " = " + expr(s[2], 0) + ";");
        ii += 1;
        continue;
      }
      if (kind === "setelem") {
        if (!dimmed[s[1]]) {
          stubStmt("array '" + s[1] + "' is assigned without DIM", "ArrayExpression");
          ii += 1;
          continue;
        }
        let target = s[1];
        for (let jj = 0; jj < s[2].length; ++jj) target += "[" + expr(s[2][jj], 0) + "]";
        emitLine(target + " = " + expr(s[3], 0) + ";");
        ii += 1;
        continue;
      }
      if (kind === "dim") {
        dimmed[s[1]] = true;
        needs.dim = true;
        let fill = s[1].charAt(s[1].length - 1) === "$" ? '""' : "0";
        let sizes = s[2].map(function(e) { return expr(e, 0); }).join(", ");
        hoistDecl(s[1]);
        if (!declared[s[1]]) {
          declared[s[1]] = true;
          if (curInSub) progHoist(s[1], "sub");
          emitLine((dispatchDecl() || progDeclSet[s[1]] ? "" : "let ") + s[1] + " = __basic_dim([" + sizes + "], " + fill + ");");
        }
        else emitLine(s[1] + " = __basic_dim([" + sizes + "], " + fill + ");");
        ii += 1;
        continue;
      }
      if (kind === "print") { emitPrint(s[1]); ii += 1; continue; }
      if (kind === "input") {
        needs.input = true;
        for (let jj = 0; jj < s[2].length; ++jj) {
          let name = s[2][jj];
          let prompt = jj === 0 ? s[1] : null;
          let call = "__basic_input(" + (prompt === null ? "null" : JSON.stringify(prompt)) + ")";
          hoistDecl(name);
          if (name.charAt(name.length - 1) === "$") {
            if (!declared[name]) {
              declared[name] = true;
              if (curInSub) progHoist(name, "sub");
              emitLine((dispatchDecl() || progDeclSet[name] ? "" : "let ") + name + " = " + call + ";");
            }
            else emitLine(name + " = " + call + ";");
          } else {
            if (!declared[name]) {
              declared[name] = true;
              if (curInSub) progHoist(name, "sub");
              emitLine((dispatchDecl() || progDeclSet[name] ? "" : "let ") + name + " = Number(" + call + ");");
            }
            else emitLine(name + " = Number(" + call + ");");
          }
        }
        noteOnce("input-lines", "INPUT reads one line per variable; a comma-separated line is not split (BASIC reads several values from one line).");
        ii += 1;
        continue;
      }
      if (kind === "if") {
        counts.conditionals += 1;
        emitLine("if (" + expr(s[1], 0) + ") {");
        indentLevel += 1;
        emitStmtList(s[2], subRanges, inSub);
        indentLevel -= 1;
        if (s[3] && s[3].length > 0) {
          emitLine("} else {");
          indentLevel += 1;
          emitStmtList(s[3], subRanges, inSub);
          indentLevel -= 1;
        }
        emitLine("}");
        ii += 1;
        continue;
      }
      if (kind === "for") {
        counts.loops += 1;
        let depth = 1;
        let nextIdx = -1;
        for (let jj = ii + 1; jj < to; ++jj) {
          if (items[jj].stmt[0] === "for") depth += 1;
          if (items[jj].stmt[0] === "next") {
            depth -= 1;
            if (depth === 0) { nextIdx = jj; break; }
          }
        }
        if (nextIdx === -1) {
          stubStmt("FOR '" + s[1] + "' has no matching NEXT in the v1 scope", "ForStatement");
          ii += 1;
          continue;
        }
        let varName = s[1];
        hoistDecl(varName);
        if (!declared[varName]) {
          declared[varName] = true;
          // Amendment A9: FOR I = I TO 2 reads the loop variable
          // before it holds its first value (basic.py reads it as
          // 0, or ""); hoist it instead of the undefined-valued
          // `let I;`, which ran zero passes instead of basic's.
          if (curInSub) progHoist(varName, "sub");
          // Amendment A11: a FOR nested inside another loop's body
          // must not leave a block-scoped `let` there — the flat vars
          // dict lets a later line read the loop variable after the
          // loops (PRINT I; J), and a let inside the outer body dies
          // with a ReferenceError. The same hoist as the unwritten
          // read (initialized 0, or "" for string names), and it
          // subsumes the A9 read case for a nested self-referential
          // bound (FOR J = J TO 2): the hoisted init is the value.
          // The GOTO dispatch machine is exempt (dispatchDecl): its
          // hoistDecl already places every main-flow FOR var at
          // machine level, so a second hoist would churn bytes.
          else if (indentLevel > 0 && !dispatchDecl()) progHoist(varName, "for");
          else if (readsName(s[2], varName) || readsName(s[3], varName) || readsName(s[4], varName)) progHoist(varName, "read");
          emitLine((dispatchDecl() || progDeclSet[varName] ? "" : "let ") + varName + ";");
        }
        let stepExpr = s[4] === null || s[4] === void 0 ? "1" : expr(s[4], 0);
        let stepVal = s[4] === null || s[4] === void 0 ? 1 : (s[4][0] === "num" ? s[4][1] : null);
        let stepIsLiteral = stepVal !== null;
        let stepName = null;
        let test;
        if (stepIsLiteral && stepVal >= 0) test = varName + " <= " + expr(s[3], 0);
        else if (stepIsLiteral) test = varName + " >= " + expr(s[3], 0);
        else {
          stepCounter += 1;
          stepName = "__basic_step_" + stepCounter;
          test = "(" + stepName + " >= 0 ? " + varName + " <= " + expr(s[3], 0) + " : " + varName + " >= " + expr(s[3], 0) + ")";
        }
        if (!stepIsLiteral) {
          hoistDecl(stepName);
          if (!declared[stepName]) {
            declared[stepName] = true;
            if (curInSub) progHoist(stepName, "sub");
          }
          emitLine((dispatchDecl() || progDeclSet[stepName] ? "" : "let ") + stepName + " = " + stepExpr + ";");
        }
        emitLine("for (" + varName + " = " + expr(s[2], 0) + "; " + test + "; " + varName + " += " + (stepIsLiteral ? stepExpr : stepName) + ") {");
        indentLevel += 1;
        emitSeq(items, ii + 1, nextIdx, subRanges, inSub, isFlat);
        indentLevel -= 1;
        emitLine("}");
        ii = nextIdx + 1;
        continue;
      }
      if (kind === "next") {
        stubStmt("NEXT without a matching FOR", "ForStatement");
        ii += 1;
        continue;
      }
      if (kind === "while") {
        // Amendment A4 (2026-11-21): WHILE/WEND lowers to a
        // JavaScript while, mirroring the FOR/NEXT pairing — the
        // depth-matching walk finds the WEND, the body emits
        // between the slots, and a WEND with no WHILE is a loud
        // stub one case down. Both are test-first, so the
        // semantics carry over unchanged.
        counts.loops += 1;
        let depth = 1;
        let wendIdx = -1;
        for (let jj = ii + 1; jj < to; ++jj) {
          if (items[jj].stmt[0] === "while") depth += 1;
          if (items[jj].stmt[0] === "wend") {
            depth -= 1;
            if (depth === 0) { wendIdx = jj; break; }
          }
        }
        if (wendIdx === -1) {
          stubStmt("WHILE has no matching WEND in the v1 scope", "WhileStatement");
          ii += 1;
          continue;
        }
        emitLine("while (" + expr(s[1], 0) + ") {");
        indentLevel += 1;
        emitSeq(items, ii + 1, wendIdx, subRanges, inSub, isFlat);
        indentLevel -= 1;
        emitLine("}");
        ii = wendIdx + 1;
        continue;
      }
      if (kind === "wend") {
        stubStmt("WEND without a matching WHILE", "WhileStatement");
        ii += 1;
        continue;
      }
      if (kind === "gosub") {
        if (!(s[1] in subRanges)) {
          stubStmt("GOSUB target line " + s[1] + " does not exist", "GOSUB");
        } else {
          emitLine("__gosub_" + s[1] + "();");
        }
        ii += 1;
        continue;
      }
      if (kind === "goto") {
        // Amendment A7 (2026-11-22): a GOTO lowers through the
        // program-counter dispatch machine (a __pcw while/switch),
        // the transform the v1 stub always named as the follow-up.
        // The plan is computed in run(): anything the machine
        // cannot represent (a jump into a loop body or a GOSUB
        // subroutine) stays a loud stub, never a silent guess.
        if (gotoPlan && !inSub) {
          let ti = gotoPlan.byTarget[s[1]];
          if (ti && ti.ok) {
            emitLine("__pc = " + ti.slot + "; continue __pcw;");
            return to; // dead code after an unconditional jump in this range
          }
          stubStmt(ti ? ti.reason : "GOTO line " + s[1] + " is not in the v1 scope", "GOTO");
        } else if (gotoPlan && inSub) {
          stubStmt("a GOTO inside a GOSUB subroutine is not in the v1 scope (it cannot leave the subroutine)", "GOTO");
        } else {
          stubStmt("GOTO line " + s[1] + " is not in the v1 scope (the pc-dispatch transform is the follow-up)", "GOTO");
        }
        ii += 1;
        continue;
      }
      if (kind === "return") {
        if (inSub) emitLine("return;");
        else stubStmt("RETURN outside a GOSUB subroutine", "RETURN");
        ii += 1;
        continue;
      }
      if (kind === "end" || kind === "stop") {
        emitLine("process.exit(0);");
        ii += 1;
        continue;
      }
      stubStmt("statement '" + kind + "' is not in the v1 scope", kind);
      ii += 1;
    }
    return ii;
  }
  function emitStmtList(stmts, subRanges, inSub) {
    let items = [];
    for (let ii = 0; ii < stmts.length; ++ii) items.push({ stmt: stmts[ii] });
    emitSeq(items, 0, items.length, subRanges, inSub, false);
  }
  // -------------------------------------------------- A7 pc-dispatch
  // A GOTO statement can appear as a top-level slot ("goto", n) or
  // as the IF shortcut (if, cond, [("goto", n)], null); nested IF
  // parts can carry the shortcut too, so the scan recurses.
  function collectIfGotos(stmts, acc) {
    if (!stmts) return acc;
    for (let ii = 0; ii < stmts.length; ++ii) {
      let st = stmts[ii];
      if (!st) continue;
      if (st[0] === "goto") acc.push(st[1]);
      if (st[0] === "if") { collectIfGotos(st[2], acc); collectIfGotos(st[3], acc); }
    }
    return acc;
  }
  function makeGotoPlan(flat, lineMap, subRanges) {
    let targets = [];
    for (let ii = 0; ii < flat.length; ++ii) {
      if (flat[ii].stmt[0] === "goto") targets.push(flat[ii].stmt[1]);
      if (flat[ii].stmt[0] === "if") { collectIfGotos(flat[ii].stmt[2], targets); collectIfGotos(flat[ii].stmt[3], targets); }
    }
    if (targets.length === 0) return null;
    let subs = Object.keys(subRanges).map(function(k) { return subRanges[k]; });
    // Loop pairs, the way basic.py's load() pairs FOR/NEXT and
    // WHILE/WEND by nesting. A jump target inside a pair's body
    // (after the header, through the NEXT/WEND) is not
    // representable — the body lowers to structured JavaScript —
    // so it stays a loud stub.
    let pairs = [];
    let fstack = [];
    let wstack = [];
    for (let ii = 0; ii < flat.length; ++ii) {
      let k = flat[ii].stmt[0];
      if (k === "for") fstack.push(ii);
      else if (k === "next" && fstack.length) pairs.push([fstack.pop(), ii]);
      else if (k === "while") wstack.push(ii);
      else if (k === "wend" && wstack.length) pairs.push([wstack.pop(), ii]);
    }
    let byTarget = {};
    let caseSet = {};
    for (let ii = 0; ii < targets.length; ++ii) {
      let t = targets[ii];
      if (byTarget[t] !== void 0) continue;
      let slot = lineMap[t];
      if (slot === void 0) {
        byTarget[t] = { slot: -1, ok: false, reason: "GOTO line " + t + " does not exist" };
        continue;
      }
      let inSub = false;
      for (let kk = 0; kk < subs.length; ++kk) {
        if (slot >= subs[kk].start && slot < subs[kk].end) { inSub = true; break; }
      }
      if (inSub) {
        byTarget[t] = { slot: slot, ok: false, reason: "a GOTO cannot target line " + t + " because the GOSUB subroutine lives there (subroutines lower to functions, so the line cannot be jumped into in the v1 scope)" };
        continue;
      }
      let inBody = false;
      for (let kk = 0; kk < pairs.length; ++kk) {
        if (slot > pairs[kk][0] && slot <= pairs[kk][1]) { inBody = true; break; }
      }
      if (inBody) {
        byTarget[t] = { slot: slot, ok: false, reason: "a GOTO cannot target line " + t + " inside a loop body in the v1 scope (the body lowers to structured JavaScript; entering it without the loop header is not representable)" };
        continue;
      }
      byTarget[t] = { slot: slot, ok: true };
      caseSet[slot] = true;
    }
    // The machine's first case is the first main-flow slot (the
    // sub-ranges are hoisted functions above it).
    let mainStart = 0;
    for (; mainStart < flat.length; ++mainStart) {
      let inside = false;
      for (let kk = 0; kk < subs.length; ++kk) {
        if (mainStart >= subs[kk].start && mainStart < subs[kk].end) { inside = true; break; }
      }
      if (!inside) break;
    }
    let caseStarts = Object.keys(caseSet).map(Number).sort(function(a, b) { return a - b; });
    for (let ii = caseStarts.length - 1; ii >= 0; --ii) if (caseStarts[ii] === mainStart) caseStarts.splice(ii, 1);
    caseStarts.unshift(mainStart);
    return { byTarget: byTarget, caseStarts: caseStarts, decls: [] };
  }
  function emitDispatch(flat, subRanges, plan) {
    if (plan.declSpliceAt === void 0) plan.declSpliceAt = lines.length;
    emitLine("// pc-dispatch machine (Amendment A7): __pc walks the flat line slots, the way");
    emitLine("// basic.py's interpreter does; a GOTO is a jump of __pc, nothing more.");
    emitLine("var __pc = " + plan.caseStarts[0] + ";");
    emitLine("__pcw: while (true) {");
    indentLevel += 1;
    emitLine("switch (__pc) {");
    indentLevel += 1;
    for (let ii = 0; ii < plan.caseStarts.length; ++ii) {
      let start = plan.caseStarts[ii];
      let next = ii + 1 < plan.caseStarts.length ? plan.caseStarts[ii + 1] : flat.length;
      let cmt = (flat[start].line !== null && flat[start].line !== void 0) ? "  // line " + flat[start].line : "";
      emitLine("case " + start + ":" + cmt);
      emitSeq(flat, start, next, subRanges, false, true);
      if (ii + 1 < plan.caseStarts.length) emitLine("__pc = " + next + "; continue __pcw;");
      else emitLine("break __pcw;");
    }
    emitLine("default: break __pcw;");
    indentLevel -= 1;
    emitLine("}");
    indentLevel -= 1;
    emitLine("}");
    // Hoist the machine's declarations ahead of it: a case can be
    // re-entered, and a `let` inside the machine would redeclare.
    let seen = {};
    let decls = [];
    for (let ii = 0; ii < plan.decls.length; ++ii) {
      let n = plan.decls[ii];
      if (!seen[n]) { seen[n] = true; decls.push("var " + n + ";"); }
    }
    if (decls.length > 0) lines.splice.apply(lines, [plan.declSpliceAt, 0].concat(decls));
  }
  function run(prog) {
    let flat = [];
    let lineMap = {};
    for (let ii = 0; ii < prog.length; ++ii) {
      let lineNo = prog[ii][0];
      let stmts = prog[ii][2] || [];
      if (lineNo !== null && lineNo !== void 0 && !(lineNo in lineMap)) lineMap[lineNo] = flat.length;
      for (let jj = 0; jj < stmts.length; ++jj) flat.push({ stmt: stmts[jj], line: lineNo });
    }
    let subRanges = {};
    let gosubTargets = [];
    for (let ii = 0; ii < flat.length; ++ii) {
      if (flat[ii].stmt[0] === "gosub") {
        let target = flat[ii].stmt[1];
        if (gosubTargets.indexOf(target) === -1) gosubTargets.push(target);
      }
    }
    for (let ii = 0; ii < gosubTargets.length; ++ii) {
      let target = gosubTargets[ii];
      let start = lineMap[target];
      if (start === void 0) continue;
      let end = flat.length;
      for (let jj = start; jj < flat.length; ++jj) {
        if (flat[jj].stmt[0] === "return") { end = jj + 1; break; }
        if (flat[jj].stmt[0] === "end" || flat[jj].stmt[0] === "stop") { end = jj; break; }
      }
      subRanges[target] = { start: start, end: end };
      counts.functions += 1;
    }
    // Amendment A7 (2026-11-22): the plan is computed before any
    // emission (a GOTO inside a subroutine body reports against
    // the plan too), and the interpreter is a pc machine — basic.py
    // walks _slots with pc arithmetic — so the machine mirrors it:
    // one case per basic block, a case start exactly at every valid
    // GOTO target's line slot, __pc the program counter.
    gotoPlan = makeGotoPlan(flat, lineMap, subRanges);
    for (let ii = 0; ii < gosubTargets.length; ++ii) {
      let target = gosubTargets[ii];
      let range = subRanges[target];
      if (!range) continue;
      emitLine("function __gosub_" + target + "() {");
      indentLevel += 1;
      emitSeq(flat, range.start, range.end, subRanges, true, false);
      indentLevel -= 1;
      emitLine("}");
    }
    if (gosubTargets.length > 0) lines.push("");
    subTargets = gosubTargets;
    if (gotoPlan) {
      noteOnce("goto-dispatch", "the BASIC program uses GOTO: the mainline lowers to a program-counter dispatch machine (a __pcw while/switch on __pc); a jump into a loop body or a GOSUB subroutine, a GOTO inside a subroutine, and a GOTO to an undefined line stay loud stubs in the v1 scope");
      emitDispatch(flat, subRanges, gotoPlan);
    } else {
    // Mainline: one pass over the flat slots; emitSeq skips the
    // subroutine ranges itself.
      emitSeq(flat, 0, flat.length, subRanges, false, true);
    }
    // Amendment A8: hoist subroutine-declared names ahead of
    // everything (sub functions included) as program-level vars,
    // initialized like an untouched BASIC read (0, or "" for
    // string names) so both the subroutines and the mainline see
    // the same binding.
    if (progDecls.length > 0) {
      let hoistVar = [];
      for (let ii = 0; ii < progDecls.length; ++ii) {
        let n = progDecls[ii];
        hoistVar.push("var " + n + " = " + (n.charAt(n.length - 1) === "$" ? '""' : "0") + ";");
      }
      lines.splice(0, 0, hoistVar.join("\n"), "");
    }
    let header = [];
    if (needs.pymod) {
      header.push("function __iroh_pymod(a, b) { return ((a % b) + b) % b; }");
      header.push("");
    }
    if (needs.dim) {
      header.push("function __basic_dim(sizes, fill) {");
      header.push("  if (sizes.length === 0) return fill;");
      header.push("  var arr = new Array(sizes[0] + 1);");
      header.push("  for (var i = 0; i < arr.length; ++i) arr[i] = __basic_dim(sizes.slice(1), fill);");
      header.push("  return arr;");
      header.push("}");
      header.push("");
    }
    if (needs.input) {
      header.push("var __basic_input_lines = null;");
      header.push("var __basic_input_at = 0;");
      header.push("function __basic_input(prompt) {");
      header.push("  if (prompt) process.stdout.write(prompt);");
      header.push("  if (__basic_input_lines === null) {");
      header.push("    __basic_input_lines = require(\"fs\").readFileSync(0, \"utf8\").split(\"\\n\");");
      header.push("  }");
      header.push("  var line = __basic_input_at < __basic_input_lines.length ? __basic_input_lines[__basic_input_at++] : \"\";");
      header.push("  return line;");
      header.push("}");
      header.push("");
      noteOnce("input-node", "INPUT in translated JavaScript reads stdin with require(\"fs\") (Node-only).");
    }
    return { text: header.concat(lines).join("\n") + "\n", counts: counts };
  }
  return { run: run, counts: counts };
}

function translateFromIrohscript(code, childProcess, options) {
  let report = newReport("irohscript", "javascript", true);
  let ast = runIrohscriptPython(code, options, childProcess, IROHSCRIPT_AST_HELPER, "IrohScript");
  let emitter = makeIrohAstJSEmitter(report);
  let out = emitter.run(ast);
  finishSourceLeg(report, out.counts);
  return { code: out.text, report: report };
}

function translateFromBasic(code, childProcess, options) {
  let report = newReport("basic", "javascript", true);
  let prog = runIrohscriptPython(code, options, childProcess, BASIC_AST_HELPER, "BASIC");
  let emitter = makeBasicJSEmitter(report);
  let out = emitter.run(prog);
  finishSourceLeg(report, out.counts);
  return { code: out.text, report: report };
}

// Shared report tail for the static-only source legs: the same
// "clean" entries translateFromJS writes, so every leg reports the
// same way.
function finishSourceLeg(report, c) {
  if (c.functions > 0) {
    report.clean.push({ construct: "functions", count: c.functions, detail: "function declarations translated" });
  }
  if (c.variables > 0) {
    report.clean.push({ construct: "variables", count: c.variables, detail: "variable declarations translated" });
  }
  if (c.loops > 0) {
    report.clean.push({ construct: "loops", count: c.loops, detail: "loops translated" });
  }
  if (c.conditionals > 0) {
    report.clean.push({ construct: "conditionals", count: c.conditionals, detail: "if statements translated" });
  }
  if (c.outputs > 0) {
    report.clean.push({ construct: "console-output", count: c.outputs, detail: "print statements translated" });
  }
}

// Map a C++ type (the spelling buildTraceEnv / inferType produce)
// to the IrohScript type name. null means "no annotation".
function irohTypeOfCpp(cppType) {
  if (!cppType) return null;
  if (cppType === "int") return "Int";
  if (cppType === "double") return "Float";
  if (cppType === "std::string") return "String";
  if (cppType === "bool") return "Bool";
  let m = /^std::vector<(.+)>$/.exec(cppType);
  if (m) {
    let inner = irohTypeOfCpp(m[1]);
    return inner ? "Vector<" + inner + ">" : null;
  }
  return null;
}

// JavaScript AST (Acorn) -> IrohScript or BASIC. Hybrid like the
// Python/C++ legs: the caller traces the program first and env
// carries the evidence. v1 scope is the same as the other legs
// (functions, arithmetic, loops, conditionals, arrays, strings,
// console output) minus what the target language cannot express:
// IrohScript has no for-loop and no arrays; BASIC has no while loop
// and no real functions (they become GOSUB subroutines). What cannot
// be expressed is a loud stub, not a guess.
function makeIrohJSEmitter(target, report, env, hints) {
  let isIroh = target === "irohscript";
  let lines = [];
  let indentLevel = 0;
  let counts = { functions: 0, loops: 0, conditionals: 0, variables: 0, outputs: 0 };
  let declared = {};
  // Amendment A6 (2026-11-22): BASIC only. When a declaration lowers
  // to DIM, remember the literal's element count: a for-of over that
  // variable can then walk 0..n-1 exactly (the bootstrap BASIC has no
  // LEN at runtime, so the length must be a translate-time fact). A
  // plain re-assignment or a non-array re-declaration of the name
  // drops the entry, so the fact can never go stale.
  let arrayLens = {};
  let noted = {};
  let ctx = { vars: {} };
  for (let k in env.vars) ctx.vars[k] = env.vars[k].type;
  if (hints && hints.variables) {
    for (let k in hints.variables) ctx.vars[k] = hints.variables[k];
  }
  // Amendment A5 (2026-11-22): the do-while flag lowering mints one
  // fresh Bool variable per do-while loop (neither target has a
  // post-test loop, so the loop guard is rewritten from the real
  // test at the end of every body pass). The name is minted against
  // the program's own identifier set, which run() collects first,
  // so it can never collide with a user name, and it stays
  // deterministic for the same program.
  let doWhileFlagCounter = 0;
  let programNames = {};
  // Amendment A6 (2026-11-22): for-of minted helpers (the hoisted
  // array for an inline literal, and the FOR/NEXT index) use the same
  // collision-proof scheme as the A5 flags: minted against the
  // program's full identifier set, deterministic for the same
  // program.
  let forOfCounter = 0;
  function collectNames(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let ii = 0; ii < node.length; ++ii) collectNames(node[ii]);
      return;
    }
    if (node.type === "Identifier") programNames[node.name] = true;
    let keys = Object.keys(node);
    for (let ii = 0; ii < keys.length; ++ii) {
      let v = node[keys[ii]];
      if (v && typeof v === "object") collectNames(v);
    }
  }
  function mintForOfName(kind) {
    while (true) {
      forOfCounter += 1;
      let name = "__for_of_" + kind + "_" + forOfCounter;
      if (!programNames[name]) {
        programNames[name] = true;
        return name;
      }
    }
  }
  function mintDoWhileFlag() {
    while (true) {
      doWhileFlagCounter += 1;
      let name = "__do_while_flag_" + doWhileFlagCounter;
      if (!programNames[name]) {
        programNames[name] = true;
        return name;
      }
    }
  }
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  function noteOnce(key, text) {
    if (!noted[key]) { noted[key] = true; report.notes.push(text); }
  }
  function assumeOnce(key, what, evidence) {
    if (!noted[key]) {
      noted[key] = true;
      recordAssumption(report, what, evidence);
    }
  }
  function stubStmt(detail, construct) {
    markUnsupported(report, construct, detail);
    if (isIroh) emitLine("__iroh_unsupported(" + JSON.stringify(detail) + ");");
    else {
      emitLine("PRINT " + basicQuote("IrohRedux: " + detail));
      emitLine("END");
    }
  }
  function stubExpr(detail, construct) {
    markUnsupported(report, construct, detail);
    if (isIroh) return "__iroh_unsupported(" + JSON.stringify(detail) + ")";
    return "(1 / 0)";
  }
  function basicQuote(s) {
    return '"' + String(s).replace(/"/g, '""') + '"';
  }
  function irohTypeOf(node) {
    let t = null;
    try { t = inferType(node, ctx); } catch (e) { t = null; }
    return irohTypeOfCpp(t);
  }
  function paramType(fnName, idx, node) {
    if (hints && hints.functions && hints.functions[fnName] && hints.functions[fnName].params) {
      let p = hints.functions[fnName].params[idx];
      if (p) return irohTypeOfCpp(p);
    }
    let f = env.funcs && env.funcs[fnName];
    if (f && f.args && idx < f.args.length) return irohTypeOfCpp(cppTypeOfValue(f.args[idx]));
    if (node) return irohTypeOf(node);
    return null;
  }
  function expr(node, parentPrec) {
    if (!node || typeof node.type !== "string") return "undefined";
    let prec = precedence(node);
    let out = "";
    if (node.type === "Literal") {
      if (typeof node.value === "string") out = isIroh ? JSON.stringify(node.value) : basicQuote(node.value);
      else if (typeof node.value === "number") out = String(node.value);
      else if (typeof node.value === "boolean") out = isIroh ? (node.value ? "True" : "False") : (node.value ? "-1" : "0");
      else if (node.value === null) {
        out = stubExpr("null has no equivalent in " + target, "Literal");
      } else {
        out = JSON.stringify(node.value);
      }
    } else if (node.type === "Identifier") {
      out = node.name;
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      let op = node.operator;
      if (op === "%") {
        assumeOnce("js-mod", "JavaScript % truncates toward zero; " + (isIroh ? "IrohScript" : "BASIC") + " % floors (Python-style); results differ when the left operand is negative", "IrohScript/BASIC % is Python-style floored modulo (bootstrap interpreter, basic.py); JavaScript % truncates toward zero");
        out = expr(node.left, prec) + " % " + expr(node.right, prec + 1);
      } else if (op === "**") {
        out = stubExpr("the ** operator has no equivalent in " + target, "BinaryExpression");
      } else if (op === "==" || op === "!=") {
        assumeOnce("loose-eq", "JavaScript loose equality (==/!=) is translated as strict equality (===/!==); values of different types compare differently", "no loose-equality operator exists in " + target);
        let jsOp = op === "==" ? (isIroh ? "==" : "=") : (isIroh ? "!=" : "<>");
        out = expr(node.left, prec) + " " + jsOp + " " + expr(node.right, prec + 1);
      } else if (op === "===" || op === "!==") {
        let jsOp = op === "===" ? (isIroh ? "==" : "=") : (isIroh ? "!=" : "<>");
        out = expr(node.left, prec) + " " + jsOp + " " + expr(node.right, prec + 1);
      } else if (op === "&&" || op === "||") {
        let jsOp = op === "&&" ? "AND" : "OR";
        out = expr(node.left, prec) + " " + jsOp + " " + expr(node.right, prec + 1);
      } else if (op === "instanceof" || op === "in") {
        out = stubExpr("the " + op + " operator has no equivalent in " + target, "BinaryExpression");
      } else {
        out = expr(node.left, prec) + " " + op + " " + expr(node.right, prec + 1);
      }
    } else if (node.type === "UnaryExpression") {
      if (node.operator === "!") out = "NOT " + expr(node.argument, 6);
      else if (node.operator === "-") out = "-" + expr(node.argument, 6);
      else {
        out = stubExpr("unary " + node.operator + " has no equivalent in " + target, "UnaryExpression");
      }
    } else if (node.type === "CallExpression") {
      let callee = node.callee;
      if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && callee.object.name === "console" && callee.property.name === "log") {
        out = stubExpr("console.log as a value (not a statement) has no equivalent in " + target, "CallExpression");
      } else if (callee.type === "Identifier") {
        out = callee.name + "(" + node.arguments.map(function(a) { return expr(a, 0); }).join(", ") + ")";
      } else if (callee.type === "MemberExpression" && !callee.computed) {
        if (!isIroh) {
          out = stubExpr("method calls have no equivalent in BASIC", "CallExpression");
        } else {
          out = expr(callee.object, 7) + "." + callee.property.name + "(" + node.arguments.map(function(a) { return expr(a, 0); }).join(", ") + ")";
          noteOnce("member-call", "a method call was translated as a dotted call; the callee must be a plain function at runtime");
        }
      } else {
        out = stubExpr("computed or indirect calls are not in the v1 scope", "CallExpression");
      }
    } else if (node.type === "MemberExpression") {
      if (calleeComputed(node)) {
        if (isIroh) {
          out = stubExpr("computed member access (arrays) has no equivalent in IrohScript v1", "MemberExpression");
        } else {
          out = expr(node.object, 7) + "(" + expr(node.property, 0) + ")";
        }
      } else {
        out = expr(node.object, 7) + "." + node.property.name;
      }
    } else if (node.type === "ArrayExpression") {
      out = stubExpr("array literals are only supported as a variable initializer for BASIC; use a variable declaration", "ArrayExpression");
    } else if (node.type === "ConditionalExpression") {
      out = stubExpr("the ?: operator has no equivalent in " + target, "ConditionalExpression");
    } else if (node.type === "TemplateLiteral") {
      out = stubExpr("template literals have no equivalent in " + target, "TemplateLiteral");
    } else if (node.type === "UpdateExpression") {
      out = stubExpr("++ / -- as a value has no equivalent in " + target + " (use it as a statement)", "UpdateExpression");
    } else {
      out = stubExpr("expression " + node.type + " is not in the v1 scope", node.type);
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function calleeComputed(node) { return !!node.computed; }
  function isConsoleLog(node) {
    return node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed &&
      node.callee.object.type === "Identifier" && node.callee.object.name === "console" &&
      node.callee.property.name === "log";
  }
  function isProcessExit(node) {
    return node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed &&
      node.callee.object.type === "Identifier" && node.callee.object.name === "process" &&
      node.callee.property.name === "exit";
  }
  // Classic numeric for (the same pattern the Python/C++ emitter
  // uses): for (let i = A; i <op> B; update). Returns null when the
  // loop is not in that shape.
  function forLoopPattern(node) {
    // Classic numeric for: for (let i = A; i <op> B; update), or
    // for (i = A; i <op> B; update) with i declared earlier (the
    // BASIC leg emits the second form so the loop variable stays
    // visible after the loop, the way BASIC scoping works).
    let name = null;
    let start = null;
    if (node.init && node.init.type === "VariableDeclaration") {
      if (node.init.declarations.length !== 1) return null;
      let decl = node.init.declarations[0];
      if (decl.id.type !== "Identifier" || !decl.init) return null;
      name = decl.id.name;
      start = decl.init;
    } else if (node.init && node.init.type === "AssignmentExpression" && node.init.operator === "=" && node.init.left.type === "Identifier") {
      name = node.init.left.name;
      start = node.init.right;
    } else return null;
    if (!node.test || node.test.type !== "BinaryExpression") return null;
    let test = node.test;
    if (test.left.type !== "Identifier" || test.left.name !== name) return null;
    if (["<", "<=", ">", ">="].indexOf(test.operator) === -1) return null;
    let step = null;
    let upd = node.update;
    if (!upd) return null;
    if (upd.type === "UpdateExpression" && upd.argument.type === "Identifier" && upd.argument.name === name) {
      step = upd.operator === "++" ? 1 : -1;
    } else if (upd.type === "AssignmentExpression" && upd.left.type === "Identifier" && upd.left.name === name) {
      if (upd.operator === "+=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = upd.right.value;
      else if (upd.operator === "-=" && upd.right.type === "Literal" && typeof upd.right.value === "number") step = -upd.right.value;
      else return null;
    } else return null;
    return { name: name, start: start, op: test.operator, end: test.right, step: step };
  }
  function emitBody(block) {
    if (!block || !block.body) return;
    indentLevel += 1;
    for (let ii = 0; ii < block.body.length; ++ii) stmt(block.body[ii]);
    indentLevel -= 1;
  }
  function emitFunction(fnNode, fnName) {
    counts.functions += 1;
    let params = fnNode.params.map(function(p, idx) {
      if (p.type !== "Identifier") return null;
      if (isIroh) {
        let t = paramType(fnName, idx, p);
        return t ? p.name + " : " + t : p.name;
      }
      return p.name;
    });
    if (params.indexOf(null) !== -1) {
      stubStmt("function '" + fnName + "' has non-identifier parameters, which are not in the v1 scope", "FunctionDeclaration");
      return;
    }
    if (isIroh) {
      emitLine("FUNCTION " + fnName + "(" + params.join(", ") + ")");
      emitBody(fnNode.body);
      emitLine("END FUNCTION");
      return;
    }
    // BASIC: a function becomes a GOSUB subroutine, emitted at the
    // end of the program (see run()). Its line number is assigned
    // here so calls anywhere — including before the declaration, the
    // way JS hoisting allows — resolve.
    if (!(fnName in subLines)) {
      subLines[fnName] = subLineBase;
      subLineBase += 1000;
    }
    if (callsItself(fnNode, fnName)) {
      markUnsupported(report, "FunctionDeclaration", "recursive function '" + fnName + "' cannot be a BASIC GOSUB subroutine (arguments and the return value share globals)");
      subroutines.push({ node: fnNode, name: fnName, params: params, stub: true });
      return;
    }
    subroutines.push({ node: fnNode, name: fnName, params: params });
  }
  let subroutines = [];
  let subLines = {};
  let subLineBase = 1000;
  let currentSub = null;
  function stmt(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "BlockStatement") {
      for (let ii = 0; ii < node.body.length; ++ii) stmt(node.body[ii]);
      return;
    }
    if (node.type === "EmptyStatement") return;
    if (node.type === "VariableDeclaration") {
      for (let ii = 0; ii < node.declarations.length; ++ii) {
        let d = node.declarations[ii];
        counts.variables += 1;
        if (d.id.type !== "Identifier") {
          stubStmt("destructuring declaration is not in the v1 scope", "VariableDeclaration");
          continue;
        }
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
        if (!isIroh && d.init) {
          let lifted = liftExpr(d.init);
          emitLifts(lifted.lifts);
          d.init = lifted.expr;
        }
        if (!isIroh && d.init && d.init.type === "ArrayExpression") {
          let n = d.init.elements.length;
          if (n === 0) {
            stubStmt("an empty array has no BASIC DIM form", "ArrayExpression");
            continue;
          }
          let hasHole = false;
          for (let jj = 0; jj < n; ++jj) if (d.init.elements[jj] === null) hasHole = true;
          if (hasHole) {
            stubStmt("a hole in an array literal has no BASIC equivalent", "ArrayExpression");
            continue;
          }
          emitLine("DIM " + d.id.name + "(" + (n - 1) + ")");
          for (let jj = 0; jj < n; ++jj) {
            emitLine(d.id.name + "(" + jj + ") = " + expr(d.init.elements[jj], 0));
          }
          declared[d.id.name] = true;
          // Amendment A6: remember the length so a later for-of over
          // this variable can lower to a FOR/NEXT index walk.
          arrayLens[d.id.name] = n;
          continue;
        }
        if (isIroh) {
          let ann = d.init ? irohTypeOf(d.init) : null;
          if (!ann && ctx.vars[d.id.name]) ann = irohTypeOfCpp(ctx.vars[d.id.name]);
          let kw = node.kind === "const" ? "CONST " : "LET ";
          emitLine(kw + d.id.name + (ann ? " : " + ann : "") + (d.init ? " = " + expr(d.init, 0) : ""));
        } else {
          emitLine("LET " + d.id.name + (d.init ? " = " + expr(d.init, 0) : " = 0"));
        }
        declared[d.id.name] = true;
        if (d.init) {
          let t = null;
          try { t = inferType(d.init, ctx); } catch (e) { t = null; }
          if (t) ctx.vars[d.id.name] = t;
        }
        // Amendment A6: this name was (re-)declared scalar, so any
        // remembered array length for it is stale.
        delete arrayLens[d.id.name];
      }
      return;
    }
    if (node.type === "FunctionDeclaration") {
      emitFunction(node, node.id.name);
      return;
    }
    if (node.type === "ReturnStatement") {
      if (!isIroh && currentSub) {
        if (node.argument) {
          let lifted = liftExpr(node.argument);
          emitLifts(lifted.lifts);
          emitLine("LET __ret_" + currentSub + " = " + expr(lifted.expr, 0));
        }
        emitLine("RETURN");
        return;
      }
      if (!isIroh && !currentSub) {
        emitLine("END");
        return;
      }
      emitLine(node.argument ? "RETURN " + expr(node.argument, 0) : "RETURN");
      return;
    }
    if (node.type === "ExpressionStatement") {
      let e = node.expression;
      if (isConsoleLog(e)) {
        counts.outputs += 1;
        if (isIroh) {
          if (e.arguments.length === 0) emitLine("PRINT \"\"");
          else if (e.arguments.length === 1) emitLine("PRINT " + expr(e.arguments[0], 0));
          else {
            noteOnce("console-log-multi", "console.log with several arguments prints each on its own line in IrohScript (PRINT takes one value).");
            for (let ii = 0; ii < e.arguments.length; ++ii) emitLine("PRINT " + expr(e.arguments[ii], 0));
          }
        } else {
          let lifted = liftCalls(node);
          emitLifts(lifted.lifts);
          let le = lifted.node.expression;
          let parts = [];
          for (let ii = 0; ii < le.arguments.length; ++ii) {
            parts.push(expr(le.arguments[ii], 0));
            if (ii < le.arguments.length - 1) parts.push('""');
          }
          if (parts.length === 0) emitLine("PRINT");
          else if (parts.length === 1) emitLine("PRINT " + parts[0]);
          else emitLine("PRINT " + parts.join(" ; "));
        }
        return;
      }
      if (isProcessExit(e)) {
        // process.exit(code): the program ends. BASIC has END for
        // this (the exit code is dropped — BASIC END takes none).
        // IrohScript has no program-end primitive, so it is a loud
        // stub, not a silent `process.exit` that would fail later
        // with an undeclared-name error.
        if (!isIroh) { emitLine("END"); return; }
        stubStmt("process.exit (ending the program) has no equivalent in IrohScript — IrohScript has no program-end primitive", "CallExpression");
        return;
      }
      if (!isIroh) {
        let lifted = liftCalls(node);
        emitLifts(lifted.lifts);
        stmtExpr(lifted.node.expression);
        return;
      }
      stmtExpr(e);
      return;
    }
    if (node.type === "IfStatement") {
      counts.conditionals += 1;
      if (isIroh) {
        emitLine("IF " + expr(node.test, 0));
        emitBody(node.consequent);
        if (node.alternate) {
          emitLine("ELSE");
          if (node.alternate.type === "BlockStatement") emitBody(node.alternate);
          else stmt(node.alternate);
        }
        emitLine("END IF");
        return;
      }
      let lifted = liftExpr(node.test);
      emitLifts(lifted.lifts);
      let n = node;
      let thenStr = inlineBranch(n.consequent);
      let elseStr = n.alternate ? inlineBranch(n.alternate) : null;
      if (thenStr === null || (n.alternate && elseStr === null)) {
        stubStmt("an IF branch that cannot be written on one BASIC line (a loop, a return, a call, or a GOTO) is not in the v1 scope", "IfStatement");
        return;
      }
      let line = "IF " + expr(lifted.expr, 0) + " THEN " + thenStr;
      if (elseStr !== null) line += " ELSE " + elseStr;
      emitLine(line);
      return;
    }
    if (node.type === "ForStatement") {
      if (isIroh) {
        // Amendment A3 (2026-11-21): a JavaScript for-loop desugars
        // through the Amendment A2 machinery instead of stubbing:
        // the init statement, LOOP <test> (True when the loop has
        // no test), the body, the update statement, END LOOP. That
        // is the JavaScript definition of the construct, so the
        // semantics are exact — init once, test before the body,
        // update after it. Every piece keeps its own rules: a piece
        // this emitter cannot write still stubs loudly on its own
        // merits.
        counts.loops += 1;
        if (node.init) {
          if (node.init.type === "VariableDeclaration") {
            noteOnce("for-loop-scope", "a for-loop's init variable stays in scope after the loop (IrohScript scope is flat, the same simplification the BASIC leg makes)");
            stmt(node.init);
          } else {
            stmt({ type: "ExpressionStatement", expression: node.init });
          }
        }
        emitLine("LOOP " + (node.test ? expr(node.test, 0) : "True"));
        emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
        indentLevel += 1;
        // The update runs after the body every iteration — a body
        // that changes the loop variable changes what the update
        // adds to (the ordering test pins this).
        if (node.update) stmt({ type: "ExpressionStatement", expression: node.update });
        indentLevel -= 1;
        emitLine("END LOOP");
        return;
      }
      let pat = forLoopPattern(node);
      if (!pat) {
        stubStmt("only a classic numeric for-loop translates to BASIC FOR/NEXT", "ForStatement");
        return;
      }
      counts.loops += 1;
      let startNode = pat.start;
      let endNode = pat.end;
      let ls = liftExpr(pat.start);
      emitLifts(ls.lifts);
      startNode = ls.expr;
      let le = liftExpr(pat.end);
      emitLifts(le.lifts);
      endNode = le.expr;
      let endText;
      if (pat.op === "<") endText = simpleExprText(endNode) + " - 1";
      else if (pat.op === "<=") endText = expr(endNode, 0);
      else if (pat.op === ">") endText = simpleExprText(endNode) + " + 1";
      else endText = expr(endNode, 0);
      let stepText = pat.step === 1 ? "" : " STEP " + String(pat.step);
      emitLine("FOR " + pat.name + " = " + expr(startNode, 0) + " TO " + endText + stepText);
      emitBody(node.body);
      emitLine("NEXT " + pat.name);
      return;
    }
    if (node.type === "WhileStatement") {
      // Amendment A2 (2026-11-21): a JavaScript while lowers into
      // the conditional IrohScript LOOP (Amendment A1) — the same
      // test-first semantics.
      // Amendment A4 (2026-11-21): the BASIC leg lowers it too, as
      // WHILE/WEND — the bootstrap interpreter's own test-first
      // construct (1.1.1 M5), so the semantics match by
      // definition. One honest gap stays a loud stub: a call in
      // the condition. Unlike FOR bounds it cannot be hoisted to a
      // GOSUB before the loop, because the WHILE line is re-tested
      // every pass and a GOSUB cannot live inside it.
      if (isIroh) {
        counts.loops += 1;
        emitLine("LOOP " + expr(node.test, 0));
        emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
        emitLine("END LOOP");
        return;
      }
      if (hasPlainCall(node.test)) {
        stubStmt("a call inside a while condition is not in the v1 scope: the WHILE line is re-tested every pass, so the call cannot be hoisted to a GOSUB before the loop — move it into the body", "WhileStatement");
        return;
      }
      counts.loops += 1;
      emitLine("WHILE " + expr(node.test, 0));
      emitBody(node.body.type === "BlockStatement" ? node.body : { body: [node.body] });
      emitLine("WEND");
      return;
    }
    if (node.type === "DoWhileStatement") {
      // Amendment A5 (2026-11-22): a do-while lowers through a
      // minted Bool flag. Neither target has a post-test loop, but
      // the body runs once before the first test either way when the
      // pre-tested loop is guarded by a flag that starts TRUE, and
      // the real test rewrites the flag at the end of every body
      // pass. The test is evaluated exactly once per pass, after the
      // body, so runs match the JavaScript one for one. The minted
      // name comes from the program's identifier set, so it cannot
      // collide with a user name.
      let flag = mintDoWhileFlag();
      let body = node.body.type === "BlockStatement" ? node.body : { body: [node.body] };
      if (isIroh) {
        counts.loops += 1;
        emitLine("LET " + flag + " : Bool = TRUE");
        emitLine("LOOP " + flag);
        emitBody(body);
        emitLine(flag + " = " + expr(node.test, 0));
        emitLine("END LOOP");
        return;
      }
      if (hasPlainCall(node.test)) {
        stubStmt("a call inside a do-while condition is not in the v1 scope: the flag is re-tested every pass through the WHILE, so the call cannot be hoisted to a GOSUB — move it into the body", "DoWhileStatement");
        return;
      }
      counts.loops += 1;
      emitLine("LET " + flag + " = -1");
      emitLine("WHILE " + flag);
      emitBody(body);
      emitLine("LET " + flag + " = " + expr(node.test, 0));
      emitLine("WEND");
      return;
    }
    if (node.type === "ForOfStatement") {
      // Amendment A6 (2026-11-22): for-of lowers through existing
      // machinery instead of stubbing. Both legs keep the v1 rule —
      // every piece this emitter cannot write still stubs loudly on
      // its own merits.
      //
      // BASIC: an array iterable rides DIM + FOR/NEXT. The literal's
      // own declaration machinery hoists the contents once (the
      // source evaluates the iterable exactly once), a minted index
      // walks 0..n-1, and the loop variable is re-assigned from the
      // array at the top of every pass. A variable works only when
      // it was declared with an array literal (the length is a
      // translate-time fact; the bootstrap BASIC has no LEN or MID
      // at runtime). A string literal unrolls on the spot.
      //
      // IrohScript: the language has no array type at all, so both
      // literals unroll into repeated passes — the first pass
      // declares the loop variable (or assigns it), later passes
      // re-assign it; a flat-scope re-binding, the same
      // simplification the for-loop desugaring makes.
      let declName = null;
      let isDecl = false;
      let declKind = "let";
      if (node.left && node.left.type === "VariableDeclaration") {
        isDecl = true;
        declKind = node.left.kind || "let";
        if (node.left.declarations.length === 1 && node.left.declarations[0].id.type === "Identifier") {
          declName = node.left.declarations[0].id.name;
        }
      } else if (node.left && node.left.type === "Identifier") {
        declName = node.left.name;
      }
      if (!declName) {
        stubStmt("a for-of target that is not a simple variable is not in the v1 scope", "ForOfStatement");
        return;
      }
      let items = null;
      let fromArrayLiteral = false;
      if (node.right && node.right.type === "ArrayExpression") {
        fromArrayLiteral = true;
        items = [];
        let n = node.right.elements.length;
        for (let ii = 0; ii < n; ++ii) {
          if (node.right.elements[ii] === null) {
            stubStmt("a hole in an array literal has no equivalent in " + (isIroh ? "IrohScript" : "BASIC"), "ForOfStatement");
            return;
          }
          items.push(node.right.elements[ii]);
        }
      } else if (node.right && node.right.type === "Literal" && typeof node.right.value === "string") {
        let s = node.right.value;
        items = [];
        for (let ii = 0; ii < s.length; ++ii) {
          let code = s.charCodeAt(ii);
          if (code < 32 || code > 126) {
            stubStmt("for-of over a string with non-printable-ASCII characters is not in the v1 scope", "ForOfStatement");
            return;
          }
          items.push({ type: "Literal", value: s[ii] });
        }
      }
      let body = node.body.type === "BlockStatement" ? node.body : { body: [node.body] };
      if (items === null) {
        if (node.right && node.right.type === "Identifier" && declared[node.right.name] && !isIroh && arrayLens[node.right.name]) {
          // A DIM'd array variable with a translate-time length.
          counts.loops += 1;
          noteOnce("forof-scope", "a for-of's binding stays in scope after the loop and holds its last value (flat scope, the same simplification the for-loop desugaring makes)");
          let idxName = mintForOfName("idx");
          emitLine("FOR " + idxName + " = 0 TO " + (arrayLens[node.right.name] - 1));
          emitLine("LET " + declName + " = " + node.right.name + "(" + idxName + ")");
          emitBody(body);
          emitLine("NEXT " + idxName);
          return;
        }
        stubStmt("for-of can only iterate an array literal (inline, or a variable declared with one) or a string literal in v1: " + (isIroh ? "IrohScript has no array type, so a runtime iterable cannot be walked" : "the bootstrap BASIC has no LEN at runtime, so a runtime-sized iterable cannot be walked"), "ForOfStatement");
        return;
      }
      if (items.length === 0) {
        // Zero iterations: the source statement does nothing, and the
        // BODY-ONLY translations below cannot run zero passes better
        // than by emitting nothing (an empty DIM has no BASIC form).
        counts.loops += 1;
        return;
      }
      if (!isIroh && fromArrayLiteral) {
        // Hoist the inline literal through the declaration machinery
        // (it lifts calls to GOSUBs, DIMs the minted array, and
        // records the length for nesting).
        let arrName = mintForOfName("arr");
        stmt({
          type: "VariableDeclaration",
          kind: "let",
          declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name: arrName }, init: node.right }],
        });
        counts.loops += 1;
        noteOnce("forof-scope", "a for-of's binding stays in scope after the loop and holds its last value (flat scope, the same simplification the for-loop desugaring makes)");
        let idxName = mintForOfName("idx");
        emitLine("FOR " + idxName + " = 0 TO " + (arrayLens[arrName] - 1));
        emitLine("LET " + declName + " = " + arrName + "(" + idxName + ")");
        emitBody(body);
        emitLine("NEXT " + idxName);
        return;
      }
      // String literal on BASIC, or either literal on IrohScript:
      // unroll one pass per item.
      counts.loops += 1;
      noteOnce("forof-scope", "a for-of's binding stays in scope after the loop and holds its last value (flat scope, the same simplification the for-loop desugaring makes)");
      if (isIroh) {
        noteOnce("forof-unroll", "a for-of over a literal was unrolled into one pass per item (the language has no array type), so the translated program holds no loop");
        if (declKind === "const") {
          noteOnce("forof-const", "a per-pass const binding is emulated with a flat declaration plus re-assignments (a const rebinding has no flat-scope encoding); assigning it inside the body was a TypeError in the source anyway");
        }
      }
      for (let ii = 0; ii < items.length; ++ii) {
        if (isIroh && ii === 0 && isDecl && !declared[declName]) {
          stmt({
            type: "VariableDeclaration",
            kind: "let",
            declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name: declName }, init: items[ii] }],
          });
        } else {
          emitLine(declName + " = " + expr(items[ii], 0));
        }
        emitBody(body);
      }
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "LabeledStatement") {
      stubStmt(node.type + " is not in the v1 scope", node.type);
      return;
    }
    stubStmt("statement " + node.type + " is not in the v1 scope", node.type);
  }
  function simpleExprText(node) {
    if (node.type === "Literal" || node.type === "Identifier") return expr(node, 0);
    return "(" + expr(node, 0) + ")";
  }
  function stmtExpr(e) {
    if (e.type === "AssignmentExpression") {
      let target = e.left;
      if (target.type !== "Identifier" && target.type !== "MemberExpression") {
        stubStmt("assignment to a non-identifier target is not in the v1 scope", "AssignmentExpression");
        return;
      }
      let name = target.type === "Identifier" ? target.name : expr(target, 0);
      let right = e.right;
      if (!isIroh) {
        let lifted = liftExpr(e.right);
        emitLifts(lifted.lifts);
        right = lifted.expr;
      }
      if (e.operator === "=") {
        if (isIroh && !declared[name] && target.type === "Identifier") {
          let ann = irohTypeOf(right);
          emitLine("LET " + name + (ann ? " : " + ann : "") + " = " + expr(right, 0));
          declared[name] = true;
        } else {
          emitLine(name + " = " + expr(right, 0));
        }
        // Amendment A6: a plain re-assignment retires any remembered
        // array length for the name (the for-of lowering may only
        // ride the original literal).
        if (target.type === "Identifier") delete arrayLens[target.name];
        return;
      }
      let op = null;
      if (e.operator === "+=") op = "+";
      else if (e.operator === "-=") op = "-";
      else if (e.operator === "*=") op = "*";
      else if (e.operator === "/=") op = "/";
      else if (e.operator === "%=") op = "%";
      if (!op) {
        stubStmt("assignment operator " + e.operator + " is not in the v1 scope", "AssignmentExpression");
        return;
      }
      if (op === "%") {
        assumeOnce("js-mod", "JavaScript % truncates toward zero; " + (isIroh ? "IrohScript" : "BASIC") + " % floors (Python-style); results differ when the left operand is negative", "IrohScript/BASIC % is Python-style floored modulo (bootstrap interpreter, basic.py); JavaScript % truncates toward zero");
      }
      emitLine(name + " = " + name + " " + op + " " + expr(right, 0));
      return;
    }
    if (e.type === "UpdateExpression" && e.argument.type === "Identifier") {
      let delta = e.operator === "++" ? "1" : "-1";
      emitLine(e.argument.name + " = " + e.argument.name + " + " + delta);
      return;
    }
    if (e.type === "CallExpression") {
      emitLine(expr(e, 0));
      return;
    }
    stubStmt("expression statement " + e.type + " is not in the v1 scope", e.type);
  }
  // BASIC only: replace every plain function call in a cloned statement
  // with a temp, and return the GOSUB lifts to emit before it. Function
  // bodies are never descended into — their calls belong to the
  // subroutine, not to the statement that declares the function.
  function liftCalls(node) {
    let lifts = [];
    let tempCounter = { n: 0 };
    function walk(n) {
      if (!n || typeof n !== "object") return n;
      if (Array.isArray(n)) {
        for (let ii = 0; ii < n.length; ++ii) n[ii] = walk(n[ii]);
        return n;
      }
      if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
        return n;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier") {
        for (let ii = 0; ii < n.arguments.length; ++ii) n.arguments[ii] = walk(n.arguments[ii]);
        tempCounter.n += 1;
        let temp = "__tmp" + tempCounter.n;
        lifts.push({ fn: n.callee.name, args: n.arguments, temp: temp });
        return { type: "Identifier", name: temp };
      }
      let keys = Object.keys(n);
      for (let ii = 0; ii < keys.length; ++ii) {
        let v = n[keys[ii]];
        if (v && typeof v === "object") n[keys[ii]] = walk(v);
      }
      return n;
    }
    let cloned = JSON.parse(JSON.stringify(node));
    let out = walk(cloned);
    return { node: out, lifts: lifts };
  }
  // BASIC only: lift the calls out of one expression (not a whole
  // statement — a call inside an IF branch or a loop body must stay
  // where it executes, so those places lift just the expression they
  // always evaluate). Returns { expr, lifts }.
  function liftExpr(node) {
    let wrapped = { type: "ExpressionStatement", expression: node };
    let lifted = liftCalls(wrapped);
    return { expr: lifted.node.expression, lifts: lifted.lifts };
  }
  function emitLifts(lifts) {
    for (let ii = 0; ii < lifts.length; ++ii) {
      let lift = lifts[ii];
      if (!(lift.fn in subLines)) {
        stubStmt("call to '" + lift.fn + "' cannot be a GOSUB subroutine (the function was not declared in this program)", "CallExpression");
        continue;
      }
      for (let jj = 0; jj < lift.args.length; ++jj) {
        emitLine("LET __arg" + jj + " = " + expr(lift.args[jj], 0));
      }
      emitLine("GOSUB " + subLines[lift.fn]);
      emitLine("LET " + lift.temp + " = __ret_" + lift.fn);
    }
  }
  // BASIC only: does this statement contain a plain function call?
  // A call in an IF branch cannot be written on the one BASIC line
  // (GOSUB is not an IF-part statement), so such a branch is a loud
  // stub instead. Function bodies are not descended into.
  function hasPlainCall(node) {
    let found = false;
    function walk(n) {
      if (!n || typeof n !== "object" || found) return;
      if (Array.isArray(n)) {
        for (let ii = 0; ii < n.length; ++ii) walk(n[ii]);
        return;
      }
      if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
        return;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier") {
        found = true;
        return;
      }
      let keys = Object.keys(n);
      for (let ii = 0; ii < keys.length; ++ii) {
        let v = n[keys[ii]];
        if (v && typeof v === "object") walk(v);
      }
    }
    walk(node);
    return found;
  }
  // BASIC only: render one branch of an IF as a single line of
  // :-separated statements. Returns null when a statement cannot be
  // written on one line (a loop, a return, a GOTO).
  function inlineBranch(node) {
    let stmts = node.type === "BlockStatement" ? node.body : [node];
    let saved = lines;
    let parts = [];
    for (let ii = 0; ii < stmts.length; ++ii) {
      if (hasPlainCall(stmts[ii])) { lines = saved; return null; }
      lines = [];
      let before = report.unsupported.length;
      stmt(stmts[ii]);
      if (report.unsupported.length > before) {
        report.unsupported.length = before;
        lines = saved;
        return null;
      }
      if (lines.length === 0) continue;
      if (lines.length !== 1) { lines = saved; return null; }
      parts.push(lines[0].trim());
    }
    lines = saved;
    if (parts.length === 0) return "REM";
    return parts.join(" : ");
  }
  function run(ast) {
    // Amendment A5 (2026-11-22): collect the program's identifier
    // set before any statement is emitted, so every minted do-while
    // flag is checked against the complete name set, not just the
    // names seen so far.
    collectNames(ast);
    let fns = [];
    let rest = [];
    for (let ii = 0; ii < ast.body.length; ++ii) {
      if (ast.body[ii].type === "FunctionDeclaration") fns.push(ast.body[ii]);
      else rest.push(ast.body[ii]);
    }
    if (isIroh) {
      for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
      if (fns.length > 0 && rest.length > 0) lines.push("");
      for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
      return { text: lines.join("\n") + "\n", counts: counts };
    }
    // BASIC: emit the mainline, then the GOSUB subroutines (their
    // line numbers were assigned as the functions were collected).
    for (let ii = 0; ii < fns.length; ++ii) emitFunction(fns[ii], fns[ii].id.name);
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    // The mainline falls through into the subroutines without this:
    // BASIC executes lines in order, so the program must stop before
    // the first GOSUB target.
    if (subroutines.length > 0) {
      let last = "";
      for (let ii = lines.length - 1; ii >= 0; --ii) {
        if (lines[ii].trim() !== "") { last = lines[ii].trim(); break; }
      }
      if (last !== "END" && last !== "STOP") lines.push("END");
    }
    for (let ii = 0; ii < subroutines.length; ++ii) {
      let sub = subroutines[ii];
      let startLine = subLines[sub.name];
      let saved = lines;
      lines = [];
      currentSub = sub.name;
      if (sub.stub) {
        emitLine("PRINT " + basicQuote("IrohRedux: recursive function '" + sub.name + "' cannot be a BASIC GOSUB subroutine"));
        emitLine("END");
      } else {
        for (let jj = 0; jj < sub.params.length; ++jj) {
          emitLine("LET " + sub.params[jj] + " = __arg" + jj);
        }
        emitBody(sub.node.body);
      }
      currentSub = null;
      let bodyLines = lines;
      lines = saved;
      lines.push("");
      for (let jj = 0; jj < bodyLines.length; ++jj) {
        lines.push(String(startLine + jj * 10) + " " + bodyLines[jj].trim());
      }
    }
    return { text: lines.join("\n") + "\n", counts: counts };
  }
  function callsItself(fnNode, fnName) {
    let found = false;
    function walk(n) {
      if (!n || typeof n !== "object" || found) return;
      if (Array.isArray(n)) {
        for (let ii = 0; ii < n.length; ++ii) walk(n[ii]);
        return;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === fnName) {
        found = true;
        return;
      }
      let keys = Object.keys(n);
      for (let ii = 0; ii < keys.length; ++ii) {
        let v = n[keys[ii]];
        if (v && typeof v === "object") walk(v);
      }
    }
    walk(fnNode.body);
    return found;
  }
  return { run: run, counts: counts };
}

function translate(code, options) {
  options = options || {};
  let from = options.from || "javascript";
  let to = options.to;
  let languages = ["javascript", "python", "cpp", "irohscript", "basic"];
  if (languages.indexOf(to) === -1) {
    throw new Error("Iroh.translate: unknown target '" + to + "' — use 'python', 'cpp', 'javascript', 'irohscript' or 'basic'");
  }
  if (from === to) {
    throw new Error("Iroh.translate: from and to are both '" + from + "'");
  }
  if (languages.indexOf(from) === -1) {
    throw new Error("Iroh.translate: unknown source '" + from + "' — use 'javascript', 'python', 'cpp', 'irohscript' or 'basic'");
  }
  // Direct legs: JavaScript out of any source, or any target out of
  // JavaScript.
  if (from === "javascript") {
    return translateFromJS(this, code, to, options);
  }
  if (to === "javascript") {
    return translateToJS(this, code, from, options);
  }
  // Two-hop via JavaScript: the first leg produces JavaScript (which
  // the second leg then traces for its types, exactly as the direct
  // JavaScript leg does). The report says so, and the first leg's
  // assumptions and notes ride along.
  let first = translateToJS(this, code, from, options);
  if (!first.report.ok) {
    first.report.to = to;
    first.report.notes.push("two-hop via JavaScript stopped at the first leg (" + from + " -> JavaScript)");
    return first;
  }
  let out = translateFromJS(this, first.code, to, options);
  out.report.from = from;
  out.report.notes.push(
    options.evidence === "none"
      ? "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is NOT traced — evidence: 'none', so types come from static inference or hints only)."
      : "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is traced for its types, exactly as the direct JavaScript leg is)."
  );
  out.report.assumptions = first.report.assumptions.concat(out.report.assumptions);
  out.report.notes = first.report.notes.concat(out.report.notes);
  return out;
}

// Any source language -> JavaScript. The Python, IrohScript and
// BASIC legs need python3 (via child_process); the C++ leg is pure
// JS. `iroh` is only used for the error message's `this` — the legs
// themselves do not trace.
function translateToJS(iroh, code, from, options) {
  if (from === "python" || from === "irohscript" || from === "basic") {
    let cp = getChildProcessSync();
    if (!cp) {
      throw new Error(
        "Iroh.translate: " + from + " -> JavaScript needs the Node.js CJS build with python3 on PATH — use Iroh.translateAsync() in ESM; it is not supported in a browser"
      );
    }
    if (from === "python") return translateFromPython(code, cp);
    if (from === "irohscript") return translateFromIrohscript(code, cp, options);
    return translateFromBasic(code, cp, options);
  }
  if (from === "cpp") {
    return translateFromCpp(code);
  }
  throw new Error("Iroh.translate: unknown source '" + from + "'");
}

function translateAsync(code, options) {
  options = options || {};
  let iroh = this;
  let from = options.from || "javascript";
  let to = options.to;
  if (from === "python" || from === "irohscript" || from === "basic") {
    // Load child_process by dynamic import so this works in the ESM
    // build too (no sync require there). The first leg runs with it;
    // the rest is synchronous (the second hop traces JavaScript,
    // which needs no child process).
    return nodeImport("node:child_process").then(
      function(cp) {
        let first = null;
        if (from === "python") first = translateFromPython(code, cp);
        else if (from === "irohscript") first = translateFromIrohscript(code, cp, options);
        else first = translateFromBasic(code, cp, options);
        if (to === "javascript" || !to) return first;
        if (!first.report.ok) {
          first.report.to = to;
          first.report.notes.push("two-hop via JavaScript stopped at the first leg (" + from + " -> JavaScript)");
          return first;
        }
        let out = translateFromJS(iroh, first.code, to, options);
        out.report.from = from;
        out.report.notes.push(
          options.evidence === "none"
            ? "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is NOT traced — evidence: 'none', so types come from static inference or hints only)."
            : "Translated " + from + " -> JavaScript -> " + to + " (two-hop: the JavaScript in the middle is traced for its types, exactly as the direct JavaScript leg is)."
        );
        out.report.assumptions = first.report.assumptions.concat(out.report.assumptions);
        out.report.notes = first.report.notes.concat(out.report.notes);
        return out;
      },
      function() {
        throw new Error("Iroh.translateAsync: " + from + " -> JavaScript needs Node.js with python3 on PATH");
      }
    );
  }
  try {
    return Promise.resolve(translate.call(iroh, code, options));
  } catch (e) {
    return Promise.reject(e);
  }
}

var _translate = /*#__PURE__*/Object.freeze({
  __proto__: null,
  translate: translate,
  translateAsync: translateAsync
});

// IrohScript -> JavaScript code generator: the compiler backend for
// IrohRedux's own core (part 3 of the 1.0.1 rework). This is NOT the
// translator (src/translate.js): the translator reports what it could
// and could not translate and emits loud stubs for the rest; this
// compiler either emits clean, runnable JavaScript or throws a clear
// error naming the construct it cannot compile. The compiled output
// is the real code IrohRedux runs — the first component compiled this
// way is the perceptron's scoring core (irohscript/core/perceptron.iroh
// -> src/neurons-irohscript.js).
//
// The frontend is the bootstrap compiler: source is compiled by
// IrohCompiler (Python, via the shared bridge in
// src/irohscript-bridge.js) and the AST JSON is walked here. No
// hand-rolled IrohScript parser on the JS side.
//
// Semantics are the bootstrap's, Python-style (7/2 = 3.5, -5 % 3 = 1):
// DIV emits plain JavaScript / (float division, the same as Python's)
// and MOD emits __iroh_pymod (floored). If Andy ever calls C++-style
// (truncated) division instead, the flip is that one helper function.
// Division and modulo are the one open question from the MVP that
// this compiler touches; everything else it emits is semantics-free
// (names, struct fields, calls, arithmetic, comparisons).
//
// The emitted code is ES2015-only (no async/await, no for...of): it
// lives in src/ and ships in the browser bundle, which buble
// transpiles. It is deterministic: same source, same bytes, so the
// checked-in generated file can be verified against a fresh compile
// (see tests/irohscript-codegen.test.js, the drift check).
//
// In a browser there is no python3 and no require: the sync entry
// throws a clear error pointing at the async entry, which works in
// ESM Node via dynamic import (same split as the translator).


function compileError(detail) {
  return new Error("Iroh.compileIrohscript: " + detail);
}

// Default value for an IrohScript type (for LET with no initializer
// and for STRUCT field defaults). Same table as the translator's:
// Int/Float -> 0, String -> "", Bool -> false, Vector -> [], a struct
// type -> a call to its factory function.
function irohTypeDefault(typeName) {
  if (typeName === "Int" || typeName === "Float") return "0";
  if (typeName === "String") return '""';
  if (typeName === "Bool") return "false";
  if (typeName && typeName.indexOf("Vector") === 0) return "[]";
  return null;
}

function makeCodegenEmitter() {
  let lines = [];
  let indentLevel = 0;
  let needsPymod = false;
  function indentStr() { return "  ".repeat(indentLevel); }
  function emitLine(text) { lines.push(indentStr() + text); }
  let BIN_PREC = { OR: 1, AND: 2, EQ: 3, NEQ: 3, LT: 3, LE: 3, GT: 3, GE: 3, ADD: 4, SUB: 4, MUL: 5, DIV: 5, MOD: 5 };
  function exprPrec(node) {
    if (!node || typeof node !== "object") return 7;
    if (node.node === "BinOp") return BIN_PREC[node.op] || 1;
    if (node.node === "UnaryOp") return 6;
    return 7;
  }
  function expr(node, parentPrec) {
    if (!node || typeof node !== "object") throw compileError("missing expression");
    let prec = exprPrec(node);
    let out = "";
    if (node.node === "Literal") {
      if (typeof node.value === "string") out = JSON.stringify(node.value);
      else if (typeof node.value === "number" || typeof node.value === "boolean") out = String(node.value);
      else if (node.value === null || node.value === void 0) out = "null";
      else out = JSON.stringify(node.value);
    } else if (node.node === "Name") {
      out = node.name;
    } else if (node.node === "BinOp") {
      if (node.op === "MOD") {
        needsPymod = true;
        out = "__iroh_pymod(" + expr(node.left, 7) + ", " + expr(node.right, 7) + ")";
      } else {
        let map = { ADD: "+", SUB: "-", MUL: "*", DIV: "/", EQ: "===", NEQ: "!==", LT: "<", LE: "<=", GT: ">", GE: ">=", AND: "&&", OR: "||" };
        if (!map[node.op]) throw compileError("binary operator '" + node.op + "' is not in the v1 scope");
        out = expr(node.left, prec) + " " + map[node.op] + " " + expr(node.right, prec + 1);
      }
    } else if (node.node === "UnaryOp") {
      out = (node.op === "NOT" ? "!" : "-") + expr(node.operand, 6);
    } else if (node.node === "Call") {
      out = expr(node.callee, 7) + "(" + node.args.map(function(a) { return expr(a, 0); }).join(", ") + ")";
    } else if (node.node === "MemberAccess") {
      out = expr(node.object, 7) + "." + node.member;
    } else {
      throw compileError("expression node '" + (node.node || "?") + "' is not in the v1 scope");
    }
    if (prec < (parentPrec || 0)) return "(" + out + ")";
    return out;
  }
  function emitBlock(stmts) {
    indentLevel += 1;
    for (let ii = 0; ii < stmts.length; ++ii) stmt(stmts[ii]);
    indentLevel -= 1;
  }
  function stmt(node) {
    if (!node || typeof node.node !== "string") throw compileError("missing statement");
    if (node.node === "Let" || node.node === "Const") {
      let kw = node.node === "Const" ? "const " : "let ";
      if (node.value === null || node.value === void 0) {
        if (node.type) {
          let dflt = irohTypeDefault(node.type);
          if (dflt !== null) { emitLine(kw + node.name + " = " + dflt + ";"); return; }
          emitLine(kw + node.name + " = " + node.type + "();");
          return;
        }
        emitLine(kw + node.name + ";");
        return;
      }
      emitLine(kw + node.name + " = " + expr(node.value, 0) + ";");
      return;
    }
    if (node.node === "Assign") {
      emitLine(expr(node.target, 0) + " = " + expr(node.value, 0) + ";");
      return;
    }
    if (node.node === "Print") {
      emitLine("console.log(" + expr(node.value, 0) + ");");
      return;
    }
    if (node.node === "If") {
      emitLine("if (" + expr(node.cond, 0) + ") {");
      emitBlock(node.then);
      if (node.else && node.else.length > 0) {
        emitLine("} else {");
        emitBlock(node.else);
      }
      emitLine("}");
      return;
    }
    if (node.node === "FunctionDef") {
      let params = node.params.map(function(p) { return p.name; }).join(", ");
      emitLine("export function " + node.name + "(" + params + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "Return") {
      emitLine(node.value ? "return " + expr(node.value, 0) + ";" : "return;");
      return;
    }
    if (node.node === "StructDef") {
      let fields = node.fields.map(function(f) {
        let dflt = irohTypeDefault(f.type);
        return f.name + ": " + (dflt !== null ? dflt : f.type + "()");
      }).join(", ");
      emitLine("export function " + node.name + "() { return { " + fields + " }; }");
      return;
    }
    if (node.node === "EnumDef") {
      let members = node.members.map(function(m) { return m + ": " + JSON.stringify(m); }).join(", ");
      emitLine("export const " + node.name + " = { " + members + " };");
      return;
    }
    if (node.node === "Call") {
      emitLine(expr(node, 0) + ";");
      return;
    }
    if (node.node === "Loop") {
      // Amendment A2 (2026-11-21): the conditional LOOP <Bool-expr>
      // (Amendment A1) lowers to a while loop. The legacy bare LOOP
      // still throws: the compiler never emits a loop it cannot end.
      if (node.cond === null || node.cond === void 0) {
        throw compileError("LOOP has no defined exit condition in IrohScript 3.0 (spec section 6 shows the form but not the termination rule) — the compiler cannot emit a loop it cannot end; write the conditional form LOOP <Bool-expr> (Amendment A1) instead");
      }
      emitLine("while (" + expr(node.cond, 0) + ") {");
      emitBlock(node.body);
      emitLine("}");
      return;
    }
    if (node.node === "Action") {
      throw compileError("ACTION is a program behaviour (record + print), not core library code — the compiler does not emit it");
    }
    if (node.node === "Intent") {
      throw compileError("INTENT is a program behaviour (record in the intent graph), not core library code — the compiler does not emit it");
    }
    if (node.node === "Conditional") {
      throw compileError("the legacy Conditional form ('enemy -> defend') is a program behaviour, not core library code — write an IF statement instead");
    }
    if (node.node === "Import") {
      throw compileError("IMPORT '" + (node.name || "?") + "' has no runtime effect (namespaces are runtime extensions) — core code must not import what it cannot use");
    }
    throw compileError("statement node '" + node.node + "' is not in the v1 scope");
  }
  function run(ast) {
    let stmts = ast.statements || [];
    let defs = [];
    let rest = [];
    for (let ii = 0; ii < stmts.length; ++ii) {
      if (stmts[ii].node === "FunctionDef" || stmts[ii].node === "StructDef" || stmts[ii].node === "EnumDef") defs.push(stmts[ii]);
      else rest.push(stmts[ii]);
    }
    for (let ii = 0; ii < defs.length; ++ii) stmt(defs[ii]);
    if (defs.length > 0 && rest.length > 0) lines.push("");
    for (let ii = 0; ii < rest.length; ++ii) stmt(rest[ii]);
    let header = [];
    if (needsPymod) {
      header.push("function __iroh_pymod(a, b) { return ((a % b) + b) % b; }");
      header.push("");
    }
    return header.concat(lines).join("\n") + "\n";
  }
  return { run: run };
}

// Compile IrohScript source to a JavaScript module string. Throws on
// a compile error in the source or on a construct the compiler cannot
// emit. options.irohscriptHome names the directory holding the
// irohscript package (the CLI and the build script pass the in-repo
// copy); otherwise IROHSCRIPT_HOME, <cwd>/irohscript, or <cwd>.
function compileIrohscript(source, options) {
  let cp = getChildProcessSync();
  if (!cp) {
    throw new Error(
      "Iroh.compileIrohscript: compiling IrohScript needs the Node.js CJS build with python3 on PATH — use Iroh.compileIrohscriptAsync() in ESM; it is not supported in a browser"
    );
  }
  return compileWithChildProcess(source, options, cp);
}

// The async version: loads child_process by dynamic import so it
// works in the ESM build too (no sync require there).
function compileIrohscriptAsync(source, options) {
  return nodeImport("node:child_process").then(
    function(cp) {
      return compileWithChildProcess(source, options, cp);
    },
    function() {
      throw new Error("Iroh.compileIrohscriptAsync: compiling IrohScript needs Node.js with python3 on PATH");
    }
  );
}

function compileWithChildProcess(source, options, cp) {
  let ast;
  try {
    ast = runIrohscriptPython(source, options, cp, IROHSCRIPT_AST_HELPER, "IrohScript");
  } catch (e) {
    // The shared bridge reports translator-flavoured errors; the
    // compiler re-labels them so a failure names the compiler.
    let message = e && e.message ? e.message : String(e);
    if (message.indexOf("Iroh.translate: ") === 0) {
      message = "Iroh.compileIrohscript: " + message.slice("Iroh.translate: ".length);
    }
    throw new Error(message);
  }
  let emitter = makeCodegenEmitter();
  return emitter.run(ast);
}

var _codegen = /*#__PURE__*/Object.freeze({
  __proto__: null,
  compileIrohscript: compileIrohscript,
  compileIrohscriptAsync: compileIrohscriptAsync
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
extend(Iroh, _synth);
extend(Iroh, _translate);
extend(Iroh, _codegen);

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

export { iroh as default };
