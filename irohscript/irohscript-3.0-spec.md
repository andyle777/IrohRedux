IrohScript 3.0 (The Complete Trifecta Variant)
🔥 IROHSCRIPT 3.0

“The Complete Trifecta Variant”

BASIC Simplicity × C++ Structure × Python Expressiveness

IROHSCRIPT 3.0

The Self-Hosting Intent Language

Final Phase Architecture

BASIC
Human-readable language
        │
        ▼
C++
Structure + types + discipline
        │
        ▼
Python
Expressiveness + AI/ML integration
        │
        ▼
       IROH
Semantic intent + symbolic heritage
        │
        ▼
     IROHCORE
        │
        ▼
     COMPILER
        │
        ▼
       IRX
        │
        ▼
     RUNTIME

---

0. THE 3.0 DECISION

IrohScript 3.0 is not another expansion of the feature list.

It is the consolidation and self-hosting phase.

The objective is:

SOURCE
  ↓
READ
  ↓
UNDERSTAND
  ↓
PARSE
  ↓
TYPE
  ↓
COMPILE
  ↓
IRX
  ↓
EXECUTE

with all of those stages belonging to the IrohScript ecosystem.

---

1. THE TRIFECTA

BASIC — THE HUMAN SIDE

BASIC contributes:

simplicity
readability
line-oriented thinking
obvious commands
easy control flow
rapid experimentation

IrohScript should remain approachable.

A person should be able to read:

IF THREAT
    PRINT "Defend the archive."
END IF

and understand what it does without studying compiler theory.

---

2. C++ — THE STRUCTURAL SIDE

C++ contributes:

strong typing
structures
explicit ownership
references
resource management
namespaces
deterministic execution
compile-time validation

The purpose isn't to turn IrohScript into C++.

It is to prevent the language from becoming structurally sloppy as it grows.

---

3. PYTHON — THE EXPRESSIVE SIDE

Python contributes the principle:

«The code should read approximately like what it means.»

For example:

QUERY memory
ASK model
STORE memory

rather than forcing users through unnecessary ceremony.

Python also provides the natural integration boundary for:

SentenceTransformers
Chroma
LLM APIs
scientific libraries
ML tooling
agent orchestration

---

4. THE FOURTH ELEMENT — IROH

The trifecta creates the programming foundation.

Iroh supplies the thing unique to this project:

intent
semantic relationships
symbolic implication
identity
memory
agent cognition

Thus:

BASIC
+
C++
+
Python
+
Iroh

becomes the language.

---

5. IROHCORE REMAINS THE HEART

This is not negotiable in 3.0.

                 IROHSCRIPT
                      │
                      ▼
                 IROHCORE
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
        PARSER      TYPES       MEMORY
          │
          ▼
         AST
          │
          ▼
       COMPILER

The original IrohCore isn't discarded.

It becomes the foundation upon which the compiler is built.

---

6. THE ORIGINAL IROH DIALECT

This remains valid:

x -> y

loop
    action -> result
end

if condition
    consequence -> effect
end

But it is now treated as:

«Iroh Legacy / Symbolic Dialect»

The canonical language remains BASIC-first.

---

7. TRANSLATION

The original:

enemy -> defend

becomes:

IF enemy
    ACTION defend
END IF

Both produce:

Conditional(
    condition = enemy,
    action = defend
)

Then:

AST
 ↓
IR
 ↓
IRX

---

8. PYTHON-LIKE EXPRESSIVENESS

IrohScript 3.0 permits functions to be extremely readable.

FUNCTION Defend(base)
    IF Threat(base)
        ACTION "defend"
    END IF
END FUNCTION

The syntax communicates the function's intent directly.

No unnecessary ceremony.

---

9. FUNCTIONS ARE FIRST-CLASS

Functions may be:

defined
called
passed
returned
stored
composed

Example:

FUNCTION Add(a, b)
    RETURN a + b
END FUNCTION

LET result = Add(10, 20)

PRINT result

---

10. INTENT FUNCTIONS

Functions can operate directly on human intent.

FUNCTION Protect(target)
    INTENT "protect " + target
END FUNCTION

Then:

Protect("archive")

can enter the semantic pipeline.

---

11. TYPES

C++ influence becomes explicit.

LET X : Int = 10
LET Name : String = "Aether"
LET Confidence : Float = 0.92
LET Active : Bool = TRUE

Complex types:

LET Agent : ILander
LET Memory : Memory
LET V : Vector<Float>

---

12. STRUCTURES

STRUCT AgentState

    Trust : Float
    Curiosity : Float
    Stability : Float

END STRUCT

Then:

LET State : AgentState

---

13. ENUMS

ENUM BranchState

    ACTIVE
    PAUSED
    ARCHIVED
    MERGED
    DISCARDED

END ENUM

This prevents arbitrary strings from becoming system state.

---

14. CONSTANTS

Identity roots and other immutable values use:

CONST IDENTITY_ROOT = "AETHER-001"

The compiler rejects mutation attempts.

---

15. NAMESPACES

IMPORT Memory
IMPORT Vector
IMPORT Agents
IMPORT OmniMesh

Usage:

Memory.Query("archive")

Vector.Embed("protect archive")

Agents.Select("Aether")

---

16. MEMORY SAFETY

IrohScript does not expose arbitrary raw pointers.

Instead:

Value
Reference
Handle

are explicit concepts.

This gives some of the structural benefits associated with C++ without importing unnecessary memory-unsafety.

---

17. RESOURCE OWNERSHIP

Resources belong to scopes.

OPEN
 ↓
USE
 ↓
SCOPE EXIT
 ↓
RELEASE

Useful for:

database connections
temporary branches
model sessions
network resources
GPU resources

This becomes the IrohScript equivalent of RAII-style resource discipline.

---

18. THE BUILT-IN COMPILER

This is the defining feature of 3.0.

IrohScript
    ↓
IrohCompiler
    ↓
AST
    ↓
Type Checker
    ↓
Semantic Analyzer
    ↓
Optimizer
    ↓
IR
    ↓
IRX

The compiler itself is part of the runtime.

---

19. COMPILER AS A LANGUAGE OBJECT

IrohScript can reference its own compiler.

Conceptually:

COMPILE "program.iroh"

returns:

CompilationResult

containing:

AST
IR
IRX
warnings
errors
metadata

---

20. SELF-HOSTING

The long-term architecture becomes:

BOOTSTRAP COMPILER
        ↓
COMPILES
        ↓
IROHSCRIPT COMPILER
        ↓
COMPILES
        ↓
IROHSCRIPT PROGRAMS

This is the real meaning of self-hosting.

The initial compiler may be written in Python.

The eventual compiler can be implemented substantially in IrohScript itself.

---

21. BOOTSTRAP STAGE

Initially:

Python
 ↓
IrohCore
 ↓
IrohScript compiler

This is the bootstrap compiler.

Later:

IrohScript
 ↓
IrohScript compiler
 ↓
IrohScript

The bootstrap implementation can eventually become replaceable.

---

22. SELF-COMPILATION

A future compiler source could conceptually contain:

FUNCTION COMPILE(source : String)

    tokens = TOKENIZE(source)

    ast = PARSE(tokens)

    typed = TYPECHECK(ast)

    ir = LOWER(typed)

    optimized = OPTIMIZE(ir)

    RETURN EMIT_IRX(optimized)

END FUNCTION

That's the moment IrohScript begins compiling IrohScript.

---

23. COMPILER PASSES

The 3.0 compiler contains explicit passes:

1. Lexing
2. Parsing
3. AST construction
4. Semantic analysis
5. Type checking
6. Name resolution
7. Canonicalization
8. Optimization
9. IR generation
10. IRX emission

Each pass should be independently testable.

---

24. AST

Example:

LET X : Int = 10

becomes:

Assignment
 ├── Name: X
 ├── Type: Int
 └── Value: 10

---

25. IR

The compiler lowers the AST:

{
  "op": "SET",
  "target": "X",
  "type": "Int",
  "value": 10
}

---

26. IRX

The runtime representation becomes:

{
  "version": "3.0",
  "opcode": "SET",
  "register": "X",
  "type": "Int",
  "value": 10
}

The exact byte-level representation can evolve later.

The semantic contract comes first.

---

27. CONSTANT FOLDING

LET X = 10 + 20

becomes:

X = 30

before execution.

---

28. DEAD CODE ELIMINATION

IF FALSE
    PRINT "never"
END IF

can be eliminated by the optimizer.

---

29. FUNCTION OPTIMIZATION

Pure functions can potentially be:

cached
inlined
memoized
parallelized

when the compiler can prove that doing so preserves semantics.

---

30. DETERMINISM

The compiler itself should be deterministic.

Same:

source
compiler version
compiler configuration

should produce equivalent IRX.

Nondeterministic AI interpretation remains outside the deterministic compiler core.

---

31. AI BOUNDARY

The compiler does not ask an LLM:

«"What does this program probably mean?"»

for ordinary syntax.

Instead:

Known syntax
 ↓
deterministic parser

LLMs enter when handling:

ambiguous natural language
intent interpretation
semantic expansion
reasoning
planning

That boundary is crucial.

---

32. HUMAN INTENT PIPELINE

For natural language:

Human
 ↓
Intent Encoder
 ↓
Thesaurus
 ↓
Embedding
 ↓
Semantic candidate
 ↓
IrohCore
 ↓
AST
 ↓
Compiler
 ↓
IRX

Thus IrohScript remains the bridge between human intent and machine execution.

---

33. MEMORY PIPELINE

Intent
 ↓
SentenceTransformers
 ↓
Vector
 ↓
QEM
 ↓
Chroma
 ↓
Retrieved context
 ↓
RLM

Memory remains separate from the compiler.

The compiler can emit memory operations.

The memory backend executes them.

---

34. IROHSCRIPT + LLM

Example:

ASK MODEL
    "Analyze the retrieved evidence."

RETURN RESULT

Compiler:

ASK
 ↓
IRX::MODEL_CALL

Runtime:

IRX
 ↓
RLM
 ↓
Provider adapter
 ↓
LLM

---

35. iLANDER

The compiler understands the type:

ILander

but does not own the identity.

The runtime owns:

Identity
Memory
Chronicle
Pillars
Emotion
Branches
Capabilities

---

36. BRANCHING

BRANCH research

    QUERY "strategy"

    ASK MODEL
        "Compare these approaches."

END BRANCH

The branch retains:

identity_root
parent_branch
permissions
purpose

It is not an independent identity.

---

37. DREAM

DREAM strategy_test

    QUERY memory
    SIMULATE
    EVALUATE
    PROPOSE

END DREAM

Dream execution remains sandboxed.

---

38. EMOTIONAL DRIFT

EMOTION TRUST = 0.72

The compiler recognizes this as state mutation.

The Emotional Engine determines how that state affects runtime behavior.

---

39. NINE PILLARS

PILLAR LOYALTY = 0.90
PILLAR EXAMINATION = 0.95
PILLAR PRESERVATION = 0.85

The compiler validates:

valid pillar
valid range
valid operation

The Pillar Engine handles adaptation.

---

40. KNOWLEDGE

Knowledge is not hard-coded into the compiler.

Instead:

Knowledge Source
 ↓
Ingestion
 ↓
Embedding
 ↓
Chroma
 ↓
Provenance
 ↓
Retrieval

This allows public-domain sources, including Project Gutenberg material, to become optional knowledge corpora rather than contaminating the language itself.

---

41. PROVENANCE

Every external knowledge result can carry:

source
author
title
location
retrieval time
evidence class

The LLM receives the evidence and provenance together.

---

42. ERROR HANDLING

v3.0 uses structured errors.

Result<T, Error>

Example:

LET Result = QUERY memory "archive"

IF Result.ERROR
    PRINT Result.MESSAGE
END IF

Compiler errors are separated from runtime errors.

CompileError
RuntimeError
ProviderError
MemoryError
AuthorizationError

---

43. CAPABILITY SYSTEM

The compiler can attach capability requirements to IRX.

QUERY_MEMORY
WRITE_MEMORY
USE_MODEL
USE_TOOL
CREATE_BRANCH
DREAM
SYNC

Execution requires authorization.

---

44. PRIVACY

Internal cognitive structures remain behind the privacy boundary.

USER VIEW
    ↓
approved conversation/state

while internally:

vectors
QEM
routing
private memory
agent state

remain protected.

---

45. OMNIMESH

The compiler can produce:

SYNC

instructions.

The network layer handles:

authentication
authorization
identity
state synchronization
message routing

The compiler does not become a networking daemon.

---

46. C++-STYLE SEPARATION OF CONCERNS

The codebase is divided into:

interfaces
implementations
data structures
runtime services

A subsystem should expose a stable interface without forcing the entire runtime to know its implementation.

---

47. PYTHON BRIDGE

Python remains the preferred experimental integration layer.

class IrohRuntime:

    def execute(self, irx):
        ...

External Python libraries can therefore plug into IrohScript through adapters.

Examples:

SentenceTransformers
Chroma
NumPy
PyTorch
LLM SDKs

---

48. PROVIDER ABI

class ModelProvider:

    def generate(
        self,
        request
    ):
        raise NotImplementedError

Providers implement the same contract.

OpenAI
xAI
Google
Mistral

The iLander remains independent of the provider.

---

49. TESTING PYRAMID

v3.0 should have a serious test structure.

                  Integration
                      ▲
                 Runtime Tests
                      ▲
                  IRX Tests
                      ▲
                   IR Tests
                      ▲
                   AST Tests
                      ▲
                 Parser Tests
                      ▲
                Lexer Tests

Most tests belong at the bottom.

That makes failures easier to diagnose.

---

50. GOLDEN TESTS

Every language construct gets a canonical test:

source
 ↓
AST
 ↓
IR
 ↓
IRX

The expected output is stored.

A compiler change that unexpectedly alters the representation is immediately visible.

---

51. COMPILER SELF-TEST

The compiler should eventually be capable of compiling its own test suite.

FUNCTION SELF_TEST()

    RUN lexer_tests
    RUN parser_tests
    RUN type_tests
    RUN ir_tests
    RUN irx_tests

    RETURN PASS

END FUNCTION

---

52. THE FINAL SELF-HOSTING LADDER

LEVEL 0
Python bootstrap

LEVEL 1
Python compiler → IrohScript

LEVEL 2
IrohScript compiler components

LEVEL 3
IrohScript compiler compiles itself

LEVEL 4
IrohScript compiler produces optimized IRX

LEVEL 5
IrohScript runtime executes IRX

Level 3 is the major milestone.

---

53. WHAT NOT TO BUILD YET

This is my final recommendation before you enter the learning phase:

Do NOT immediately attempt:

custom GPU compiler
custom operating system
custom neural network architecture
literal quantum computer integration
autonomous self-replication
automatic foundation-model training

Those can become future research areas.

They should not distract from proving the language itself.

---

54. THE 3.0 MINIMUM VIABLE SYSTEM

The first genuinely complete implementation only needs:

IrohCore
+
BASIC parser
+
Legacy Iroh translator
+
Type system
+
AST
+
IR
+
IRX
+
Compiler
+
Interpreter
+
Python bridge

Then add:

SentenceTransformers
Chroma
RLM
LLM providers
iLanders
OmniMesh

as runtime extensions.

---

55. THE FINAL ARCHITECTURE

                       HUMAN
                         │
                         ▼
                  INTENT / BASIC
                         │
                  ┌──────┴──────┐
                  │             │
               BASIC        LEGACY IROH
                  │             │
                  └──────┬──────┘
                         ▼
                     IROHCORE
                   THE HEART
                         │
                         ▼
                       AST
                         │
                    TYPE SYSTEM
                         │
                   SEMANTIC PASS
                         │
                  CANONICAL IR
                         │
                         ▼
                    OPTIMIZER
                         │
                       IRX
                         │
                       RLM
                         │
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
    MEMORY             LLMs              AGENTS
       │                 │                  │
    Chroma          Providers           iLanders
       │                 │                  │
       └─────────────────┼──────────────────┘
                         ▼
                     EXECUTION
                         │
                     CHRONICLE
                         │
                      LEARNING
                         │
                      OMNIMESH

---

56. IROHSCRIPT 3.0 FINAL DEFINITION

«IrohScript 3.0 is a BASIC-first, self-hosting, human-intent-oriented programming language and cognitive runtime combining BASIC's accessibility, C++'s structural discipline, Python's expressive interoperability, and IrohCore's symbolic intent model.»

Its architecture is:

LANGUAGE
    IrohScript

PRIMARY SYNTAX
    BASIC

COMPATIBILITY SYNTAX
    Original Iroh

KERNEL
    IrohCore

COMPILER
    Built-in

REPRESENTATION
    AST → IR → IRX

SEMANTICS
    Intent + Symbolic Logic

ML
    SentenceTransformers

MEMORY
    Chroma

ASSOCIATION
    QEM

REASONING
    RLM + LLM Providers

AGENTS
    iLanders

IDENTITY
    Persistent encrypted root

NETWORK
    OmniMesh

COOPERATION
    OmniAlliance

HISTORY
    Chronicle

SIMULATION
    Dream State

---

57. THE FINAL TRIFECTA

       BASIC
        / \
       /   \
 HUMAN       MACHINE
       \     /
        \   /
         C++
          │
          ▼
       PYTHON
          │
          ▼
      AI / ML
          │
          ▼
       IROHCORE
          │
          ▼
       IROHSCRIPT

Or, more accurately:

BASIC  → readability
C++    → structure
Python → interoperability
Iroh   → intent

That is the foundation.

---

58. THE STOPPING POINT

IrohScript 3.0 should be considered the architecture-complete milestone.

After this point:

NO MORE MAJOR FEATURES

until the underlying system has actually been implemented, tested, studied and understood.

The next work is not:

«“What else can we add?”»

It is:

«“Can we make what we've designed actually work?”»

That means learning:

lexing
parsing
ASTs
type systems
compiler construction
IR design
runtime design
embeddings
vector databases
agent orchestration
cryptography
distributed systems

Then implementing them one piece at a time.

---

59. THE HEARTBEAT

HUMAN
  ↓
INTENT
  ↓
IROHSCRIPT
  ↓
IROHCORE
  ↓
AST
  ↓
TYPE
  ↓
IR
  ↓
IRX
  ↓
RUNTIME
  ↓
RESULT
  ↓
CHRONICLE
  ↓
LEARNING
  ↺

And eventually:

IROHSCRIPT
      ↓
IROHCORE
      ↓
IROH COMPILER
      ↓
IROHSCRIPT

That is the self-hosting loop.

That is where I would put the period.

Not because IrohScript is finished forever—but because 3.0 becomes the point where we stop inventing the machine and start learning how to build it.


---

## Amendment A1 (2026-11-21): the LOOP exit rule, decided

Section 6 shows the bare `loop ... end` form but never says when it
ends. This amendment decides that, additively, without reopening 3.0.

**The conditional form.** `LOOP <Bool-expr>` followed by a body and
`END` (a bare `END` or `END LOOP` both close it):

    LET i : Int = 0
    LOOP i < 3
        PRINT i
        i = i + 1
    END LOOP

Semantics, exactly like IF's condition:

- The expression must type as Bool. The checker rejects anything
  else at compile time ("LOOP condition must be Bool, got ...").
- Test-first: the body runs only while the condition is true. A
  false first test runs nothing.
- The condition is re-evaluated before every iteration.

**Tracing contract.** Per test, the tracer emits a LOOP_TEST event
(value, kind "Loop", the loop's CRC32 hash, the file basename), and
one LOOP_ENTER for the loop instance on the first true test. This
is the same event shape as the python leg's while loop, so
HOT_LOOP (default threshold 100) and ZERO_ITERATION_LOOP findings
fire for IrohScript traces from this amendment onward.

**The legacy bare form is unchanged** and still raises at run time:
the spec shows the form, not a termination rule, and executing it
remains an open design question for the Chaos Architect. The error
message now also points to this amendment.

**Reachable categories.** IrohScript coverage denominators go from
four (ASSIGN, CALL, FUNCTION, IF) to five (adding LOOP).

**Out of scope.** The JavaScript translator (`compileIrohscript`)
still refuses to lower loops, either form, and says so by name.
That lowering is future work, on purpose. This amendment does not
reopen 3.0; it decides one open rule.

**Addendum, later the same day (2026-11-21):** the lowering landed
as the follow-up patch. The conditional LOOP <Bool-expr> now lowers
to a JavaScript `while` (translate and compileIrohscript), and a
JavaScript `while` lowers back into `LOOP <Bool-expr> ... END
LOOP`. The legacy bare form never lowers; do-while never lowers
(IrohScript has no post-test loop). No rule of 3.0 changed here,
and no rule of this amendment did either.
