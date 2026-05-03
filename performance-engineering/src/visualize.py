#!/usr/bin/env python3
"""Render an animation from an nbody -dump trajectory file.

Binary format:
  int32 n
  int32 num_frames
  float32[num_frames * n * 3]  (xyz per body, per frame)

Usage:
  ./nbody -n 256 -s 400 -dump trajectory.bin
  python visualize.py trajectory.bin            # interactive window
  python visualize.py trajectory.bin out.gif    # save to file
"""
import struct
import sys

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation


def load(path):
    with open(path, "rb") as f:
        header = f.read(8)
        n, nframes = struct.unpack("ii", header)
        arr = np.frombuffer(f.read(), dtype=np.float32)
    return arr.reshape(nframes, n, 3)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None

    frames = load(path)
    nframes, n, _ = frames.shape
    print(f"loaded {nframes} frames of {n} bodies")

    lim = float(np.max(np.abs(frames[:, :, :2]))) * 1.1
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.set_aspect("equal")
    ax.set_facecolor("black")
    ax.set_xticks([])
    ax.set_yticks([])
    scat = ax.scatter(frames[0, :, 0], frames[0, :, 1], s=2, c="white")

    def update(i):
        scat.set_offsets(frames[i, :, :2])
        return (scat,)

    anim = FuncAnimation(fig, update, frames=nframes, interval=30, blit=True)
    if out:
        anim.save(out, dpi=100)
        print(f"wrote {out}")
    else:
        plt.show()


if __name__ == "__main__":
    main()
