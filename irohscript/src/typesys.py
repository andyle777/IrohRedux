"""IrohScript 3.0 — type system (compiler pass 5: type checking).

Types (spec sections 11-13):

    Int, String, Float, Bool            (primitives)
    STRUCT types, e.g. AgentState       (named, with typed fields)
    ENUM types, e.g. BranchState        (named, with members)
    Vector<T>                           (generic; declared, not constructed
                                         in the MVP — see README)
    ILander, Memory                     (named types the compiler knows;
                                         constructing them is a runtime
                                         extension)

Rules (MVP, documented in the README — the spec does not pin these down,
so they are stated here and listed as open design questions where they
are genuinely a choice):
  - Assignment requires an exact type match; Unknown (an unannotated
    function parameter, or a value whose type cannot be known statically)
    is compatible with everything.
  - Int and Float are distinct types: no implicit numeric coercion.
  - ``+`` on Int+Int is Int; on Float (either side) is Float; on
    String+String is String. Anything else is a type error.
  - Comparisons return Bool; AND/OR/NOT require Bool.
  - A value of a STRUCT type can only be built by ``LET x : T`` (default
    instance) in the MVP; there is no struct literal syntax in the spec.
"""

PRIMITIVES = {"Int", "String", "Float", "Bool"}
RUNTIME_TYPES = {"ILander", "Memory"}  # known names; construction is later


class Type:
    """A type. ``name`` is the declared name; ``kind`` disambiguates."""

    def __init__(self, name, kind="primitive", fields=None, members=None,
                 args=None):
        self.name = name
        self.kind = kind  # primitive | struct | enum | generic | unknown | runtime
        self.fields = fields or {}    # struct: {field: Type}
        self.members = members or []  # enum: [member, ...]
        self.args = args or []        # generic: [Type, ...]

    def __repr__(self):
        return "Type(%s)" % self.name

    def __eq__(self, other):
        return (isinstance(other, Type) and self.name == other.name
                and self.kind == other.kind)

    def __hash__(self):
        return hash((self.name, self.kind))


UNKNOWN = Type("Unknown", kind="unknown")
INT = Type("Int")
STRING = Type("String")
FLOAT = Type("Float")
BOOL = Type("Bool")

_BY_NAME = {"Int": INT, "String": STRING, "Float": FLOAT, "Bool": BOOL}


def parse_type_name(text, declared_types):
    """Resolve a type annotation string to a Type.

    ``declared_types`` maps struct/enum names to their Type objects.
    Raises ValueError for an unknown type name.
    """
    text = text.strip()
    if "<" in text:
        base, rest = text.split("<", 1)
        inner = rest.rstrip(">").strip()
        args = [parse_type_name(a.strip(), declared_types)
                for a in _split_top(inner)]
        if base not in ("Vector",):
            raise ValueError("Unknown generic type %r" % base)
        return Type(text, kind="generic", args=args)
    if text in _BY_NAME:
        return _BY_NAME[text]
    if text in declared_types:
        return declared_types[text]
    if text in RUNTIME_TYPES:
        return Type(text, kind="runtime")
    raise ValueError("Unknown type %r" % text)


def _split_top(text):
    parts, depth, current = [], 0, ""
    for ch in text:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current)
    return parts


def compatible(expected, actual):
    """True if a value of type `actual` may fill a slot of `expected`."""
    if expected is UNKNOWN or actual is UNKNOWN:
        return True
    return expected == actual


def type_of_literal(value):
    if isinstance(value, bool):
        return BOOL
    if isinstance(value, int):
        return INT
    if isinstance(value, float):
        return FLOAT
    if isinstance(value, str):
        return STRING
    return UNKNOWN


def default_value(type_obj):
    """The default value for a LET of a STRUCT type (fields defaulted)."""
    if type_obj is INT:
        return 0
    if type_obj is FLOAT:
        return 0.0
    if type_obj is STRING:
        return ""
    if type_obj is BOOL:
        return False
    return None
