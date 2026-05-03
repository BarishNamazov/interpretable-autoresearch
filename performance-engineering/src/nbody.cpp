// Naive N-body gravitational simulator.
//
// Direct O(N^2) pairwise force calculation, semi-implicit Euler integration.
// Written for clarity, not speed — this is the starting point for performance
// work, not the goal.

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cmath>
#include <vector>
#include <random>
#include <string>

struct Body {
    double x, y, z;
    double vx, vy, vz;
};

struct Accel {
    double x, y, z;
};

static const double G = 1.0;
static const double SOFTENING = 1e-3;

static void step(std::vector<Body>& bodies, double dt) {
    int n = (int)bodies.size();
    double mass = n > 0 ? 1.0 / n : 0.0;
    const double soft2 = SOFTENING * SOFTENING;
    Body* __restrict__ b = bodies.data();

    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; i++) {
        double xi = b[i].x, yi = b[i].y, zi = b[i].z;
        double ax = 0.0, ay = 0.0, az = 0.0;
        for (int j = 0; j < n; j++) {
            double dx = b[j].x - xi;
            double dy = b[j].y - yi;
            double dz = b[j].z - zi;
            double r2 = dx*dx + dy*dy + dz*dz + soft2;
            double r  = std::sqrt(r2);
            double f  = G * mass / (r2 * r);
            ax += f * dx;
            ay += f * dy;
            az += f * dz;
        }
        b[i].vx += ax * dt;
        b[i].vy += ay * dt;
        b[i].vz += az * dt;
    }

    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; i++) {
        b[i].x += b[i].vx * dt;
        b[i].y += b[i].vy * dt;
        b[i].z += b[i].vz * dt;
    }
}

static void init_random(std::vector<Body>& bodies, int n, unsigned seed) {
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> pos(-1.0, 1.0);
    std::uniform_real_distribution<double> vel(-0.05, 0.05);
    bodies.resize(n);
    for (int i = 0; i < n; i++) {
        bodies[i].x = pos(rng);
        bodies[i].y = pos(rng);
        bodies[i].z = pos(rng);
        bodies[i].vx = vel(rng);
        bodies[i].vy = vel(rng);
        bodies[i].vz = vel(rng);
    }
}

static void usage(const char* prog) {
    std::fprintf(stderr,
        "usage: %s [-n N] [-s STEPS] [-dt DT] [-seed S] [-dump PATH] [-every K]\n"
        "  -n      number of bodies (default 1024)\n"
        "  -s      number of timesteps (default 200)\n"
        "  -dt     timestep size (default 0.001)\n"
        "  -seed   RNG seed (default 42)\n"
        "  -dump   write binary trajectory to PATH (for visualization)\n"
        "  -every  dump every K-th frame (default 1)\n",
        prog);
}

int main(int argc, char** argv) {
    int n = 1024;
    int steps = 200;
    double dt = 0.001;
    unsigned seed = 42;
    const char* dump_path = nullptr;
    int dump_every = 1;

    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if      (a == "-n"     && i+1 < argc) n = std::atoi(argv[++i]);
        else if (a == "-s"     && i+1 < argc) steps = std::atoi(argv[++i]);
        else if (a == "-dt"    && i+1 < argc) dt = std::atof(argv[++i]);
        else if (a == "-seed"  && i+1 < argc) seed = (unsigned)std::atoi(argv[++i]);
        else if (a == "-dump"  && i+1 < argc) dump_path = argv[++i];
        else if (a == "-every" && i+1 < argc) dump_every = std::atoi(argv[++i]);
        else { usage(argv[0]); return 1; }
    }

    std::vector<Body> bodies;
    init_random(bodies, n, seed);

    FILE* dump = nullptr;
    int32_t frames_written = 0;
    if (dump_path) {
        dump = std::fopen(dump_path, "wb");
        if (!dump) { std::perror("fopen"); return 1; }
        int32_t hn = n, nf = 0;
        std::fwrite(&hn, sizeof(int32_t), 1, dump);
        std::fwrite(&nf, sizeof(int32_t), 1, dump);  // patched at end
    }

    auto dump_frame = [&]() {
        if (!dump) return;
        for (int i = 0; i < n; i++) {
            float xyz[3] = { (float)bodies[i].x, (float)bodies[i].y, (float)bodies[i].z };
            std::fwrite(xyz, sizeof(float), 3, dump);
        }
        frames_written++;
    };

    dump_frame();
    for (int s = 0; s < steps; s++) {
        step(bodies, dt);
        if ((s + 1) % dump_every == 0) dump_frame();
    }

    // Position-weighted checksum: a cheap correctness anchor.
    // Any optimization must preserve this to within a small tolerance.
    double checksum = 0.0;
    for (int i = 0; i < n; i++) {
        checksum += bodies[i].x * (i + 1)
                  + bodies[i].y * (i + 2)
                  + bodies[i].z * (i + 3);
    }
    std::printf("n: %d\n", n);
    std::printf("steps: %d\n", steps);
    std::printf("checksum: %.10f\n", checksum);

    if (dump) {
        std::fseek(dump, sizeof(int32_t), SEEK_SET);
        std::fwrite(&frames_written, sizeof(int32_t), 1, dump);
        std::fclose(dump);
    }
    return 0;
}
