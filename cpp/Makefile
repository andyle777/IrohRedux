CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -O2

all: example test_client

example: example.cpp iroh.hpp
	$(CXX) $(CXXFLAGS) example.cpp -o example

test_client: test_client.cpp iroh.hpp
	$(CXX) $(CXXFLAGS) test_client.cpp -o test_client

test_filter: test_filter.cpp iroh_trace_rt.cpp
	$(CXX) $(CXXFLAGS) test_filter.cpp -o test_filter -ldl

test: test_client test_filter
	./test_client
	./test_filter

clean:
	rm -f example test_client test_filter

.PHONY: all test clean
