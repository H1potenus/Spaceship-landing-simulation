/*
 * canvasutil.js
 * Shared drawing helpers: HiDPI canvas sizing, "nice" axis ticks, arrows,
 * plot frames and number formatting.
 */
(function (LS) {
  'use strict';

  const C = {
    cyan: '#22d3ee', green: '#34d399', orange: '#f59e0b', red: '#f87171',
    blue: '#60a5fa', yellow: '#facc15', white: '#e8f1fa', muted: '#6c7f93',
    grid: 'rgba(120,150,180,0.10)', axis: 'rgba(140,170,200,0.35)',
    mono: '"JetBrains Mono", "Cascadia Code", Consolas, Menlo, monospace'
  };
  LS.COLORS = C;

  // Resizes the backing store to the CSS size * devicePixelRatio. Returns {ctx, w, h} in CSS px.
  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nf * mag;
  }

  function ticks(min, max, target) {
    if (!(max > min)) return [min];
    const step = niceStep(max - min, target);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  function arrow(ctx, x0, y0, x1, y1, color, width, head) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const hl = Math.min(head || 8, len * 0.5);
    const ux = dx / len, uy = dy / len;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * hl - uy * hl * 0.45, y1 - uy * hl + ux * hl * 0.45);
    ctx.lineTo(x1 - ux * hl + uy * hl * 0.45, y1 - uy * hl - ux * hl * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  function fmt(v, d) {
    if (!isFinite(v)) return '\u2014';
    return v.toFixed(d === undefined ? 1 : d);
  }

  function fmtTick(v) {
    const a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
    if (a >= 10 || a === 0) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1).replace(/\.0$/, '');
    return v.toFixed(2);
  }

  /*
   * Plot frame with grid and tick labels.
   * r = {x, y, w, h} plot area; xr/yr = [min, max]. Returns mapping functions.
   */
  function frame(ctx, r, xr, yr, opts) {
    opts = opts || {};
    const X = (v) => r.x + (v - xr[0]) / (xr[1] - xr[0]) * r.w;
    const Y = (v) => r.y + r.h - (v - yr[0]) / (yr[1] - yr[0]) * r.h;
    ctx.save();
    ctx.font = '9.5px ' + C.mono;
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of ticks(xr[0], xr[1], opts.xTicks || 6)) {
      const x = Math.round(X(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke();
      ctx.fillText(fmtTick(v), x, r.y + r.h + 3);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of ticks(yr[0], yr[1], opts.yTicks || 5)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
      ctx.fillText(fmtTick(v), r.x - 4, y);
    }
    ctx.strokeStyle = C.axis;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    if (opts.xLabel) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = C.muted;
      ctx.fillText(opts.xLabel, r.x + r.w - 3, r.y + r.h - 2);
    }
    if (opts.yLabel) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = C.muted;
      ctx.fillText(opts.yLabel, r.x + 4, r.y + 3);
    }
    ctx.restore();
    return { X, Y };
  }

  function legend(ctx, items, x, y) {
    ctx.save();
    ctx.font = '9.5px ' + C.mono;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cx = x;
    for (const it of items) {
      ctx.strokeStyle = it.color;
      ctx.fillStyle = it.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(it.dash || []);
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + 14, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9fb2c4';
      ctx.fillText(it.label, cx + 18, y);
      cx += 24 + ctx.measureText(it.label).width + 8;
    }
    ctx.restore();
  }

  LS.CU = { fitCanvas, ticks, niceStep, arrow, fmt, fmtTick, frame, legend };
})(globalThis.LS = globalThis.LS || {});
