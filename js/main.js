/*
 * main.js
 * Application bootstrap and render loop.
 *
 * Time warp rule: the physics timestep dt is NEVER changed. Warp only changes how many
 * fixed-dt integration substeps run per rendered frame (accumulator pattern), so RK4
 * and the stiff leg springs stay numerically identical at 0.5x and at 100x.
 */
(function (LS) {
  'use strict';

  const MAX_WARP = 100;

  const app = {
    trainer: null,
    renderer: new LS.WorldRenderer(document.getElementById('world')),
    nnviz: new LS.NNVisualizer(document.getElementById('nn')),
    fitPlot: new LS.FitnessPlot(document.getElementById('plot-fitness')),
    phasePlot: new LS.PhasePlot(document.getElementById('plot-phase')),
    ctrlPlot: new LS.ControlPlot(document.getElementById('plot-control')),
    ui: null,
    speed: 1,
    lastSpeed: 1,
    acc: 0,
    substeps: 0,
    turbo: null,
    lastFrame: performance.now(),
    plotTimer: 0,

    attachTrainer(tr) {
      this.trainer = tr;
      tr.onGenerationEnd = () => { if (this.ui) this.ui.checkpointsDirty = true; };
    },

    setSpeed(v) {
      if (v > 0) this.lastSpeed = v;
      this.speed = v;
      this.acc = 0;
      this.ui.setSpeedButtons(v);
    },

    togglePause() {
      this.setSpeed(this.speed === 0 ? (this.lastSpeed || 1) : 0);
    },

    startTurbo(n) {
      if (this.trainer.mode === 'replay') this.stopReplay();
      this.turbo = { target: this.trainer.gen + n };
    },

    impulse(target) {
      this.trainer.applyImpulse(target);
    },

    startReplay(label) {
      this.turbo = null;
      if (this.trainer.startReplay(label)) {
        this.renderer.cam.init = false;
        this.ui.checkpointsDirty = true;
        if (this.speed === 0) this.setSpeed(1);
      }
    },

    stopReplay() {
      this.trainer.stopReplay();
      this.renderer.cam.init = false;
      this.ui.checkpointsDirty = true;
    },

    reset() {
      this.turbo = null;
      const tr = new LS.Trainer();
      this.ui.applyControlsTo(tr);
      tr._startGeneration();
      this.attachTrainer(tr);
      this.renderer.cam.init = false;
      this.ui.checkpointsDirty = true;
    },

    frame(now) {
      const realDt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      const tr = this.trainer;
      const dt = LS.SIM.dt;
      let steps = 0;

      if (this.turbo) {
        // Headless: integrate as many fixed steps as fit in a ~28 ms budget.
        const t0 = performance.now();
        while (performance.now() - t0 < 28 && tr.gen < this.turbo.target) {
          for (let k = 0; k < 100; k++) tr.step();
          steps += 100;
        }
        if (tr.gen >= this.turbo.target) this.turbo = null;
      } else if (this.speed > 0) {
        this.acc += realDt * this.speed;
        const maxSteps = Math.ceil(MAX_WARP * 0.1 / dt);
        while (this.acc >= dt && steps < maxSteps) {
          tr.step();
          this.acc -= dt;
          steps++;
        }
        if (steps >= maxSteps) this.acc = 0;
      }
      this.substeps = steps;

      const leader = tr.getLeader();
      if (leader) leader.lander.computeDiag(tr.getTime(), tr.env, tr.getPhases());

      const hud = {
        speedLabel: this.turbo ? 'MAX' : this.speed === 0 ? 'PAUSED' : this.speed + 'x',
        substeps: steps
      };
      this.renderer.render(tr, realDt, hud);
      this.nnviz.render(leader);
      this.plotTimer -= realDt;
      if (this.plotTimer <= 0) {
        this.plotTimer = 1 / 30;
        this.fitPlot.render(tr.history);
        this.phasePlot.render(tr);
        this.ctrlPlot.render(tr);
      }
      this.ui.update(now);
      requestAnimationFrame((t) => this.frame(t));
    }
  };

  app.attachTrainer(new LS.Trainer());
  app.ui = new LS.UI(app);
  app.ui.applyControlsTo(app.trainer);
  LS.app = app;
  requestAnimationFrame((t) => app.frame(t));
})(globalThis.LS = globalThis.LS || {});
