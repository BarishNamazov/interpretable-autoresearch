#!/usr/bin/env python3
"""End-to-end benchmark for the n-body simulator."""

import argparse
import math
import os
import statistics
import subprocess
import sys
import time


def parse_kv(output):
    values = {}
    for line in output.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--n", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--dt", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--expected-checksum", type=float)
    parser.add_argument("--checksum-rtol", type=float, default=1e-6)
    args = parser.parse_args()

    if args.runs <= 0:
        raise SystemExit("--runs must be positive")

    subprocess.run(["make", "-C", "src"], check=True, stdout=subprocess.DEVNULL)

    command = [
        os.path.join("src", "nbody"),
        "-n",
        str(args.n),
        "-s",
        str(args.steps),
        "-dt",
        str(args.dt),
        "-seed",
        str(args.seed),
    ]

    elapsed = []
    checksums = []
    for _ in range(args.runs):
        start = time.perf_counter()
        proc = subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        elapsed.append(time.perf_counter() - start)
        values = parse_kv(proc.stdout)
        if "checksum" not in values:
            raise RuntimeError("benchmark output did not include checksum")
        checksums.append(float(values["checksum"]))

    checksum = checksums[0]
    checksum_spread = max(abs(value - checksum) for value in checksums)
    checksum_drift = 0.0
    checksum_ok = 1
    if args.expected_checksum is not None:
        checksum_drift = abs(checksum - args.expected_checksum)
        tolerance = args.checksum_rtol * max(1.0, abs(args.expected_checksum))
        checksum_ok = int(math.isfinite(checksum) and checksum_drift <= tolerance)

    print(f"primary_median_seconds: {statistics.median(elapsed):.9f}")
    print(f"secondary_min_seconds: {min(elapsed):.9f}")
    print(f"secondary_max_seconds: {max(elapsed):.9f}")
    print(f"secondary_runs: {args.runs}")
    print(f"checksum: {checksum:.10f}")
    print(f"checksum_spread: {checksum_spread:.12g}")
    print(f"checksum_drift: {checksum_drift:.12g}")
    print(f"checksum_ok: {checksum_ok}")
    return 0 if checksum_ok else 2


if __name__ == "__main__":
    sys.exit(main())
