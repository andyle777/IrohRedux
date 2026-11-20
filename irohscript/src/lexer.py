"""IrohScript 3.0 — lexer (compiler pass 1).

Turns source text into a token stream. Keywords are matched
case-insensitively (BASIC tradition); identifiers keep their case.
Newlines are significant: they separate statements.

Tokens carry (kind, value, line, column) so every later pass can point at
the source line that failed.

Line comments start with ``#`` and run to end of line. They are a
bootstrap convenience, not a spec construct, and are stripped here.
"""

import re

from .errors import LexError

KEYWORDS = {
    "LET", "CONST", "FUNCTION", "END", "IF", "ELSE", "PRINT", "RETURN",
    "ACTION", "STRUCT", "ENUM", "IMPORT", "INTENT", "LOOP",
    "TRUE", "FALSE", "AND", "OR", "NOT",
}

# Order matters: multi-character operators before their prefixes.
TOKEN_SPEC = [
    ("NEWLINE", r"\n"),
    ("SKIP", r"[ \t\r]+"),
    ("COMMENT", r"#[^\n]*"),
    ("STRING", r'"(?:[^"\\]|\\.)*"'),
    ("FLOAT", r"\d+\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+"),
    ("INT", r"\d+"),
    ("ARROW", r"->"),
    ("EQ", r"=="),
    ("NEQ", r"!="),
    ("LE", r"<="),
    ("GE", r">="),
    ("ASSIGN", r"="),
    ("LT", r"<"),
    ("GT", r">"),
    ("PLUS", r"\+"),
    ("MINUS", r"-"),
    ("STAR", r"\*"),
    ("SLASH", r"/"),
    ("PERCENT", r"%"),
    ("COLON", r":"),
    ("COMMA", r","),
    ("DOT", r"\."),
    ("LPAREN", r"\("),
    ("RPAREN", r"\)"),
    ("IDENT", r"[A-Za-z_][A-Za-z0-9_]*"),
    ("MISMATCH", r"."),
]

_MASTER = re.compile("|".join("(?P<%s>%s)" % pair for pair in TOKEN_SPEC))


class Token:
    """One lexical token."""

    __slots__ = ("kind", "value", "line", "col")

    def __init__(self, kind, value, line, col):
        self.kind = kind
        self.value = value
        self.line = line
        self.col = col

    def __repr__(self):
        return "Token(%s, %r, line %d)" % (self.kind, self.value, self.line)

    def __eq__(self, other):
        return (isinstance(other, Token) and self.kind == other.kind
                and self.value == other.value and self.line == other.line)

    def __hash__(self):
        return hash((self.kind, self.value, self.line))


def _unescape(text):
    """Unescape a double-quoted string literal (inner text, quotes removed)."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            mapping = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
            out.append(mapping.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def lex(source):
    """Lex `source` into a list of Tokens, ending with an EOF token."""
    tokens = []
    line = 1
    line_start = 0
    for match in _MASTER.finditer(source):
        kind = match.lastgroup
        text = match.group()
        col = match.start() - line_start + 1
        if kind == "NEWLINE":
            tokens.append(Token("NEWLINE", "\n", line, col))
            line += 1
            line_start = match.end()
        elif kind in ("SKIP", "COMMENT"):
            continue
        elif kind == "MISMATCH":
            raise LexError("Unexpected character %r" % text, line=line)
        elif kind == "STRING":
            tokens.append(Token("STRING", _unescape(text[1:-1]), line, col))
        elif kind == "IDENT":
            upper = text.upper()
            if upper in KEYWORDS:
                tokens.append(Token(upper, text, line, col))
            else:
                tokens.append(Token("IDENT", text, line, col))
        elif kind == "INT":
            tokens.append(Token("INT", int(text), line, col))
        elif kind == "FLOAT":
            tokens.append(Token("FLOAT", float(text), line, col))
        else:
            tokens.append(Token(kind, text, line, col))
    tokens.append(Token("EOF", None, line, 1))
    return tokens
