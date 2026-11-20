"""IrohScript 3.0 — optimizer (compiler pass 8).

Two passes, exactly as the spec defines them:

  - Constant folding (section 27): ``LET X = 10 + 20`` becomes ``X = 30``
    before execution. Any BinOp/UnaryOp whose operands are all literals
    folds to a single literal. Division or modulo by zero is NOT folded
    (the runtime error must still fire), and string ``+`` folds only
    String + String.
  - Dead code elimination (section 28): ``IF FALSE ... END IF`` is
    removed; ``IF TRUE ... END IF`` is replaced by its then-branch;
    statements after a RETURN in the same block are removed.

The optimizer runs on the IR, after type checking, so folded values keep
the types the checker already approved. It is deterministic: same IR in,
same IR out.
"""

from .typesys import type_of_literal

_BINOPS = {
    "ADD": lambda a, b: a + b,
    "SUB": lambda a, b: a - b,
    "MUL": lambda a, b: a * b,
    "DIV": lambda a, b: a / b,
    "MOD": lambda a, b: a % b,
    "EQ": lambda a, b: a == b,
    "NEQ": lambda a, b: a != b,
    "LT": lambda a, b: a < b,
    "LE": lambda a, b: a <= b,
    "GT": lambda a, b: a > b,
    "GE": lambda a, b: a >= b,
    "AND": lambda a, b: a and b,
    "OR": lambda a, b: a or b,
}


def optimize(ir):
    """Optimize a list of IR instructions. Returns a new list."""
    return _optimize_block(ir)


def _optimize_block(block):
    out = []
    for instr in block:
        optimized = _optimize_instr(instr)
        if optimized is None:
            continue  # eliminated
        if isinstance(optimized, list):
            out.extend(optimized)  # spliced (IF TRUE -> then-branch)
        else:
            out.append(optimized)
        if optimized is not None and isinstance(optimized, dict) \
                and optimized.get("op") == "RETURN":
            break  # dead code after RETURN
    return out


def _optimize_instr(instr):
    op = instr.get("op")
    if op == "DEFAULT":
        return dict(instr)
    if op in ("SET", "CONST", "PRINT", "ACTION", "INTENT"):
        folded = dict(instr)
        folded["value"] = fold_expr(instr["value"])
        return folded
    if op == "SETFIELD":
        folded = dict(instr)
        folded["object"] = fold_expr(instr["object"])
        folded["value"] = fold_expr(instr["value"])
        return folded
    if op == "RETURN":
        folded = dict(instr)
        if instr.get("value") is not None:
            folded["value"] = fold_expr(instr["value"])
        return folded
    if op == "CALLSTMT":
        folded = dict(instr)
        folded["value"] = fold_expr(instr["value"])
        return folded
    if op == "IF":
        cond = fold_expr(instr["cond"])
        if _is_literal(cond, False):
            return None  # IF FALSE: the whole branch is dead code
        if _is_literal(cond, True):
            return _optimize_block(instr["then"])  # splice then-branch
        folded = dict(instr)
        folded["cond"] = cond
        folded["then"] = _optimize_block(instr["then"])
        folded["else"] = _optimize_block(instr["else"])
        return folded
    if op == "LOOP":
        folded = dict(instr)
        folded["body"] = _optimize_block(instr["body"])
        return folded
    if op == "FUNCDEF":
        folded = dict(instr)
        folded["body"] = _optimize_block(instr["body"])
        return folded
    return dict(instr)


def _is_literal(expr, value):
    return (isinstance(expr, dict) and expr.get("op") == "LIT"
            and expr.get("value") is value)


def fold_expr(expr):
    """Fold a constant expression to a literal where possible."""
    if not isinstance(expr, dict):
        return expr
    op = expr.get("op")
    if op in _BINOPS:
        left = fold_expr(expr["left"])
        right = fold_expr(expr["right"])
        if left.get("op") == "LIT" and right.get("op") == "LIT":
            a, b = left["value"], right["value"]
            if op in ("DIV", "MOD") and b == 0:
                return {"op": op, "left": left, "right": right}
            if op == "ADD" and isinstance(a, str) and isinstance(b, str):
                pass  # string concat folds
            elif op in ("ADD", "SUB", "MUL", "DIV", "MOD") and \
                    (isinstance(a, str) or isinstance(b, str)):
                return {"op": op, "left": left, "right": right}
            elif op in ("AND", "OR") and \
                    (not isinstance(a, bool) or not isinstance(b, bool)):
                return {"op": op, "left": left, "right": right}
            elif op in ("LT", "LE", "GT", "GE", "EQ", "NEQ") and \
                    type(a) is not type(b) and \
                    not (isinstance(a, (int, float))
                         and isinstance(b, (int, float))):
                return {"op": op, "left": left, "right": right}
            try:
                value = _BINOPS[op](a, b)
            except Exception:
                return {"op": op, "left": left, "right": right}
            if isinstance(value, bool):
                lit_type = "Bool"
            elif isinstance(value, int):
                lit_type = "Int"
            elif isinstance(value, float):
                lit_type = "Float"
            elif isinstance(value, str):
                lit_type = "String"
            else:
                return {"op": op, "left": left, "right": right}
            return {"op": "LIT", "value": value, "type": lit_type}
        return {"op": op, "left": left, "right": right}
    if op == "NOT":
        operand = fold_expr(expr["operand"])
        if operand.get("op") == "LIT" and isinstance(operand["value"], bool):
            return {"op": "LIT", "value": not operand["value"],
                    "type": "Bool"}
        return {"op": "NOT", "operand": operand}
    if op == "NEG":
        operand = fold_expr(expr["operand"])
        if operand.get("op") == "LIT" and \
                isinstance(operand["value"], (int, float)):
            value = -operand["value"]
            return {"op": "LIT", "value": value,
                    "type": type_of_literal(value).name}
        return {"op": "NEG", "operand": operand}
    if op == "CALL":
        folded = dict(expr)
        folded["args"] = [fold_expr(a) for a in expr["args"]]
        return folded
    if op == "GET":
        folded = dict(expr)
        folded["object"] = fold_expr(expr["object"])
        return folded
    return dict(expr)
