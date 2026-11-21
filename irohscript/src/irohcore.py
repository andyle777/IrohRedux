"""IrohScript 3.0 — IrohCore (the heart, spec section 5).

IrohCore is the foundation the compiler is built on. In the MVP it owns
exactly two things, and nothing it does not own yet:

1. Canonicalization — the heart of the language is that the BASIC form
   and the legacy Iroh form mean the same thing. ``IF x ACTION y END IF``
   canonicalizes to the same Conditional node that ``x -> y`` parses to
   directly (spec section 7). Canonicalization also normalises
   single-action IFs so the rest of the pipeline sees one shape.

2. The intent graph — INTENT statements (spec section 10) enter the
   semantic pipeline here. An intent is recorded as text plus its origin;
   what consumes intents (embeddings, RLM, agents) is a runtime extension
   and is NOT built in the MVP. IrohCore records intent; it does not
   interpret it.

Deliberately NOT owned by IrohCore in the MVP: memory (Chroma), identity
management beyond the IDENTITY_ROOT constant, branches, dreams, pillars,
emotion. Those are runtime extensions (spec section 54).
"""

from . import ast_nodes as A


class IrohCore:
    """The symbolic intent heart of IrohScript."""

    VERSION = "3.0"

    def __init__(self):
        self.intents = []          # [{"text": str, "origin": str}]
        self.identity_root = None  # set from CONST IDENTITY_ROOT, if any

    # ------------------------------------------------------- canonicalization
    def canonicalize(self, program):
        """Walk the AST, converting single-action IFs to Conditionals."""
        return A.Program([self._canon_stmt(s) for s in program.statements])

    def _canon_block(self, body):
        return [self._canon_stmt(s) for s in body]

    def _canon_stmt(self, stmt):
        if isinstance(stmt, A.If):
            then_body = self._canon_block(stmt.then_body)
            else_body = self._canon_block(stmt.else_body)
            if len(then_body) == 1 and isinstance(then_body[0], A.Action) \
                    and not else_body:
                return A.Conditional(stmt.cond, then_body[0].value)
            return A.If(stmt.cond, then_body, else_body)
        if isinstance(stmt, A.FunctionDef):
            return A.FunctionDef(stmt.name, stmt.params,
                                 self._canon_block(stmt.body))
        if isinstance(stmt, A.Loop):
            # Amendment A1: keep the conditional's cond through
            # canonicalization (bare LOOP stays cond None).
            return A.Loop(self._canon_block(stmt.body), stmt.cond)
        return stmt

    # ------------------------------------------------------------- intents
    def record_intent(self, text, origin="program"):
        """Record an intent in the graph. Returns the recorded entry."""
        entry = {"text": text, "origin": origin}
        self.intents.append(entry)
        return entry

    def set_identity_root(self, value):
        self.identity_root = value
