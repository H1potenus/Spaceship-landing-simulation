/*
 * renderer.js
 * World view: sky, altitude grid, terrain and landing pad, wind field, milestone
 * ghost trajectories, the semi-transparent swarm, and the highlighted leader with
 * its force vectors (velocity, thrust, drag, weight, leg reactions) and CoM marker.
 */
(function (LS) {
  'use strict';

  const { IX, IY, IVX, IVY, ITH, IFT, IDL } = LS.STATE;
  const C = LS.COLORS;
  const CU = LS.CU;

  const SKY = {
    earth: ['#020409', '#06121f', '#0d2238'],
    mars: ['#040203', '#140a08', '#2a1510'],
    moon: ['#010102', '#030407', '#06080c'],
    titan: ['#050301', '#1a1005', '#33210a']
  };
  const GROUND = {
    earth: ['#3d4b58', '#161d25', '#93a9bd', 'rgba(40,58,76,0.55)'],
    mars: ['#7a3f26', '#2e160d', '#d08055', 'rgba(110,52,30,0.5)'],
    moon: ['#62666d', '#26282c', '#c2c7cf', 'rgba(80,84,92,0.5)'],
    titan: ['#6b5426', '#2a200c', '#c9a457', 'rgba(100,78,36,0.5)']
  };

  const RCS_TOP_Y = 1.75;  // body-frame height of the upper RCS pods [m]
  const RCS_BOT_Y = -2.6;  // body-frame height of the lower RCS pods [m]

  class WorldRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.cam = { x: 0, viewH: 300, init: false };
      this.opts = { swarm: true, follow: true, vectors: true, ghosts: true, wind: true, trails: true };
      this.stars = [];
      const r = new LS.RNG(7);
      for (let i = 0; i < 160; i++) this.stars.push([r.next(), r.next(), r.next() * 1.3 + 0.2, r.next()]);
      this.flicker = new LS.RNG(99);
    }

    // ---------------------------------------------------------------- camera
    updateCamera(leader, realDt, w, h) {
      const cam = this.cam;
      let tx, tH;
      if (this.opts.follow && leader) {
        const s = leader.lander.s;
        tx = s[IX];
        tH = Math.min(760, Math.max(42, (s[IY] + 6) * 1.55 + 18));
      } else {
        tx = 0;
        tH = 290;
      }
      if (!cam.init) { cam.x = tx; cam.viewH = tH; cam.init = true; }
      const k = Math.min(1, realDt * 3.0);
      cam.x += (tx - cam.x) * k;
      cam.viewH += (tH - cam.viewH) * k;
      cam.scale = h / cam.viewH;
      cam.bottom = -0.07 * cam.viewH;
      cam.w = w; cam.h = h;
    }

    sx(x) { return this.cam.w * 0.5 + (x - this.cam.x) * this.cam.scale; }
    sy(y) { return this.cam.h - (y - this.cam.bottom) * this.cam.scale; }

    // ------------------------------------------------------------------ main
    render(trainer, realDt, hud) {
      const { ctx, w, h } = CU.fitCanvas(this.canvas);
      const leader = trainer.getLeader();
      this.updateCamera(leader, realDt, w, h);
      const env = trainer.env;
      const t = trainer.getTime();
      const phases = trainer.getPhases();
      this.g = env.planet.g;

      this.drawSky(ctx, w, h, env.planetKey);
      this.drawGrid(ctx, w, h);
      if (this.opts.wind) this.drawWind(ctx, w, h, env, t, phases);
      this.drawGround(ctx, w, h, env.planetKey, t);
      if (this.opts.ghosts) this.drawGhosts(ctx, trainer);

      const exag = this.exaggeration();
      if (this.opts.swarm && trainer.mode === 'train') {
        for (const a of trainer.agents) {
          if (a === leader) continue;
          this.drawLander(ctx, a, 0.22, false, exag);
        }
      }
      if (leader) {
        if (this.opts.trails) this.drawTrail(ctx, leader, C.cyan, 0.85, []);
        this.drawLander(ctx, leader, 1, true, exag);
        if (this.opts.vectors) this.drawVectors(ctx, leader, exag);
      }
      this.drawHUD(ctx, w, h, trainer, leader, hud, exag);
    }

    exaggeration() {
      const px = (LS.VEHICLE.height + 1) * this.cam.scale; // hull + legs, in pixels
      return px < 52 ? 52 / px : 1;
    }

    // ------------------------------------------------------------ background
    drawSky(ctx, w, h, key) {
      const sky = SKY[key] || SKY.earth;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, sky[0]);
      g.addColorStop(0.6, sky[1]);
      g.addColorStop(1, sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const starAlpha = key === 'earth' ? 0.35 : key === 'titan' ? 0.12 : 0.8;
      for (const st of this.stars) {
        const x = ((st[0] * w * 1.3 - this.cam.x * 0.15) % w + w) % w;
        const y = st[1] * h * 0.75;
        ctx.globalAlpha = starAlpha * (0.4 + 0.6 * st[3]);
        ctx.fillStyle = '#dfe9f5';
        ctx.fillRect(x, y, st[2], st[2]);
      }
      ctx.globalAlpha = 1;
    }

    drawGrid(ctx, w, h) {
      const cam = this.cam;
      const yTop = cam.bottom + cam.viewH;
      const step = CU.niceStep(cam.viewH, 6);
      ctx.font = '10px ' + C.mono;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (let y = Math.max(step, Math.ceil(cam.bottom / step) * step); y < yTop; y += step) {
        const py = Math.round(this.sy(y)) + 0.5;
        ctx.strokeStyle = 'rgba(120,160,200,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
        ctx.fillStyle = 'rgba(140,170,200,0.45)';
        ctx.fillText(CU.fmtTick(y) + ' m', 6, py - 2);
      }
      const halfW = w / cam.scale / 2;
      const xs = CU.niceStep(halfW * 2, 8);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = Math.ceil((cam.x - halfW) / xs) * xs; x < cam.x + halfW; x += xs) {
        const px = Math.round(this.sx(x)) + 0.5;
        ctx.strokeStyle = 'rgba(120,160,200,0.045)';
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.sy(0)); ctx.stroke();
      }
    }

    drawWind(ctx, w, h, env, t, phases) {
      const out = { x: 0, y: 0 };
      const rows = 7, cols = 9;
      const cam = this.cam;
      ctx.lineWidth = 1.2;
      for (let r = 0; r < rows; r++) {
        const py = h * (0.08 + 0.78 * r / (rows - 1));
        const y = cam.bottom + (h - py) / cam.scale;
        if (y < 1) continue;
        env.wind(t, y, phases, out);
        const mag = Math.hypot(out.x, out.y);
        if (mag < 0.15) continue;
        const len = Math.min(46, 3 + mag * 2.2);
        const ux = out.x / mag, uy = -out.y / mag;
        const drift = ((t * out.x * 6) % (w / cols) + w / cols) % (w / cols);
        for (let c = 0; c < cols; c++) {
          const px = (c + 0.5) * (w / cols) + drift - w / cols / 2;
          const a = 0.10 + 0.25 * Math.min(1, mag / 15);
          CU.arrow(ctx, px - ux * len / 2, py - uy * len / 2, px + ux * len / 2, py + uy * len / 2,
            `rgba(125,211,252,${a.toFixed(3)})`, 1.2, 5);
        }
      }
    }

    drawGround(ctx, w, h, key, t) {
      const cam = this.cam;
      const gy = this.sy(0);
      const gc = GROUND[key] || GROUND.earth;

      // Distant ridge line (parallax) so the horizon reads clearly against the sky.
      ctx.fillStyle = gc[3];
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w + 8; px += 8) {
        const xw = cam.x * 0.45 + (px - w / 2) / cam.scale;
        const hy = 0.12 * cam.viewH * (0.55 + 0.3 * Math.sin(xw / 61 + 0.7) + 0.15 * Math.sin(xw / 23 + 2.1));
        ctx.lineTo(px, Math.min(gy, this.sy(hy)));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      if (gy > h + 2) { this.drawPlatform(ctx, w, h, t); return; }

      // Terrain body
      const g = ctx.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, gc[0]);
      g.addColorStop(1, gc[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, gy, w, h - gy);

      // Surface strata lines
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let k = 1; k <= 4; k++) {
        const yy = gy + k * Math.max(6, (h - gy) / 5);
        if (yy > h) break;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
      }

      // Rocks / surface texture (deterministic per world position)
      if (cam.scale > 2.5) {
        const halfW = w / cam.scale / 2;
        const step = 3.5;
        ctx.fillStyle = gc[2];
        ctx.globalAlpha = 0.55;
        for (let x = Math.floor((cam.x - halfW) / step) * step; x < cam.x + halfW; x += step) {
          const hsh = Math.abs(Math.sin(x * 12.9898) * 43758.5453) % 1;
          if (hsh < 0.45 || Math.abs(x - LS.SIM.padX) < LS.SIM.padHalfWidth + 1) continue;
          const rw = (0.3 + hsh * 0.9) * cam.scale, rh = (0.15 + hsh * 0.45) * cam.scale;
          ctx.beginPath();
          ctx.ellipse(this.sx(x + hsh), gy, rw, rh, 0, Math.PI, 2 * Math.PI);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Bright surface rim
      ctx.strokeStyle = gc[2];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, gy + 1); ctx.lineTo(w, gy + 1); ctx.stroke();

      this.drawPlatform(ctx, w, h, t);
    }

    // Raised landing platform: steel deck on a braced pillar structure.
    drawPlatform(ctx, w, h, t) {
      const S = LS.SIM;
      const deckT = 0.7;                       // deck slab thickness [m]
      const x0 = this.sx(S.padX - S.padHalfWidth), x1 = this.sx(S.padX + S.padHalfWidth);
      if (x1 < -20 || x0 > w + 20) return;
      const yTop = this.sy(S.padHeight);
      const yBot = Math.max(yTop + 4, this.sy(S.padHeight - deckT));
      const yGround = this.sy(0);
      const cx = this.sx(S.padX);
      const sc = this.cam.scale;

      // Glow halo so the target stands out from far away
      const halo = ctx.createRadialGradient(cx, yTop, 2, cx, yTop, Math.max(40, (x1 - x0) * 0.75));
      halo.addColorStop(0, 'rgba(250,204,21,0.16)');
      halo.addColorStop(1, 'rgba(250,204,21,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x0 - (x1 - x0), yTop - (x1 - x0), (x1 - x0) * 3, (x1 - x0) * 1.6);

      // Support pillars and cross bracing
      const pillars = [-0.92, -0.46, 0, 0.46, 0.92].map((f) => this.sx(S.padX + f * S.padHalfWidth));
      const pw = Math.max(2, 0.55 * sc);
      ctx.strokeStyle = '#7c8a99';
      ctx.lineWidth = Math.max(1, 0.12 * sc);
      for (let i = 0; i < pillars.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(pillars[i], yBot); ctx.lineTo(pillars[i + 1], yGround);
        ctx.moveTo(pillars[i + 1], yBot); ctx.lineTo(pillars[i], yGround);
        ctx.stroke();
      }
      for (const p of pillars) {
        const pg = ctx.createLinearGradient(p - pw / 2, 0, p + pw / 2, 0);
        pg.addColorStop(0, '#56626f');
        pg.addColorStop(0.5, '#aab7c4');
        pg.addColorStop(1, '#4a5561');
        ctx.fillStyle = pg;
        ctx.fillRect(p - pw / 2, yBot, pw, yGround - yBot);
        ctx.fillStyle = '#39434e';
        ctx.fillRect(p - pw, yGround - Math.max(2, 0.25 * sc), pw * 2, Math.max(2, 0.25 * sc));
      }

      // Deck slab with hazard-striped front face
      const dg = ctx.createLinearGradient(0, yTop, 0, yBot);
      dg.addColorStop(0, '#c9d4de');
      dg.addColorStop(0.18, '#7f8d9b');
      dg.addColorStop(1, '#4b5865');
      ctx.fillStyle = dg;
      ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, yTop + (yBot - yTop) * 0.35, x1 - x0, (yBot - yTop) * 0.65);
      ctx.clip();
      const sw = Math.max(5, 0.9 * sc);
      const dh = yBot - yTop;
      ctx.fillStyle = '#facc15';
      for (let x = x0 - dh; x < x1; x += sw * 2) {
        ctx.beginPath();
        ctx.moveTo(x, yBot); ctx.lineTo(x + sw, yBot);
        ctx.lineTo(x + sw + dh, yTop); ctx.lineTo(x + dh, yTop);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#eef3f8';
      ctx.fillRect(x0, yTop, x1 - x0, Math.max(1.5, 0.12 * sc));
      ctx.strokeStyle = '#2a3440';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, yTop + 0.5, x1 - x0 - 1, dh);

      // Centre-line target marker
      const mk = Math.max(5, 0.8 * sc);
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(cx, yTop - 1); ctx.lineTo(cx - mk, yTop - 1 - mk * 1.2); ctx.lineTo(cx + mk, yTop - 1 - mk * 1.2);
      ctx.closePath();
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.5));
      ctx.fill();
      ctx.globalAlpha = 1;

      // Edge lights: blinking corner beacons + steady green row along the deck
      const lr = Math.max(1.6, Math.min(4, sc * 0.22));
      ctx.fillStyle = '#34d399';
      for (let f = -1; f <= 1.0001; f += 0.25) {
        const lx = this.sx(S.padX + f * (S.padHalfWidth - 0.4));
        ctx.beginPath(); ctx.arc(lx, yTop - lr * 0.6, lr * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      const blink = (Math.floor(t * 2) % 2) === 0;
      ctx.fillStyle = blink ? '#f87171' : 'rgba(248,113,113,0.25)';
      for (const lx of [x0 + lr, x1 - lr]) {
        ctx.beginPath(); ctx.arc(lx, yTop - lr * 1.6, lr * 1.2, 0, Math.PI * 2); ctx.fill();
      }

      ctx.font = '600 10px ' + C.mono;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(250,204,21,0.9)';
      ctx.fillText('LZ-1 PLATFORM  \u00b1' + S.padHalfWidth + ' m  \u00b7  deck ' + S.padHeight + ' m', cx, yGround + 6);
    }

    // ------------------------------------------------------------ trajectories
    polyline(ctx, traj, n, color, alpha, dash, width) {
      if (!traj || n < 2) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1.6;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = this.sx(traj[i * 3]), y = this.sy(traj[i * 3 + 1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawGhosts(ctx, trainer) {
      const gp = trainer.ghostPaths;
      const items = [
        [gp.gen1, C.red, 'GEN 1'],
        [gp.gen10, C.orange, 'GEN 10'],
        [gp.best, C.green, 'BEST']
      ];
      ctx.font = '9.5px ' + C.mono;
      for (const [snap, color, label] of items) {
        if (!snap) continue;
        this.polyline(ctx, snap.traj, snap.nSamples, color, 0.55, [6, 5], 1.4);
        const n = snap.nSamples - 1;
        const ex = this.sx(snap.traj[n * 3]), ey = this.sy(snap.traj[n * 3 + 1]);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.8;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label + (label === 'BEST' ? ' (G' + snap.gen + ')' : ''), ex + 4, ey - 6);
        ctx.globalAlpha = 1;
      }
    }

    drawTrail(ctx, a, color, alpha) {
      this.polyline(ctx, a.traj, a.nSamples, color, alpha * 0.7, [], 1.6);
    }

    // ----------------------------------------------------------------- lander
    // Body-frame geometry (metres, +y towards the nose, CoM at the origin).
    drawLander(ctx, a, alpha, highlight, exag) {
      const L = a.lander, s = L.s, V = LS.VEHICLE;
      const scale = this.cam.scale * exag;
      const yDraw = s[IY] + (exag - 1) * V.restHeight;
      const px = this.sx(s[IX]), py = this.sy(yDraw);
      if (px < -120 || px > this.cam.w + 120 || py < -120 || py > this.cam.h + 120) return;
      const hb = V.height / 2;          // hull base at -hb
      const r = V.radius;

      let tint = '#dbe6f0';
      if (a.done) tint = a.outcome === 'LANDED' ? C.green : a.outcome === 'CRASH' ? C.red : C.orange;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.scale(scale, -scale);
      ctx.rotate(s[ITH]);
      const lw = 1 / scale;

      // ---- Main engine plume (in the gimballed nozzle frame) ----
      const F = s[IFT] / V.maxThrust;
      if (F > 0.01 && !a.done) {
        ctx.save();
        ctx.translate(0, -hb);
        ctx.rotate(s[IDL]);
        const fl = (1.6 + 8.5 * F) * (0.88 + 0.24 * this.flicker.next());
        const grad = ctx.createLinearGradient(0, -0.45, 0, -0.45 - fl);
        grad.addColorStop(0, 'rgba(255,248,215,0.97)');
        grad.addColorStop(0.22, 'rgba(255,175,60,0.9)');
        grad.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-0.45, -0.45);
        ctx.quadraticCurveTo(-0.7 - 0.3 * F, -0.45 - fl * 0.45, 0, -0.45 - fl);
        ctx.quadraticCurveTo(0.7 + 0.3 * F, -0.45 - fl * 0.45, 0.45, -0.45);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // ---- RCS side-thruster plumes ----
      // Positive pitch command = CCW couple: the upper-right pod jets to +x (pushing the
      // nose left) and the lower-left pod jets to -x (pushing the tail right).
      const rcsOn = !a.done && s[LS.STATE.IFUEL] > 0 && Math.abs(a.pitch) > 0.06;
      const sideTop = a.pitch > 0 ? 1 : -1;
      if (rcsOn) {
        const m = Math.min(1, Math.abs(a.pitch));
        this.rcsPlume(ctx, sideTop, RCS_TOP_Y, m);
        this.rcsPlume(ctx, -sideTop, RCS_BOT_Y, m);
      }

      // ---- Landing legs with visual spring compression ----
      ctx.strokeStyle = highlight ? '#b8c7d6' : tint;
      const c = Math.cos(s[ITH]);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const pen = L.feet[i * 2 + 1] - LS.groundHeight(L.feet[i * 2]);
        const comp = exag === 1 && pen < 0 ? -pen / Math.max(0.3, c) : 0;
        const footX = side * V.footX, footY = V.footY + comp;
        const ax = side * (r - 0.05), ay = -1.7;
        ctx.lineWidth = 2.6 * lw;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(footX, footY);
        const mx = ax + (footX - ax) * 0.55, my = ay + (footY - ay) * 0.55;
        ctx.moveTo(side * r, -hb + 0.25);
        ctx.lineTo(mx, my);
        ctx.stroke();
        ctx.lineWidth = 4 * lw;
        ctx.beginPath();
        ctx.moveTo(footX - 0.4, footY);
        ctx.lineTo(footX + 0.4, footY);
        ctx.stroke();
      }

      // ---- Nozzle ----
      ctx.save();
      ctx.translate(0, -hb);
      ctx.rotate(s[IDL]);
      ctx.fillStyle = highlight ? '#58616c' : tint;
      ctx.beginPath();
      ctx.moveTo(-0.3, 0.05); ctx.lineTo(0.3, 0.05); ctx.lineTo(0.5, -0.45); ctx.lineTo(-0.5, -0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ---- Hull: cylinder + ogive nose ----
      const shoulder = hb - 1.3, tip = hb + 0.2;
      ctx.beginPath();
      ctx.moveTo(-r, -hb);
      ctx.lineTo(r, -hb);
      ctx.lineTo(r, shoulder);
      ctx.quadraticCurveTo(r, tip - 0.4, 0, tip);
      ctx.quadraticCurveTo(-r, tip - 0.4, -r, shoulder);
      ctx.closePath();
      if (highlight) {
        const hg = ctx.createLinearGradient(-r, 0, r, 0);
        hg.addColorStop(0, '#8f9daa');
        hg.addColorStop(0.42, '#f3f7fb');
        hg.addColorStop(1, '#a3b1bf');
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#2b3744';                 // engine section
        ctx.fillRect(-r, -hb, 2 * r, 0.75);
        ctx.fillStyle = '#1b2633';                 // interstage band
        ctx.fillRect(-r, shoulder - 0.45, 2 * r, 0.45);
        ctx.fillStyle = '#22d3ee';                 // mission stripe
        ctx.fillRect(-r, -0.35, 2 * r, 0.22);
        ctx.fillStyle = 'rgba(27,43,61,0.55)';     // propellant gauge window
        ctx.fillRect(-0.09, -2.4, 0.18, 3.4);
        const fuelFrac = Math.max(0, s[LS.STATE.IFUEL] / V.fuelMass);
        ctx.fillStyle = 'rgba(245,158,11,0.75)';
        ctx.fillRect(-0.06, -2.37, 0.12, 3.34 * fuelFrac);
        ctx.restore();
        ctx.lineWidth = 1 * lw;
        ctx.strokeStyle = '#2a3746';
        ctx.stroke();
        ctx.fillStyle = '#0e1620';                 // cockpit window
        ctx.beginPath(); ctx.arc(0, shoulder + 0.55, 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(34,211,238,0.7)';
        ctx.beginPath(); ctx.arc(0.07, shoulder + 0.6, 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a4757';                 // grid fins
        ctx.fillRect(-r - 0.45, shoulder - 0.95, 0.45, 0.35);
        ctx.fillRect(r, shoulder - 0.95, 0.45, 0.35);
      } else {
        ctx.fillStyle = tint;
        ctx.fill();
      }

      // ---- RCS pods (always drawn; active nozzles glow) ----
      const pods = [[-1, RCS_TOP_Y], [1, RCS_TOP_Y], [-1, RCS_BOT_Y], [1, RCS_BOT_Y]];
      for (const [sx, sy] of pods) {
        ctx.fillStyle = highlight ? '#334050' : tint;
        ctx.fillRect(sx > 0 ? r - 0.02 : -r - 0.3, sy - 0.22, 0.32, 0.44);
        const active = rcsOn && ((sy === RCS_TOP_Y && sx === sideTop) || (sy === RCS_BOT_Y && sx === -sideTop));
        if (active) {
          ctx.fillStyle = '#e0f2fe';
          ctx.beginPath(); ctx.arc(sx * (r + 0.32), sy, 0.16, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();

      if (highlight) {
        ctx.save();
        ctx.strokeStyle = 'rgba(34,211,238,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(px, py, 5.2 * scale + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (a.impulseFlash > 0) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, a.impulseFlash * 1.5);
          ctx.strokeStyle = C.orange;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 5.2 * scale + 14 + (0.8 - a.impulseFlash) * 40, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = C.orange;
          ctx.font = '700 11px ' + C.mono;
          ctx.textAlign = 'center';
          ctx.fillText('IMPULSE', px, py - 5.2 * scale - 22);
          ctx.restore();
        }
      }
      if (a.done && a.outcome === 'CRASH' && alpha < 1) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4);
        ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Cold-gas RCS plume leaving a side pod at body height y, jetting towards dir (+1 / -1).
    rcsPlume(ctx, dir, y, m) {
      const r = LS.VEHICLE.radius;
      const x0 = dir * (r + 0.3);
      const len = (0.9 + 2.8 * m) * (0.85 + 0.3 * this.flicker.next());
      const wEnd = 0.25 + 0.55 * m;
      const g = ctx.createLinearGradient(x0, y, x0 + dir * len, y);
      g.addColorStop(0, 'rgba(240,250,255,0.95)');
      g.addColorStop(0.35, 'rgba(186,230,253,0.6)');
      g.addColorStop(1, 'rgba(186,230,253,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y - 0.1);
      ctx.lineTo(x0 + dir * len, y - wEnd);
      ctx.quadraticCurveTo(x0 + dir * (len + 0.3), y, x0 + dir * len, y + wEnd);
      ctx.lineTo(x0, y + 0.1);
      ctx.closePath();
      ctx.fill();
    }

    // ---------------------------------------------------------- force vectors
    drawVectors(ctx, a, exag) {
      const L = a.lander, s = L.s, V = LS.VEHICLE, d = L.diag;
      const px = this.sx(s[IX]), py = this.sy(s[IY] + (exag - 1) * V.restHeight);
      ctx.save();
      ctx.font = '600 10px ' + C.mono;
      ctx.textBaseline = 'middle';

      const label = (x, y, text, color) => {
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(text, x + 5, y);
      };

      // Weight (grey)
      const Wn = d.mass * this.g;
      const wl = 70 * Wn / V.maxThrust;
      CU.arrow(ctx, px, py, px, py + wl, 'rgba(160,175,190,0.6)', 1.5, 6);

      // Thrust (orange) - force on the vehicle along the gimballed axis
      const F = d.thrust;
      if (F > 50 && !a.done) {
        const ux = d.Ftx / F, uy = d.Fty / F;
        const len = 75 * F / V.maxThrust;
        const ex = px + ux * len, ey = py - uy * len;
        CU.arrow(ctx, px, py, ex, ey, C.orange, 2.4, 9);
        label(ex, ey, 'Ft ' + (F / 1000).toFixed(1) + ' kN', C.orange);
      }

      // Velocity (blue)
      const v = Math.hypot(s[IVX], s[IVY]);
      if (v > 0.05) {
        const len = Math.min(120, v * 3.2);
        const ex = px + s[IVX] / v * len, ey = py - s[IVY] / v * len;
        CU.arrow(ctx, px, py, ex, ey, C.blue, 2.4, 9);
        label(ex, ey, 'v ' + v.toFixed(1) + ' m/s', C.blue);
      }

      // Drag (yellow) - sqrt-scaled for visibility
      const Fd = Math.hypot(d.Fdx, d.Fdy);
      if (Fd > 1) {
        const len = Math.min(95, 11 * Math.sqrt(Fd / 100));
        const ex = px + d.Fdx / Fd * len, ey = py - d.Fdy / Fd * len;
        CU.arrow(ctx, px, py, ex, ey, C.yellow, 2, 8);
        label(ex, ey, 'D ' + Fd.toFixed(0) + ' N', C.yellow);
      }

      // Leg normal reactions (green) at the feet
      for (let i = 0; i < 2; i++) {
        const N = d.legN[i];
        if (N > 10) {
          const fx = this.sx(L.feet[i * 2]), fy = this.sy(Math.max(LS.groundHeight(L.feet[i * 2]), L.feet[i * 2 + 1]));
          CU.arrow(ctx, fx, fy, fx, fy - Math.min(60, 30 * N / 10000), C.green, 2, 7);
        }
      }

      // CoM marker (quartered disc)
      const r = 5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b1119';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, r, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0b1119';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // -------------------------------------------------------------------- HUD
    drawHUD(ctx, w, h, trainer, leader, hud, exag) {
      ctx.save();
      ctx.font = '600 11px ' + C.mono;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const replay = trainer.mode === 'replay';
      const tag = replay ? 'REPLAY \u25b8 ' + trainer.replayLabel + ' (gen ' + trainer.replayCheckpoint.gen + ' brain)'
        : 'TRAINING \u25b8 GEN ' + trainer.gen + (this.opts.swarm ? ' \u00b7 PARALLEL SWARM' : ' \u00b7 SINGLE ELITE');
      ctx.fillStyle = replay ? 'rgba(245,158,11,0.15)' : 'rgba(34,211,238,0.10)';
      const tw = ctx.measureText(tag).width;
      ctx.fillRect(10, 10, tw + 16, 22);
      ctx.fillStyle = replay ? C.orange : C.cyan;
      ctx.fillText(tag, 18, 15);

      ctx.font = '10px ' + C.mono;
      ctx.fillStyle = '#9fb2c4';
      const lines = [];
      lines.push('T+ ' + trainer.getTime().toFixed(2) + ' s   warp ' + hud.speedLabel + '   substeps/frame ' + hud.substeps);
      if (exag > 1.01) lines.push('vehicle drawn \u00d7' + exag.toFixed(1) + ' for visibility');
      lines.forEach((l, i) => ctx.fillText(l, 12, 38 + i * 14));

      // Wind indicator
      const env = trainer.env;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#9fb2c4';
      ctx.fillText(env.planet.name.toUpperCase() + '  g=' + env.planet.g.toFixed(2) + ' m/s\u00b2', w - 12, 76);
      ctx.fillText('WIND ' + env.steadyWind.toFixed(1) + ' m/s  TURB ' + env.turbulence.toFixed(1) + ' m/s', w - 12, 90);
      const flags = [];
      if (trainer.settings.thrustLoss) flags.push('ENGINE \u221220%');
      if (trainer.settings.sensorNoise) flags.push('SENSOR NOISE \u03c3=' + trainer.settings.noiseSigma.toFixed(3));
      if (flags.length) {
        ctx.fillStyle = C.orange;
        ctx.fillText(flags.join('  \u00b7  '), w - 12, 104);
      }

      // Scale bar
      const target = 80 / this.cam.scale;
      const step = CU.niceStep(target, 1);
      const bl = step * this.cam.scale;
      ctx.strokeStyle = '#9fb2c4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w - 12 - bl, h - 14); ctx.lineTo(w - 12, h - 14);
      ctx.moveTo(w - 12 - bl, h - 18); ctx.lineTo(w - 12 - bl, h - 10);
      ctx.moveTo(w - 12, h - 18); ctx.lineTo(w - 12, h - 10);
      ctx.stroke();
      ctx.textBaseline = 'bottom';
      ctx.fillText(CU.fmtTick(step) + ' m', w - 12, h - 20);

      // Legend
      if (this.opts.vectors) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const items = [[C.blue, 'velocity'], [C.orange, 'thrust'], [C.yellow, 'drag'], [C.green, 'leg N'], ['rgba(160,175,190,0.8)', 'weight']];
        let x = 12;
        for (const [col, lab] of items) {
          ctx.fillStyle = col;
          ctx.fillRect(x, h - 15, 10, 3);
          ctx.fillStyle = '#9fb2c4';
          ctx.fillText(lab, x + 14, h - 13);
          x += 22 + ctx.measureText(lab).width;
        }
      }

      // Leader outcome banner
      if (leader && leader.done) {
        const ok = leader.outcome === 'LANDED';
        const col = ok ? C.green : leader.outcome === 'CRASH' ? C.red : C.orange;
        ctx.font = '700 15px ' + C.mono;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const txt = (ok ? '\u2713 ' : '\u2717 ') + leader.reason + '   fitness ' + leader.fitness.toFixed(1);
        const bw = ctx.measureText(txt).width + 30;
        ctx.fillStyle = 'rgba(5,8,13,0.75)';
        ctx.fillRect(w / 2 - bw / 2, 52, bw, 30);
        ctx.strokeStyle = col;
        ctx.strokeRect(w / 2 - bw / 2 + 0.5, 52.5, bw, 30);
        ctx.fillStyle = col;
        ctx.fillText(txt, w / 2, 67);
      }
      ctx.restore();
    }
  }

  LS.WorldRenderer = WorldRenderer;
})(globalThis.LS = globalThis.LS || {});
