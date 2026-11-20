"""Plain BASIC interpreter (v1 subset) for IrohRedux.

BASIC is a named ingredient of IrohScript (BASIC-first, spec section
6), and it is traced as a first-class language alongside it. This is
a small dedicated interpreter, not a reuse of the IrohScript parser:
classic BASIC needs a program counter (GOTO/GOSUB jump to line
numbers, FOR/NEXT keeps a loop stack), which the IrohScript tree-walk
IRX interpreter cannot express — there is no jump in IRX, and its
LOOP has no exit rule.

Covered in v1 (documented honestly; anything else is a clear error,
never silently skipped):
  - Line numbers (optional); statements separated by ':'; REM comments;
    '?' as a PRINT shorthand.
  - LET (or bare assignment), PRINT with ';' and ',' separators and a
    trailing separator suppressing the newline, INPUT (with an optional
    prompt string), DIM and arrays (any number of dimensions).
  - IF cond THEN <statement> [: ...] [ELSE <statement> ...], and
    IF cond THEN <line> (a jump). The THEN/ELSE parts hold LET, PRINT,
    INPUT, array assignment, nested IF and END only — FOR, GOTO and
    GOSUB inside an IF part are a v1 parse error.
  - FOR var = start TO end [STEP step] / NEXT [var], nested; GOTO;
    GOSUB / RETURN; END / STOP.
  - Expressions: numbers, strings, names (with an optional $ suffix),
    array reads, parentheses, + - * / % = <> < > <= >= AND OR NOT.
    Division is true division and % is floored modulo (Python-style,
    the same semantics as the IrohScript bootstrap — an open design
    question for Andy, not a BASIC standard).

NOT in v1 (a clear error naming the construct):
  DATA/READ, WHILE/WEND, DEF FN, ON GOTO/GOSUB, built-in functions
  (ABS, LEN, ...), multi-statement string handling beyond PRINT,
  file I/O, PRINT zones (',' separates with one space, not 14-column
  zones), INPUT reprompting (a bad value is an error, not "?Redo").

Semantics defaults (documented, not hidden):
  - Undeclared numeric variables read as 0, string ($) variables as
    ""; undeclared array elements read as 0 / "".
  - Numbers print without extra padding; a float that is integral
    prints as its integer.
  - INPUT reads one line from the input stream and splits it on
    commas; values are assigned left to right.
"""

import sys


class BasicError(Exception):
    """A BASIC parse or runtime error. Carries the BASIC line when known."""

    def __init__(self, message, line=None):
        self.line = line
        where = " on line %s" % line if line is not None else ""
        super().__init__("%s%s" % (message, where))
        self.message = message


# ---------------------------------------------------------------------------
# Lexer (per physical line)
# ---------------------------------------------------------------------------

KEYWORDS = {
    "LET", "PRINT", "IF", "THEN", "ELSE", "FOR", "TO", "STEP", "NEXT",
    "GOTO", "GOSUB", "RETURN", "INPUT", "DIM", "END", "STOP", "REM",
    "DATA", "READ", "ON", "DEF", "FN", "WHILE", "WEND", "AND", "OR",
    "NOT",
}

# Keywords that are statements (a line may not start with a bare number
# followed by anything else, so a leading number is a line number).
MULTI_OPS = ("<>", "<=", ">=")


class Token:
    def __init__(self, kind, value):
        self.kind = kind  # "NUM", "STR", "NAME", keyword, or an operator
        self.value = value

    def __repr__(self):
        return "Token(%r, %r)" % (self.kind, self.value)


def lex_line(text):
    """Lex one physical line into tokens (no NEWLINE token)."""
    tokens = []
    ii = 0
    n = len(text)
    while ii < n:
        ch = text[ii]
        if ch in " \t":
            ii += 1
            continue
        if ch == '"':
            jj = ii + 1
            out = []
            while jj < n:
                if text[jj] == '"':
                    if jj + 1 < n and text[jj + 1] == '"':
                        out.append('"')
                        jj += 2
                        continue
                    break
                out.append(text[jj])
                jj += 1
            if jj >= n:
                raise BasicError("Unterminated string")
            tokens.append(Token("STR", "".join(out)))
            ii = jj + 1
            continue
        if ch.isdigit() or (ch == "." and ii + 1 < n and text[ii + 1].isdigit()):
            jj = ii
            while jj < n and (text[jj].isdigit() or text[jj] == "."):
                jj += 1
            if jj < n and text[jj] in "eE":
                jj += 1
                if jj < n and text[jj] in "+-":
                    jj += 1
                while jj < n and text[jj].isdigit():
                    jj += 1
            raw = text[ii:jj]
            try:
                value = float(raw) if ("." in raw or "e" in raw or "E" in raw) else int(raw)
            except ValueError:
                raise BasicError("Bad number %r" % raw)
            tokens.append(Token("NUM", value))
            ii = jj
            continue
        if ch.isalpha() or ch == "_":
            jj = ii
            while jj < n and (text[jj].isalnum() or text[jj] == "_"):
                jj += 1
            if jj < n and text[jj] == "$":
                jj += 1
            word = text[ii:jj]
            upper = word.upper()
            if upper in KEYWORDS:
                tokens.append(Token(upper, word))
            else:
                tokens.append(Token("NAME", word))
            ii = jj
            continue
        two = text[ii:ii + 2]
        if two in MULTI_OPS:
            tokens.append(Token(two, two))
            ii += 2
            continue
        if ch in "+-*/%=<>() ,:;?":
            tokens.append(Token(ch, ch))
            ii += 1
            continue
        raise BasicError("Unexpected character %r" % ch)
    return tokens


# ---------------------------------------------------------------------------
# Parser — a program is a list of lines; each line is (number, [stmt])
# ---------------------------------------------------------------------------
# Statement tuples:
#   ("let", name, expr)  ("setelem", name, [idx], expr)
#   ("print", [(expr, sep), ...])  sep is ";" | "," | None
#   ("if", cond, then_stmts, else_stmts|None)
#   ("for", var, start, end, step|None)  ("next", var|None)
#   ("goto", n)  ("gosub", n)  ("return",)
#   ("input", prompt|None, [names])
#   ("dim", name, [size_exprs])  ("end",)  ("stop",)  ("rem",)
# Expressions: ("num", v) ("str", s) ("var", name) ("arr", name, [idx])
#   ("bin", op, l, r)  ("un", op, e)

_UNSUPPORTED = {
    "DATA": "DATA/READ is not in the v1 subset",
    "READ": "DATA/READ is not in the v1 subset",
    "WHILE": "WHILE/WEND is not in the v1 subset",
    "WEND": "WHILE/WEND is not in the v1 subset",
    "DEF": "DEF FN is not in the v1 subset",
    "ON": "ON GOTO/GOSUB is not in the v1 subset",
}

# Statements allowed inside an IF THEN/ELSE part (no jumps, no loops:
# a FOR or GOTO there has no well-defined NEXT/jump target in v1).
_IF_PART_STATEMENTS = {"LET", "PRINT", "?", "INPUT", "IF", "END", "STOP", "NAME"}


class _Parser:
    def __init__(self, tokens, line_no):
        self.tokens = tokens
        self.pos = 0
        self.line_no = line_no

    def error(self, message):
        raise BasicError(message, self.line_no)

    def at(self, kind):
        return self.pos < len(self.tokens) and self.tokens[self.pos].kind == kind

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def accept(self, kind):
        if self.at(kind):
            self.pos += 1
            return True
        return False

    def expect(self, kind):
        if not self.accept(kind):
            tok = self.peek()
            self.error("Expected %s, got %s"
                       % (kind, repr(tok.value) if tok else "end of line"))

    def parse_statements(self, in_if_part=False):
        stmts = []
        while True:
            if self.pos >= len(self.tokens):
                break
            if self.at("ELSE"):
                break
            stmts.append(self.parse_statement(in_if_part))
            if not self.accept(":"):
                break
        return stmts

    def parse_statement(self, in_if_part=False):
        tok = self.peek()
        if tok is None:
            self.error("Empty statement")
        kind = tok.kind
        if kind in _UNSUPPORTED:
            self.error(_UNSUPPORTED[kind])
        if in_if_part and kind not in _IF_PART_STATEMENTS:
            self.error("%s is not allowed in an IF THEN/ELSE part in v1" % kind)
        if kind == "REM":
            self.pos = len(self.tokens)
            return ("rem",)
        if kind == "LET":
            self.pos += 1
            return self._parse_assignment()
        if kind == "PRINT" or kind == "?":
            self.pos += 1
            return self._parse_print()
        if kind == "IF":
            return self._parse_if()
        if kind == "FOR":
            return self._parse_for()
        if kind == "NEXT":
            self.pos += 1
            name = None
            if self.at("NAME"):
                name = self.tokens[self.pos].value
                self.pos += 1
            return ("next", name)
        if kind == "GOTO":
            self.pos += 1
            return ("goto", self._parse_line_number())
        if kind == "GOSUB":
            self.pos += 1
            return ("gosub", self._parse_line_number())
        if kind == "RETURN":
            self.pos += 1
            return ("return",)
        if kind == "INPUT":
            return self._parse_input()
        if kind == "DIM":
            return self._parse_dim()
        if kind == "END":
            self.pos += 1
            return ("end",)
        if kind == "STOP":
            self.pos += 1
            return ("stop",)
        if kind == "NAME":
            # Bare assignment: X = 5, or A(I) = 5.
            return self._parse_assignment()
        self.error("Unexpected %r" % tok.value)

    def _parse_line_number(self):
        tok = self.peek()
        if tok is None or tok.kind != "NUM" or not isinstance(tok.value, int):
            self.error("Expected a line number")
        self.pos += 1
        return tok.value

    def _parse_assignment(self):
        tok = self.peek()
        if tok is None or tok.kind != "NAME":
            self.error("Expected a variable name")
        name = tok.value
        self.pos += 1
        if self.accept("("):
            idx = [self.parse_expr()]
            while self.accept(","):
                idx.append(self.parse_expr())
            self.expect(")")
            self.expect("=")
            value = self.parse_expr()
            return ("setelem", name, idx, value)
        self.expect("=")
        return ("let", name, self.parse_expr())

    def _parse_print(self):
        items = []
        while True:
            if self.pos >= len(self.tokens) or self.at(":"):
                break
            if self.at("ELSE"):
                break
            expr = self.parse_expr()
            sep = None
            if self.at(";"):
                sep = ";"
                self.pos += 1
            elif self.at(","):
                sep = ","
                self.pos += 1
            items.append((expr, sep))
            if sep is None:
                break
        return ("print", items)

    def _parse_if(self):
        self.expect("IF")
        cond = self.parse_expr()
        self.expect("THEN")
        if self.at("NUM"):
            # A bare number after THEN is a jump target (IF X THEN 100):
            # conditional, not an unconditional GOTO.
            return ("if", cond, [("goto", self._parse_line_number())], None)
        if self.at("GOTO"):
            self.pos += 1
            return ("if", cond, [("goto", self._parse_line_number())], None)
        then_stmts = self.parse_statements(in_if_part=True)
        else_stmts = None
        if self.accept("ELSE"):
            else_stmts = self.parse_statements(in_if_part=True)
        return ("if", cond, then_stmts, else_stmts)

    def _parse_for(self):
        self.expect("FOR")
        tok = self.peek()
        if tok is None or tok.kind != "NAME":
            self.error("Expected a loop variable after FOR")
        var = tok.value
        self.pos += 1
        self.expect("=")
        start = self.parse_expr()
        self.expect("TO")
        end = self.parse_expr()
        step = None
        if self.accept("STEP"):
            step = self.parse_expr()
        return ("for", var, start, end, step)

    def _parse_input(self):
        self.expect("INPUT")
        prompt = None
        if self.at("STR"):
            prompt = self.tokens[self.pos].value
            self.pos += 1
            self.accept(";")
        names = []
        while True:
            tok = self.peek()
            if tok is None or tok.kind != "NAME":
                self.error("Expected a variable name after INPUT")
            names.append(tok.value)
            self.pos += 1
            if not self.accept(","):
                break
        return ("input", prompt, names)

    def _parse_dim(self):
        self.expect("DIM")
        tok = self.peek()
        if tok is None or tok.kind != "NAME":
            self.error("Expected an array name after DIM")
        name = tok.value
        self.pos += 1
        self.expect("(")
        sizes = [self.parse_expr()]
        while self.accept(","):
            sizes.append(self.parse_expr())
        self.expect(")")
        return ("dim", name, sizes)

    # ------------------------------------------------------------ expressions
    def parse_expr(self):
        return self._parse_or()

    def _parse_or(self):
        left = self._parse_and()
        while self.at("OR"):
            self.pos += 1
            left = ("bin", "OR", left, self._parse_and())
        return left

    def _parse_and(self):
        left = self._parse_not()
        while self.at("AND"):
            self.pos += 1
            left = ("bin", "AND", left, self._parse_not())
        return left

    def _parse_not(self):
        if self.at("NOT"):
            self.pos += 1
            return ("un", "NOT", self._parse_not())
        return self._parse_cmp()

    def _parse_cmp(self):
        left = self._parse_add()
        while True:
            tok = self.peek()
            if tok is not None and tok.kind in ("=", "<>", "<", ">", "<=", ">="):
                self.pos += 1
                left = ("bin", tok.kind, left, self._parse_add())
            else:
                return left

    def _parse_add(self):
        left = self._parse_mul()
        while True:
            tok = self.peek()
            if tok is not None and tok.kind in ("+", "-"):
                self.pos += 1
                left = ("bin", tok.kind, left, self._parse_mul())
            else:
                return left

    def _parse_mul(self):
        left = self._parse_unary()
        while True:
            tok = self.peek()
            if tok is not None and tok.kind in ("*", "/", "%"):
                self.pos += 1
                left = ("bin", tok.kind, left, self._parse_unary())
            else:
                return left

    def _parse_unary(self):
        if self.at("-"):
            self.pos += 1
            return ("un", "NEG", self._parse_unary())
        return self._parse_primary()

    def _parse_primary(self):
        tok = self.peek()
        if tok is None:
            self.error("Expected an expression")
        if tok.kind == "NUM":
            self.pos += 1
            return ("num", tok.value)
        if tok.kind == "STR":
            self.pos += 1
            return ("str", tok.value)
        if tok.kind == "NAME":
            self.pos += 1
            if self.accept("("):
                idx = [self.parse_expr()]
                while self.accept(","):
                    idx.append(self.parse_expr())
                self.expect(")")
                return ("arr", tok.value, idx)
            return ("var", tok.value)
        if tok.kind == "(":
            self.pos += 1
            expr = self.parse_expr()
            self.expect(")")
            return expr
        self.error("Unexpected %r in expression" % tok.value)


def parse_program(text):
    """Parse BASIC source into a program: a list of
    (number, physical, [stmt]) where number is the BASIC line number
    or None (unnumbered lines are addressed by their 1-based physical
    line)."""
    lines = []
    for physical, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        tokens = lex_line(raw)
        if not tokens:
            continue
        number = None
        if tokens[0].kind == "NUM" and isinstance(tokens[0].value, int):
            number = tokens[0].value
            tokens = tokens[1:]
            if not tokens:
                lines.append((number, physical, []))
                continue
        parser = _Parser(tokens, number if number is not None else physical)
        stmts = parser.parse_statements()
        if parser.pos < len(parser.tokens):
            parser.error("Unexpected %r" % parser.tokens[parser.pos].value)
        lines.append((number, physical, stmts))
    if not lines:
        raise BasicError("Empty program")
    explicit = [n for n, _p, _s in lines if n is not None]
    if len(set(explicit)) != len(explicit):
        raise BasicError("Duplicate line number")
    return lines


# ---------------------------------------------------------------------------
# Interpreter — a program-counter machine over flattened slots
# ---------------------------------------------------------------------------

class BasicInterpreter:
    """Execute a parsed BASIC program.

    ``input_stream`` supplies INPUT lines (default: sys.stdin at run
    time); printed output accumulates in ``self.output`` (completed
    lines) with ``self._pending`` holding a line whose newline was
    suppressed by a trailing ';' or ','.
    """

    def __init__(self, input_stream=None):
        self.input_stream = input_stream
        self.vars = {}
        self.arrays = {}  # name -> {"dims": [...], "data": {tuple: value}}
        self.output = []
        self._pending = ""
        self._gosub_stack = []
        self._for_stack = []  # {"var","end","step","for_pc","next_pc"}
        self._entered_loops = set()  # for-slot indices that fired LOOP_ENTER
        self._slots = []  # (line_key, stmt_index, stmt)
        self._line_map = {}  # line number -> first slot index
        self._for_next = {}  # for slot -> next slot; next slot -> for slot
        self.halted = False

    # ------------------------------------------------------------ hooks
    # Tracing subclasses override these; the base is silent.
    def _hook_assign(self, name, value, op, obj, site):
        pass

    def _hook_if(self, site, value):
        pass

    def _hook_loop_test(self, site, value):
        pass

    def _hook_loop_enter(self, site):
        pass

    def _hook_gosub(self, site, name):
        pass

    def _hook_gosub_return(self, site, name):
        pass

    # ------------------------------------------------------------ loading
    def load(self, program):
        self._slots = []
        self._line_map = {}
        for number, physical, stmts in program:
            # Numbered lines are addressed by their BASIC number;
            # unnumbered lines by their 1-based physical line.
            key = number if number is not None else physical
            if key not in self._line_map:
                self._line_map[key] = len(self._slots)
            for ii, stmt in enumerate(stmts):
                self._slots.append((key, ii, stmt))
        # Pair FOR with NEXT by nesting.
        stack = []
        for pc, (_line, _ii, stmt) in enumerate(self._slots):
            if stmt[0] == "for":
                stack.append(pc)
            elif stmt[0] == "next":
                if not stack:
                    raise BasicError("NEXT without FOR", _line)
                for_pc = stack.pop()
                self._for_next[for_pc] = pc
                self._for_next[pc] = for_pc
        if stack:
            line = self._slots[stack[-1]][0]
            raise BasicError("FOR without NEXT", line)

    def run(self, program):
        """Execute a parsed program. Returns {"output": [...]}."""
        self.load(program)
        pc = 0
        stream = self.input_stream if self.input_stream is not None else sys.stdin
        while pc < len(self._slots) and not self.halted:
            line, ii, stmt = self._slots[pc]
            pc = self._exec_stmt(stmt, line, ii, pc, stream)
        # A trailing ';' or ',' left a partial line pending; flush it.
        # An empty pending buffer means nothing is owed — without this
        # guard every run ended with a spurious blank line.
        if self._pending != "":
            self._flush_pending()
        return {"output": list(self.output)}

    def run_source(self, text):
        """Parse and execute BASIC source text."""
        return self.run(parse_program(text))

    # ------------------------------------------------------------ statements
    def _site(self, line, ii):
        return "%s.%d" % (line, ii)

    def _exec_stmt(self, stmt, line, ii, pc, stream):
        kind = stmt[0]
        if kind == "rem":
            return pc + 1
        if kind == "let":
            value = self._eval(stmt[2])
            self.vars[stmt[1]] = value
            self._hook_assign(stmt[1], value, "=", stmt[1],
                              self._site(line, ii))
            return pc + 1
        if kind == "setelem":
            idx = tuple(self._eval(e) for e in stmt[2])
            value = self._eval(stmt[3])
            self._set_elem(stmt[1], idx, value)
            self._hook_assign(stmt[1], value, "=",
                              "%s(%s)" % (stmt[1], ",".join(str(i) for i in idx)),
                              self._site(line, ii))
            return pc + 1
        if kind == "print":
            self._do_print(stmt[1])
            return pc + 1
        if kind == "if":
            cond = self._eval(stmt[1])
            value = self._truthy(cond)
            self._hook_if(self._site(line, ii), value)
            body = stmt[2] if value else (stmt[3] or [])
            # THEN/ELSE parts run inline, not as slots. A sub-statement
            # returns pc+1 normally; anything else is a jump (a GOTO
            # in the part — IF X THEN 100) and propagates out.
            for sub in body:
                nxt = self._exec_stmt(sub, line, ii, pc, stream)
                if self.halted:
                    return pc
                if nxt != pc + 1:
                    return nxt
            return pc + 1
        if kind == "for":
            return self._do_for(stmt, line, ii, pc)
        if kind == "next":
            return self._do_next(stmt, line, ii, pc)
        if kind == "goto":
            target = stmt[1]
            if target not in self._line_map:
                raise BasicError("GOTO to undefined line %d" % target, line)
            return self._line_map[target]
        if kind == "gosub":
            target = stmt[1]
            if target not in self._line_map:
                raise BasicError("GOSUB to undefined line %d" % target, line)
            self._hook_gosub(self._site(line, ii), "gosub@%d" % target)
            self._gosub_stack.append((pc + 1, "gosub@%d" % target, self._site(line, ii)))
            return self._line_map[target]
        if kind == "return":
            if not self._gosub_stack:
                raise BasicError("RETURN without GOSUB", line)
            ret_pc, name, site = self._gosub_stack.pop()
            self._hook_gosub_return(site, name)
            return ret_pc
        if kind == "input":
            self._do_input(stmt, line, ii, stream)
            return pc + 1
        if kind == "dim":
            dims = [self._eval(e) for e in stmt[2]]
            for d in dims:
                if not isinstance(d, int) or isinstance(d, bool) or d < 0:
                    raise BasicError("DIM size must be a non-negative integer", line)
            self.arrays[stmt[1]] = {"dims": dims, "data": {}}
            return pc + 1
        if kind == "end" or kind == "stop":
            self.halted = True
            return pc + 1
        raise BasicError("Unknown statement %r" % (kind,), line)

    def _do_for(self, stmt, line, ii, pc):
        _kind, var, start_e, end_e, step_e = stmt
        start = self._eval(start_e)
        end = self._eval(end_e)
        step = self._eval(step_e) if step_e is not None else 1
        self._check_number(start, "FOR start")
        self._check_number(end, "FOR end")
        self._check_number(step, "FOR step")
        if step == 0:
            raise BasicError("FOR STEP is zero", line)
        self.vars[var] = start
        self._hook_assign(var, start, "=", var, self._site(line, ii))
        site = self._site(line, ii)
        passed = start <= end if step > 0 else start >= end
        self._hook_loop_test(site, passed)
        if not passed:
            return self._for_next[pc] + 1
        if pc not in self._entered_loops:
            self._entered_loops.add(pc)
            self._hook_loop_enter(site)
        self._for_stack.append({"var": var, "end": end, "step": step,
                                "for_pc": pc, "next_pc": self._for_next[pc]})
        return pc + 1

    def _do_next(self, stmt, line, ii, pc):
        var = stmt[1]
        frame = None
        for frame in reversed(self._for_stack):
            if var is None or frame["var"] == var:
                break
        else:
            frame = None
        if frame is None:
            raise BasicError("NEXT without a matching FOR", line)
        if var is not None and frame["var"] != var:
            raise BasicError("NEXT %s does not match FOR %s"
                             % (var, frame["var"]), line)
        # Pop any frames above the matched one (a NEXT for an outer
        # loop implicitly closes the inner ones — classic BASIC
        # behaviour; the inner loops simply end).
        while self._for_stack and self._for_stack[-1] is not frame:
            self._for_stack.pop()
        new_value = self.vars[frame["var"]] + frame["step"]
        self.vars[frame["var"]] = new_value
        self._hook_assign(frame["var"], new_value, "=",
                          frame["var"], self._site(line, ii))
        site = self._site(*self._slot_line(frame["for_pc"]))
        passed = (new_value <= frame["end"] if frame["step"] > 0
                  else new_value >= frame["end"])
        self._hook_loop_test(site, passed)
        if passed:
            self._for_stack.pop()
            self._for_stack.append(frame)
            return frame["for_pc"] + 1
        self._for_stack.pop()
        return pc + 1

    def _slot_line(self, pc):
        line, ii, _stmt = self._slots[pc]
        return (line, ii)

    def _do_input(self, stmt, line, ii, stream):
        _kind, prompt, names = stmt
        if prompt is not None:
            self._pending += prompt
        raw = stream.readline()
        if raw == "":
            raise BasicError("INPUT: end of input", line)
        parts = [p.strip() for p in raw.rstrip("\n").split(",")]
        for pos, name in enumerate(names):
            if pos >= len(parts):
                raise BasicError("INPUT: not enough values", line)
            text = parts[pos]
            if name.endswith("$"):
                value = text
            else:
                try:
                    value = float(text) if ("." in text or "e" in text or "E" in text) else int(text)
                except ValueError:
                    raise BasicError("INPUT: %r is not a number" % text, line)
            self.vars[name] = value
            self._hook_assign(name, value, "=", name, self._site(line, ii))

    def _do_print(self, items):
        for expr, sep in items:
            value = self._eval(expr)
            self._pending += format_value(value)
            if sep == ",":
                self._pending += " "
            elif sep is None:
                self._flush_pending()
                return
        # Trailing ';' or ',' suppresses the newline; a PRINT with no
        # items is a blank line.
        if not items:
            self._flush_pending()

    def _flush_pending(self):
        self.output.append(self._pending)
        self._pending = ""

    # ------------------------------------------------------------ values
    def _truthy(self, value):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        raise BasicError("IF condition is not a number")

    def _check_number(self, value, what):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise BasicError("%s must be a number" % what)

    def _get_elem(self, name, idx):
        arr = self.arrays.get(name)
        if arr is None:
            raise BasicError("Array %s is not DIMensioned" % name)
        if len(idx) != len(arr["dims"]):
            raise BasicError("Array %s takes %d indice(s), got %d"
                             % (name, len(arr["dims"]), len(idx)))
        for pos, (i, size) in enumerate(zip(idx, arr["dims"])):
            if not isinstance(i, int) or isinstance(i, bool) or i < 0 or i > size:
                raise BasicError("Array index %r out of range" % (i,))
        return arr["data"].get(tuple(idx), 0 if not name.endswith("$") else "")

    def _set_elem(self, name, idx, value):
        arr = self.arrays.get(name)
        if arr is None:
            raise BasicError("Array %s is not DIMensioned" % name)
        if len(idx) != len(arr["dims"]):
            raise BasicError("Array %s takes %d indice(s), got %d"
                             % (name, len(arr["dims"]), len(idx)))
        for pos, (i, size) in enumerate(zip(idx, arr["dims"])):
            if not isinstance(i, int) or isinstance(i, bool) or i < 0 or i > size:
                raise BasicError("Array index %r out of range" % (i,))
        arr["data"][tuple(idx)] = value

    def _eval(self, expr):
        op = expr[0]
        if op == "num" or op == "str":
            return expr[1]
        if op == "var":
            name = expr[1]
            if name in self.vars:
                return self.vars[name]
            return "" if name.endswith("$") else 0
        if op == "arr":
            idx = tuple(self._eval(e) for e in expr[2])
            return self._get_elem(expr[1], idx)
        if op == "un":
            operand = self._eval(expr[2])
            if expr[1] == "NEG":
                self._check_number(operand, "Unary -")
                return -operand
            return not self._truthy(operand)
        if op == "bin":
            return self._eval_binop(expr[1], expr[2], expr[3])
        raise BasicError("Unknown expression %r" % (op,))

    def _eval_binop(self, op, left_e, right_e):
        left = self._eval(left_e)
        right = self._eval(right_e)
        if op == "+":
            if isinstance(left, str) or isinstance(right, str):
                return format_value(left) + format_value(right)
            self._check_number(left, "+")
            self._check_number(right, "+")
            return left + right
        if op == "-" or op == "*":
            self._check_number(left, op)
            self._check_number(right, op)
            return left - right if op == "-" else left * right
        if op == "/":
            self._check_number(left, "/")
            self._check_number(right, "/")
            if right == 0:
                raise BasicError("Division by zero")
            return left / right  # true division (open design question)
        if op == "%":
            self._check_number(left, "%")
            self._check_number(right, "%")
            if right == 0:
                raise BasicError("Modulo by zero")
            return left % right  # floored modulo (open design question)
        if op == "=":
            return left == right
        if op == "<>":
            return left != right
        if op in ("<", ">", "<=", ">="):
            if isinstance(left, str) or isinstance(right, str):
                if not (isinstance(left, str) and isinstance(right, str)):
                    raise BasicError("Cannot compare a string with a number")
                return {"<": left < right, ">": left > right,
                        "<=": left <= right, ">=": left >= right}[op]
            self._check_number(left, op)
            self._check_number(right, op)
            return {"<": left < right, ">": left > right,
                    "<=": left <= right, ">=": left >= right}[op]
        if op == "AND":
            return self._truthy(left) and self._truthy(right)
        if op == "OR":
            return self._truthy(left) or self._truthy(right)
        raise BasicError("Unknown operator %r" % op)


def format_value(value):
    """How a value prints: strings raw, integral floats as integers."""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)
