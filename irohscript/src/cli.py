"""IrohScript 3.0 — command-line interface.

Usage (from ~/workspace/irohscript):

    python3 -m src.cli run examples/add.iroh
    python3 -m src.cli compile examples/add.iroh
    python3 -m src.cli compile examples/add.iroh --ast --ir

`run` compiles and executes, printing the program's output.
`compile` prints the IRX JSON (and, with --ast / --ir, those stages too).
Compile errors print to stderr and exit 1; runtime errors exit 2.
"""

import argparse
import json
import sys

from .bridge import IrohRuntime
from .errors import CompileError, IrohRuntimeError


def _print_json(obj):
    print(json.dumps(obj, sort_keys=True, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="irohscript",
                                     description="IrohScript 3.0 compiler")
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run", help="compile and execute a program")
    run_p.add_argument("file")
    compile_p = sub.add_parser("compile", help="compile and print IRX JSON")
    compile_p.add_argument("file")
    compile_p.add_argument("--ast", action="store_true",
                           help="also print the AST")
    compile_p.add_argument("--ir", action="store_true",
                           help="also print the IR")
    args = parser.parse_args(argv)

    runtime = IrohRuntime()
    try:
        with open(args.file, "r", encoding="utf-8") as handle:
            source = handle.read()
    except OSError as exc:
        print("Cannot read %s: %s" % (args.file, exc), file=sys.stderr)
        return 1

    try:
        result = runtime.compile(source)
    except CompileError as exc:
        print("CompileError: %s" % exc, file=sys.stderr)
        return 1

    if args.command == "compile":
        if args.ast:
            print("--- AST ---")
            _print_json(result.ast.to_dict())
        if args.ir:
            print("--- IR ---")
            _print_json(result.ir)
        print("--- IRX ---")
        _print_json(result.irx)
        for warning in result.warnings:
            print("warning: %s" % warning, file=sys.stderr)
        return 0

    try:
        outcome = runtime.execute(result.irx)
    except IrohRuntimeError as exc:
        print("RuntimeError: %s" % exc, file=sys.stderr)
        return 2
    for line in outcome["output"]:
        print(line)
    for warning in result.warnings:
        print("warning: %s" % warning, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
