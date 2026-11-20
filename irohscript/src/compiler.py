"""IrohScript 3.0 — the built-in compiler (spec sections 18, 23).

Pipeline (each pass independently testable):

    source
      -> lexing            (lexer.lex)
      -> parsing + AST     (parser.parse)
      -> canonicalization  (IrohCore.canonicalize — the heart)
      -> semantic analysis + type checking + name resolution
                           (checker.check)
      -> IR generation     (ir.lower)
      -> optimization      (optimizer.optimize — folding + DCE)
      -> IRX emission      (irx.emit)

No LLM anywhere in the compiler (spec section 31): known syntax goes
through the deterministic parser, full stop. The compiler is
deterministic (spec section 30): same source + version + config gives
identical IRX, because nothing in the pipeline reads the clock, the
environment, or a dict ordering.
"""

from . import ir as ir_mod
from . import irx as irx_mod
from . import optimizer
from .checker import check
from .irohcore import IrohCore
from .parser import parse


class CompilationResult:
    """Everything COMPILE "program.iroh" returns (spec section 19)."""

    def __init__(self, ast, ir, irx_doc, warnings, core):
        self.ast = ast
        self.ir = ir
        self.irx = irx_doc
        self.warnings = list(warnings)
        self.core = core

    @property
    def errors(self):
        return []  # errors raise; a result only exists on success

    def to_dict(self):
        return {"version": "3.0",
                "ast": self.ast.to_dict(),
                "ir": self.ir,
                "irx": self.irx,
                "warnings": self.warnings,
                "metadata": {"intents_recorded": len(self.core.intents),
                             "identity_root": self.core.identity_root}}


class IrohCompiler:
    """The built-in compiler. Part of the runtime (spec section 18)."""

    VERSION = "3.0"

    def __init__(self, core=None):
        self.core = core or IrohCore()

    def compile(self, source):
        """Compile source text. Raises CompileError on failure."""
        ast = parse(source)
        ast = self.core.canonicalize(ast)
        check(ast)
        ir = ir_mod.lower(ast)
        ir = optimizer.optimize(ir)
        irx_doc = irx_mod.emit(ir)
        warnings = self._warnings(ast)
        return CompilationResult(ast, ir, irx_doc, warnings, self.core)

    def compile_file(self, path):
        with open(path, "r", encoding="utf-8") as handle:
            return self.compile(handle.read())

    def _warnings(self, ast):
        """Non-fatal notes. The MVP emits one: legacy dialect use is
        valid but the canonical language is BASIC-first (spec section 6)."""
        from . import ast_nodes as A
        warnings = []

        def walk(stmts):
            for stmt in stmts:
                if isinstance(stmt, A.Conditional):
                    warnings.append(
                        "Legacy Iroh dialect used (\"->\"); canonical "
                        "language is BASIC-first (spec section 6).")
                for body in (getattr(stmt, "then_body", []),
                             getattr(stmt, "else_body", []),
                             getattr(stmt, "body", [])):
                    walk(body)

        walk(ast.statements)
        return warnings
