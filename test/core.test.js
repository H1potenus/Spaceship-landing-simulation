'use strict';
/*
 * Sanity tests for the simulation core. Run with:  npm test   (Node >= 18, no dependencies)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../tools/load-core');
const { evaluateGenome } = require('../tools/evaluate-lib');

const LS = loadCore();

// ---------------------------------------------------------------- numerics
test('RK4 stage formulas: error of y\' = -y falls by ~16x when the step is halved', () => {
  // The lander integrator is a classical RK4; verify the scheme itself on an analytic problem
  // by re-implementing the same stage formulas on a scalar ODE and checking the error ratio.
  function rk4(h, T) {
    let y = 1;
    for (let t = 0; t < T - 1e-12; t += h) {
      const k1 = -y, k2 = -(y + 0.5 * h * k1), k3 = -(y + 0.5 * h * k2), k4 = -(y + h * k3);
      y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    return Math.abs(y - Math.exp(-T));
  }
  const ratio = rk4(0.1, 1) / rk4(0.05, 1);
  assert.ok(ratio > 14 && ratio < 18, `error ratio ${ratio.toFixed(2)} should be about 16`);
});

test('free fall in vacuum matches the analytic solution', () => {
  const env = new LS.Environment();
  env.setPlanet('moon');
  const lander = new LS.Lander(LS.VEHICLE);
  lander.reset({ x0: 100, y0: 500, vx0: 0, vy0: 0, th0: 0, om0: 0 });
  const phases = new Float64Array(6);
  const T = 5, dt = LS.SIM.dt;
  for (let k = 0; k < T / dt; k++) lander.step(k * dt, dt, env, phases);
  const g = LS.PLANETS.moon.g;
  assert.ok(Math.abs(lander.s[LS.STATE.IY] - (500 - 0.5 * g * T * T)) < 1e-6);
  assert.ok(Math.abs(lander.s[LS.STATE.IVY] + g * T) < 1e-9);
});

test('rocket equation: constant full throttle burns fuel at F / (Isp g0)', () => {
  const env = new LS.Environment();
  env.setPlanet('moon');
  const lander = new LS.Lander(LS.VEHICLE);
  lander.reset({ x0: 0, y0: 5000, vx0: 0, vy0: 0, th0: 0, om0: 0 });
  lander.cmdThrottle = 1;
  const phases = new Float64Array(6);
  const dt = LS.SIM.dt;
  for (let k = 0; k < 500; k++) lander.step(k * dt, dt, env, phases); // 5 s, lag fully settled
  const burned = LS.VEHICLE.fuelMass - lander.s[LS.STATE.IFUEL];
  const expected = (LS.VEHICLE.maxThrust / (LS.VEHICLE.isp * LS.G0)) * 5;
  assert.ok(burned > 0.95 * expected && burned < expected, `burned ${burned.toFixed(2)} kg vs ${expected.toFixed(2)} kg`);
});

test('hover throttle (m g / F_max) holds altitude in vacuum to within a few metres', () => {
  const env = new LS.Environment();
  env.setPlanet('moon');
  const lander = new LS.Lander(LS.VEHICLE);
  lander.reset({ x0: 0, y0: 1000, vx0: 0, vy0: 0, th0: 0, om0: 0 });
  const g = LS.PLANETS.moon.g;
  const phases = new Float64Array(6);
  const dt = LS.SIM.dt;
  for (let k = 0; k < 300; k++) {
    // throttle follows the shrinking weight as propellant is consumed
    lander.cmdThrottle = (lander.mass() * g) / LS.VEHICLE.maxThrust;
    lander.step(k * dt, dt, env, phases);
  }
  assert.ok(Math.abs(lander.s[LS.STATE.IY] - 1000) < 3, 'altitude drift ' + (lander.s[LS.STATE.IY] - 1000));
});

// ---------------------------------------------------------------- environment / rng
test('atmosphere is exponential and vanishes on the Moon', () => {
  const env = new LS.Environment();
  assert.ok(Math.abs(env.density(0) - 1.225) < 1e-12);
  assert.ok(Math.abs(env.density(8500) - 1.225 / Math.E) < 1e-9);
  env.setPlanet('moon');
  assert.equal(env.density(0), 0);
});

test('seeded RNG is reproducible and approximately standard normal', () => {
  const a = new LS.RNG(123), b = new LS.RNG(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const r = new LS.RNG(7);
  let s = 0, s2 = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) { const v = r.gauss(); s += v; s2 += v * v; }
  assert.ok(Math.abs(s / n) < 0.03);
  assert.ok(Math.abs(s2 / n - 1) < 0.05);
});

// ---------------------------------------------------------------- neural network / GA
test('MLP 10-16-12-2 has 406 parameters and bounded outputs', () => {
  assert.equal(LS.MLP.paramCount(LS.NN.layers), 406);
  const rng = new LS.RNG(1);
  const net = new LS.MLP(LS.NN.layers);
  net.setWeights(LS.MLP.randomGenome(LS.NN.layers, rng));
  for (let i = 0; i < 200; i++) {
    const x = Array.from({ length: 10 }, () => (rng.next() - 0.5) * 10);
    const [u, p] = net.forward(x);
    assert.ok(u >= 0 && u <= 1 && p >= -1 && p <= 1);
  }
});

test('GA keeps elites unchanged and respects the weight clamp', () => {
  const rng = new LS.RNG(5);
  const evo = new LS.Evolution(LS.MLP.paramCount(LS.NN.layers), LS.GA, rng);
  const pop = evo.initPopulation(LS.NN.layers);
  const fitness = pop.map((_, i) => i); // genome 39 is the best
  const { genomes, eliteCount } = evo.nextGeneration(pop, fitness);
  assert.equal(genomes.length, LS.GA.popSize);
  assert.equal(eliteCount, 4);
  assert.deepEqual(Array.from(genomes[0]), Array.from(pop[39]));
  for (const g of genomes) for (const w of g) assert.ok(Math.abs(w) <= LS.GA.weightClamp + 1e-12);
});

// ---------------------------------------------------------------- end-to-end
test('training is deterministic for a fixed seed', () => {
  function run() {
    const tr = new LS.Trainer(11);
    while (tr.gen <= 3) tr.step();
    return tr.history.map((h) => h.max.toFixed(6)).join(',');
  }
  assert.equal(run(), run());
});

test('a pretrained champion lands reliably on unseen scenarios', () => {
  const champ = require('../docs/data/seed1/champion.json');
  const r = evaluateGenome(champ.genome, { episodes: 40, seed: 99 });
  assert.ok(r.successRate >= 0.9, 'success rate ' + r.successRate);
  assert.ok(r.meanTouchdownVy < 1.0, 'touchdown speed ' + r.meanTouchdownVy);
});
