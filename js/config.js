/*
 * config.js
 * Global constants: planet presets, vehicle parameters, simulation rules,
 * fitness weights, neural network topology and genetic algorithm settings.
 * All quantities are SI (m, kg, s, N, rad) unless noted.
 */
(function (LS) {
  'use strict';

  const DEG = Math.PI / 180;
  LS.DEG = DEG;
  LS.G0 = 9.80665; // standard gravity used in the rocket equation (Isp * g0)

  // Planet presets: surface gravity, sea-level density and density scale height.
  LS.PLANETS = {
    earth: { name: 'Earth-like', g: 9.81, rho0: 1.225, H: 8500 },
    mars: { name: 'Mars', g: 3.721, rho0: 0.020, H: 11100 },
    moon: { name: 'Moon (vacuum)', g: 1.625, rho0: 0.0, H: 1 },
    titan: { name: 'Titan (dense)', g: 1.352, rho0: 5.43, H: 21000 }
  };

  // 3-DoF lander rigid body (approximated as a cylinder for the inertia tensor).
  LS.VEHICLE = {
    dryMass: 1000,            // kg
    fuelMass: 350,            // kg (initial propellant load)
    radius: 0.95,             // m (cylinder radius r)
    height: 7.0,              // m (cylinder height h) - tall, slender booster-style lander

    maxThrust: 28000,         // N  (main engine, vacuum-equivalent)
    isp: 250,                 // s  (main engine specific impulse)
    actuatorTau: 0.05,        // s  (first-order throttle lag)
    gimbalMax: 8 * DEG,       // rad (TVC deflection limit)
    gimbalTau: 0.08,          // s  (gimbal servo lag)
    engineArm: 3.5,           // m  (CoM -> gimbal pivot distance, L_engine)

    rcsThrust: 450,           // N  (each cold-gas RCS pod)
    rcsArm: 2.2,              // m  (RCS moment arm, L_RCS: pods near nose and tail)
    rcsIsp: 70,               // s  (cold gas specific impulse)

    cd: 1.0,                  // drag coefficient
    areaSide: 2 * 0.95 * 7.0, // m^2 (2r * h, broadside reference area)
    areaTop: Math.PI * 0.95 * 0.95, // m^2 (axial reference area)
    cpOffset: 0.6,            // m  (centre of pressure above CoM along body axis)

    footX: 2.7,               // m  body-frame foot position (mirrored left/right)
    footY: -4.3,              // m  (below CoM)
    legK: 70000,              // N/m   leg spring stiffness k_leg
    legC: 8000,               // N s/m leg damper c_leg
    mu: 0.6,                  // Coulomb friction coefficient
    frictionVel: 0.25,        // m/s  regularisation width of sgn() -> tanh(v / v_eps)

    restHeight: 4.2,          // m  approximate CoM height above the surface when resting on the legs

    // Body-frame points of the rigid hull. Any of them below ground => structural crash.
    hullPoints: [
      [-0.95, -3.5], [0.95, -3.5],   // hull bottom corners
      [-0.5, -3.95], [0.5, -3.95],   // engine nozzle exit
      [-0.95, 2.2], [0.95, 2.2],     // shoulders (base of the nose cone)
      [-0.45, 3.3], [0.45, 3.3],     // nose cone
      [0, 3.7]                       // nose tip
    ]
  };

  LS.SIM = {
    dt: 0.01,                 // s  fixed physics timestep (never changed by time warp)
    controlEvery: 2,          // NN evaluated every 2 physics steps (50 Hz guidance loop)
    maxTime: 40,              // s  episode timeout
    padX: 0,                  // m  landing pad centre
    padHalfWidth: 12,         // m
    padHeight: 3.0,           // m  deck height of the raised landing platform above the terrain
    sideImpactDepth: 0.6,     // m  a foot deeper than this inside the platform hit its side wall
    worldHalfWidth: 450,      // m  lateral out-of-bounds limit
    ceiling: 800,             // m  vertical out-of-bounds limit
    restTime: 1.0,            // s  of stable contact required to declare LANDED
    restSpeed: 0.3,           // m/s
    restOmega: 0.06,          // rad/s
    softVy: 2.0,              // m/s touchdown limits (exceed => HARD LANDING)
    softVx: 1.0,              // m/s
    softTheta: 5 * DEG,       // rad
    tipOver: 35 * DEG,        // rad  tilt while in contact => TIP-OVER
    lossOfControl: 100 * DEG, // rad  tilt in flight => LOSS OF CONTROL
    sampleEvery: 5            // record trajectory/telemetry every 5 steps (20 Hz)
  };

  // Initial-condition envelope (one shared scenario per generation for a fair comparison).
  LS.SCENARIO = {
    x0: [-55, 55],
    y0: [180, 240],
    vx0: [-6, 6],
    vy0: [-22, -12],
    th0: [-8 * DEG, 8 * DEG],
    om0: [-4 * DEG, 4 * DEG]
  };

  // LQR-inspired running cost and terminal rewards.
  LS.FITNESS = {
    w1: 0.5,    // position error     (dx/sx)^2 + (dy/sy)^2
    w2: 0.2,    // velocity           (vx/svx)^2 + (vy/svy)^2
    w3: 0.6,    // attitude           (theta/sth)^2
    w4: 0.4,    // angular rate       (omega/som)^2
    w5: 0.05,   // control effort     ||u||^2
    sx: 50, sy: 100, svx: 10, svy: 20, sth: 0.3, som: 0.5,
    w2Ground: 3,          // velocity weight multiplier 1 + w2Ground * exp(-h / groundScale)
    groundScale: 15,      // m

    landBonus: 400,       // soft touchdown + stable rest (on pad)
    offPadFactor: 0.4,    // multiplier when the stable landing is outside the pad
    padBonus: 100,        // precision bonus scaled by distance to pad centre
    fuelBonus: 150,       // scaled by remaining fuel ratio
    softBonus: 60,        // scaled by how gentle the touchdown vertical speed was

    crash: 150,           // base structural-failure penalty
    crashVy: 15,          // per m/s of vertical impact speed
    crashVx: 30,          // per m/s of lateral impact speed
    crashAngle: 400,      // per rad of tilt at impact
    distPenalty: 80,      // per 50 m of lateral miss distance at termination
    lost: 1000,           // loss of control / out of bounds
    timeout: 250,         // still airborne at maxTime
    timeoutAlt: 1.5       // per m of residual altitude at timeout
  };

  LS.NN = {
    layers: [10, 16, 12, 2],
    inputLabels: ['\u0394x', '\u0394y', 'vx', 'vy', '\u03b8', '\u03c9', 'fuel', 'leg L', 'leg R', 'F/Fmax'],
    outputLabels: ['THROTTLE', 'PITCH CMD'],
    noisyInputs: 6        // Gaussian sensor noise applies to the first 6 (navigation) inputs
  };

  LS.GA = {
    popSize: 40,
    eliteFrac: 0.10,
    tournamentK: 5,
    crossover: 'sbx',     // 'sbx' | 'uniform'
    crossoverProb: 0.9,
    sbxEta: 12,
    baseRate: 0.10,       // per-gene mutation probability
    baseSigma: 0.20,      // Gaussian mutation step
    maxRate: 0.30,
    maxSigma: 0.50,
    plateauWindow: 3,     // compares mean of last 3 gens with the 3 before
    weightClamp: 8
  };

  LS.CHECKPOINT_GENS = [1, 5, 10, 20, 30, 50, 100];
})(globalThis.LS = globalThis.LS || {});
