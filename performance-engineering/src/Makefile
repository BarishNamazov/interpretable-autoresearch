CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++17 -Wall -Wextra -march=native

nbody: nbody.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

clean:
	rm -f nbody trajectory.bin

.PHONY: clean
