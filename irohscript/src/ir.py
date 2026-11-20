"""IrohScript 3.0 — AST to IR lowering (compiler pass 9: IR generation).

IR is a list of instruction dicts. The shapes follow spec section 25:

    {"op": "SET", "target": "X", "type": "Int", "value": 10}

Expressions lower to nested dicts: {"op": "ADD", "left": ..., "right": ...},
{"op": "CALL", "name": ..., "args": [...]}, {"op": "LOAD", "name": ...},
{"op": "GET", "object": ..., "member": ...}. Control flow stays nested
(IF carries "then"/"else" instruction lists) — a tree IR, not flat
bytecode, which keeps the MVP interpreter a direct tree walk.

A Conditional lowers to an IF whose then-branch is a single ACTION:
the canonical form is preserved in the AST; the IR is where it becomes
executable control flow.
"""

from . import ast_nodes as A


def lower(program):
    """Lower a checked AST Program to a list of IR instructions."""
    out = []
    for stmt in program.statements:
        out.extend(lower_stmt(stmt))
    return out


def lower_stmt(stmt):
    if isinstance(stmt, A.Let):
        if stmt.value is None:
            # Default instance/value (spec section 12).
            return [{"op": "DEFAULT", "target": stmt.name,
                     "type": stmt.type_ann}]
        op = "CONST" if stmt.is_const else "SET"
        instr = {"op": op, "target": stmt.name,
                 "value": lower_expr(stmt.value)}
        if stmt.type_ann is not None:
            instr["type"] = stmt.type_ann
        return [instr]
    if isinstance(stmt, A.Assign):
        if isinstance(stmt.target, A.Name):
            return [{"op": "SET", "target": stmt.target.name,
                     "value": lower_expr(stmt.value)}]
        return [{"op": "SETFIELD",
                 "object": lower_expr(stmt.target.obj),
                 "field": stmt.target.member,
                 "value": lower_expr(stmt.value)}]
    if isinstance(stmt, A.Print):
        return [{"op": "PRINT", "value": lower_expr(stmt.value)}]
    if isinstance(stmt, A.Action):
        return [{"op": "ACTION", "value": lower_expr(stmt.value)}]
    if isinstance(stmt, A.If):
        return [{"op": "IF", "cond": lower_expr(stmt.cond),
                 "then": _lower_block(stmt.then_body),
                 "else": _lower_block(stmt.else_body)}]
    if isinstance(stmt, A.Conditional):
        return [{"op": "IF", "cond": lower_expr(stmt.condition),
                 "then": [{"op": "ACTION",
                           "value": lower_expr(stmt.action)}],
                 "else": []}]
    if isinstance(stmt, A.Loop):
        return [{"op": "LOOP", "body": _lower_block(stmt.body)}]
    if isinstance(stmt, A.FunctionDef):
        return [{"op": "FUNCDEF", "name": stmt.name,
                 "params": [{"name": n, "type": t}
                            for n, t in stmt.params],
                 "body": _lower_block(stmt.body)}]
    if isinstance(stmt, A.Return):
        value = lower_expr(stmt.value) if stmt.value is not None else None
        return [{"op": "RETURN", "value": value}]
    if isinstance(stmt, A.StructDef):
        return [{"op": "STRUCTDEF", "name": stmt.name,
                 "fields": [{"name": n, "type": t}
                            for n, t in stmt.fields]}]
    if isinstance(stmt, A.EnumDef):
        return [{"op": "ENUMDEF", "name": stmt.name,
                 "members": list(stmt.members)}]
    if isinstance(stmt, A.Import):
        return [{"op": "IMPORT", "name": stmt.name}]
    if isinstance(stmt, A.Intent):
        return [{"op": "INTENT", "value": lower_expr(stmt.value)}]
    if isinstance(stmt, A.Call):
        # A bare call as a statement (e.g. Protect("archive")).
        return [{"op": "CALLSTMT", "value": lower_expr(stmt)}]
    raise ValueError("Cannot lower %s" % type(stmt).__name__)


def _lower_block(body):
    out = []
    for stmt in body:
        out.extend(lower_stmt(stmt))
    return out


def lower_expr(expr):
    if isinstance(expr, A.Literal):
        return {"op": "LIT", "value": expr.value,
                "type": expr.type_name}
    if isinstance(expr, A.Name):
        return {"op": "LOAD", "name": expr.name}
    if isinstance(expr, A.BinOp):
        return {"op": expr.op, "left": lower_expr(expr.left),
                "right": lower_expr(expr.right)}
    if isinstance(expr, A.UnaryOp):
        return {"op": expr.op, "operand": lower_expr(expr.operand)}
    if isinstance(expr, A.Call):
        callee = expr.callee
        if isinstance(callee, A.Name):
            name = callee.name
        elif isinstance(callee, A.MemberAccess):
            name = "%s.%s" % (_member_base(callee), callee.member)
        else:
            raise ValueError("Unsupported callee in CALL")
        return {"op": "CALL", "name": name,
                "args": [lower_expr(a) for a in expr.args]}
    if isinstance(expr, A.MemberAccess):
        return {"op": "GET", "object": lower_expr(expr.obj),
                "member": expr.member}
    raise ValueError("Cannot lower expression %s" % type(expr).__name__)


def _member_base(access):
    if isinstance(access.obj, A.Name):
        return access.obj.name
    if isinstance(access.obj, A.MemberAccess):
        return "%s.%s" % (_member_base(access.obj), access.obj.member)
    raise ValueError("Unsupported member base")
