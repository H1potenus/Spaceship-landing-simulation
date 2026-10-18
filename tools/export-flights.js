#!/usr/bin/env node
'use strict';
/*
 * export-flights.js
 * Flies one genome on N random scenarios and dumps the sampled telemetry (20 Hz) as JSON,
 * for plotting (see tools/make_figures.py).
 *
 * Usage: node tools/export-flights.js --genome docs/data/seed1/champion.json --episodes 40
 *        --seed 5 --out /tmp/flights.json [--untrained]   (untrained = best genome of generation 1)
 */
const fs = require('fs');
const { loadCore } = require('./load-core');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const LS = loadCore();
const S = LS.SIM;
const episodes = +arg('episodes', 40);
const seed = +arg('seed', 5);
const wind = +arg('wind', 0);
const tr = new LS.Trainer(seed);
tr.env.steadyWind = wind;

let genome;
if (arg('untrained', false)) {
  // Best brain of a freshly initialised population after one generation (what Gen 1 looks like).
  const t1 = new LS.Trainer(seed);
  while (t1.gen < 2) t1.step();
  genome = t1.checkpoints.get('Gen 1').genome;
} else {
  genome = Float64Array.from(JSON.parse(fs.readFileSync(arg('genome'), 'utf8')).genome);
}

const flights = [];
const maxSteps = Math.round(S.maxTime / S.dt) + 2;
for (let e = 0; e < episodes; e++) {
  const sc = tr._makeScenario();
  const a = new LS.Agent(-1, Float64Array.from(genome));
  a.reset(sc);
  for (let k = 0; k < maxSteps && !a.done; k++) tr._stepAgent(a, k * S.dt, k, sc.phases);
  const n = a.nSamples, T = [], X = [], Y = [], VY = [], TH = [], U = [], F = [], D = [];
  for (let i = 0; i < n; i++) {
    X.push(+a.traj[i * LS.TRAJ_K].toFixed(3));
    Y.push(+a.traj[i * LS.TRAJ_K + 1].toFixed(3));
    VY.push(+a.traj[i * LS.TRAJ_K + 2].toFixed(3));
    T.push(+a.hist[i * LS.HIST_K].toFixed(3));
    U.push(+a.hist[i * LS.HIST_K + 1].toFixed(4));
    TH.push(+a.hist[i * LS.HIST_K + 3].toFixed(4));
    F.push(+a.hist[i * LS.HIST_K + 4].toFixed(4));
    D.push(+a.hist[i * LS.HIST_K + 5].toFixed(4));
  }
  flights.push({
    outcome: a.outcome, reason: a.reason, fitness: +a.fitness.toFixed(2),
    fuelLeft: +(a.lander.s[LS.STATE.IFUEL] / LS.VEHICLE.fuelMass).toFixed(3),
    scenario: { x0: sc.x0, y0: sc.y0, vx0: sc.vx0, vy0: sc.vy0, th0: sc.th0 },
    t: T, x: X, y: Y, vy: VY, theta: TH, throttle: U, thrust: F, gimbal: D
  });
}
const out = { padHalfWidth: S.padHalfWidth, padHeight: S.padHeight, restHeight: LS.VEHICLE.restHeight, flights };
fs.writeFileSync(arg('out'), JSON.stringify(out));
console.log(`${flights.length} flights, ${flights.filter((f) => f.reason === 'LANDED').length} landed on the pad`);
