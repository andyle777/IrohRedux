"""IrohScript 3.0 — Python bridge (spec section 47).

Python remains the preferred experimental integration layer:

    class IrohRuntime:
        def execute(self, irx):
            ...

``execute`` takes an IRX document (a dict, or its JSON text) and runs it.
``run_source`` compiles IrohScript source and runs it in one step.
External Python libraries plug in through adapters later; the bridge
itself is deliberately tiny and has no third-party dependencies.
"""

from .compiler import IrohCompiler
from .interpreter import Interpreter
from .irohcore import IrohCore
from .irx import from_json


class IrohRuntime:
    """The Python bridge: compile IrohScript, execute IRX."""

    VERSION = "3.0"

    def __init__(self):
        self.core = IrohCore()
        self.compiler = IrohCompiler(self.core)

    def execute(self, irx):
        """Execute an IRX document (dict or JSON string).

        Returns {"output": [...], "actions": [...], "intents": [...],
        "variables": {...}}. A fresh interpreter runs each call, so
        repeated executions do not share state; the IrohCore intent
        graph persists across calls on the same runtime.
        """
        doc = from_json(irx)
        interpreter = Interpreter(self.core)
        return interpreter.execute(doc)

    def run_source(self, source):
        """Compile source text and execute the resulting IRX."""
        result = self.compiler.compile(source)
        outcome = self.execute(result.irx)
        outcome["irx"] = result.irx
        outcome["warnings"] = result.warnings
        return outcome

    def compile(self, source):
        """Compile source text and return the CompilationResult."""
        return self.compiler.compile(source)
