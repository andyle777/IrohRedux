"""Lexer tests (spec section 49: most tests at the bottom)."""

import unittest

from src.errors import LexError
from src.lexer import Token, lex


def kinds(source):
    return [(t.kind, t.value) for t in lex(source)]


class TestLexerBasics(unittest.TestCase):
    def test_keywords_case_insensitive(self):
        toks = lex("let x = 1\nLET y = 2\nLet z = 3")
        kinds_list = [t.kind for t in toks]
        self.assertEqual(kinds_list.count("LET"), 3)

    def test_identifiers_keep_case(self):
        toks = lex("LET myVar = 1")
        self.assertEqual(toks[1].value, "myVar")

    def test_int_literal(self):
        toks = lex("42")
        self.assertEqual((toks[0].kind, toks[0].value), ("INT", 42))

    def test_float_literal(self):
        toks = lex("0.92")
        self.assertEqual((toks[0].kind, toks[0].value), ("FLOAT", 0.92))

    def test_float_exponent(self):
        toks = lex("1e21")
        self.assertEqual((toks[0].kind, toks[0].value), ("FLOAT", 1e21))

    def test_string_literal(self):
        toks = lex('"hello"')
        self.assertEqual((toks[0].kind, toks[0].value), ("STRING", "hello"))

    def test_string_escape(self):
        toks = lex(r'"a\"b"')
        self.assertEqual(toks[0].value, 'a"b')

    def test_string_newline_escape(self):
        toks = lex(r'"a\nb"')
        self.assertEqual(toks[0].value, "a\nb")

    def test_arrow_operator(self):
        toks = lex("x -> y")
        self.assertEqual([t.kind for t in toks[:3]],
                         ["IDENT", "ARROW", "IDENT"])

    def test_comparison_operators(self):
        toks = lex("a == b != c <= d >= e < f > g")
        ops = [t.kind for t in toks
               if t.kind in ("EQ", "NEQ", "LE", "GE", "LT", "GT")]
        self.assertEqual(ops, ["EQ", "NEQ", "LE", "GE", "LT", "GT"])

    def test_arithmetic_operators(self):
        toks = lex("a + b - c * d / e % f")
        ops = [t.kind for t in toks
               if t.kind in ("PLUS", "MINUS", "STAR", "SLASH", "PERCENT")]
        self.assertEqual(ops, ["PLUS", "MINUS", "STAR", "SLASH", "PERCENT"])

    def test_punctuation(self):
        toks = lex("f(a, b) : Vector<Float> x.y")
        kinds_list = [t.kind for t in toks]
        for expected in ("LPAREN", "COMMA", "RPAREN", "COLON", "LT",
                         "GT", "DOT"):
            self.assertIn(expected, kinds_list)

    def test_newlines_are_tokens(self):
        toks = lex("a\nb\nc")
        self.assertEqual([t.kind for t in toks if t.kind == "NEWLINE"],
                         ["NEWLINE", "NEWLINE"])

    def test_comments_stripped(self):
        toks = lex("LET x = 1 # a comment\nPRINT x")
        values = [t.value for t in toks if t.kind == "IDENT"]
        self.assertEqual(values, ["x", "x"])

    def test_comment_only_line(self):
        toks = lex("# hello\nLET x = 1")
        self.assertEqual(toks[0].kind, "NEWLINE")

    def test_eof_token_last(self):
        toks = lex("LET x = 1")
        self.assertEqual(toks[-1].kind, "EOF")

    def test_line_numbers(self):
        toks = lex("LET a = 1\nLET b = 2")
        b_tok = [t for t in toks if t.value == "b"][0]
        self.assertEqual(b_tok.line, 2)

    def test_true_false_keywords(self):
        toks = lex("TRUE FALSE")
        self.assertEqual([t.kind for t in toks[:2]], ["TRUE", "FALSE"])

    def test_unexpected_character(self):
        with self.assertRaises(LexError):
            lex("LET x = @")

    def test_unterminated_string(self):
        with self.assertRaises(LexError):
            lex('PRINT "oops')


class TestLexerTokenEquality(unittest.TestCase):
    def test_token_equality(self):
        self.assertEqual(Token("INT", 1, 1, 1), Token("INT", 1, 1, 1))
        self.assertNotEqual(Token("INT", 1, 1, 1), Token("INT", 2, 1, 1))


if __name__ == "__main__":
    unittest.main()
