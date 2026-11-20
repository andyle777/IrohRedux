"""Tests for the plain BASIC interpreter (src/basic.py, v1 subset).

Run from the irohscript directory:
    python3 -m unittest discover -s tests -v
"""

import io
import unittest

from src.basic import BasicError, BasicInterpreter


def run(source, inp=None):
    stream = io.StringIO(inp) if inp is not None else None
    interp = BasicInterpreter(input_stream=stream)
    return interp.run_source(source)["output"]


class TestBasicArithmetic(unittest.TestCase):
    def test_add_prints_30(self):
        self.assertEqual(run("10 LET X = 10\n20 LET Y = 20\n30 PRINT X + Y\n"),
                         ["30"])

    def test_unnumbered_lines(self):
        self.assertEqual(run("LET X = 2\nPRINT X * 3\n"), ["6"])

    def test_division_is_true_division(self):
        # Python-style, like the IrohScript bootstrap (open question).
        self.assertEqual(run("PRINT 7 / 2\n"), ["3.5"])

    def test_modulo_is_floored(self):
        self.assertEqual(run("PRINT -5 % 3\n"), ["1"])

    def test_string_concat(self):
        self.assertEqual(run('PRINT "hi" + " there"\n'), ["hi there"])

    def test_string_variable_suffix(self):
        self.assertEqual(run('LET A$ = "x"\nPRINT A$\n'), ["x"])

    def test_undeclared_reads_as_zero(self):
        self.assertEqual(run("PRINT Z + 1\n"), ["1"])

    def test_print_separators(self):
        self.assertEqual(run('PRINT "a"; "b", "c"\n'), ["ab c"])
        self.assertEqual(run('PRINT "a";\nPRINT "b"\n'), ["ab"])

    def test_rem_comment(self):
        self.assertEqual(run("10 REM hello\n20 PRINT 1\n"), ["1"])


class TestBasicControl(unittest.TestCase):
    def test_if_then_else(self):
        self.assertEqual(
            run('10 IF 5 > 3 THEN PRINT "yes" ELSE PRINT "no"\n'), ["yes"])
        self.assertEqual(
            run('10 IF 5 < 3 THEN PRINT "yes" ELSE PRINT "no"\n'), ["no"])

    def test_if_then_line_jump(self):
        prog = ("10 LET X = 5\n20 IF X > 10 THEN 100\n30 PRINT \"small\"\n"
                "40 END\n100 PRINT \"big\"\n")
        self.assertEqual(run(prog), ["small"])
        prog2 = ("10 LET X = 15\n20 IF X > 10 THEN 100\n30 PRINT \"small\"\n"
                 "40 END\n100 PRINT \"big\"\n")
        self.assertEqual(run(prog2), ["big"])

    def test_for_next(self):
        self.assertEqual(
            run("10 FOR I = 1 TO 3\n20 PRINT I\n30 NEXT I\n"),
            ["1", "2", "3"])

    def test_for_step(self):
        self.assertEqual(
            run("10 FOR I = 10 TO 0 STEP -3\n20 PRINT I\n30 NEXT I\n"),
            ["10", "7", "4", "1"])

    def test_for_zero_iterations(self):
        self.assertEqual(
            run("10 FOR I = 5 TO 1\n20 PRINT I\n30 NEXT I\n40 PRINT \"done\"\n"),
            ["done"])

    def test_for_sum(self):
        self.assertEqual(
            run("10 LET S = 0\n20 FOR I = 1 TO 5\n30 S = S + I\n40 NEXT I\n50 PRINT S\n"),
            ["15"])

    def test_nested_for(self):
        self.assertEqual(
            run("10 FOR I = 1 TO 2\n20 FOR J = 1 TO 2\n30 PRINT I * 10 + J\n40 NEXT J\n50 NEXT I\n"),
            ["11", "12", "21", "22"])

    def test_goto(self):
        self.assertEqual(
            run("10 PRINT \"a\"\n20 GOTO 40\n30 PRINT \"skipped\"\n40 PRINT \"b\"\n"),
            ["a", "b"])

    def test_gosub_return(self):
        prog = ("10 GOSUB 100\n20 PRINT \"back\"\n30 END\n"
                "100 PRINT \"sub\"\n110 RETURN\n")
        self.assertEqual(run(prog), ["sub", "back"])

    def test_nested_gosub(self):
        prog = ("10 GOSUB 100\n20 END\n"
                "100 GOSUB 200\n110 RETURN\n"
                "200 PRINT \"deep\"\n210 RETURN\n")
        self.assertEqual(run(prog), ["deep"])

    def test_colon_separated_statements(self):
        self.assertEqual(run("10 LET X = 1 : LET Y = 2 : PRINT X + Y\n"),
                         ["3"])


class TestBasicData(unittest.TestCase):
    def test_input_number(self):
        self.assertEqual(run("10 INPUT X\n20 PRINT X * 2\n", inp="21\n"),
                         ["42"])

    def test_input_prompt_and_string(self):
        self.assertEqual(
            run('10 INPUT "name? "; N$\n20 PRINT "hi "; N$\n', inp="Andy\n"),
            ["name? hi Andy"])

    def test_input_two_values(self):
        self.assertEqual(
            run("10 INPUT A, B\n20 PRINT A + B\n", inp="3, 4\n"), ["7"])

    def test_dim_and_array(self):
        prog = ("10 DIM A(3)\n20 A(1) = 42\n30 A(2) = A(1) + 1\n"
                "40 PRINT A(1)\n50 PRINT A(2)\n60 PRINT A(0)\n")
        self.assertEqual(run(prog), ["42", "43", "0"])

    def test_dim_two_dimensions(self):
        prog = ("10 DIM M(2, 2)\n20 M(1, 2) = 7\n30 PRINT M(1, 2)\n")
        self.assertEqual(run(prog), ["7"])


class TestBasicErrors(unittest.TestCase):
    def test_goto_undefined_line(self):
        with self.assertRaises(BasicError) as ctx:
            run("10 GOTO 99\n")
        self.assertIn("undefined line 99", str(ctx.exception))

    def test_return_without_gosub(self):
        with self.assertRaises(BasicError):
            run("10 RETURN\n")

    def test_next_without_for(self):
        with self.assertRaises(BasicError):
            run("10 NEXT I\n")

    def test_for_without_next(self):
        with self.assertRaises(BasicError):
            run("10 FOR I = 1 TO 3\n20 PRINT I\n")

    def test_division_by_zero(self):
        with self.assertRaises(BasicError):
            run("10 PRINT 1 / 0\n")

    def test_data_is_a_clear_error(self):
        with self.assertRaises(BasicError) as ctx:
            run("10 DATA 1, 2, 3\n")
        self.assertIn("DATA/READ is not in the v1 subset", str(ctx.exception))

    def test_while_is_a_clear_error(self):
        with self.assertRaises(BasicError) as ctx:
            run("10 WHILE X < 3\n20 PRINT X\n30 WEND\n")
        self.assertIn("WHILE/WEND is not in the v1 subset", str(ctx.exception))

    def test_for_in_if_part_is_a_clear_error(self):
        with self.assertRaises(BasicError) as ctx:
            run("10 IF 1 THEN FOR I = 1 TO 3\n")
        self.assertIn("not allowed in an IF THEN/ELSE part", str(ctx.exception))

    def test_array_without_dim(self):
        with self.assertRaises(BasicError):
            run("10 A(1) = 5\n")

    def test_input_bad_number(self):
        with self.assertRaises(BasicError):
            run("10 INPUT X\n", inp="abc\n")


if __name__ == "__main__":
    unittest.main()
