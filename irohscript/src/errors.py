"""IrohScript 3.0 — error types.

The spec (section 42) separates compiler errors from runtime errors:

    CompileError
    RuntimeError
    ProviderError
    MemoryError
    AuthorizationError

The MVP implements CompileError (with LexError / ParseError / SemanticError /
TypeCheckError / NameResolutionError as subclasses) and RuntimeError.
ProviderError, MemoryError and AuthorizationError belong to the runtime
extensions (LLM providers, Chroma memory, capabilities) which are NOT part
of the section 54 minimum viable system, so they are declared here for the
shape of the API but never raised by the MVP compiler.
"""


class IrohError(Exception):
    """Base class for every IrohScript error."""


class CompileError(IrohError):
    """A compile-time error. Carries the source line when known."""

    def __init__(self, message, line=None):
        self.line = line
        where = " on line %d" % line if line is not None else ""
        super().__init__("%s%s" % (message, where))
        self.message = message


class LexError(CompileError):
    """Lexing failed: an unrecognised character or unterminated string."""


class ParseError(CompileError):
    """Parsing failed: the token stream does not match the grammar."""


class SemanticError(CompileError):
    """Semantic analysis failed (e.g. a CONST mutation attempt)."""


class TypeCheckError(CompileError):
    """Type checking failed (e.g. LET X : Int = "hello")."""


class NameResolutionError(CompileError):
    """Name resolution failed (e.g. use of an undeclared name)."""


class RuntimeError_(IrohError):
    """A runtime error raised while executing IRX.

    Named RuntimeError_ to avoid shadowing Python's builtin RuntimeError.
    The public name exposed to embedders is IrohRuntimeError (alias below).
    """

    def __init__(self, message):
        super().__init__(message)
        self.message = message


IrohRuntimeError = RuntimeError_


# Declared for the shape of the section 42 error taxonomy. Not raised by
# the MVP: they belong to the runtime extensions (providers, memory,
# capabilities) listed in spec section 54 as later work.
class ProviderError(IrohError):
    """An LLM provider failed (runtime extension, not MVP)."""


class MemoryError_(IrohError):
    """A memory-backend operation failed (runtime extension, not MVP)."""


class AuthorizationError(IrohError):
    """A capability check failed (runtime extension, not MVP)."""
