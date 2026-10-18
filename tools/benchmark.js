#!/usr/bin/env node
'use strict';
/*
 * benchmark.js
 * Reproduces the tables in the README. Every champion stored in docs/data is flown on
 * 500 unseen scenarios (a scenario seed never used for training or champion selection).
 *
 *   docs/data/seedN/      brains trained in calm air
 *   docs/data/windseedN/  brains trained under 8 m/s crosswind + 3 m/s turbulence
 *
 * Writes docs/data/benchmark.json.
 */
const fs = require('fs');
const path = require('path');
const { evaluateGenome } = require('./evaluate-lib');

const dataDir = path.join(__dirname, '..', 'docs', 'data');
const dirs = fs.readdirSync(dataDir);
const GROUPS = {
  'trained in calm air': dirs.filter((d) => /^seed\d+$/.test(d)).sort(),
  'trained in wind + turbulence': dirs.filter((d) => /^windseed\d+$/.test(d)).sort()
};
const CASES = [
  { name: 'Nominal (calm air)', opts: {} },
  { name: 'Crosswind 8 m/s', opts: { wind: 8 } },
  { name: 'Crosswind 8 m/s + turbulence 3 m/s', opts: { wind: 8, turbulence: 3 } },
  { name: '20 % thrust loss', opts: { thrustLoss: true } },
  { name: 'Sensor noise sigma = 0.03', opts: { noiseSigma: 0.03 } },
  { name: 'Sensor noise sigma = 0.10', opts: { noiseSigma: 0.10 } },
  { name: 'Mars (g = 3.72, thin air)', opts: { planet: 'mars' } }
];

const out = { episodes: 500, evalSeed: 424242, groups: {} };
for (const [gname, seeds] of Object.entries(GROUPS)) {
  console.log('\n== ' + gname + ' (' + seeds.length + ' independent training runs)');
  out.groups[gname] = [];
  for (const c of CASES) {
    const per = seeds.map((s) => {
      const { genome } = JSON.parse(fs.readFileSync(path.join(dataDir, s, 'champion.json'), 'utf8'));
      const r = evaluateGenome(genome, Object.assign({ episodes: out.episodes, seed: out.evalSeed }, c.opts));
      return { run: s, successRate: r.successRate, meanTouchdownVy: r.meanTouchdownVy, meanFuelLeft: r.meanFuelLeft, meanPadMiss: r.meanPadMiss, outcomes: r.outcomes };
    });
    const mean = per.reduce((p, r) => p + r.successRate, 0) / per.length;
    out.groups[gname].push({ name: c.name, meanSuccess: mean, perRun: per });
    console.log(c.name.padEnd(40), (100 * mean).toFixed(1).padStart(5) + ' %   per run: ' + per.map((r) => (100 * r.successRate).toFixed(0)).join(' / '));
  }
}
fs.writeFileSync(path.join(dataDir, 'benchmark.json'), JSON.stringify(out, null, 1));
