"""IrohScript tracer — run an IrohScript program through the
interpreter and stream IrohRedux trace events as JSON lines, in the
same shape the JavaScript CLI emits and the native Python tracer
emits (python/iroh/trace.py), so Iroh.analyze() works unchanged:

    {"type":"event","event":"FUNCTION_CALL","category":"CALL",
     "trigger":"before","hash":123456,"indent":0,"name":"Add",
     "arguments":[10,20],"file":"add.iroh"}
    ...
    {"type":"result","value":null}

How it works: TracingInterpreter subclasses the IRX interpreter and
hooks the points the analyzer reads — function calls (FUNCTION_CALL /
FUNCTION_ENTER / FUNCTION_CALL_END / FUNCTION_LEAVE, with the call
depth as ``indent``), IF conditions (IF_TEST with the Bool value), and
assignments (ASSIGN with the post-assignment value). PRINT/ACTION
output is collected by the interpreter and written to stderr after
the run, so the JSONL stream on stdout stays clean.

Hashes are CRC32 of kind:file:path, where the path is the
instruction's index path through the IRX tree ("0.2.then.1"). IRX
carries no source positions, so the path is the site identity; it is
deterministic because compilation is deterministic (spec section 30).
A function body is always traced under its definition path, not the
call site, so one branch is one site no matter how many callers it
has. The analyzer's one-sided-branch and deep-recursion findings
read these events directly.

What v1 does NOT see (stated plainly, not hidden):
- LOOP: the spec shows the form but no exit rule, so executing one
  raises a clear error naming it as an open design question — there
  is no LOOP_TEST to emit, and HOT_LOOP / ZERO_ITERATION_LOOP can
  never fire for IrohScript until the LOOP rule is decided.
- INTENT records in the IrohCore graph but has no event category, so
  it is invisible in the trace (like PRINT, it is program output,
  not control flow).
- A call that raises emits FUNCTION_CALL / FUNCTION_ENTER but no
  CALL_END / LEAVE: the frame exited by throwing, not by returning.
  The error line at the end of the stream is the record of it.
- GOTO does not exist in IrohScript; there is nothing to trace for it.

Usage:
    python3 -m src.trace [--events CALL,IF,ASSIGN] prog.iroh
    python3 -m src.trace -c "LET X : Int = 10"
"""

import os
import sys

# Allow running as a script (python3 irohscript/src/trace.py) as well
# as a module (python3 -m src.trace from the irohscript directory).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.bridge import IrohRuntime  # noqa: E402
from src.errors import CompileError  # noqa: E402
from src.interpreter import FunctionValue, Interpreter  # noqa: E402
from src.traceutil import EventSink, cli_main, error_name, safe_value, site_hash  # noqa: E402

__all__ = ["TracingInterpreter", "trace_source", "trace_file", "main"]

# Categories this tracer can emit.
EMITTED_CATEGORIES = {"CALL", "FUNCTION", "IF", "ASSIGN"}


class TracingInterpreter(Interpreter):
    """The IRX interpreter, with event hooks for the analyzer.

    ``sink`` is an EventSink; ``filename`` is the traced file (its
    basename goes on call events, like the Python tracer).
    """

    def __init__(self, core, filename, sink):
        super().__init__(core)
        self.filename = filename
        self.basename = filename.rsplit("/", 1)[-1]
        self.sink = sink
        self._depth = 0
        self._path = []  # index path of the instruction now executing
        self._func_paths = {}  # id(FunctionValue) -> definition path

    # ------------------------------------------------------------ paths
    def _hash(self, kind):
        site = ".".join(str(p) for p in self._path)
        return site_hash(kind, self.filename, site)

    def _exec_block(self, instrs, env):
        base = list(self._path)
        try:
            for ii, instr in enumerate(instrs):
                self._path = base + [ii]
                self._exec_instr(instr, env)
        finally:
            self._path = base

    # ------------------------------------------------------------ statements
    def _do_IF(self, instr, env):
        cond = self._eval(instr["cond"], env)
        if not isinstance(cond, bool):
            from src.errors import RuntimeError_ as IrohRuntimeError
            raise IrohRuntimeError("IF condition is not a Bool")
        self.sink.emit("IF_TEST", "IF", "test", self._hash("if"),
                       self._depth, value=bool(cond), kind="If",
                       file=self.basename)
        branch = instr["then"] if cond else instr["else"]
        saved = self._path
        self._path = saved + ["then" if cond else "else"]
        try:
            self._exec_block(branch, env)
        finally:
            self._path = saved

    def _do_FUNCDEF(self, instr, env):
        super()._do_FUNCDEF(instr, env)
        func = env.lookup(instr["name"])
        self._func_paths[id(func)] = list(self._path)

    def _do_SET(self, instr, env):
        super()._do_SET(instr, env)
        value = env.lookup(instr["register"])
        self.sink.emit("ASSIGN", "ASSIGN", "assign", self._hash("assign"),
                       self._depth, name=instr["register"],
                       value=safe_value(value), result=safe_value(value),
                       op="=", object=instr["register"], kind="Set",
                       file=self.basename)

    def _do_CONST(self, instr, env):
        super()._do_CONST(instr, env)
        value = env.lookup(instr["register"])
        self.sink.emit("ASSIGN", "ASSIGN", "assign", self._hash("assign"),
                       self._depth, name=instr["register"],
                       value=safe_value(value), result=safe_value(value),
                       op="const", object=instr["register"], kind="Const",
                       file=self.basename)

    def _do_SETFIELD(self, instr, env):
        super()._do_SETFIELD(instr, env)
        obj = self._eval(instr["object"], env)
        value = obj.fields[instr["field"]]
        self.sink.emit("ASSIGN", "ASSIGN", "assign", self._hash("assign"),
                       self._depth, name=instr["field"],
                       value=safe_value(value), result=safe_value(value),
                       op="=", object="%s.%s" % (obj.type_name, instr["field"]),
                       kind="SetField", file=self.basename)

    # ------------------------------------------------------------ calls
    def _call(self, expr, env):
        name = expr["name"]
        # Find the function first so the body traces under its
        # definition path; anything that is not a plain function value
        # (struct default construction, a bad call) runs uninstrumented
        # through the base implementation, which raises the real error.
        func = None
        try:
            found = env.lookup(name)
            if isinstance(found, FunctionValue):
                func = found
        except Exception:
            func = None
        if func is None:
            return super()._call(expr, env)
        args = [self._eval(a, env) for a in expr["args"]]
        if len(args) != len(func.params):
            # Arity error: let the base implementation raise it, with
            # no events — the call never entered.
            return super()._call(expr, env)
        hash_ = site_hash("func", self.filename,
                          ".".join(str(p) for p in
                                   self._func_paths.get(id(func), [name])))
        self.sink.emit("FUNCTION_CALL", "CALL", "before", hash_,
                       self._depth, name=name,
                       arguments=[safe_value(a) for a in args],
                       file=self.basename)
        self.sink.emit("FUNCTION_ENTER", "FUNCTION", "enter", hash_,
                       self._depth, name=name, file=self.basename)
        self._depth += 1
        saved_path = self._path
        def_path = self._func_paths.get(id(func))
        if def_path is not None:
            self._path = list(def_path) + ["body"]
        try:
            ret = super()._call(expr, env)
        except BaseException:
            # The call threw: no CALL_END / LEAVE — the frame exited by
            # throwing, not by returning. The error line records it.
            self._depth -= 1
            self._path = saved_path
            raise
        self._depth -= 1
        self._path = saved_path
        self.sink.emit("FUNCTION_CALL_END", "CALL", "after", hash_,
                       self._depth, name=name,
                       **{"return": safe_value(ret)}, file=self.basename)
        self.sink.emit("FUNCTION_LEAVE", "FUNCTION", "leave", hash_,
                       self._depth, name=name, file=self.basename)
        return ret


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

def trace_source(source, filename="<iroh>", events=None):
    """Trace IrohScript ``source``; returns (events, error).

    ``events`` is a list of event dicts in the CLI's JSONL shape.
    ``error`` is None on success, else {"name": ..., "message": ...}.
    The program runs in-process; its PRINT/ACTION output goes to
    stderr while it runs so the caller's stdout stays a clean event
    channel.
    """
    sink = EventSink(events)
    runtime = IrohRuntime()
    try:
        result = runtime.compile(source)
    except CompileError as exc:
        # The precise subclass (TypeCheckError, ParseError, ...) is
        # the useful name, not the CompileError base.
        return [], {"name": type(exc).__name__, "message": str(exc)}
    except BaseException as exc:  # noqa: BLE001 — the tracer reports, never crashes
        return [], {"name": error_name(exc), "message": str(exc)}
    interp = TracingInterpreter(runtime.core, filename, sink)
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        outcome = interp.execute(result.irx)
    except BaseException as exc:  # noqa: BLE001 — the tracer reports, never crashes
        return sink.events, {"name": error_name(exc), "message": str(exc)}
    finally:
        sys.stdout = old_stdout
    for line in outcome["output"]:
        sys.stderr.write(line + "\n")
    for warning in result.warnings:
        sys.stderr.write("warning: %s\n" % warning)
    sys.stderr.flush()
    return sink.events, None


def trace_file(path, events=None):
    """Trace the IrohScript file at ``path``; same return as trace_source."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            source = handle.read()
    except OSError as exc:
        return [], {"name": "Error",
                    "message": "Cannot read %s: %s" % (path, exc)}
    return trace_source(source, filename=path, events=events)


def main(argv=None):
    """CLI entry point: ``python3 -m src.trace [--events ...] prog.iroh``."""
    return cli_main(argv, trace_source, trace_file,
                    "src.trace",
                    "Trace an IrohScript program; stream JSONL events on stdout.")


if __name__ == "__main__":
    sys.exit(main())
