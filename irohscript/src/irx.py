"""IrohScript 3.0 — IRX emission (compiler pass 10).

IRX is the runtime representation (spec section 26): JSON, version
"3.0", opcode form. The mapping from IR:

    IR   {"op": "SET", "target": "X", "type": "Int", "value": 10}
    IRX  {"version": "3.0", "opcode": "SET", "register": "X",
          "type": "Int", "value": 10}

Every instruction dict carries "version": "3.0" and "opcode" in place of
"op"; "target" becomes "register". Nested expression dicts keep "op"
(they are expressions, not instructions). The document form is:

    {"version": "3.0", "program": [<instruction>, ...]}

Emission is deterministic: ``json.dumps(..., sort_keys=True)`` everywhere,
no timestamps, no dict-order dependence — the same source, version and
configuration always produce identical IRX (spec section 30).
"""

import json


def emit(ir):
    """Emit an IRX document (a dict) from optimized IR."""
    return {"version": "3.0",
            "program": [_emit_instr(instr) for instr in ir]}


def _emit_instr(instr):
    out = {"version": "3.0"}
    for key, value in instr.items():
        if key == "op":
            out["opcode"] = value
        elif key == "target":
            out["register"] = value
        elif key in ("then", "else", "body"):
            out[key] = [_emit_instr(i) for i in value]
        else:
            out[key] = value
    return out


def to_json(irx):
    """Serialize an IRX document deterministically."""
    return json.dumps(irx, sort_keys=True, indent=2)


def from_json(text):
    """Parse an IRX document (dict or JSON string)."""
    if isinstance(text, dict):
        return text
    return json.loads(text)
