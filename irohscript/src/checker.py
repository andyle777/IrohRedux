"""IrohScript 3.0 — semantic analysis, name resolution, type checking
(compiler passes 4-6).

Walks the canonical AST and either returns cleanly or raises the first
CompileError. Rules enforced:

  - Every name used must be declared (functions, structs and enums are
    pre-declared so forward references work; variables must be declared
    before use, in source order).
  - CONST names cannot be assigned to (spec section 14). The rejection
    message names the constant.
  - LET with an annotation requires the value's type to match exactly
    (Int and Float are distinct; Unknown is compatible with everything).
  - IF conditions must be Bool (or Unknown).
  - Function calls check arity when the callee is a known function.
  - Struct field access and enum member access are checked against the
    declaration; member access on anything else is an error.
  - Namespaces brought in by IMPORT (Memory, Vector, Agents, OmniMesh)
    are runtime extensions: any use of them is a clear error naming the
    extension, not a silent pass.
  - RETURN is only legal inside a FUNCTION.
  - A bare identifier used as a value must not be a struct/enum/namespace
    name (those are types/namespaces, not values).
"""

from . import ast_nodes as A
from .errors import (NameResolutionError, SemanticError, TypeCheckError)
from .typesys import (UNKNOWN, INT, STRING, FLOAT, BOOL, Type,
                      parse_type_name, compatible, type_of_literal)


class Symbol:
    def __init__(self, kind, type_obj, const=False, params=None):
        self.kind = kind  # var | const | func | struct | enum | namespace | param
        self.type = type_obj
        self.const = const
        self.params = params or []  # funcs: [(name, Type|None)]

    def __repr__(self):
        return "Symbol(%s, %s)" % (self.kind, self.type)


class Checker:
    def __init__(self):
        self.scopes = [{}]            # stack of {name: Symbol}
        self.declared_types = {}      # struct/enum name -> Type
        self.in_function = 0

    # ------------------------------------------------------------ scopes
    def push(self):
        self.scopes.append({})

    def pop(self):
        self.scopes.pop()

    def declare(self, name, symbol, line=None):
        if name in self.scopes[-1]:
            raise NameResolutionError(
                "Name %r is already declared in this scope" % name,
                line=line)
        self.scopes[-1][name] = symbol

    def lookup(self, name):
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]
        return None

    # ------------------------------------------------------------ entry
    def check(self, program):
        self._predeclare(program.statements)
        for stmt in program.statements:
            self.check_stmt(stmt)
        return program

    def _predeclare(self, statements):
        """Declare top-level functions, structs, enums and imports first,
        so forward references and recursion work."""
        for stmt in statements:
            if isinstance(stmt, A.FunctionDef):
                self.declare(stmt.name, Symbol(
                    "func", UNKNOWN,
                    params=[(n, self._resolve_type(t) if t else None)
                            for n, t in stmt.params]))
            elif isinstance(stmt, A.StructDef):
                fields = {}
                for fname, ftype in stmt.fields:
                    fields[fname] = self._resolve_type(ftype)
                t = Type(stmt.name, kind="struct", fields=fields)
                self.declared_types[stmt.name] = t
                self.declare(stmt.name, Symbol("struct", t))
            elif isinstance(stmt, A.EnumDef):
                t = Type(stmt.name, kind="enum", members=list(stmt.members))
                self.declared_types[stmt.name] = t
                self.declare(stmt.name, Symbol("enum", t))
            elif isinstance(stmt, A.Import):
                self.declare(stmt.name, Symbol("namespace", UNKNOWN))

    def _resolve_type(self, text):
        if text is None:
            return None
        try:
            return parse_type_name(text, self.declared_types)
        except ValueError as exc:
            raise TypeCheckError(str(exc))

    # ------------------------------------------------------------ statements
    def check_stmt(self, stmt):
        method = getattr(self, "_check_" + type(stmt).__name__, None)
        if method is None:
            raise SemanticError("Checker has no rule for %s"
                                % type(stmt).__name__)
        method(stmt)

    def _check_Let(self, stmt):
        if stmt.value is None:
            # No initializer: only legal with a type annotation, and only
            # for a struct or primitive type (default instance/value).
            declared = self._resolve_type(stmt.type_ann)
            if declared.kind in ("generic", "runtime"):
                raise TypeCheckError(
                    "Cannot construct a value of type %r in the MVP: %s "
                    "is a runtime extension" % (stmt.type_ann, stmt.type_ann))
            self.declare(stmt.name, Symbol(
                "const" if stmt.is_const else "var", declared,
                const=stmt.is_const))
            return
        value_type = self.check_expr(stmt.value)
        if stmt.type_ann is not None:
            declared = self._resolve_type(stmt.type_ann)
            if declared.kind in ("generic", "runtime"):
                raise TypeCheckError(
                    "Cannot construct a value of type %r in the MVP: %s "
                    "is a runtime extension" % (stmt.type_ann, stmt.type_ann))
            if not compatible(declared, value_type):
                raise TypeCheckError(
                    "LET %s : %s cannot hold a value of type %s"
                    % (stmt.name, stmt.type_ann, value_type.name))
            self.declare(stmt.name, Symbol(
                "const" if stmt.is_const else "var", declared,
                const=stmt.is_const))
        else:
            self.declare(stmt.name, Symbol(
                "const" if stmt.is_const else "var", value_type,
                const=stmt.is_const))

    def _check_Assign(self, stmt):
        value_type = self.check_expr(stmt.value)
        target = stmt.target
        if isinstance(target, A.Name):
            sym = self.lookup(target.name)
            if sym is None:
                raise NameResolutionError(
                    "Assignment to undeclared name %r" % target.name)
            if sym.const:
                raise SemanticError(
                    "Cannot assign to CONST %r: constants are immutable "
                    "(spec section 14)" % target.name)
            if sym.kind not in ("var", "param"):
                raise SemanticError(
                    "Cannot assign to %r: it is a %s, not a variable"
                    % (target.name, sym.kind))
            if not compatible(sym.type, value_type):
                raise TypeCheckError(
                    "Cannot assign a value of type %s to %r of type %s"
                    % (value_type.name, target.name, sym.type.name))
        elif isinstance(target, A.MemberAccess):
            obj_type = self.check_expr(target.obj)
            if obj_type.kind != "struct":
                raise TypeCheckError(
                    "Cannot assign to a field of %r: not a struct"
                    % obj_type.name)
            if target.member not in obj_type.fields:
                raise NameResolutionError(
                    "Struct %s has no field %r"
                    % (obj_type.name, target.member))
            field_type = obj_type.fields[target.member]
            if not compatible(field_type, value_type):
                raise TypeCheckError(
                    "Cannot assign a value of type %s to field %r of type %s"
                    % (value_type.name, target.member, field_type.name))

    def _check_Print(self, stmt):
        self.check_expr(stmt.value)

    def _check_Action(self, stmt):
        self.check_expr(stmt.value)

    def _check_If(self, stmt):
        cond_type = self.check_expr(stmt.cond)
        if not compatible(BOOL, cond_type):
            raise TypeCheckError(
                "IF condition must be Bool, got %s" % cond_type.name)
        for s in stmt.then_body:
            self.check_stmt(s)
        for s in stmt.else_body:
            self.check_stmt(s)

    def _check_Conditional(self, stmt):
        cond_type = self.check_expr(stmt.condition)
        if not compatible(BOOL, cond_type):
            raise TypeCheckError(
                "Conditional condition must be Bool, got %s"
                % cond_type.name)
        self.check_expr(stmt.action)

    def _check_Loop(self, stmt):
        for s in stmt.body:
            self.check_stmt(s)

    def _check_FunctionDef(self, stmt):
        self.push()
        self.in_function += 1
        for pname, ptype in stmt.params:
            self.declare(pname, Symbol(
                "param", self._resolve_type(ptype) if ptype else UNKNOWN))
        for s in stmt.body:
            self.check_stmt(s)
        self.in_function -= 1
        self.pop()

    def _check_Return(self, stmt):
        if self.in_function == 0:
            raise SemanticError("RETURN outside of a FUNCTION")
        if stmt.value is not None:
            self.check_expr(stmt.value)

    def _check_StructDef(self, stmt):
        return  # declared in _predeclare; fields resolved there

    def _check_EnumDef(self, stmt):
        return  # declared in _predeclare

    def _check_Import(self, stmt):
        return  # namespace binding created in _predeclare

    def _check_Intent(self, stmt):
        value_type = self.check_expr(stmt.value)
        if not compatible(STRING, value_type):
            raise TypeCheckError(
                "INTENT requires a String, got %s" % value_type.name)

    def _check_Call(self, stmt):
        # A bare call as a statement, e.g. Protect("archive").
        self.check_expr(stmt)

    # ------------------------------------------------------------ expressions
    def check_expr(self, expr):
        method = getattr(self, "_type_" + type(expr).__name__, None)
        if method is None:
            raise SemanticError("Checker has no rule for %s"
                                % type(expr).__name__)
        return method(expr)

    def _type_Literal(self, expr):
        return type_of_literal(expr.value)

    def _type_Name(self, expr):
        sym = self.lookup(expr.name)
        if sym is None:
            raise NameResolutionError("Undeclared name %r" % expr.name)
        if sym.kind in ("struct", "enum"):
            raise SemanticError(
                "%r is a %s, not a value" % (expr.name, sym.kind))
        if sym.kind == "namespace":
            raise SemanticError(
                "Namespace %r is a runtime extension and is not available "
                "in the MVP (spec section 54)" % expr.name)
        return sym.type

    def _type_BinOp(self, expr):
        left = self.check_expr(expr.left)
        right = self.check_expr(expr.right)
        if expr.op in ("AND", "OR"):
            if not compatible(BOOL, left) or not compatible(BOOL, right):
                raise TypeCheckError(
                    "%s requires Bool operands, got %s and %s"
                    % (expr.op, left.name, right.name))
            return BOOL
        if expr.op in ("EQ", "NEQ", "LT", "LE", "GT", "GE"):
            if left is not UNKNOWN and right is not UNKNOWN and left != right:
                raise TypeCheckError(
                    "Cannot compare %s with %s" % (left.name, right.name))
            return BOOL
        if expr.op in ("ADD", "SUB", "MUL", "DIV", "MOD"):
            if left is UNKNOWN or right is UNKNOWN:
                if expr.op == "ADD" and (left is STRING or right is STRING):
                    return STRING
                return UNKNOWN
            if left is STRING and right is STRING and expr.op == "ADD":
                return STRING
            if left is STRING or right is STRING:
                raise TypeCheckError(
                    "Cannot apply %s to String and %s"
                    % (expr.op, (right if left is STRING else left).name))
            if left is FLOAT or right is FLOAT:
                return FLOAT
            if left is INT and right is INT:
                return INT
            if left is UNKNOWN or right is UNKNOWN:
                return UNKNOWN
            raise TypeCheckError(
                "Cannot apply %s to %s and %s"
                % (expr.op, left.name, right.name))
        raise SemanticError("Unknown operator %r" % expr.op)

    def _type_UnaryOp(self, expr):
        operand = self.check_expr(expr.operand)
        if expr.op == "NOT":
            if not compatible(BOOL, operand):
                raise TypeCheckError("NOT requires Bool, got %s"
                                     % operand.name)
            return BOOL
        if expr.op == "NEG":
            if operand in (INT, FLOAT, UNKNOWN):
                return operand
            raise TypeCheckError("Unary - requires a number, got %s"
                                 % operand.name)
        raise SemanticError("Unknown unary operator %r" % expr.op)

    def _type_Call(self, expr):
        callee = expr.callee
        if isinstance(callee, A.MemberAccess):
            # Namespace calls (Memory.Query, ...) are runtime extensions.
            if isinstance(callee.obj, A.Name):
                sym = self.lookup(callee.obj.name)
                if sym is not None and sym.kind == "namespace":
                    raise SemanticError(
                        "Namespace %r is a runtime extension and is not "
                        "available in the MVP (spec section 54)"
                        % callee.obj.name)
            raise TypeCheckError("Cannot call a member of %s"
                                 % callee.obj)
        if not isinstance(callee, A.Name):
            raise TypeCheckError("Callee must be a named function")
        sym = self.lookup(callee.name)
        if sym is None:
            raise NameResolutionError("Call to undeclared function %r"
                                      % callee.name)
        if sym.kind == "var" and sym.type is UNKNOWN:
            # First-class function stored in a variable (spec section 9):
            # the static type is unknown, so arity cannot be checked here;
            # the interpreter checks it at call time.
            for arg in expr.args:
                self.check_expr(arg)
            return UNKNOWN
        if sym.kind != "func":
            raise SemanticError("%r is a %s, not a function"
                                % (callee.name, sym.kind))
        if sym.params and len(expr.args) != len(sym.params):
            raise TypeCheckError(
                "Function %r takes %d argument(s), got %d"
                % (callee.name, len(sym.params), len(expr.args)))
        for arg, (pname, ptype) in zip(expr.args, sym.params):
            arg_type = self.check_expr(arg)
            if ptype is not None and not compatible(ptype, arg_type):
                raise TypeCheckError(
                    "Argument %r of %r must be %s, got %s"
                    % (pname, callee.name, ptype.name, arg_type.name))
        return UNKNOWN  # MVP functions have no declared return type

    def _type_MemberAccess(self, expr):
        if isinstance(expr.obj, A.Name):
            sym = self.lookup(expr.obj.name)
            if sym is not None and sym.kind == "enum":
                if expr.member not in sym.type.members:
                    raise NameResolutionError(
                        "Enum %s has no member %r"
                        % (sym.type.name, expr.member))
                return sym.type
            if sym is not None and sym.kind == "namespace":
                raise SemanticError(
                    "Namespace %r is a runtime extension and is not "
                    "available in the MVP (spec section 54)"
                    % expr.obj.name)
            if sym is not None and sym.kind == "struct":
                raise SemanticError(
                    "%r is a struct type, not a value" % expr.obj.name)
        obj_type = self.check_expr(expr.obj)
        if obj_type.kind == "struct":
            if expr.member not in obj_type.fields:
                raise NameResolutionError(
                    "Struct %s has no field %r"
                    % (obj_type.name, expr.member))
            return obj_type.fields[expr.member]
        if obj_type.kind == "enum":
            if expr.member not in obj_type.members:
                raise NameResolutionError(
                    "Enum %s has no member %r"
                    % (obj_type.name, expr.member))
            return obj_type
        raise TypeCheckError(
            "Cannot access member %r of %s" % (expr.member, obj_type.name))


def check(program):
    """Run semantic analysis + type checking on a canonical AST."""
    return Checker().check(program)
