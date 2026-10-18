#!/usr/bin/env node
'use strict';
/*
 * evaluate.js
 * Test a saved champion genome on fresh random scenarios.
 *
 * Usage: node tools/evaluate.js docs/data/seed1/champion.json [--episodes 500] [--seed 424242]
 *        [--wind 10] [--turbulence 3] [--thrust-loss] [--noise 0.03] [--planet earth]
 */
const fs = require('fs');
const { evaluateGenome } = require('./evaluate-lib');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: node tools/evaluate.js <champion.json> [options]');
    process.exit(1);
  }
  const { genome } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = evaluateGenome(genome, {
    episodes: +arg('episodes', 500),
    seed: +arg('seed', 424242),
    wind: +arg('wind', 0),
    turbulence: +arg('turbulence', 0),
    thrustLoss: !!arg('thrust-loss', false),
    noiseSigma: +arg('noise', 0),
    planet: arg('planet', 'earth')
  });
  console.log(JSON.stringify(r, (k, v) => (k === 'vy' || k === 'fuel' || k === 'miss' ? undefined : v), 2));
}
