#!/usr/bin/env node
'use strict';
/*
 * train-headless.js
 * Runs the neuroevolution loop without a browser and writes
 *   <out>/history.csv     per-generation statistics
 *   <out>/champion.json   best genome (selected on held-out validation scenarios)
 *
 * Usage: node tools/train-headless.js [--seed 1] [--gens 100] [--out docs/data/seed1]
 *        [--wind 0] [--turbulence 0] [--thrust-loss] [--noise 0]
 */
const fs = require('fs');
const path = require('path');
const { loadCore } = require('./load-core');
const { evaluateGenome } = require('./evaluate-lib');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function train(o) {
  const LS = loadCore();
  const tr = new LS.Trainer(o.seed);
  tr.env.steadyWind = o.wind;
  tr.env.turbulence = o.turbulence;
  tr.settings.thrustLoss = o.thrustLoss;
  tr.settings.sensorNoise = o.noise > 0;
  tr.settings.noiseSigma = o.noise;
  tr._startGeneration();

  while (tr.gen <= o.gens) tr.step();

  // Candidate pool: current elites (best robust fitness) plus the all-time best genome.
  const eliteCount = Math.max(1, Math.round(tr.agents.length * LS.GA.eliteFrac));
  const pool = tr.agents.slice(0, eliteCount).map((a) => a.genome);
  if (tr.allTimeBest) pool.push(tr.allTimeBest.genome);
  let champion = pool[0], bestScore = -1;
  for (const g of pool) {
    const r = evaluateGenome(g, {
      episodes: 100, seed: o.seed + 7777, wind: o.wind, turbulence: o.turbulence,
      thrustLoss: o.thrustLoss, noiseSigma: o.noise
    });
    if (r.successRate > bestScore) { bestScore = r.successRate; champion = g; }
  }
  return { tr, champion, validation: bestScore };
}

if (require.main === module) {
  const o = {
    seed: +arg('seed', 1),
    gens: +arg('gens', 100),
    out: arg('out', null),
    wind: +arg('wind', 0),
    turbulence: +arg('turbulence', 0),
    thrustLoss: !!arg('thrust-loss', false),
    noise: +arg('noise', 0)
  };
  const t0 = Date.now();
  const { tr, champion, validation } = train(o);
  const secs = (Date.now() - t0) / 1000;
  console.log(`seed=${o.seed} gens=${o.gens} wall=${secs.toFixed(1)}s validation_success=${(100 * validation).toFixed(0)}%`);
  if (o.out) {
    fs.mkdirSync(o.out, { recursive: true });
    const rows = ['gen,best_fitness,mean_fitness,landed,on_pad,mutation_sigma,mutation_rate'];
    for (const h of tr.history) {
      rows.push([h.gen, h.max.toFixed(2), h.mean.toFixed(2), h.landed, h.onPad, h.sigma.toFixed(3), h.rate.toFixed(3)].join(','));
    }
    fs.writeFileSync(path.join(o.out, 'history.csv'), rows.join('\n') + '\n');
    fs.writeFileSync(path.join(o.out, 'champion.json'), JSON.stringify({
      seed: o.seed, generations: o.gens, layers: tr.constructor && globalThis.LS.NN.layers,
      genome: Array.from(champion, (v) => +v.toFixed(6))
    }));
  }
}

module.exports = { train };
