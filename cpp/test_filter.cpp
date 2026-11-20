// Unit tests for the Itanium mangled-name filter in iroh_trace_rt.cpp
// (classify_mangled): std/__ names are filtered, user functions are
// kept — including user functions that take or return a std type, which
// a demangled-string test gets wrong. The runtime is #included so the
// anonymous-namespace classifier is visible; the hooks never fire in
// this binary (it is not compiled with -finstrument-functions).
//
//   g++ -std=c++17 -Wall -Wextra -O2 test_filter.cpp -o test_filter -ldl && ./test_filter

#include <cassert>
#include <cstdio>

#include "iroh_trace_rt.cpp"

static void check(const char* mangled, int expected) {
  int got = classify_mangled(mangled);
  if (got != expected) {
    std::fprintf(stderr, "FAIL: classify_mangled(%s) = %d, want %d\n",
                 mangled, got, expected);
    assert(false);
  }
}

int main() {
  // User functions — kept (0), even when std types are involved.
  check("_Z5greetNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE", 0);
  check("_Z3addii", 0);
  check("_Z3adddd", 0);
  check("_Z5twiceIiET_S0_", 0);
  check("_Z6helperi", 0);
  check("_ZN12_GLOBAL__N_110anon_helperEi", 0);  // anonymous namespace
  check("_ZZ4mainENKUliE_clEi", 0);              // lambda inside main
  check("main", 0);
  check("printf", 0);
  check("_ZN3foo3barEv", 0);                      // user namespace
  check("_ZThn8_N3foo3barEv", 0);                 // thunk to a user fn
  // Standard library / compiler internals — filtered (1).
  check("_ZNSt6vectorIiSaIiEE9push_backERKi", 1);
  check("_ZNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEEC1EPKcRKS3_", 1);
  check("_ZStplIcSt11char_traitsIcESaIcEESbIT_T0_T1_EPKS3_RKSbIS2_S1_S0_E", 1);
  check("_ZN9__gnu_cxx17__normal_iteratorIPiSt6vectorIiSaIiEEEppEv", 1);
  check("_ZSt4cout", 1);
  check("__cxa_demangle", 1);
  check("_ZThn8_NSt6vectorIiSaIiEED0Ev", 1);  // thunk to a std method
  std::printf("test_filter: all classify_mangled checks passed\n");
  return 0;
}
