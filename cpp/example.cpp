// Example: trace JavaScript from C++ with IrohRedux.
//
// Build:  g++ -std=c++17 -Wall -Wextra example.cpp -o example
// Run:    ./example            (from the repo root, so ./cli/iroh.js is found)
#include <iostream>

#include "iroh.hpp"

int main() {
  iroh::Client client;
  auto trace = client.run(
      "function factorial(n) {"
      "  if (n === 0) return 1;"
      "  return n * factorial(n - 1);"
      "}; factorial(3);",
      {"CALL", "IF"});

  for (const auto& e : trace.events) {
    const std::string& name = e["event"].as_string();
    if (name == "FUNCTION_CALL") {
      std::cout << "call factorial(" << e["arguments"].as_array()[0].as_number()
                << ")\n";
    } else if (name == "FUNCTION_CALL_END") {
      std::cout << "  -> returns " << e["return"].as_number() << "\n";
    }
  }
  std::cout << "result: " << trace.result.as_number() << "\n";
  return 0;
}
