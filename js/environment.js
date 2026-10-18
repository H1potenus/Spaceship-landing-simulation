/*
 * environment.js
 * Planetary environment: gravity, exponential atmosphere rho(y) = rho0 * exp(-y / H)
 * and a wind field made of a steady crosswind with a power-law boundary layer plus
 * multi-frequency sinusoidal turbulence gusts. Gust phases come from the scenario so
 * every agent in a generation (and every replay) experiences identical disturbances.
 */
(function (LS) {
  'use strict';

  const TWO_PI = Math.PI * 2;

  class Environment {
    constructor() {
      this.planetKey = 'earth';
      this.planet = LS.PLANETS.earth;
      this.steadyWind = 0;   // m/s, positive = blowing towards +x
      this.turbulence = 0;   // m/s, gust amplitude
    }

    setPlanet(key) {
      if (LS.PLANETS[key]) {
        this.planetKey = key;
        this.planet = LS.PLANETS[key];
      }
    }

    static randomPhases(rng) {
      const p = new Float64Array(6);
      for (let i = 0; i < 6; i++) p[i] = rng.next() * TWO_PI;
      return p;
    }

    density(y) {
      const pl = this.planet;
      if (pl.rho0 <= 0) return 0;
      return pl.rho0 * Math.exp(-(y > 0 ? y : 0) / pl.H);
    }

    // Wind boundary-layer profile (1/7 power law referenced to 50 m altitude).
    profile(y) {
      const f = Math.pow((y > 0.5 ? y : 0.5) / 50, 1 / 7);
      return f < 0.35 ? 0.35 : (f > 1.35 ? 1.35 : f);
    }

    // Writes the wind velocity at time t and altitude y into out.x / out.y.
    wind(t, y, phases, out) {
      const prof = this.profile(y);
      const T = this.turbulence;
      let gx = 0, gy = 0;
      if (T > 0) {
        gx = 0.55 * Math.sin(0.31 * t + phases[0]) +
             0.30 * Math.sin(0.97 * t + phases[1]) +
             0.15 * Math.sin(2.30 * t + phases[2]) +
             0.10 * Math.sin(5.10 * t + phases[3]);
        gy = 0.6 * Math.sin(0.53 * t + phases[4]) +
             0.4 * Math.sin(1.70 * t + phases[5]);
      }
      out.x = (this.steadyWind + T * gx) * prof;
      out.y = 0.25 * T * gy * prof;
    }
  }

  LS.Environment = Environment;
})(globalThis.LS = globalThis.LS || {});
