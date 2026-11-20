"""IrohScript 3.0 — package entry point."""

from .bridge import IrohRuntime
from .compiler import IrohCompiler, CompilationResult
from .irohcore import IrohCore

__all__ = ["IrohRuntime", "IrohCompiler", "IrohCore", "CompilationResult"]
__version__ = "3.0"
