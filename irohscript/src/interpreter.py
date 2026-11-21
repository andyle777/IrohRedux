"""IrohScript 3.0 — IRX interpreter.

Executes an IRX document (spec section 26) by walking the instruction
tree. Values are Python values with IrohScript types attached by the
checker; the interpreter enforces the runtime half of the rules:

  - PRINT writes the value to output (Bool prints as TRUE/FALSE).
  - ACTION records the evaluated action and prints it.
  - SET declares or assigns; CONST declares an immutable binding.
  - IF branches on a Bool; LOOP is decided conditional (Amendment
    A1, test-first) and must branch on a Bool like IF; the legacy bare
    spec, so executing one raises a clear error naming it as an open
    design question (it is not silently executed, and not silently
    skipped).
  - Functions are first-class values with lexical scope; RETURN unwinds
    via an exception.
  - INTENT evaluates its String and records it in the IrohCore intent
    graph.

Arithmetic semantics (open design question, documented in the README):
the bootstrap is Python, so division is true division (7 / 2 = 3.5) and
% is floored modulo (-5 % 3 = 1), matching Python. If Andy wants C++
semantics (truncated division/modulo), that is a one-line change in
_eval_binop, and it is listed as a question for him.
"""

from .errors import RuntimeError_ as IrohRuntimeError
from .typesys import default_value


class _Return(Exception):
    def __init__(self, value):
        self.value = value


class _Break(Exception):
    pass


class FunctionValue:
    def __init__(self, name, params, body, closure):
        self.name = name
        self.params = params  # [(name, type|None)]
        self.body = body      # IRX instruction list
        self.closure = closure

    def __repr__(self):
        return "<function %s>" % self.name


class StructValue:
    def __init__(self, type_name, fields):
        self.type_name = type_name
        self.fields = dict(fields)

    def __repr__(self):
        inner = ", ".join("%s=%r" % (k, v) for k, v in self.fields.items())
        return "%s{%s}" % (self.type_name, inner)


class EnumValue:
    def __init__(self, type_name, member):
        self.type_name = type_name
        self.member = member

    def __repr__(self):
        return "%s.%s" % (self.type_name, self.member)


class Env:
    """A lexical scope: a dict of names plus a parent scope."""

    def __init__(self, parent=None):
        self.vars = {}
        self.consts = set()
        self.parent = parent

    def lookup(self, name):
        env = self
        while env is not None:
            if name in env.vars:
                return env.vars[name]
            env = env.parent
        raise IrohRuntimeError("Undefined name %r at runtime" % name)

    def define(self, name, value, const=False):
        self.vars[name] = value
        if const:
            self.consts.add(name)

    def assign(self, name, value):
        env = self
        while env is not None:
            if name in env.vars:
                if name in env.consts:
                    raise IrohRuntimeError(
                        "Cannot assign to CONST %r at runtime" % name)
                env.vars[name] = value
                return
            env = env.parent
        raise IrohRuntimeError("Assignment to undeclared name %r" % name)

    def is_const(self, name):
        env = self
        while env is not None:
            if name in env.consts:
                return True
            env = env.parent
        return False

    def snapshot(self):
        """The global variables as a plain dict (for results)."""
        out = {}
        env = self
        chain = []
        while env is not None:
            chain.append(env)
            env = env.parent
        for env in reversed(chain):
            for name, value in env.vars.items():
                out[name] = _to_plain(value)
        return out


def _to_plain(value):
    if isinstance(value, FunctionValue):
        return "<function %s>" % value.name
    if isinstance(value, StructValue):
        return {"$struct": value.type_name,
                **{k: _to_plain(v) for k, v in value.fields.items()}}
    if isinstance(value, EnumValue):
        return "%s.%s" % (value.type_name, value.member)
    return value


def format_value(value):
    """How a value prints (spec uses TRUE/FALSE for Bools)."""
    if value is True:
        return "TRUE"
    if value is False:
        return "FALSE"
    if isinstance(value, float):
        return repr(value)
    return str(value)


class Interpreter:
    def __init__(self, core):
        self.core = core
        self.output = []   # printed lines, in order
        self.actions = []  # ACTION results, in order
        self.global_env = Env()
        self.struct_types = {}  # name -> [(field, type)]
        self.enum_types = {}    # name -> [member]

    # ------------------------------------------------------------ entry
    def execute(self, irx_doc):
        """Execute an IRX document. Returns a result dict."""
        program = irx_doc.get("program", [])
        self._exec_block(program, self.global_env)
        return {"output": list(self.output),
                "actions": list(self.actions),
                "intents": [dict(i) for i in self.core.intents],
                "variables": self.global_env.snapshot()}

    # ------------------------------------------------------------ blocks
    def _exec_block(self, instrs, env):
        for instr in instrs:
            self._exec_instr(instr, env)

    def _exec_instr(self, instr, env):
        op = instr.get("opcode")
        handler = getattr(self, "_do_" + op, None)
        if handler is None:
            raise IrohRuntimeError("Unknown IRX opcode %r" % op)
        handler(instr, env)

    # ------------------------------------------------------------ statements
    def _do_SET(self, instr, env):
        value = self._eval(instr["value"], env)
        name = instr["register"]
        if self._find_env(env, name) is not None:
            env.assign(name, value)
        else:
            env.define(name, value)

    def _do_DEFAULT(self, instr, env):
        # Default instance (struct) or default value (primitive).
        name = instr["register"]
        type_name = instr["type"]
        if type_name in self.struct_types:
            env.define(name, self._default_struct(type_name))
        elif type_name in self.enum_types:
            raise IrohRuntimeError(
                "Cannot declare a default value of enum type %r"
                % type_name)
        else:
            env.define(name, default_value(_type_for_name(type_name)))

    def _do_CONST(self, instr, env):
        value = self._eval(instr["value"], env)
        name = instr["register"]
        env.define(name, value, const=True)
        if name == "IDENTITY_ROOT":
            self.core.set_identity_root(value)

    def _do_SETFIELD(self, instr, env):
        obj = self._eval(instr["object"], env)
        if not isinstance(obj, StructValue):
            raise IrohRuntimeError("Cannot set a field on a non-struct")
        if instr["field"] not in obj.fields:
            raise IrohRuntimeError(
                "Struct %s has no field %r"
                % (obj.type_name, instr["field"]))
        obj.fields[instr["field"]] = self._eval(instr["value"], env)

    def _do_PRINT(self, instr, env):
        value = self._eval(instr["value"], env)
        self.output.append(format_value(value))

    def _do_ACTION(self, instr, env):
        value = self._eval(instr["value"], env)
        self.actions.append(value)
        self.output.append(format_value(value))

    def _do_IF(self, instr, env):
        cond = self._eval(instr["cond"], env)
        if not isinstance(cond, bool):
            raise IrohRuntimeError("IF condition is not a Bool")
        branch = instr["then"] if cond else instr["else"]
        self._exec_block(branch, env)

    def _do_LOOP(self, instr, env):
        # Amendment A1 (2026-11-21): the exit rule is decided for the
        # CONDITIONAL form, LOOP <Bool-expr> ... END, test-first like
        # IF. The legacy bare form still has no rule and still errors.
        cond_ir = instr.get("cond")
        if cond_ir is None:
            raise IrohRuntimeError(
                "Legacy LOOP has no defined exit condition in IrohScript "
                "3.0 (spec section 6 shows the form but not the "
                "termination rule); executing it is an open design "
                "question for the Chaos Architect (the Amendment A1 "
                "conditional form LOOP <Bool> has one)")
        while True:
            cond = self._eval(cond_ir, env)
            if not isinstance(cond, bool):
                raise IrohRuntimeError("LOOP condition is not a Bool")
            if not cond:
                break
            self._exec_block(instr["body"], env)

    def _do_FUNCDEF(self, instr, env):
        func = FunctionValue(instr["name"], instr["params"],
                             instr["body"], env)
        env.define(instr["name"], func)

    def _do_RETURN(self, instr, env):
        value = None
        if instr.get("value") is not None:
            value = self._eval(instr["value"], env)
        raise _Return(value)

    def _do_STRUCTDEF(self, instr, env):
        self.struct_types[instr["name"]] = [
            (f["name"], f["type"]) for f in instr["fields"]]

    def _do_ENUMDEF(self, instr, env):
        self.enum_types[instr["name"]] = list(instr["members"])

    def _do_IMPORT(self, instr, env):
        return  # namespaces are runtime extensions; use is a compile error

    def _do_INTENT(self, instr, env):
        value = self._eval(instr["value"], env)
        if not isinstance(value, str):
            raise IrohRuntimeError("INTENT requires a String")
        self.core.record_intent(value)

    def _do_CALLSTMT(self, instr, env):
        self._eval(instr["value"], env)

    # ------------------------------------------------------------ helpers
    def _find_env(self, env, name):
        while env is not None:
            if name in env.vars:
                return env
            env = env.parent
        return None

    # ------------------------------------------------------------ expressions
    def _eval(self, expr, env):
        op = expr.get("op")
        if op == "LIT":
            return expr["value"]
        if op == "LOAD":
            return env.lookup(expr["name"])
        if op == "GET":
            obj_expr = expr["object"]
            if obj_expr.get("op") == "LOAD" \
                    and obj_expr["name"] in self.enum_types:
                type_name = obj_expr["name"]
                if expr["member"] not in self.enum_types[type_name]:
                    raise IrohRuntimeError(
                        "Enum %s has no member %r"
                        % (type_name, expr["member"]))
                return EnumValue(type_name, expr["member"])
            obj = self._eval(obj_expr, env)
            if isinstance(obj, StructValue):
                if expr["member"] not in obj.fields:
                    raise IrohRuntimeError(
                        "Struct %s has no field %r"
                        % (obj.type_name, expr["member"]))
                return obj.fields[expr["member"]]
            raise IrohRuntimeError("Cannot access a member of %r" % (obj,))
        if op == "CALL":
            return self._call(expr, env)
        if op == "NOT":
            operand = self._eval(expr["operand"], env)
            if not isinstance(operand, bool):
                raise IrohRuntimeError("NOT requires a Bool")
            return not operand
        if op == "NEG":
            operand = self._eval(expr["operand"], env)
            if not isinstance(operand, (int, float)) \
                    or isinstance(operand, bool):
                raise IrohRuntimeError("Unary - requires a number")
            return -operand
        return self._eval_binop(op, expr, env)

    def _eval_binop(self, op, expr, env):
        left = self._eval(expr["left"], env)
        right = self._eval(expr["right"], env)
        if op == "ADD":
            if isinstance(left, str) and isinstance(right, str):
                return left + right
            if isinstance(left, bool) or isinstance(right, bool):
                raise IrohRuntimeError("Cannot add Bools")
            if isinstance(left, (int, float)) and isinstance(right, (int, float)):
                return left + right
            raise IrohRuntimeError("Cannot add %s and %s"
                                    % (type(left).__name__,
                                       type(right).__name__))
        if op in ("SUB", "MUL"):
            self._numbers(op, left, right)
            return left - right if op == "SUB" else left * right
        if op == "DIV":
            self._numbers(op, left, right)
            if right == 0:
                raise IrohRuntimeError("Division by zero")
            return left / right  # true division (open design question)
        if op == "MOD":
            self._numbers(op, left, right)
            if right == 0:
                raise IrohRuntimeError("Modulo by zero")
            return left % right  # floored modulo (open design question)
        if op == "EQ":
            return left == right
        if op == "NEQ":
            return left != right
        if op in ("LT", "LE", "GT", "GE"):
            if type(left) is not type(right) and not (
                    isinstance(left, (int, float))
                    and isinstance(right, (int, float))):
                raise IrohRuntimeError("Cannot compare %s with %s"
                                        % (type(left).__name__,
                                           type(right).__name__))
            return {"LT": left < right, "LE": left <= right,
                    "GT": left > right, "GE": left >= right}[op]
        if op == "AND":
            return bool(left) and bool(right)
        if op == "OR":
            return bool(left) or bool(right)
        raise IrohRuntimeError("Unknown operator %r" % op)

    def _numbers(self, op, left, right):
        if isinstance(left, bool) or isinstance(right, bool) or \
                not isinstance(left, (int, float)) or \
                not isinstance(right, (int, float)):
            raise IrohRuntimeError("Operator %s requires numbers" % op)

    def _call(self, expr, env):
        name = expr["name"]
        if "." in name:
            raise IrohRuntimeError(
                "Call to %r: namespaces are runtime extensions, not "
                "available in the MVP" % name)
        func = env.lookup(name)
        if isinstance(func, StructValue) or isinstance(func, EnumValue):
            raise IrohRuntimeError("%r is not callable" % name)
        if not isinstance(func, FunctionValue):
            # A zero-argument struct/enum default construction is not a
            # call; a bare name used as a function is a runtime error.
            if name in self.struct_types and not expr["args"]:
                return self._default_struct(name)
            if name in self.enum_types:
                raise IrohRuntimeError(
                    "Enum %r is not callable" % name)
            raise IrohRuntimeError("%r is not a function" % name)
        if len(expr["args"]) != len(func.params):
            raise IrohRuntimeError(
                "Function %r takes %d argument(s), got %d"
                % (name, len(func.params), len(expr["args"])))
        args = [self._eval(a, env) for a in expr["args"]]
        call_env = Env(func.closure)
        for param, value in zip(func.params, args):
            call_env.define(param["name"], value)
        try:
            self._exec_block(func.body, call_env)
        except _Return as ret:
            return ret.value
        return None

    def _default_struct(self, name, _seen=None):
        # A struct-typed field defaults to a struct of its own type,
        # recursively — `LET o : Outer` where Outer has an Inner field
        # gives o.inner as an Inner value, not None, so `o.inner.x = 3`
        # works. (Before this, every non-primitive field defaulted to
        # None and a nested field assignment died in _do_SETFIELD with
        # "Cannot set a field on a non-struct".) A self-referential
        # field (a struct with a field of its own type) has no finite
        # default, so it stays None — the same "no value" the language
        # already gives unknown types — instead of recursing forever.
        if _seen is None:
            _seen = set()
        if name in _seen:
            return None
        _seen = _seen | {name}
        fields = {}
        for fname, ftype in self.struct_types[name]:
            if ftype in self.struct_types:
                fields[fname] = self._default_struct(ftype, _seen)
            else:
                fields[fname] = default_value(_type_for_name(ftype))
        return StructValue(name, fields)


def _type_for_name(text):
    from .typesys import INT, FLOAT, STRING, BOOL, UNKNOWN
    return {"Int": INT, "Float": FLOAT, "String": STRING,
            "Bool": BOOL}.get(text, UNKNOWN)
