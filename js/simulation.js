/*
 * simulation.js
 * Training orchestration: agents (brain + lander), sensing, LQR-style running cost,
 * terminal events and rewards, generation lifecycle, checkpoints, ghost paths,
 * replay of saved brains and disturbance injection. Contains no DOM code, so the
 * same engine runs headless (Fast-Train) or under Node for verification.
 */
(function (LS) {
  'use strict';

  const { IX, IY, IVX, IVY, ITH, IOM, IFUEL, IFT, IDL } = LS.STATE;
  const TRAJ_K = 3;  // x, y, vy
  const HIST_K = 6;  // t, throttle, pitch, theta, F/Fmax, delta
  const EVAL_MEMORY = 5; // episodes averaged for the selection fitness of surviving genomes

  function wrapAngle(a) {
    a = (a + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
  }
  LS.wrapAngle = wrapAngle;

  class Agent {
    constructor(id, genome) {
      this.id = id;
      this.brain = new LS.MLP(LS.NN.layers);
      this.lander = new LS.Lander(LS.VEHICLE);
      this.inputs = new Float64Array(LS.NN.layers[0]);
      const maxSamples = Math.ceil(LS.SIM.maxTime / LS.SIM.dt / LS.SIM.sampleEvery) + 4;
      this.maxSamples = maxSamples;
      this.traj = new Float32Array(maxSamples * TRAJ_K);
      this.hist = new Float32Array(maxSamples * HIST_K);
      this.setGenome(genome);
    }

    setGenome(genome) {
      this.genome = genome;
      this.brain.setWeights(genome);
    }

    reset(sc) {
      this.lander.reset(sc);
      this.fitness = 0;
      this.costIntegral = 0;
      this.terminal = 0;
      this.done = false;
      this.outcome = 'FLYING';
      this.reason = 'IN FLIGHT';
      this.restTimer = 0;
      this.touchdown = null;
      this.wasContact = false;
      this.throttle = 0;
      this.pitch = 0;
      this.nSamples = 0;
      this.endTime = 0;
      this.impulseFlash = 0;
    }

    record(t) {
      if (this.nSamples >= this.maxSamples) return;
      const s = this.lander.s, n = this.nSamples;
      const tj = n * TRAJ_K;
      this.traj[tj] = s[IX];
      this.traj[tj + 1] = s[IY];
      this.traj[tj + 2] = s[IVY];
      const hj = n * HIST_K;
      this.hist[hj] = t;
      this.hist[hj + 1] = this.throttle;
      this.hist[hj + 2] = this.pitch;
      this.hist[hj + 3] = wrapAngle(s[ITH]);
      this.hist[hj + 4] = s[IFT] / LS.VEHICLE.maxThrust;
      this.hist[hj + 5] = s[IDL];
      this.nSamples = n + 1;
    }
  }

  class Trainer {
    constructor(seed) {
      this.seed = seed === undefined ? ((Math.random() * 4294967296) >>> 0) : seed;
      this.env = new LS.Environment();
      this.gaRng = new LS.RNG(this.seed);
      this.scenarioRng = new LS.RNG(this.seed ^ 0xA5A5A5A5);
      this.noiseRng = new LS.RNG(this.seed ^ 0x5F3759DF);
      this.impulseRng = new LS.RNG(this.seed ^ 0x13579BDF);

      this.settings = {
        thrustLoss: false,
        sensorNoise: false,
        noiseSigma: 0.03,
        scenarioMode: 'random' // 'random' | 'fixed'
      };

      this.genomeSize = LS.MLP.paramCount(LS.NN.layers);
      this.evo = new LS.Evolution(this.genomeSize, LS.GA, this.gaRng);
      const pop = this.evo.initPopulation(LS.NN.layers);
      this.agents = pop.map((g, i) => new Agent(i, g));

      this.gen = 1;
      this.history = [];
      this.checkpoints = new Map();
      this.allTimeBest = null;
      this.ghostPaths = { gen1: null, gen10: null, best: null };
      this.lastGenSummary = null;
      this.onGenerationEnd = null;

      this.mode = 'train';
      this.replayAgent = null;
      this.replayLabel = null;
      this.replayScenario = null;
      this.replayT = 0;
      this.replayStep = 0;
      this.replayHold = 0;

      this.fixedScenario = this._makeScenario();
      this._startGeneration();
    }

    _makeScenario() {
      const r = this.scenarioRng, R = LS.SCENARIO;
      return {
        x0: r.range(R.x0),
        y0: r.range(R.y0),
        vx0: r.range(R.vx0),
        vy0: r.range(R.vy0),
        th0: r.range(R.th0),
        om0: r.range(R.om0),
        phases: LS.Environment.randomPhases(r)
      };
    }

    _startGeneration() {
      this.scenario = this.settings.scenarioMode === 'fixed' ? this.fixedScenario : this._makeScenario();
      for (const a of this.agents) a.reset(this.scenario);
      this.t = 0;
      this.stepIndex = 0;
      this.leaderIdx = 0;
      for (const a of this.agents) a.record(0);
    }

    // ---------------------------------------------------------------- sensing
    _sense(a) {
      const s = a.lander.s, V = LS.VEHICLE, S = LS.SIM, inp = a.inputs;
      // Altitude uses a signed square-root scaling so the last few metres before
      // touchdown keep useful resolution (1 m -> 0.1, 25 m -> 0.5, 225 m -> 1.5).
      const dy = (s[IY] - LS.targetHeight()) / 100;
      inp[0] = (s[IX] - S.padX) / 50;
      inp[1] = dy >= 0 ? Math.sqrt(dy) : -Math.sqrt(-dy);
      inp[2] = s[IVX] / 5;
      inp[3] = s[IVY] / 10;
      inp[4] = wrapAngle(s[ITH]) / 0.5;
      inp[5] = s[IOM] / 1.0;
      inp[6] = s[IFUEL] / V.fuelMass;
      inp[7] = a.lander.contact[0];
      inp[8] = a.lander.contact[1];
      inp[9] = s[IFT] / V.maxThrust;
      if (this.settings.sensorNoise) {
        const sig = this.settings.noiseSigma;
        for (let k = 0; k < LS.NN.noisyInputs; k++) inp[k] += this.noiseRng.gauss() * sig;
      }
      for (let k = 0; k < inp.length; k++) {
        if (inp[k] > 5) inp[k] = 5; else if (inp[k] < -5) inp[k] = -5;
      }
    }

    // --------------------------------------------------------- agent stepping
    _stepAgent(a, t, stepIndex, phases) {
      const L = a.lander, s = L.s, V = LS.VEHICLE, S = LS.SIM, W = LS.FITNESS;
      const dt = S.dt;

      if (stepIndex % S.controlEvery === 0) {
        this._sense(a);
        const out = a.brain.forward(a.inputs);
        a.throttle = out[0];
        a.pitch = out[1];
        L.cmdThrottle = out[0];
        L.cmdPitch = out[1];
      }
      L.thrustFactor = this.settings.thrustLoss ? 0.8 : 1.0;
      L.step(t, dt, this.env, phases);
      L.updateKinematics();
      const tn = t + dt;
      if (a.impulseFlash > 0) a.impulseFlash -= dt;

      // LQR-inspired integrated running cost J_step.
      const ex = (s[IX] - S.padX) / W.sx;
      const ey = (s[IY] - LS.targetHeight()) / W.sy;
      const evx = s[IVX] / W.svx;
      const evy = s[IVY] / W.svy;
      const eth = wrapAngle(s[ITH]) / W.sth;
      const eom = s[IOM] / W.som;
      // Gain-scheduled velocity weight: grows towards the ground (terminal-phase emphasis).
      const hAgl = s[IY] - V.restHeight - LS.groundHeight(s[IX]);
      const w2s = W.w2 * (1 + W.w2Ground * Math.exp(-(hAgl > 0 ? hAgl : 0) / W.groundScale));
      const J = (W.w1 * (ex * ex + ey * ey) +
                 w2s * (evx * evx + evy * evy) +
                 W.w3 * eth * eth +
                 W.w4 * eom * eom +
                 W.w5 * (a.throttle * a.throttle + a.pitch * a.pitch)) * dt;
      a.costIntegral += J;
      a.fitness -= J;

      if ((stepIndex + 1) % S.sampleEvery === 0) a.record(tn);

      // ---- Terminal events ----
      const th = wrapAngle(s[ITH]);
      const anyContact = L.contact[0] || L.contact[1];

      if (L.sideImpact) return this._terminate(a, tn, 'CRASH', 'PLATFORM COLLISION');
      if (L.hullMinY < 0) return this._terminate(a, tn, 'CRASH', 'HULL STRIKE');

      if (anyContact && !a.wasContact) {
        const td = { vx: s[IVX], vy: s[IVY], th, t: tn };
        if (!a.touchdown) a.touchdown = td;
        if (Math.abs(td.vy) > S.softVy || Math.abs(td.vx) > S.softVx || Math.abs(th) > S.softTheta) {
          a.touchdown = td;
          return this._terminate(a, tn, 'CRASH', 'HARD LANDING');
        }
      }
      a.wasContact = !!anyContact;

      if (anyContact && Math.abs(th) > S.tipOver) return this._terminate(a, tn, 'CRASH', 'TIP-OVER');
      if (!anyContact && Math.abs(th) > S.lossOfControl) return this._terminate(a, tn, 'LOST', 'LOSS OF CONTROL');
      if (Math.abs(s[IX]) > S.worldHalfWidth || s[IY] > S.ceiling) return this._terminate(a, tn, 'LOST', 'OUT OF BOUNDS');

      if (L.contact[0] && L.contact[1]) {
        const sp = Math.sqrt(s[IVX] * s[IVX] + s[IVY] * s[IVY]);
        if (sp < S.restSpeed && Math.abs(s[IOM]) < S.restOmega) {
          a.restTimer += dt;
          if (a.restTimer >= S.restTime) return this._terminate(a, tn, 'LANDED', 'LANDED');
        } else {
          a.restTimer = 0;
        }
      } else {
        a.restTimer = 0;
      }

      if (tn >= S.maxTime - 1e-9) return this._terminate(a, tn, 'TIMEOUT', 'TIMEOUT');
    }

    _terminate(a, t, outcome, reason) {
      const s = a.lander.s, S = LS.SIM, W = LS.FITNESS, V = LS.VEHICLE;
      const dx = Math.abs(s[IX] - S.padX);
      const missPen = W.distPenalty * Math.min(dx, 300) / 50;
      let term = 0;
      if (outcome === 'LANDED') {
        const onPad = dx <= S.padHalfWidth;
        const fuelRatio = s[IFUEL] / V.fuelMass;
        const tdVy = a.touchdown ? Math.abs(a.touchdown.vy) : 0;
        term = W.landBonus * (onPad ? 1 : W.offPadFactor) +
               W.fuelBonus * fuelRatio +
               (onPad ? W.padBonus * (1 - dx / S.padHalfWidth) : -missPen) +
               W.softBonus * (1 - Math.min(1, tdVy / S.softVy));
        if (!onPad) reason = 'LANDED OFF-PAD';
      } else if (outcome === 'CRASH') {
        // Graded separately on each touchdown limit so near-misses still carry a gradient.
        term = -(W.crash + W.crashVy * Math.abs(s[IVY]) + W.crashVx * Math.abs(s[IVX]) +
                 W.crashAngle * Math.abs(wrapAngle(s[ITH])) + missPen);
      } else if (outcome === 'LOST') {
        term = -(W.lost + missPen);
      } else if (outcome === 'TIMEOUT') {
        term = -(W.timeout + W.timeoutAlt * Math.max(0, s[IY] - LS.targetHeight()) + missPen);
      }
      a.terminal = term;
      a.fitness += term;
      a.done = true;
      a.outcome = outcome;
      a.reason = reason;
      a.endTime = t;
      a.lander.cmdThrottle = 0;
      a.lander.cmdPitch = 0;
      a.record(t);
    }

    // ------------------------------------------------------------- main step
    step() {
      if (this.mode === 'replay') { this._stepReplay(); return; }
      const t = this.t, ph = this.scenario.phases, si = this.stepIndex;
      let alive = 0;
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (a.done) continue;
        this._stepAgent(a, t, si, ph);
        if (!a.done) alive++;
      }
      this.t = t + LS.SIM.dt;
      this.stepIndex = si + 1;
      if (this.stepIndex % 10 === 0) this._updateLeader();
      if (alive === 0) this._endGeneration();
    }

    _updateLeader() {
      const ag = this.agents;
      let best = this.leaderIdx, bestF = ag[best].fitness;
      for (let i = 0; i < ag.length; i++) {
        if (ag[i].fitness > bestF + 2) { bestF = ag[i].fitness; best = i; }
      }
      this.leaderIdx = best;
    }

    countStatus() {
      let alive = 0, landed = 0, crashed = 0, other = 0;
      for (const a of this.agents) {
        if (!a.done) alive++;
        else if (a.outcome === 'LANDED') landed++;
        else if (a.outcome === 'CRASH') crashed++;
        else other++;
      }
      return { alive, landed, crashed, other };
    }

    _snapshot(a, gen) {
      return {
        gen,
        genome: Float64Array.from(a.genome),
        fitness: a.fitness,
        outcome: a.outcome,
        reason: a.reason,
        scenario: this.scenario,
        traj: a.traj.slice(0, a.nSamples * TRAJ_K),
        nSamples: a.nSamples
      };
    }

    _endGeneration() {
      const ag = this.agents, N = ag.length;
      const fitness = ag.map((a) => a.fitness);
      let bestI = 0, sum = 0, landed = 0, onPad = 0;
      for (let i = 0; i < N; i++) {
        sum += fitness[i];
        if (fitness[i] > fitness[bestI]) bestI = i;
        if (ag[i].outcome === 'LANDED') {
          landed++;
          if (ag[i].reason === 'LANDED') onPad++;
        }
      }
      const best = ag[bestI];
      const summary = {
        gen: this.gen,
        max: fitness[bestI],
        mean: sum / N,
        landed,
        onPad,
        successRate: onPad / N,
        sigma: this.evo.sigma,
        rate: this.evo.rate,
        bestReason: best.reason
      };
      this.history.push(summary);
      this.lastGenSummary = summary;

      const snap = this._snapshot(best, this.gen);
      if (LS.CHECKPOINT_GENS.indexOf(this.gen) >= 0) this.checkpoints.set('Gen ' + this.gen, snap);
      if (!this.allTimeBest || snap.fitness > this.allTimeBest.fitness) {
        this.allTimeBest = snap;
        this.checkpoints.set('All-Time Best', snap);
        this.ghostPaths.best = snap;
      }
      if (this.gen === 1) this.ghostPaths.gen1 = snap;
      if (this.gen === 10) this.ghostPaths.gen10 = snap;

      // Re-evaluation averaging: every genome keeps its last EVAL_MEMORY episode scores.
      const selFitness = new Array(N);
      for (let i = 0; i < N; i++) {
        const g = ag[i].genome;
        if (!g.evals) g.evals = [];
        g.evals.push(fitness[i]);
        if (g.evals.length > EVAL_MEMORY) g.evals.shift();
        let m = 0;
        for (const v of g.evals) m += v;
        selFitness[i] = m / g.evals.length;
      }
      let bestSel = -Infinity;
      for (let i = 0; i < N; i++) if (selFitness[i] > bestSel) bestSel = selFitness[i];
      summary.bestRobust = bestSel;

      const res = this.evo.nextGeneration(ag.map((a) => a.genome), selFitness);
      for (let i = 0; i < N; i++) ag[i].setGenome(res.genomes[i]);
      summary.sigmaNext = this.evo.sigma;
      summary.rateNext = this.evo.rate;
      summary.mode = this.evo.mode;

      this.gen++;
      this._startGeneration();
      if (this.onGenerationEnd) this.onGenerationEnd(summary);
    }

    // ---------------------------------------------------------------- replay
    startReplay(label) {
      const cp = this.checkpoints.get(label);
      if (!cp) return false;
      this.mode = 'replay';
      this.replayLabel = label;
      this.replayCheckpoint = cp;
      this.replayScenario = cp.scenario;
      this.replayAgent = new Agent(-1, Float64Array.from(cp.genome));
      this._restartReplay();
      return true;
    }

    _restartReplay() {
      this.replayAgent.reset(this.replayScenario);
      this.replayAgent.record(0);
      this.replayT = 0;
      this.replayStep = 0;
      this.replayHold = 0;
    }

    _stepReplay() {
      const a = this.replayAgent;
      if (a.done) {
        this.replayHold += LS.SIM.dt;
        if (this.replayHold > 2.5) this._restartReplay();
        return;
      }
      this._stepAgent(a, this.replayT, this.replayStep, this.replayScenario.phases);
      this.replayT += LS.SIM.dt;
      this.replayStep++;
    }

    stopReplay() {
      this.mode = 'train';
      this.replayAgent = null;
      this.replayLabel = null;
    }

    // ------------------------------------------------------------- accessors
    getLeader() {
      return this.mode === 'replay' ? this.replayAgent : this.agents[this.leaderIdx];
    }

    getTime() {
      return this.mode === 'replay' ? this.replayT : this.t;
    }

    getPhases() {
      return this.mode === 'replay' ? this.replayScenario.phases : this.scenario.phases;
    }

    getVisibleAgents() {
      return this.mode === 'replay' ? [this.replayAgent] : this.agents;
    }

    // ------------------------------------------------------------ disturbances
    applyImpulse(target) {
      const r = this.impulseRng;
      const dir = r.next() < 0.5 ? -1 : 1;
      const Jx = dir * r.uniform(2500, 4000);          // N s  (~2-3 m/s lateral kick)
      const Jy = r.uniform(-800, 800);                 // N s
      const Jth = -dir * r.uniform(2500, 4500);        // N m s (~60-110 deg/s)
      const list = target === 'all' ? this.getVisibleAgents() : [this.getLeader()];
      let n = 0;
      for (const a of list) {
        if (!a || a.done) continue;
        a.lander.applyImpulse(Jx, Jy, Jth);
        a.impulseFlash = 0.8;
        n++;
      }
      return { n, Jx, Jy, Jth };
    }
  }

  LS.Agent = Agent;
  LS.Trainer = Trainer;
  LS.TRAJ_K = TRAJ_K;
  LS.HIST_K = HIST_K;
})(globalThis.LS = globalThis.LS || {});
