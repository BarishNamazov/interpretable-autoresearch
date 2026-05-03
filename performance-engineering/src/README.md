# N-body simulator (naive)

A small, intentionally unoptimized 3-D gravitational N-body simulator in C++.
The code is the *starting point* for the autoresearch performance loop
described in `../program.md`.

## Layout

- `nbody.cpp` — single-file simulator. Direct O(N²) pairwise forces,
  semi-implicit Euler integration, AoS body layout. Compiled to `./nbody`.
- `Makefile` — builds `nbody` with `-O2 -std=c++17`. `make` to build,
  `make clean` to wipe.
- `visualize.py` — reads a `-dump` trajectory file and renders a 2-D
  projection (matplotlib). Used to sanity-check that optimizations have not
  silently broken the physics.

There is **no benchmark harness yet** — establishing one is part of the
agent's `Discovering` reaction (R0 in `program.md`).

## Build & run

```sh
make
./nbody                                    # defaults: n=1024, steps=200
./nbody -n 512 -s 500 -seed 7
./nbody -n 256 -s 400 -dump trajectory.bin  # for visualization
```

Flags:

| flag    | meaning                                     | default |
| ------- | ------------------------------------------- | ------- |
| `-n`    | number of bodies                            | 1024    |
| `-s`    | number of timesteps                         | 200     |
| `-dt`   | timestep size                               | 0.001   |
| `-seed` | RNG seed for initial positions / velocities | 42      |
| `-dump` | write binary trajectory to PATH             | (off)   |
| `-every`| dump every K-th frame                       | 1       |

## Output

`nbody` prints flat key/value pairs to stdout:

```
n: 1024
steps: 200
checksum: <float>
```

The `checksum` is a position-weighted sum of the final body coordinates.
It is the **correctness anchor**: any optimization must reproduce the
baseline checksum to within a small numerical tolerance (e.g. ~1e-6
relative). A run whose checksum drifts is a failed experiment.

There is no separate test suite. Checksum equivalence to the baseline is
the regression check.

## Visualization

```sh
./nbody -n 256 -s 400 -dump trajectory.bin
python visualize.py trajectory.bin           # interactive
python visualize.py trajectory.bin out.gif   # save
```

Requires `numpy` and `matplotlib`. The visualization is for human inspection
only — it is not part of the benchmark or the correctness check.

## Physics, briefly

Pairwise gravity with softening:

    a_i = sum_{j != i} G * m_j * (r_j - r_i) / (|r_j - r_i|² + ε²)^(3/2)

`G = 1`, `ε = 1e-3`, masses normalized so total mass = 1. Initial positions
uniform in the unit cube; initial velocities small and random. Integration
is semi-implicit Euler (velocity updated first, then position). This
integrator is not symplectic and energy will drift over long horizons —
that is fine; the benchmark fixes step count, so the same drift happens
identically every run, and the checksum stays reproducible.

## Known characteristics (do not pre-optimize)

The agent should discover these via profiling, not from this README. Listed
here only so a human reader is not surprised:

- Force loop is O(N²) with no use of Newton's third law (every pair is
  computed twice).
- Bodies are stored AoS (`struct Body { ... }; vector<Body>`).
- `std::sqrt` is called once per (i, j) pair.
- Acceleration buffers are reallocated each step.
- Single-threaded.

## Constraints relevant to `program.md`

- Modifications happen under `src/` only.
- Do not change the public meaning of `checksum` or the CLI flags — the
  benchmark and visualization both depend on them.
- The `-dump` path and binary format are part of the contract with
  `visualize.py`. If you change the layout, update `visualize.py` in the
  same change.
- `make` must continue to produce `./nbody`. Adjust `CXXFLAGS` in the
  `Makefile` rather than hard-coding flags in build commands.
