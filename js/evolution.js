/*
 * evolution.js
 * Genetic algorithm over flat neural-network genomes:
 *   - elitism (top 10 % copied unchanged)
 *   - k-way tournament selection
 *   - Simulated Binary Crossover (SBX, Deb & Agrawal) or uniform crossover
 *   - adaptive Gaussian mutation: rate and step grow when the best fitness
 *     plateaus and relax back to their base values once progress resumes
 */
(function (LS) {
  'use strict';

  class Evolution {
    constructor(genomeSize, cfg, rng) {
      this.n = genomeSize;
      this.cfg = Object.assign({}, cfg);
      this.rng = rng;
      this.rate = cfg.baseRate;
      this.sigma = cfg.baseSigma;
      this.bestHistory = [];
      this.stagnation = 0;
      this.mode = 'EXPLOIT';
    }

    initPopulation(layers) {
      const pop = [];
      for (let i = 0; i < this.cfg.popSize; i++) pop.push(LS.MLP.randomGenome(layers, this.rng));
      return pop;
    }

    tournament(order, fitness) {
      const k = this.cfg.tournamentK;
      let best = -1, bestF = -Infinity;
      for (let i = 0; i < k; i++) {
        const idx = order[this.rng.int(order.length)];
        if (fitness[idx] > bestF) { bestF = fitness[idx]; best = idx; }
      }
      return best;
    }

    // SBX: produces two children whose spread around the parents follows the
    // polynomial distribution controlled by eta (larger eta = children closer to parents).
    sbx(p1, p2, c1, c2) {
      const eta = this.cfg.sbxEta, rng = this.rng;
      const e = 1 / (eta + 1);
      for (let i = 0; i < this.n; i++) {
        if (rng.next() < 0.5) {
          const u = rng.next();
          const beta = u <= 0.5 ? Math.pow(2 * u, e) : Math.pow(1 / (2 * (1 - u)), e);
          c1[i] = 0.5 * ((1 + beta) * p1[i] + (1 - beta) * p2[i]);
          c2[i] = 0.5 * ((1 - beta) * p1[i] + (1 + beta) * p2[i]);
        } else {
          c1[i] = p1[i];
          c2[i] = p2[i];
        }
      }
    }

    uniform(p1, p2, c1, c2) {
      const rng = this.rng;
      for (let i = 0; i < this.n; i++) {
        if (rng.next() < 0.5) { c1[i] = p1[i]; c2[i] = p2[i]; }
        else { c1[i] = p2[i]; c2[i] = p1[i]; }
      }
    }

    // Half of the offspring use the adaptive (possibly inflated) step and rate, the other
    // half the base values, so exploration never wipes out fine-tuning around the elites.
    mutate(g) {
      const rng = this.rng, lim = this.cfg.weightClamp;
      const explore = rng.next() < 0.5;
      const rate = explore ? this.rate : this.cfg.baseRate;
      const sigma = explore ? this.sigma : this.cfg.baseSigma;
      for (let i = 0; i < this.n; i++) {
        if (rng.next() < rate) {
          let v = g[i] + rng.gauss() * sigma;
          if (v > lim) v = lim; else if (v < -lim) v = -lim;
          g[i] = v;
        }
      }
    }

    // Plateau detection on the per-generation best fitness.
    adapt(genBest) {
      const c = this.cfg, h = this.bestHistory;
      h.push(genBest);
      const W = c.plateauWindow;
      if (h.length < 2 * W) { this.mode = 'EXPLOIT'; return; }
      let recent = 0, older = 0;
      for (let i = 0; i < W; i++) {
        recent += h[h.length - 1 - i];
        older += h[h.length - 1 - W - i];
      }
      recent /= W; older /= W;
      const threshold = 0.02 * Math.abs(older) + 5;
      if (recent - older < threshold) {
        this.stagnation++;
        this.sigma = Math.min(c.maxSigma, this.sigma * 1.25);
        this.rate = Math.min(c.maxRate, this.rate * 1.15);
        this.mode = 'EXPLORE';
      } else {
        this.stagnation = 0;
        this.sigma = c.baseSigma + (this.sigma - c.baseSigma) * 0.6;
        this.rate = c.baseRate + (this.rate - c.baseRate) * 0.6;
        this.mode = 'EXPLOIT';
      }
    }

    /*
     * Builds the next generation. fitness[] is the selection fitness (the trainer passes
     * the mean over each genome's recent evaluations, so surviving elites are ranked by
     * robustness across scenarios rather than one lucky episode).
     * Returns { genomes, order, eliteCount } where genomes[0..eliteCount-1] are the
     * unchanged elites (best first); elites carry their evaluation record (g.evals).
     */
    nextGeneration(genomes, fitness) {
      const N = genomes.length;
      const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => fitness[b] - fitness[a]);
      this.adapt(fitness[order[0]]);

      const eliteCount = Math.max(1, Math.round(N * this.cfg.eliteFrac));
      const next = [];
      for (let i = 0; i < eliteCount; i++) {
        const src = genomes[order[i]];
        const copy = Float64Array.from(src);
        copy.evals = src.evals ? src.evals.slice() : [];
        next.push(copy);
      }

      while (next.length < N) {
        const a = genomes[this.tournament(order, fitness)];
        const b = genomes[this.tournament(order, fitness)];
        const c1 = new Float64Array(this.n), c2 = new Float64Array(this.n);
        if (this.rng.next() < this.cfg.crossoverProb) {
          if (this.cfg.crossover === 'uniform') this.uniform(a, b, c1, c2);
          else this.sbx(a, b, c1, c2);
        } else {
          c1.set(a);
          c2.set(b);
        }
        this.mutate(c1);
        next.push(c1);
        if (next.length < N) {
          this.mutate(c2);
          next.push(c2);
        }
      }
      return { genomes: next, order, eliteCount };
    }
  }

  LS.Evolution = Evolution;
})(globalThis.LS = globalThis.LS || {});
