CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -O2

all: example test_client

example: example.cpp iroh.hpp
	$(CXX) $(CXXFLAGS) example.cpp -o example

test_client: test_client.cpp iroh.hpp
	$(CXX) $(CXXFLAGS) test_client.cpp -o test_client

test: test_client
	./test_client

clean:
	rm -f example test_client

.PHONY: all test clean
