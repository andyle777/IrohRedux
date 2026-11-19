// Tests for the C++ Iroh client. Plain asserts, no test framework.
//
// Build & run:  g++ -std=c++17 -Wall -Wextra test_client.cpp -o test_client && ./test_client
// Run from the repo root so ./cli/iroh.js is found (or set IROH_CLI).
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
  return 0;
}
