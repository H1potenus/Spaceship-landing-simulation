/*
 * rng.js
 * Seeded pseudo-random number generator (Mulberry32) with uniform and
 * Gaussian (Box-Muller) sampling. Seeding makes scenarios and replays reproducible.
 */
(function (LS) {
  'use strict';

  class RNG {
    constructor(seed) {
      this.setSeed(seed === undefined ? (Date.now() >>> 0) : seed);
    }

    setSeed(seed) {
      this.state = (seed >>> 0) || 0x9E3779B9;
      this.spare = null;
    }

    // Uniform in [0, 1)
    next() {
      this.state = (this.state + 0x6D2B79F5) | 0;
      let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    uniform(a, b) {
      return a + (b - a) * this.next();
    }

    range(pair) {
      return this.uniform(pair[0], pair[1]);
    }

    int(n) {
      return Math.floor(this.next() * n);
    }

    // Standard normal N(0, 1) via the polar Box-Muller transform.
    gauss() {
      if (this.spare !== null) {
        const v = this.spare;
        this.spare = null;
        return v;
      }
      let u, v, s;
      do {
        u = 2 * this.next() - 1;
        v = 2 * this.next() - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const f = Math.sqrt(-2 * Math.log(s) / s);
      this.spare = v * f;
      return u * f;
    }
  }

  LS.RNG = RNG;
})(globalThis.LS = globalThis.LS || {});
