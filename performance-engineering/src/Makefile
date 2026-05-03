CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra

nbody: nbody.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

clean:
	rm -f nbody trajectory.bin

.PHONY: clean
