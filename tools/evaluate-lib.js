'use strict';
/*
 * evaluate-lib.js
 * Open-loop evaluation of a single genome on a set of random scenarios, using exactly
 * the same dynamics, sensing and terminal logic as the trainer.
 */
const { loadCore } = require('./load-core');

/**
 * @param {Float64Array|number[]} genome  flat MLP weights
 * @param {object} opts
 * @param {number} opts.episodes   number of random scenarios
 * @param {number} opts.seed       scenario seed (use a seed different from the training seed)
 * @param {number} [opts.wind]     steady crosswind, m/s
 * @param {number} [opts.turbulence] gust amplitude, m/s
 * @param {boolean} [opts.thrustLoss]  20 % main-engine thrust loss
 * @param {number} [opts.noiseSigma]   Gaussian sensor noise (normalised units), 0 = off
 * @param {string} [opts.planet]   earth | mars | moon | titan
 */
function evaluateGenome(genome, opts) {
  const LS = loadCore();
  const tr = new LS.Trainer(opts.seed);
  tr.env.setPlanet(opts.planet || 'earth');
  tr.env.steadyWind = opts.wind || 0;
  tr.env.turbulence = opts.turbulence || 0;
  tr.settings.thrustLoss = !!opts.thrustLoss;
  tr.settings.sensorNoise = (opts.noiseSigma || 0) > 0;
  tr.settings.noiseSigma = opts.noiseSigma || 0;

  const S = LS.SIM;
  const res = { episodes: opts.episodes, landed: 0, onPad: 0, outcomes: {}, vy: [], fuel: [], miss: [] };
  const maxSteps = Math.round(S.maxTime / S.dt) + 2;

  for (let e = 0; e < opts.episodes; e++) {
    const sc = tr._makeScenario();
    const a = new LS.Agent(-1, Float64Array.from(genome));
    a.reset(sc);
    for (let k = 0; k < maxSteps && !a.done; k++) tr._stepAgent(a, k * S.dt, k, sc.phases);
    res.outcomes[a.reason] = (res.outcomes[a.reason] || 0) + 1;
    if (a.outcome === 'LANDED') {
      res.landed++;
      if (a.reason === 'LANDED') res.onPad++;
      res.vy.push(Math.abs(a.touchdown ? a.touchdown.vy : 0));
      res.fuel.push(a.lander.s[LS.STATE.IFUEL] / LS.VEHICLE.fuelMass);
      res.miss.push(Math.abs(a.lander.s[LS.STATE.IX] - S.padX));
    }
  }
  res.successRate = res.onPad / res.episodes;
  const mean = (v) => (v.length ? v.reduce((p, c) => p + c, 0) / v.length : NaN);
  res.meanTouchdownVy = mean(res.vy);
  res.meanFuelLeft = mean(res.fuel);
  res.meanPadMiss = mean(res.miss);
  return res;
}

module.exports = { evaluateGenome };
