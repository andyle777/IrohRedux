"""Shared helpers for the IrohScript and BASIC tracers.

Both tracers emit IrohRedux trace events in the same JSONL shape the
JavaScript CLI emits (see cli/iroh.js) and the native Python tracer
emits (see python/iroh/trace.py), so Iroh.analyze() works unchanged
across languages:

    {"type":"event","event":"FUNCTION_CALL","category":"CALL",
     "trigger":"before","hash":123456,"indent":0,"name":"Add",
     "arguments":[10,20],"file":"add.iroh"}

Event categories are the JS engine's (src/labels.js); --events is
validated against the full list, like the CLI. Hashes are CRC32 of
kind:file:site, so the same program always gets the same hashes — the
site is a source line for BASIC and an instruction path for IrohScript
(IRX carries no source positions; the path is deterministic because
compilation is deterministic, spec section 30).
"""

import argparse
import json
import sys
import zlib

__all__ = ["KNOWN_CATEGORIES", "EventSink", "safe_value", "site_hash",
           "error_name", "print_error", "cli_main"]

# Event categories the JS engine knows (src/labels.js). Each tracer
# emits a subset; --events is validated against the full list.
KNOWN_CATEGORIES = {
    "THIS", "UNARY", "UPDATE", "BINARY", "LOGICAL", "TERNARY", "ASSIGN",
    "ALLOC", "MEMBER", "LITERAL", "IDENTIFIER", "TRY", "CATCH", "FINALLY",
    "OP_NEW", "VAR", "IF", "ELSE", "SWITCH", "CASE", "BREAK", "CONTINUE",
    "LOOP", "CALL", "FUNCTION", "BLOCK", "PROGRAM", "METHOD", "SUPER",
    "AWAIT",
}


def safe_value(value, depth=3, seen=None):
    """JSON-safe projection of a value, like Iroh.safeValue (depth-capped)."""
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return repr(value)
        return value
    if seen is None:
        seen = set()
    if depth <= 0:
        return "[Object]"
    if isinstance(value, (list, tuple)):
        if id(value) in seen:
            return "[Circular]"
        seen.add(id(value))
        return [safe_value(v, depth - 1, seen) for v in value]
    if isinstance(value, dict):
        if id(value) in seen:
            return "[Circular]"
        seen.add(id(value))
        out = {}
        for k, v in list(value.items())[:50]:
            out[str(k)] = safe_value(v, depth - 1, seen)
        return out
    if isinstance(value, (set, frozenset)):
        return [safe_value(v, depth - 1, seen) for v in list(value)[:50]]
    return repr(value)


def site_hash(kind, filename, site):
    """Stable per-site hash: CRC32 of kind:file:site."""
    return zlib.crc32(("%s:%s:%s" % (kind, filename, site)).encode("utf-8"))


class EventSink:
    """Collects emitted events, applying the --events category filter.

    ``wanted`` is None (all categories) or a set of category names.
    Events are dicts in the CLI's JSONL shape; ``events`` holds them
    in emission order.
    """

    def __init__(self, wanted=None):
        self.wanted = wanted
        self.events = []

    def emit(self, event, category, trigger, hash_, indent, **fields):
        if self.wanted is not None and category not in self.wanted:
            return
        line = {
            "type": "event",
            "event": event,
            "category": category,
            "trigger": trigger,
            "hash": hash_,
            "indent": indent,
        }
        for key, value in fields.items():
            if value is not None:
                line[key] = value
        self.events.append(line)


def error_name(exc):
    """Public error name for an exception.

    The interpreter's runtime error class is spelled RuntimeError_
    in Python (to avoid shadowing the builtin); the public name the
    spec exposes is IrohRuntimeError (errors.py). Everything else
    reports its real class name.
    """
    name = type(exc).__name__
    if name == "RuntimeError_":
        return "IrohRuntimeError"
    return name


def print_error(error):
    sys.stdout.write(json.dumps(
        {"type": "error", "name": error["name"], "message": error["message"]},
        separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _parse_events_arg(text):
    """Validate an --events value; returns a wanted set (None = all)."""
    if text.upper() == "ALL":
        return None
    wanted = [s.strip().upper() for s in text.split(",") if s.strip()]
    unknown = [name for name in wanted if name not in KNOWN_CATEGORIES]
    if unknown:
        sys.stderr.write("Unknown event category: %s\n" % (unknown[0],))
        return False
    return set(wanted)


def cli_main(argv, trace_source, trace_file, prog, description):
    """Shared CLI entry for a tracer: ``prog [--events ...] file``.

    ``trace_source`` is (source, filename, events) -> (events, error)
    and ``trace_file`` is (path, events) -> (events, error), following
    the python/iroh/trace.py contract. Events stream as JSONL on
    stdout; the program's own output stays on stderr; an error is a
    final {"type":"error",...} line and exit 1.
    """
    parser = argparse.ArgumentParser(prog=prog, description=description)
    parser.add_argument("file", nargs="?", help="program file to trace")
    parser.add_argument("-c", dest="code", default=None,
                        help="program source to trace (instead of a file)")
    parser.add_argument("--events", default="ALL",
                        help="comma list of event categories, or ALL")
    parser.add_argument("--no-result", action="store_true",
                        help="skip the final result line")
    args = parser.parse_args(argv)

    wanted = _parse_events_arg(args.events)
    if wanted is False:
        return 2

    if args.code is not None:
        events, error = trace_source(args.code, "<iroh>", wanted)
    elif args.file is not None:
        events, error = trace_file(args.file, wanted)
    else:
        parser.print_usage(sys.stderr)
        return 2

    for event in events:
        sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    if error is not None:
        print_error(error)
        return 1
    if not args.no_result:
        sys.stdout.write(json.dumps({"type": "result", "value": None},
                                    separators=(",", ":")) + "\n")
    sys.stdout.flush()
    return 0
