"""IrohScript 3.0 — AST nodes (compiler passes 2-3: parsing, AST).

Every node is a dataclass with a ``to_dict()`` form so the AST is
JSON-serialisable: the golden tests (spec section 50) store the expected
AST for each construct and compare it exactly.

Node shapes follow the spec:
  - Section 24: ``LET X : Int = 10`` becomes
    Assignment(Name X, Type Int, Value 10).
  - Section 7: both ``enemy -> defend`` and
    ``IF enemy ACTION defend END IF`` become
    Conditional(condition = enemy, action = defend).

A note on ACTION: a bare identifier after ACTION names the action symbol
itself (``ACTION defend`` means the action "defend", matching the legacy
``enemy -> defend`` where ``defend`` is a symbol, not a variable). Quoted
strings and other expressions evaluate normally. This rule is what makes
the legacy and BASIC forms produce identical Conditional nodes.
"""

from dataclasses import dataclass, field


def _d(node):
    return node.to_dict() if hasattr(node, "to_dict") else node


@dataclass
class Program:
    statements: list = field(default_factory=list)

    def to_dict(self):
        return {"node": "Program",
                "statements": [_d(s) for s in self.statements]}


@dataclass
class Literal:
    value: object
    type_name: str = None  # inferred literal type: Int / Float / String / Bool

    def to_dict(self):
        return {"node": "Literal", "value": self.value,
                "type": self.type_name}


@dataclass
class Name:
    name: str

    def to_dict(self):
        return {"node": "Name", "name": self.name}


@dataclass
class BinOp:
    op: str  # ADD SUB MUL DIV MOD EQ NEQ LT LE GT GE AND OR
    left: object
    right: object

    def to_dict(self):
        return {"node": "BinOp", "op": self.op,
                "left": _d(self.left), "right": _d(self.right)}


@dataclass
class UnaryOp:
    op: str  # NOT NEG
    operand: object

    def to_dict(self):
        return {"node": "UnaryOp", "op": self.op,
                "operand": _d(self.operand)}


@dataclass
class Call:
    callee: object  # Name or MemberAccess
    args: list = field(default_factory=list)

    def to_dict(self):
        return {"node": "Call", "callee": _d(self.callee),
                "args": [_d(a) for a in self.args]}


@dataclass
class MemberAccess:
    obj: object
    member: str

    def to_dict(self):
        return {"node": "MemberAccess", "object": _d(self.obj),
                "member": self.member}


# ---------------------------------------------------------------- statements

@dataclass
class Let:
    name: str
    type_ann: str  # may be None (inferred)
    value: object
    is_const: bool = False

    def to_dict(self):
        return {"node": "Const" if self.is_const else "Let",
                "name": self.name, "type": self.type_ann,
                "value": _d(self.value)}


@dataclass
class Assign:
    target: object  # Name or MemberAccess
    value: object

    def to_dict(self):
        return {"node": "Assign", "target": _d(self.target),
                "value": _d(self.value)}


@dataclass
class Print:
    value: object

    def to_dict(self):
        return {"node": "Print", "value": _d(self.value)}


@dataclass
class Action:
    value: object  # usually Literal("defend") — an action symbol

    def to_dict(self):
        return {"node": "Action", "value": _d(self.value)}


@dataclass
class If:
    cond: object
    then_body: list = field(default_factory=list)
    else_body: list = field(default_factory=list)

    def to_dict(self):
        return {"node": "If", "cond": _d(self.cond),
                "then": [_d(s) for s in self.then_body],
                "else": [_d(s) for s in self.else_body]}


@dataclass
class Conditional:
    """Canonical form of ``IF x ACTION y END IF`` and of ``x -> y``.

    Section 7: both spellings produce this one node.
    """
    condition: object
    action: object

    def to_dict(self):
        return {"node": "Conditional", "condition": _d(self.condition),
                "action": _d(self.action)}


@dataclass
class Loop:
    body: list = field(default_factory=list)
    # Amendment A1 (2026-11-21): LOOP <Bool-expr> is the decided
    # conditional form; the legacy bare LOOP keeps cond None. Not
    # serialized in to_dict (golden AST files stay byte-stable).
    cond: object = None

    def to_dict(self):
        return {"node": "Loop", "body": [_d(s) for s in self.body]}


@dataclass
class FunctionDef:
    name: str
    params: list = field(default_factory=list)  # [(name, type|None)]
    body: list = field(default_factory=list)

    def to_dict(self):
        return {"node": "FunctionDef", "name": self.name,
                "params": [{"name": n, "type": t} for n, t in self.params],
                "body": [_d(s) for s in self.body]}


@dataclass
class Return:
    value: object  # may be None (bare RETURN)

    def to_dict(self):
        return {"node": "Return", "value": _d(self.value)}


@dataclass
class StructDef:
    name: str
    fields: list = field(default_factory=list)  # [(name, type)]

    def to_dict(self):
        return {"node": "StructDef", "name": self.name,
                "fields": [{"name": n, "type": t} for n, t in self.fields]}


@dataclass
class EnumDef:
    name: str
    members: list = field(default_factory=list)

    def to_dict(self):
        return {"node": "EnumDef", "name": self.name,
                "members": list(self.members)}


@dataclass
class Import:
    name: str

    def to_dict(self):
        return {"node": "Import", "name": self.name}


@dataclass
class Intent:
    value: object

    def to_dict(self):
        return {"node": "Intent", "value": _d(self.value)}
