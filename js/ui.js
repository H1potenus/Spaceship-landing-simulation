/*
 * ui.js
 * DOM bindings: time warp, Fast-Train, view toggles, environment / disturbance /
 * hardware controls, evolution settings, checkpoint replay list, fullscreen toggle
 * and header statistics.
 */
(function (LS) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  class UI {
    constructor(app) {
      this.app = app;
      this.checkpointsDirty = true;
      this.lastHeader = 0;
      this.bind();
    }

    bind() {
      const app = this.app;

      // Time warp
      $('warp').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) app.setSpeed(parseFloat(b.dataset.speed));
      });

      $('turbo10').addEventListener('click', () => app.startTurbo(10));
      $('turbo50').addEventListener('click', () => app.startTurbo(50));

      // View
      $('seg-view').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.setView(b.dataset.view === 'swarm');
      });
      $('seg-cam').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.setCam(b.dataset.cam === 'follow');
      });
      const ro = app.renderer.opts;
      $('chk-vectors').addEventListener('change', (e) => { ro.vectors = e.target.checked; });
      $('chk-ghosts').addEventListener('change', (e) => { ro.ghosts = e.target.checked; });
      $('chk-wind').addEventListener('change', (e) => { ro.wind = e.target.checked; });
      $('chk-trails').addEventListener('change', (e) => { ro.trails = e.target.checked; });

      // Environment
      $('sel-planet').addEventListener('change', (e) => app.trainer.env.setPlanet(e.target.value));
      $('rng-wind').addEventListener('input', (e) => {
        app.trainer.env.steadyWind = parseFloat(e.target.value);
        $('lbl-wind').textContent = app.trainer.env.steadyWind.toFixed(1) + ' m/s';
      });
      $('rng-turb').addEventListener('input', (e) => {
        app.trainer.env.turbulence = parseFloat(e.target.value);
        $('lbl-turb').textContent = app.trainer.env.turbulence.toFixed(2) + ' m/s';
      });

      // Perturbation & hardware
      $('btn-impulse').addEventListener('click', () => app.impulse($('sel-impulse-target').value));
      $('chk-thrustloss').addEventListener('change', (e) => { app.trainer.settings.thrustLoss = e.target.checked; });
      $('chk-noise').addEventListener('change', (e) => { app.trainer.settings.sensorNoise = e.target.checked; });
      $('rng-noise').addEventListener('input', (e) => {
        app.trainer.settings.noiseSigma = parseFloat(e.target.value);
        $('lbl-noise').textContent = app.trainer.settings.noiseSigma.toFixed(3);
      });

      // Evolution
      $('sel-crossover').addEventListener('change', (e) => { app.trainer.evo.cfg.crossover = e.target.value; });
      $('sel-scenario').addEventListener('change', (e) => { app.trainer.settings.scenarioMode = e.target.value; });
      $('btn-reset').addEventListener('click', () => app.reset());

      // Checkpoints
      $('checkpoints').addEventListener('click', (e) => {
        const b = e.target.closest('.cp');
        if (b) app.startReplay(b.dataset.label);
      });
      $('btn-resume').addEventListener('click', () => app.stopReplay());

      // Fullscreen
      $('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
      $('btn-fullscreen-2').addEventListener('click', () => this.toggleFullscreen());
      document.addEventListener('fullscreenchange', () => this.syncFullscreen());
      document.addEventListener('webkitfullscreenchange', () => this.syncFullscreen());

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        const speeds = { Digit1: 0.5, Digit2: 1, Digit3: 5, Digit4: 20, Digit5: 100 };
        if (e.code === 'Space') { e.preventDefault(); app.togglePause(); }
        else if (speeds[e.code] !== undefined) app.setSpeed(speeds[e.code]);
        else if (e.code === 'KeyI') app.impulse($('sel-impulse-target').value);
        else if (e.code === 'KeyV') this.setView(!app.renderer.opts.swarm);
        else if (e.code === 'KeyC') this.setCam(!app.renderer.opts.follow);
        else if (e.code === 'KeyF') this.toggleFullscreen();
        else if (e.code === 'Escape' && $('viewport').classList.contains('pseudo-full')) this.toggleFullscreen();
      });
    }

    // Re-applies the current control values to a freshly created trainer.
    applyControlsTo(trainer) {
      trainer.env.setPlanet($('sel-planet').value);
      trainer.env.steadyWind = parseFloat($('rng-wind').value);
      trainer.env.turbulence = parseFloat($('rng-turb').value);
      trainer.settings.thrustLoss = $('chk-thrustloss').checked;
      trainer.settings.sensorNoise = $('chk-noise').checked;
      trainer.settings.noiseSigma = parseFloat($('rng-noise').value);
      trainer.settings.scenarioMode = $('sel-scenario').value;
      trainer.evo.cfg.crossover = $('sel-crossover').value;
    }

    setView(swarm) {
      this.app.renderer.opts.swarm = swarm;
      for (const b of $('seg-view').children) b.classList.toggle('active', (b.dataset.view === 'swarm') === swarm);
    }

    setCam(follow) {
      this.app.renderer.opts.follow = follow;
      for (const b of $('seg-cam').children) b.classList.toggle('active', (b.dataset.cam === 'follow') === follow);
    }

    setSpeedButtons(speed) {
      for (const b of $('warp').children) b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
    }

    // Fullscreen for the simulation view. Uses the Fullscreen API and falls back to a
    // window-filling layout when the browser refuses (e.g. inside an embedded frame).
    toggleFullscreen() {
      const vp = $('viewport');
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      if (vp.classList.contains('pseudo-full')) {
        vp.classList.remove('pseudo-full');
        this.syncFullscreen();
        return;
      }
      const req = vp.requestFullscreen || vp.webkitRequestFullscreen;
      const fallback = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        vp.classList.add('pseudo-full');
        this.syncFullscreen();
      };
      if (!req) { fallback(); return; }
      try {
        const p = req.call(vp);
        if (p && p.catch) p.catch(fallback);
        // Some embedded browsers leave the request pending forever; fall back after a moment.
        setTimeout(fallback, 600);
      } catch (err) {
        fallback();
      }
    }

    syncFullscreen() {
      const vp = $('viewport');
      if (document.fullscreenElement || document.webkitFullscreenElement) vp.classList.remove('pseudo-full');
      const full = !!(document.fullscreenElement || document.webkitFullscreenElement) || vp.classList.contains('pseudo-full');
      vp.classList.toggle('is-full', full);
      $('fs-label').textContent = full ? 'Exit fullscreen' : 'Fullscreen';
      this.app.renderer.cam.init = false;
    }

    renderCheckpoints() {
      if (!this.checkpointsDirty) return;
      this.checkpointsDirty = false;
      const tr = this.app.trainer;
      const root = $('checkpoints');
      const labels = [];
      for (const g of LS.CHECKPOINT_GENS) if (tr.checkpoints.has('Gen ' + g)) labels.push('Gen ' + g);
      if (tr.checkpoints.has('All-Time Best')) labels.push('All-Time Best');
      if (!labels.length) {
        root.innerHTML = '<div class="muted">Checkpoints appear after Gen 1 completes.</div>';
      } else {
        root.innerHTML = labels.map((lab) => {
          const cp = tr.checkpoints.get(lab);
          const cls = cp.outcome === 'LANDED' ? 'res-landed' : cp.outcome === 'CRASH' ? 'res-crash' : 'res-other';
          const active = tr.mode === 'replay' && tr.replayLabel === lab ? ' active' : '';
          const sub = lab === 'All-Time Best' ? ' (G' + cp.gen + ')' : '';
          return `<button class="cp${active}" data-label="${lab}"><span class="cp-name">\u25b6 ${lab}${sub}</span>` +
            `<span class="cp-fit">${cp.fitness.toFixed(1)}</span><span class="cp-res ${cls}">${cp.reason}</span></button>`;
        }).join('');
      }
      $('btn-resume').classList.toggle('hidden', tr.mode !== 'replay');
    }

    // Header and GA readouts (throttled to ~12 Hz).
    update(now) {
      const app = this.app, tr = app.trainer;
      this.renderCheckpoints();
      if (now - this.lastHeader < 80) return;
      this.lastHeader = now;

      const cnt = tr.mode === 'replay' ? null : tr.countStatus();
      $('hdr-gen').textContent = tr.gen;
      $('hdr-time').textContent = tr.getTime().toFixed(2) + ' s';
      $('hdr-alive').textContent = cnt ? cnt.alive : '\u2014';
      $('hdr-landed').textContent = cnt ? cnt.landed : '\u2014';
      $('hdr-failed').textContent = cnt ? cnt.crashed + cnt.other : '\u2014';
      $('hdr-best').textContent = tr.allTimeBest ? tr.allTimeBest.fitness.toFixed(1) : '\u2014';
      $('substeps').textContent = app.substeps;
      $('dt-readout').textContent = LS.SIM.dt.toFixed(3) + ' s';
      $('simrate').textContent = app.turbo ? 'MAX (headless)' : app.speed === 0 ? 'PAUSED' : app.speed + 'x';
      $('ga-sigma').textContent = tr.evo.sigma.toFixed(3);
      $('ga-rate').textContent = tr.evo.rate.toFixed(3);
      $('ga-mode').textContent = tr.evo.mode + (tr.evo.stagnation ? ' (' + tr.evo.stagnation + ')' : '');
      $('ga-mode').style.color = tr.evo.mode === 'EXPLORE' ? LS.COLORS.orange : LS.COLORS.green;
      const lg = tr.lastGenSummary;
      $('ga-success').textContent = lg ? lg.landed + ' / ' + lg.onPad : '\u2014';

      const ts = $('turbo-status');
      if (app.turbo) {
        ts.textContent = 'Training headless\u2026 gen ' + tr.gen + ' \u2192 ' + app.turbo.target;
        ts.classList.add('on');
      } else {
        ts.textContent = 'Headless training idle';
        ts.classList.remove('on');
      }

      const a = tr.getLeader();
      if (!a) return;
      $('nn-agent').textContent = tr.mode === 'replay' ? 'replay \u00b7 ' + tr.replayLabel : 'agent #' + a.id;
    }
  }

  LS.UI = UI;
})(globalThis.LS = globalThis.LS || {});
