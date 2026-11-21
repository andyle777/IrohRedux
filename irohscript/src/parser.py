"""IrohScript 3.0 — parser (compiler passes 2-3) + legacy Iroh translator.

BASIC-first grammar (spec sections 1, 6-15):

    program    := statement*
    statement  := let | const | print | if | function | return | action
                | struct | enum | import | intent | loop
                | legacy-implication | assignment | expr-statement
    let        := LET name [":" type] "=" expr
    const      := CONST name "=" expr
    print      := PRINT expr
    if         := IF expr statement* [ELSE statement*] (END IF | END)
    function   := FUNCTION name "(" [param ["," param]*] ")" body END FUNCTION
    return     := RETURN [expr]
    action     := ACTION expr
    struct     := STRUCT name field* END STRUCT
    enum       := ENUM name member* END ENUM
    import     := IMPORT name
    intent     := INTENT expr
    loop       := LOOP body END
    legacy     := name "->" expr        (spec section 6-7)
    assignment := (name | name "." name) "=" expr
    expr       := or-expr, standard precedence, see _parse_expr

Keywords are case-insensitive; a NEWLINE separates statements and an
expression never spans a line (MVP rule, documented in the README).

The legacy translator: a line ``enemy -> defend`` parses to exactly the
same Conditional node as ``IF enemy ACTION defend END IF`` (spec section
7). A bare identifier on the right of ``->`` is an action symbol, so it
becomes Literal("defend"); the same rule applies to ACTION's bare
identifier argument (see ast_nodes.py).
"""

from . import ast_nodes as A
from .errors import ParseError


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    # ------------------------------------------------------------ utilities
    def peek(self, offset=0):
        idx = min(self.pos + offset, len(self.tokens) - 1)
        return self.tokens[idx]

    def advance(self):
        tok = self.tokens[self.pos]
        if self.pos < len(self.tokens) - 1:
            self.pos += 1
        return tok

    def at(self, kind):
        return self.peek().kind == kind

    def accept(self, kind):
        if self.at(kind):
            return self.advance()
        return None

    def expect(self, kind, what=None):
        if self.at(kind):
            return self.advance()
        tok = self.peek()
        raise ParseError(
            "Expected %s but found %r" % (what or kind, tok.value),
            line=tok.line)

    def skip_newlines(self):
        while self.at("NEWLINE"):
            self.advance()

    def at_block_end(self):
        """True when the next tokens close the enclosing block."""
        if self.at("END"):
            return True
        return self.at("EOF")

    # ------------------------------------------------------------ entry
    def parse_program(self):
        statements = []
        self.skip_newlines()
        while not self.at("EOF"):
            statements.append(self.parse_statement())
            self.skip_newlines()
        return A.Program(statements)

    def parse_block(self, terminators=("END",)):
        """Parse statements until a terminator keyword or EOF."""
        body = []
        self.skip_newlines()
        while not self.at("EOF"):
            if self.at("END"):
                break
            if self.at("ELSE") and "ELSE" in terminators:
                break
            body.append(self.parse_statement())
            self.skip_newlines()
        return body

    def expect_end(self, what):
        tok = self.peek()
        if not self.at("END"):
            raise ParseError("Expected END to close %s but found %r"
                             % (what, tok.value), line=tok.line)
        self.advance()
        # Accept "END IF" / "END FUNCTION" / "END STRUCT" / "END ENUM" /
        # "END LOOP" as well as a bare END.
        if self.at("IF") and what in ("IF",):
            self.advance()
        elif self.at("FUNCTION") and what == "FUNCTION":
            self.advance()
        elif self.at("STRUCT") and what == "STRUCT":
            self.advance()
        elif self.at("ENUM") and what == "ENUM":
            self.advance()
        elif self.at("LOOP") and what == "LOOP":
            self.advance()

    # ------------------------------------------------------------ statements
    def parse_statement(self):
        tok = self.peek()
        kind = tok.kind
        # Legacy Iroh implication ``symbol -> expr`` (spec section 6).
        # The left-hand symbol is a bare word, which may collide with a
        # BASIC keyword: the spec's own example is ``action -> result``,
        # and ``action`` lexes as the ACTION keyword. A word followed by
        # ``->`` is always a legacy implication, never a keyword statement.
        if self.peek(1).kind == "ARROW" and kind in ("IDENT", "ACTION"):
            name_tok = self.advance()
            self.advance()  # ARROW
            rhs = self.parse_expr()
            if isinstance(rhs, A.Name):
                rhs = A.Literal(rhs.name, "String")
            return A.Conditional(A.Name(name_tok.value), rhs)
        if kind == "LET":
            return self.parse_let(False)
        if kind == "CONST":
            return self.parse_let(True)
        if kind == "PRINT":
            self.advance()
            return A.Print(self.parse_expr())
        if kind == "IF":
            return self.parse_if()
        if kind == "FUNCTION":
            return self.parse_function()
        if kind == "RETURN":
            self.advance()
            if self.at("NEWLINE") or self.at("EOF") or self.at("END"):
                return A.Return(None)
            return A.Return(self.parse_expr())
        if kind == "ACTION":
            return self.parse_action()
        if kind == "STRUCT":
            return self.parse_struct()
        if kind == "ENUM":
            return self.parse_enum()
        if kind == "IMPORT":
            self.advance()
            name = self.expect("IDENT", "a namespace name")
            return A.Import(name.value)
        if kind == "INTENT":
            self.advance()
            return A.Intent(self.parse_expr())
        if kind == "LOOP":
            self.advance()
            # Amendment A1 (2026-11-21): LOOP followed by a Bool
            # expression is the decided conditional loop (test-first,
            # like IF). The bare legacy form (spec section 6) still
            # parses, with cond None, and still errors at run time.
            cond = None
            if not self.at("NEWLINE"):
                cond = self.parse_expr()
            body = self.parse_block()
            self.expect_end("LOOP")
            return A.Loop(body, cond)
        if kind == "IDENT":
            return self.parse_ident_statement()
        raise ParseError("Unexpected %r" % (tok.value,), line=tok.line)

    def parse_let(self, is_const):
        self.advance()  # LET / CONST
        name = self.expect("IDENT", "a variable name")
        type_ann = None
        if self.accept("COLON"):
            type_ann = self.parse_type()
        # A LET with a type but no value declares a default instance
        # (spec section 12: ``LET State : AgentState``).
        value = None
        if self.accept("ASSIGN"):
            value = self.parse_expr()
        elif type_ann is None or is_const:
            tok = self.peek()
            raise ParseError(
                "LET %r needs a value or a type annotation"
                % name.value, line=tok.line)
        return A.Let(name.value, type_ann, value, is_const=is_const)

    def parse_if(self):
        self.advance()  # IF
        cond = self.parse_expr()
        then_body = self.parse_block(terminators=("END", "ELSE"))
        else_body = []
        if self.accept("ELSE"):
            else_body = self.parse_block(terminators=("END",))
        self.expect_end("IF")
        return A.If(cond, then_body, else_body)

    def parse_function(self):
        self.advance()  # FUNCTION
        name = self.expect("IDENT", "a function name")
        self.expect("LPAREN", "'('")
        params = []
        if not self.at("RPAREN"):
            while True:
                pname = self.expect("IDENT", "a parameter name")
                ptype = None
                if self.accept("COLON"):
                    ptype = self.parse_type()
                params.append((pname.value, ptype))
                if not self.accept("COMMA"):
                    break
        self.expect("RPAREN", "')'")
        body = self.parse_block()
        self.expect_end("FUNCTION")
        return A.FunctionDef(name.value, params, body)

    def parse_action(self):
        self.advance()  # ACTION
        expr = self.parse_expr()
        # A bare identifier after ACTION names the action symbol itself.
        if isinstance(expr, A.Name):
            expr = A.Literal(expr.name, "String")
        return A.Action(expr)

    def parse_struct(self):
        self.advance()  # STRUCT
        name = self.expect("IDENT", "a struct name")
        self.skip_newlines()
        fields = []
        while not self.at("END") and not self.at("EOF"):
            fname = self.expect("IDENT", "a field name")
            self.expect("COLON", "':'")
            ftype = self.parse_type()
            fields.append((fname.value, ftype))
            self.skip_newlines()
        self.expect_end("STRUCT")
        return A.StructDef(name.value, fields)

    def parse_enum(self):
        self.advance()  # ENUM
        name = self.expect("IDENT", "an enum name")
        self.skip_newlines()
        members = []
        while not self.at("END") and not self.at("EOF"):
            member = self.expect("IDENT", "an enum member")
            members.append(member.value)
            self.skip_newlines()
        self.expect_end("ENUM")
        return A.EnumDef(name.value, members)

    def parse_ident_statement(self):
        """IDENT-led statement: assignment or a call."""
        name_tok = self.advance()
        if self.at("DOT"):
            self.advance()
            member = self.expect("IDENT", "a field name")
            target = A.MemberAccess(A.Name(name_tok.value), member.value)
            # A nested member chain (o.inner.x = 3): consume further
            # .field segments before looking for the assignment. The
            # checker, the IR (SETFIELD takes a general object
            # expression) and the interpreter already handle a nested
            # target — only this parser step gated it to one level.
            # parse_postfix also consumes calls (o.f(1)), so an
            # assignment is only accepted when the target is still a
            # member access; a call falls through to the expression
            # statement below, and `o.f(1) = 3` still fails.
            target = self.parse_postfix(target)
            if not isinstance(target, A.Call) and self.accept("ASSIGN"):
                return A.Assign(target, self.parse_expr())
            # A member access (or a call on one) as an expression statement.
            return self._expr_statement(target)
        if self.accept("ASSIGN"):
            return A.Assign(A.Name(name_tok.value), self.parse_expr())
        expr = self.parse_postfix(A.Name(name_tok.value))
        return self._expr_statement(expr)

    def _expr_statement(self, expr):
        # Expression statements are calls (e.g. Protect("archive")).
        # Anything else on its own line is a parse error, not silent.
        if isinstance(expr, A.Call):
            return expr
        tok = self.peek()
        raise ParseError("Expected a statement but found an expression",
                         line=tok.line)

    # ------------------------------------------------------------ types
    def parse_type(self):
        base = self.expect("IDENT", "a type name")
        name = base.value
        if self.accept("LT"):
            args = [self.parse_type()]
            while self.accept("COMMA"):
                args.append(self.parse_type())
            self.expect("GT", "'>'")
            return "%s<%s>" % (name, ", ".join(args))
        return name

    # ------------------------------------------------------------ expressions
    def parse_expr(self):
        return self.parse_or()

    def parse_or(self):
        left = self.parse_and()
        while self.at("OR"):
            self.advance()
            left = A.BinOp("OR", left, self.parse_and())
        return left

    def parse_and(self):
        left = self.parse_not()
        while self.at("AND"):
            self.advance()
            left = A.BinOp("AND", left, self.parse_not())
        return left

    def parse_not(self):
        if self.at("NOT"):
            tok = self.advance()
            return A.UnaryOp("NOT", self.parse_not())
        return self.parse_comparison()

    def parse_comparison(self):
        left = self.parse_additive()
        ops = {"EQ": "EQ", "NEQ": "NEQ", "LT": "LT", "LE": "LE",
               "GT": "GT", "GE": "GE"}
        while self.peek().kind in ops:
            op = ops[self.advance().kind]
            left = A.BinOp(op, left, self.parse_additive())
        return left

    def parse_additive(self):
        left = self.parse_multiplicative()
        while self.peek().kind in ("PLUS", "MINUS"):
            op = "ADD" if self.advance().kind == "PLUS" else "SUB"
            left = A.BinOp(op, left, self.parse_multiplicative())
        return left

    def parse_multiplicative(self):
        left = self.parse_unary()
        while self.peek().kind in ("STAR", "SLASH", "PERCENT"):
            kind = self.advance().kind
            op = {"STAR": "MUL", "SLASH": "DIV", "PERCENT": "MOD"}[kind]
            left = A.BinOp(op, left, self.parse_unary())
        return left

    def parse_unary(self):
        if self.at("MINUS"):
            self.advance()
            return A.UnaryOp("NEG", self.parse_unary())
        return self.parse_postfix(self.parse_primary())

    def parse_postfix(self, expr):
        while True:
            if self.at("DOT"):
                self.advance()
                member = self.expect("IDENT", "a member name")
                expr = A.MemberAccess(expr, member.value)
            elif self.at("LPAREN"):
                self.advance()
                args = []
                if not self.at("RPAREN"):
                    while True:
                        args.append(self.parse_expr())
                        if not self.accept("COMMA"):
                            break
                self.expect("RPAREN", "')'")
                expr = A.Call(expr, args)
            else:
                return expr

    def parse_primary(self):
        tok = self.peek()
        if tok.kind == "INT":
            self.advance()
            return A.Literal(tok.value, "Int")
        if tok.kind == "FLOAT":
            self.advance()
            return A.Literal(tok.value, "Float")
        if tok.kind == "STRING":
            self.advance()
            return A.Literal(tok.value, "String")
        if tok.kind == "TRUE":
            self.advance()
            return A.Literal(True, "Bool")
        if tok.kind == "FALSE":
            self.advance()
            return A.Literal(False, "Bool")
        if tok.kind == "IDENT":
            self.advance()
            return A.Name(tok.value)
        if tok.kind == "LPAREN":
            self.advance()
            expr = self.parse_expr()
            self.expect("RPAREN", "')'")
            return expr
        raise ParseError("Expected an expression but found %r"
                         % (tok.value,), line=tok.line)


def parse(source):
    """Parse source text into an AST Program. Raises ParseError."""
    from .lexer import lex
    return Parser(lex(source)).parse_program()
