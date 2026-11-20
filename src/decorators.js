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
import { parseExpression, cloneNode } from "./helpers";
import { reserveTempVarId } from "./utils";

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
  function privMember(obj) {
    // `#m` as a member property: only legal inside the class body,
    // which is where these closures are created (static block).
    return magic({
      type: "MemberExpression",
      object: obj,
      property: { type: "PrivateIdentifier", name: keyName.slice(1) },
      computed: false,
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
export function desugarDecorators(ast, patcher) {
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
