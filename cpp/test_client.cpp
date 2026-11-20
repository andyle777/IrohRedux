// Tests for the C++ Iroh client. Plain asserts, no test framework.
//
// Build & run:  g++ -std=c++17 -Wall -Wextra test_client.cpp -o test_client && ./test_client
// Run from the repo root so ./cli/iroh.js is found (or set IROH_CLI).
#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <string>
#include <vector>

#include "iroh.hpp"

static std::vector<double> call_args(const iroh::Trace& t) {
  std::vector<double> out;
  for (const auto& e : t.events) {
    if (e["event"].as_string() == "FUNCTION_CALL") {
      out.push_back(e["arguments"].as_array()[0].as_number());
    }
  }
  return out;
}

static std::vector<double> call_returns(const iroh::Trace& t) {
  std::vector<double> out;
  for (const auto& e : t.events) {
    if (e["event"].as_string() == "FUNCTION_CALL_END") {
      out.push_back(e["return"].as_number());
    }
  }
  return out;
}

int main() {
  iroh::Client client;

  // factorial: calls [3,2,1,0], returns [1,1,2,6], result 6.
  {
    auto trace = client.run(
        "function factorial(n) {"
        "  if (n === 0) return 1;"
        "  return n * factorial(n - 1);"
        "}; factorial(3);",
        {"CALL", "IF"});
    assert(trace.has_result);
    assert(trace.result.as_number() == 6);
    assert((call_args(trace) == std::vector<double>{3, 2, 1, 0}));
    assert((call_returns(trace) == std::vector<double>{1, 1, 2, 6}));
  }

  // Arrow map: result [2,4,6].
  {
    auto trace = client.run("let x = [1,2,3].map(v => v * 2); x;", {"VAR"});
    assert(trace.has_result);
    const auto& arr = trace.result.as_array();
    assert(arr.size() == 3 && arr[0].as_number() == 2 && arr[1].as_number() == 4 &&
           arr[2].as_number() == 6);
  }

  // Async programs are awaited.
  {
    auto trace = client.run(
        "async function f() { return await Promise.resolve(42); } f();",
        {"AWAIT"});
    assert(trace.has_result && trace.result.as_number() == 42);
    int awaits = 0;
    for (const auto& e : trace.events) {
      if (e["event"].as_string() == "AWAIT") ++awaits;
    }
    assert(awaits == 1);
  }

  // Parse error raises TraceError with a SyntaxError name.
  {
    bool threw = false;
    try {
      client.run("let x = ;");
    } catch (const iroh::TraceError& e) {
      threw = true;
      assert(e.name == "SyntaxError");
    }
    assert(threw);
  }

  // Runtime error keeps the events that fired before it.
  {
    bool threw = false;
    try {
      client.run("let a = 1; throw new Error('boom');");
    } catch (const iroh::TraceError& e) {
      threw = true;
      assert(std::string(e.what()) == "boom");
      assert(!e.events.empty());
    }
    assert(threw);
  }

  std::cout << "All C++ client tests passed.\n";

  // --- Native C++ tracer (0.9.0): iroh::native::Tracer -------------
  {
    iroh::native::Tracer tracer;

    // factorial: calls [factorial x4], returns, result is the exit code.
    auto trace = tracer.trace_code(
        "int factorial(int n) {"
        "  if (n == 0) return 1;"
        "  return n * factorial(n - 1);"
        "}"
        "int main() { return factorial(3); }");
    assert(trace.has_exit_code);
    assert(trace.exit_code == 6);  // main returns factorial(3)
    std::vector<std::string> names;
    for (const auto& e : trace.events) {
      if (e["event"].as_string() == "FUNCTION_CALL") {
        names.push_back(e["name"].as_string());
      }
    }
    // main + 4 factorial calls; std:: internals are filtered out.
    assert(names.size() == 5);
    assert(names[0] == "main");
    assert(names[1] == "factorial(int)");
    assert(names[4] == "factorial(int)");
    // Depth: main at 0, factorial(3)..(0) at 1..4.
    std::vector<double> indents;
    for (const auto& e : trace.events) {
      if (e["event"].as_string() == "FUNCTION_ENTER") {
        indents.push_back(e["indent"].as_number());
      }
    }
    assert((indents == std::vector<double>{0, 1, 2, 3, 4}));
    // Every call has an address, never a faked name.
    for (const auto& e : trace.events) {
      assert(e["address"].is_string());
      assert(!e["address"].as_string().empty());
    }
  }

  // Deep recursion: 31 nested calls, exit code 31.
  {
    iroh::native::Tracer tracer;
    auto trace = tracer.trace_code(
        "int countdown(int n) {"
        "  if (n == 0) return 0;"
        "  return countdown(n - 1) + 1;"
        "}"
        "int main() { return countdown(30); }");
    assert(trace.has_exit_code && trace.exit_code == 30);
    double max_indent = 0;
    for (const auto& e : trace.events) {
      if (e["event"].as_string() == "FUNCTION_ENTER") {
        max_indent = std::max(max_indent, e["indent"].as_number());
      }
    }
    assert(max_indent == 31);
  }

  // A compile error raises TraceError, not a crash.
  {
    iroh::native::Tracer tracer;
    bool threw = false;
    try {
      tracer.trace_code("int main() { return ; }");
    } catch (const iroh::TraceError& e) {
      threw = true;
      assert(std::string(e.what()).find("Compilation failed") != std::string::npos);
    }
    assert(threw);
  }

  std::cout << "All C++ native tracer tests passed.\n";
  return 0;
}
