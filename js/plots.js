/*
 * plots.js
 * Engineering plots:
 *   FitnessPlot  - max / mean fitness per generation + on-pad success rate
 *   PhasePlot    - altitude vs vertical velocity with the full-thrust suicide-burn
 *                  envelope, milestone ghost portraits and the live leader trace
 *   ControlPlot  - throttle command vs actual thrust, pitch command, gimbal and pitch angle
 */
(function (LS) {
  'use strict';

  const C = LS.COLORS;
  const CU = LS.CU;
  const HK = 6; // must match LS.HIST_K

  function emptyMsg(ctx, w, h, msg) {
    ctx.fillStyle = C.muted;
    ctx.font = '10.5px ' + C.mono;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
  }

  class FitnessPlot {
    constructor(canvas) { this.canvas = canvas; }

    render(history) {
      const { ctx, w, h } = CU.fitCanvas(this.canvas);
      ctx.clearRect(0, 0, w, h);
      const r = { x: 44, y: 18, w: w - 44 - 34, h: h - 18 - 18 };
      if (!history.length) {
        CU.frame(ctx, r, [1, 10], [-1000, 600], {});
        emptyMsg(ctx, w, h, 'Awaiting first generation\u2026');
        return;
      }
      let lo = Infinity, hi = -Infinity;
      for (const s of history) {
        lo = Math.min(lo, s.mean, s.max);
        hi = Math.max(hi, s.max, s.mean);
      }
      const pad = (hi - lo) * 0.08 + 10;
      const xr = [1, Math.max(5, history.length)];
      const yr = [lo - pad, hi + pad];
      const { X, Y } = CU.frame(ctx, r, xr, yr, { xLabel: 'generation', yTicks: 5 });

      // Success-rate bars (secondary axis 0..100 %)
      const bw = Math.max(1, r.w / xr[1] * 0.7);
      for (const s of history) {
        if (s.successRate <= 0) continue;
        const bh = s.successRate * r.h;
        ctx.fillStyle = 'rgba(52,211,153,0.28)';
        ctx.fillRect(X(s.gen) - bw / 2, r.y + r.h - bh, bw, bh);
      }
      ctx.fillStyle = 'rgba(52,211,153,0.8)';
      ctx.font = '9.5px ' + C.mono;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('100%', r.x + r.w + 4, r.y + 4);
      ctx.fillText('0%', r.x + r.w + 4, r.y + r.h - 4);

      // Zero line
      if (yr[0] < 0 && yr[1] > 0) {
        ctx.strokeStyle = 'rgba(200,220,240,0.25)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(r.x, Y(0)); ctx.lineTo(r.x + r.w, Y(0)); ctx.stroke();
        ctx.setLineDash([]);
      }

      const line = (key, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        history.forEach((s, i) => (i ? ctx.lineTo(X(s.gen), Y(s[key])) : ctx.moveTo(X(s.gen), Y(s[key]))));
        ctx.stroke();
      };
      line('mean', C.orange, 1.4);
      line('max', C.cyan, 2);

      // Checkpoint markers
      ctx.fillStyle = 'rgba(232,241,250,0.7)';
      for (const g of LS.CHECKPOINT_GENS) {
        if (g > history.length) break;
        const s = history[g - 1];
        ctx.beginPath(); ctx.arc(X(g), Y(s.max), 2.6, 0, Math.PI * 2); ctx.fill();
      }
      const last = history[history.length - 1];
      CU.legend(ctx, [
        { color: C.cyan, label: 'max ' + last.max.toFixed(0) },
        { color: C.orange, label: 'mean ' + last.mean.toFixed(0) },
        { color: 'rgba(52,211,153,0.7)', label: 'on-pad ' + (last.successRate * 100).toFixed(0) + '%' }
      ], r.x + 4, 8);
    }
  }

  class PhasePlot {
    constructor(canvas) { this.canvas = canvas; }

    render(trainer) {
      const { ctx, w, h } = CU.fitCanvas(this.canvas);
      ctx.clearRect(0, 0, w, h);
      const r = { x: 40, y: 18, w: w - 40 - 10, h: h - 18 - 18 };
      const leader = trainer.getLeader();
      const sc = trainer.mode === 'replay' ? trainer.replayScenario : trainer.scenario;
      const yMax = Math.max(60, sc.y0 * 1.12);
      const vMin = Math.min(-30, sc.vy0 * 1.6);
      const xr = [vMin, 6], yr = [0, yMax];
      const { X, Y } = CU.frame(ctx, r, xr, yr, { xLabel: 'vy [m/s]', yLabel: 'alt above pad [m]', xTicks: 7 });
      const V = LS.VEHICLE;

      // Soft-touchdown window
      ctx.fillStyle = 'rgba(52,211,153,0.12)';
      ctx.fillRect(X(-LS.SIM.softVy), Y(yMax * 0.06), X(0) - X(-LS.SIM.softVy), Y(0) - Y(yMax * 0.06));

      // Suicide-burn envelope: v = -sqrt(2 a h), a = F_max/m - g (full throttle, leader's mass)
      if (leader) {
        const m = V.dryMass + leader.lander.s[LS.STATE.IFUEL];
        const g = trainer.env.planet.g;
        const fac = trainer.settings.thrustLoss ? 0.8 : 1;
        const aMax = V.maxThrust * fac / m - g;
        if (aMax > 0) {
          ctx.strokeStyle = 'rgba(232,241,250,0.55)';
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let i = 0; i <= 60; i++) {
            const hh = yMax * i / 60;
            const v = -Math.sqrt(2 * aMax * hh);
            if (v < xr[0]) break;
            const px = X(v), py = Y(hh);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      const trace = (traj, n, color, alpha, width) => {
        if (!traj || n < 2) return;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const px = X(Math.max(xr[0], Math.min(xr[1], traj[i * 3 + 2])));
          const py = Y(Math.max(0, Math.min(yMax, traj[i * 3 + 1] - LS.targetHeight())));
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      const gp = trainer.ghostPaths;
      if (gp.gen1) trace(gp.gen1.traj, gp.gen1.nSamples, C.red, 0.45, 1.2);
      if (gp.gen10) trace(gp.gen10.traj, gp.gen10.nSamples, C.orange, 0.45, 1.2);
      if (gp.best) trace(gp.best.traj, gp.best.nSamples, C.green, 0.55, 1.2);
      if (leader) {
        trace(leader.traj, leader.nSamples, C.cyan, 1, 1.8);
        const s = leader.lander.s;
        const px = X(Math.max(xr[0], Math.min(xr[1], s[LS.STATE.IVY])));
        const py = Y(Math.max(0, Math.min(yMax, s[LS.STATE.IY] - LS.targetHeight())));
        ctx.fillStyle = C.cyan;
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
      }

      // Target (0, 0)
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 1.5;
      const tx = X(0), ty = Y(0);
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.moveTo(tx - 9, ty); ctx.lineTo(tx + 9, ty);
      ctx.moveTo(tx, ty - 9); ctx.lineTo(tx, ty + 9);
      ctx.stroke();

      CU.legend(ctx, [
        { color: C.cyan, label: 'leader' },
        { color: 'rgba(232,241,250,0.6)', label: 'full-thrust envelope', dash: [5, 4] },
        { color: C.red, label: 'G1' }, { color: C.orange, label: 'G10' }, { color: C.green, label: 'best' }
      ], r.x + 4, 8);
    }
  }

  class ControlPlot {
    constructor(canvas) { this.canvas = canvas; }

    render(trainer) {
      const { ctx, w, h } = CU.fitCanvas(this.canvas);
      ctx.clearRect(0, 0, w, h);
      const a = trainer.getLeader();
      const tMax = Math.max(10, Math.ceil((a ? a.endTime || trainer.getTime() : 10) / 5) * 5);
      const gap = 16;
      const top = { x: 40, y: 18, w: w - 50, h: (h - 18 - 18 - gap) / 2 };
      const bot = { x: 40, y: top.y + top.h + gap, w: w - 50, h: top.h };
      const f1 = CU.frame(ctx, top, [0, tMax], [0, 1.05], { yTicks: 2, xTicks: 6 });
      const f2 = CU.frame(ctx, bot, [0, tMax], [-1.05, 1.05], { yTicks: 2, xTicks: 6, xLabel: 't [s]' });
      if (!a || a.nSamples < 2) return;
      const H = a.hist, n = a.nSamples;
      const thDeg = 20 * Math.PI / 180;
      const gm = LS.VEHICLE.gimbalMax;
      const series = (f, idx, color, width, map) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = f.X(H[i * HK]);
          const y = f.Y(map(H[i * HK + idx]));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      const clamp = (v) => Math.max(-1.05, Math.min(1.05, v));
      series(f1, 1, 'rgba(245,158,11,0.55)', 1, (v) => v);
      series(f1, 4, C.orange, 1.8, (v) => v);
      series(f2, 2, 'rgba(34,211,238,0.45)', 1, clamp);
      series(f2, 5, C.cyan, 1.6, (v) => clamp(v / gm));
      series(f2, 3, C.white, 1.4, (v) => clamp(v / thDeg));
      CU.legend(ctx, [
        { color: 'rgba(245,158,11,0.6)', label: 'u_cmd' },
        { color: C.orange, label: 'F/Fmax (lagged)' }
      ], top.x + 4, 8);
      CU.legend(ctx, [
        { color: 'rgba(34,211,238,0.5)', label: 'pitch cmd' },
        { color: C.cyan, label: '\u03b4/\u03b4max' },
        { color: C.white, label: '\u03b8 (\u00b120\u00b0)' }
      ], bot.x + 4, bot.y - 8);
    }
  }

  LS.FitnessPlot = FitnessPlot;
  LS.PhasePlot = PhasePlot;
  LS.ControlPlot = ControlPlot;
})(globalThis.LS = globalThis.LS || {});
