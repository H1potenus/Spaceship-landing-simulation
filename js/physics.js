/*
 * physics.js
 * 3-DoF rigid-body lander dynamics integrated with classical 4th-order Runge-Kutta.
 *
 * State vector s = [x, y, vx, vy, theta, omega, m_fuel, F_thrust, delta]
 *   theta  : pitch angle, counter-clockwise positive, 0 = upright
 *   F_thrust and delta are actuator states (first-order lags), so throttle and
 *   gimbal commands are integrated consistently inside every RK4 stage.
 *
 * Modelled effects:
 *   - variable mass m(t) = m_dry + m_fuel(t), dm/dt = -|F| / (Isp g0)
 *   - dynamic inertia I(t) = m(t) (3 r^2 + h^2) / 12
 *   - gimballed main engine below the CoM + cold-gas RCS couple
 *   - quadratic aerodynamic drag in an exponential atmosphere with wind,
 *     applied at a centre of pressure offset from the CoM (aero torque)
 *   - two spring-damper landing legs with regularised Coulomb friction
 */
(function (LS) {
  'use strict';

  const IX = 0, IY = 1, IVX = 2, IVY = 3, ITH = 4, IOM = 5, IFUEL = 6, IFT = 7, IDL = 8;
  const NSTATE = 9;
  LS.STATE = { IX, IY, IVX, IVY, ITH, IOM, IFUEL, IFT, IDL, NSTATE };

  // Surface height: the raised landing platform deck around padX, flat terrain elsewhere.
  function groundHeight(x) {
    const S = LS.SIM;
    return Math.abs(x - S.padX) <= S.padHalfWidth ? S.padHeight : 0;
  }
  LS.groundHeight = groundHeight;
  // Height of the resting CoM directly above the pad deck (the guidance target).
  LS.targetHeight = function () { return LS.SIM.padHeight + LS.VEHICLE.restHeight; };

  class Lander {
    constructor(vehicle) {
      this.V = vehicle;
      this.s = new Float64Array(NSTATE);
      this.k1 = new Float64Array(NSTATE);
      this.k2 = new Float64Array(NSTATE);
      this.k3 = new Float64Array(NSTATE);
      this.k4 = new Float64Array(NSTATE);
      this.tmp = new Float64Array(NSTATE);
      this.scratch = new Float64Array(NSTATE);

      this.cmdThrottle = 0;   // u_cmd in [0, 1]
      this.cmdPitch = 0;      // pitch torque command in [-1, 1]
      this.thrustFactor = 1;  // 0.8 when the 20 % thrust-loss failure is active

      this.contact = [0, 0];          // left, right leg contact flags
      this.feet = new Float64Array(4); // world foot positions xL, yL, xR, yR
      this.hullMinY = 10;        // lowest hull clearance above the local surface
      this.sideImpact = false;   // a foot or hull point struck the platform side wall
      this._w = { x: 0, y: 0 };

      this.inertiaFactor = (3 * vehicle.radius * vehicle.radius + vehicle.height * vehicle.height) / 12;

      // Diagnostics for the telemetry/vector overlays (filled by computeDiag on demand).
      this.diag = {
        mass: 0, inertia: 0, thrust: 0, delta: 0,
        Ftx: 0, Fty: 0, Fdx: 0, Fdy: 0, Flx: 0, Fly: 0,
        legN: [0, 0], legF: [0, 0],
        rcsL: 0, rcsR: 0,
        tauEngine: 0, tauRcs: 0, tauAero: 0, tauLegs: 0, tauNet: 0,
        rho: 0, windX: 0, windY: 0, vrel: 0, q: 0,
        ax: 0, ay: 0, gForce: 0, twr: 0
      };
    }

    reset(sc) {
      const s = this.s;
      s[IX] = sc.x0; s[IY] = sc.y0;
      s[IVX] = sc.vx0; s[IVY] = sc.vy0;
      s[ITH] = sc.th0; s[IOM] = sc.om0;
      s[IFUEL] = this.V.fuelMass;
      s[IFT] = 0; s[IDL] = 0;
      this.cmdThrottle = 0;
      this.cmdPitch = 0;
      this.updateKinematics();
    }

    mass() {
      return this.V.dryMass + (this.s[IFUEL] > 0 ? this.s[IFUEL] : 0);
    }

    inertia(m) {
      return m * this.inertiaFactor;
    }

    /*
     * State derivative ds/dt = f(t, s) with actuator commands held constant
     * (zero-order hold over the step). Writes into out; optionally fills diag.
     */
    deriv(t, s, out, env, phases, diag) {
      const V = this.V;
      const fuel = s[IFUEL] > 0 ? s[IFUEL] : 0;
      const hasFuel = fuel > 0;
      const m = V.dryMass + fuel;
      const I = m * this.inertiaFactor;
      const th = s[ITH], om = s[IOM];
      const c = Math.cos(th), sn = Math.sin(th);
      const g = env.planet.g;

      // ---- Main engine: first-order actuator lag dF/dt = (Fmax u - F) / tau ----
      const Fcmd = hasFuel ? V.maxThrust * this.thrustFactor * this.cmdThrottle : 0;
      const F = s[IFT] > 0 ? s[IFT] : 0;
      const dF = (Fcmd - s[IFT]) / V.actuatorTau;

      // ---- Thrust vector control: delta_cmd = -pitch * delta_max (servo lag) ----
      const deltaCmd = -this.cmdPitch * V.gimbalMax;
      const dDelta = (deltaCmd - s[IDL]) / V.gimbalTau;
      const delta = s[IDL];
      const ang = th + delta;
      const Ftx = -F * Math.sin(ang);
      const Fty = F * Math.cos(ang);
      const tauEngine = -F * V.engineArm * Math.sin(delta);

      // ---- RCS couple: positive pitch command fires the left pod (CCW torque) ----
      const p = this.cmdPitch;
      const rcsL = hasFuel && p > 0 ? p * V.rcsThrust : 0;
      const rcsR = hasFuel && p < 0 ? -p * V.rcsThrust : 0;
      const tauRcs = (rcsL - rcsR) * V.rcsArm;

      // ---- Aerodynamics: F_drag = -1/2 rho Cd A |v_rel| v_rel ----
      const w = this._w;
      env.wind(t, s[IY], phases, w);
      const vrx = s[IVX] - w.x;
      const vry = s[IVY] - w.y;
      const vrel = Math.sqrt(vrx * vrx + vry * vry);
      const rho = env.density(s[IY]);
      let Fdx = 0, Fdy = 0, tauAero = 0;
      if (rho > 0 && vrel > 1e-9) {
        // Projected area blends broadside and axial areas by the flow incidence.
        const cosA = (-sn * vrx + c * vry) / vrel;
        const absCos = cosA < 0 ? -cosA : cosA;
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const A = V.areaSide * sinA + V.areaTop * absCos;
        const k = -0.5 * rho * V.cd * A * vrel;
        Fdx = k * vrx;
        Fdy = k * vry;
        const rcx = -sn * V.cpOffset, rcy = c * V.cpOffset; // centre of pressure
        tauAero = rcx * Fdy - rcy * Fdx;
      }

      // ---- Landing legs: spring-damper normal force + Coulomb friction ----
      let Flx = 0, Fly = 0, tauLegs = 0;
      for (let i = 0; i < 2; i++) {
        const bx = (i === 0 ? -1 : 1) * V.footX, by = V.footY;
        const rx = c * bx - sn * by;
        const ry = sn * bx + c * by;
        const gy = groundHeight(s[IX] + rx);
        const fy = s[IY] + ry - gy;  // foot height above the local surface
        let Fn = 0, Ff = 0;
        // A foot buried deeper than sideImpactDepth entered the platform through its side
        // wall; that is a structural collision (flagged in updateKinematics), not a spring load.
        if (fy < 0 && fy > -LS.SIM.sideImpactDepth) {
          const fvx = s[IVX] - om * ry;  // foot velocity = v + omega x r
          const fvy = s[IVY] + om * rx;
          Fn = V.legK * (0 - fy) - V.legC * fvy;
          if (Fn < 0) Fn = 0;
          Ff = -V.mu * Fn * Math.tanh(fvx / V.frictionVel); // regularised sgn()
          Flx += Ff;
          Fly += Fn;
          tauLegs += rx * Fn - ry * Ff;
        }
        if (diag) { diag.legN[i] = Fn; diag.legF[i] = Ff; }
      }

      // ---- Net force and torque ----
      const Fx = Ftx + Fdx + Flx;
      const Fy = Fty + Fdy + Fly - m * g;
      const tauNet = tauEngine + tauRcs + tauAero + tauLegs;

      out[IX] = s[IVX];
      out[IY] = s[IVY];
      out[IVX] = Fx / m;
      out[IVY] = Fy / m;
      out[ITH] = om;
      out[IOM] = tauNet / I;
      out[IFUEL] = hasFuel ? -(F / (V.isp * LS.G0) + (rcsL + rcsR) / (V.rcsIsp * LS.G0)) : 0;
      out[IFT] = dF;
      out[IDL] = dDelta;

      if (diag) {
        diag.mass = m; diag.inertia = I; diag.thrust = F; diag.delta = delta;
        diag.Ftx = Ftx; diag.Fty = Fty; diag.Fdx = Fdx; diag.Fdy = Fdy; diag.Flx = Flx; diag.Fly = Fly;
        diag.rcsL = rcsL; diag.rcsR = rcsR;
        diag.tauEngine = tauEngine; diag.tauRcs = tauRcs; diag.tauAero = tauAero;
        diag.tauLegs = tauLegs; diag.tauNet = tauNet;
        diag.rho = rho; diag.windX = w.x; diag.windY = w.y; diag.vrel = vrel;
        diag.q = 0.5 * rho * vrel * vrel;
        // Proper (non-gravitational) acceleration felt by the crew/IMU.
        const pax = (Fx) / m, pay = (Fy + m * g) / m;
        diag.ax = Fx / m; diag.ay = Fy / m;
        diag.gForce = Math.sqrt(pax * pax + pay * pay) / LS.G0;
        diag.twr = F / (m * g);
      }
    }

    // One classical RK4 step of size dt.
    step(t, dt, env, phases) {
      const s = this.s, k1 = this.k1, k2 = this.k2, k3 = this.k3, k4 = this.k4, tmp = this.tmp;
      const h2 = dt * 0.5;
      let i;
      this.deriv(t, s, k1, env, phases, null);
      for (i = 0; i < NSTATE; i++) tmp[i] = s[i] + h2 * k1[i];
      this.deriv(t + h2, tmp, k2, env, phases, null);
      for (i = 0; i < NSTATE; i++) tmp[i] = s[i] + h2 * k2[i];
      this.deriv(t + h2, tmp, k3, env, phases, null);
      for (i = 0; i < NSTATE; i++) tmp[i] = s[i] + dt * k3[i];
      this.deriv(t + dt, tmp, k4, env, phases, null);
      const d6 = dt / 6;
      for (i = 0; i < NSTATE; i++) s[i] += d6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);

      if (s[IFUEL] < 0) s[IFUEL] = 0;
      if (s[IFT] < 0) s[IFT] = 0;
      const gm = this.V.gimbalMax;
      if (s[IDL] > gm) s[IDL] = gm; else if (s[IDL] < -gm) s[IDL] = -gm;
    }

    // Exact kinematics at the current state: foot positions, contacts, lowest hull point.
    updateKinematics() {
      const s = this.s, V = this.V;
      const c = Math.cos(s[ITH]), sn = Math.sin(s[ITH]);
      const deep = -LS.SIM.sideImpactDepth;
      this.sideImpact = false;
      for (let i = 0; i < 2; i++) {
        const bx = (i === 0 ? -1 : 1) * V.footX, by = V.footY;
        const fx = s[IX] + c * bx - sn * by;
        const fy = s[IY] + sn * bx + c * by;
        const pen = fy - groundHeight(fx);
        this.feet[i * 2] = fx;
        this.feet[i * 2 + 1] = fy;
        this.contact[i] = pen < 0 && pen > deep ? 1 : 0;
        if (pen <= deep) this.sideImpact = true;
      }
      let minY = Infinity;
      const hp = V.hullPoints;
      for (let j = 0; j < hp.length; j++) {
        const px = s[IX] + c * hp[j][0] - sn * hp[j][1];
        const y = s[IY] + sn * hp[j][0] + c * hp[j][1] - groundHeight(px);
        if (y < minY) minY = y;
      }
      this.hullMinY = minY;
    }

    // Evaluate forces at the current state for display purposes only.
    computeDiag(t, env, phases) {
      this.deriv(t, this.s, this.scratch, env, phases, this.diag);
      return this.diag;
    }

    // Instantaneous external kick: linear impulse (N s) and angular impulse (N m s).
    applyImpulse(Jx, Jy, Jtheta) {
      const m = this.mass();
      this.s[IVX] += Jx / m;
      this.s[IVY] += Jy / m;
      this.s[IOM] += Jtheta / this.inertia(m);
    }
  }

  LS.Lander = Lander;
})(globalThis.LS = globalThis.LS || {});
