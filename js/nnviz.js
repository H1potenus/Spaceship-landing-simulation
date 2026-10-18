/*
 * nnviz.js
 * Live neural-network visualiser. Node brightness encodes activation magnitude
 * (cyan = positive, orange = negative); each synapse is drawn with thickness and
 * opacity proportional to its instantaneous signal |w_ij * a_i|, coloured by sign,
 * so the dominant sensor -> actuator pathways are visible in real time.
 */
(function (LS) {
  'use strict';

  const C = LS.COLORS;

  function sigColor(v, alpha) {
    return v >= 0 ? `rgba(34,211,238,${alpha})` : `rgba(249,115,22,${alpha})`;
  }

  class NNVisualizer {
    constructor(canvas) {
      this.canvas = canvas;
    }

    render(agent) {
      const { ctx, w, h } = LS.CU.fitCanvas(this.canvas);
      ctx.clearRect(0, 0, w, h);
      if (!agent) return;
      const brain = agent.brain;
      const layers = brain.layers;
      const acts = brain.acts;
      const padL = 84, padR = 96, padT = 16, padB = 12;
      const nL = layers.length;
      const colX = [];
      for (let l = 0; l < nL; l++) colX.push(padL + (w - padL - padR) * l / (nL - 1));
      const maxN = Math.max.apply(null, layers);
      const pos = layers.map((n, l) => {
        const arr = [];
        // Small layers (the outputs) get extra spacing so their labels never overlap.
        const span = (h - padT - padB) * Math.max(n / maxN, n <= 3 ? 0.5 : 0);
        const top = padT + ((h - padT - padB) - span) / 2;
        for (let i = 0; i < n; i++) arr.push([colX[l], n === 1 ? h / 2 : top + span * (i + 0.5) / n]);
        return arr;
      });
      const r = Math.max(3, Math.min(7.5, (h - padT - padB) / maxN * 0.34));

      // Synapses
      for (let l = 0; l < nL - 1; l++) {
        const nin = layers[l], nout = layers[l + 1];
        let maxS = 1e-6;
        for (let j = 0; j < nout; j++) for (let i = 0; i < nin; i++) {
          const sgl = Math.abs(brain.weight(l, j, i) * acts[l][i]);
          if (sgl > maxS) maxS = sgl;
        }
        for (let j = 0; j < nout; j++) {
          for (let i = 0; i < nin; i++) {
            const sig = brain.weight(l, j, i) * acts[l][i];
            const m = Math.abs(sig) / maxS;
            if (m < 0.04) continue;
            ctx.strokeStyle = sigColor(sig, (0.05 + 0.75 * m * m).toFixed(3));
            ctx.lineWidth = 0.4 + 2.8 * m;
            ctx.beginPath();
            ctx.moveTo(pos[l][i][0], pos[l][i][1]);
            ctx.lineTo(pos[l + 1][j][0], pos[l + 1][j][1]);
            ctx.stroke();
          }
        }
      }

      // Nodes
      for (let l = 0; l < nL; l++) {
        for (let i = 0; i < layers[l]; i++) {
          const a = acts[l][i];
          const isThrottle = l === nL - 1 && i === 0;
          const mag = Math.min(1, Math.abs(isThrottle ? a : a));
          const [x, y] = pos[l][i];
          ctx.fillStyle = '#0b1119';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = sigColor(a, (0.12 + 0.88 * mag).toFixed(3));
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(160,190,215,0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Labels
      ctx.font = '9.5px ' + C.mono;
      ctx.textBaseline = 'middle';
      const inL = LS.NN.inputLabels;
      for (let i = 0; i < layers[0]; i++) {
        const [x, y] = pos[0][i];
        const v = acts[0][i];
        ctx.textAlign = 'right';
        ctx.fillStyle = '#9fb2c4';
        ctx.fillText(inL[i], x - r - 38, y);
        ctx.fillStyle = v >= 0 ? C.cyan : C.orange;
        ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(2), x - r - 4, y);
      }
      const outL = LS.NN.outputLabels;
      const last = nL - 1;
      for (let j = 0; j < layers[last]; j++) {
        const [x, y] = pos[last][j];
        const v = acts[last][j];
        ctx.textAlign = 'left';
        ctx.fillStyle = '#cfd9e4';
        ctx.font = '600 9.5px ' + C.mono;
        ctx.fillText(outL[j], x + r + 6, y - 8);
        ctx.font = '9.5px ' + C.mono;
        ctx.fillStyle = j === 0 ? C.orange : C.cyan;
        ctx.fillText(v.toFixed(3), x + r + 6, y + 6);
        // output bar
        const bw = 44, bx = x + r + 46, by = y + 3;
        ctx.fillStyle = '#172230';
        ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = j === 0 ? C.orange : C.cyan;
        if (j === 0) ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, v)), 5);
        else {
          const half = bw / 2;
          const vv = Math.max(-1, Math.min(1, v));
          ctx.fillRect(bx + half + Math.min(0, vv * half), by, Math.abs(vv * half), 5);
        }
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = C.muted;
      const names = ['IN \u00b7 ' + layers[0], 'H1 \u00b7 ' + layers[1], 'H2 \u00b7 ' + layers[2], 'OUT \u00b7 ' + layers[3]];
      for (let l = 0; l < nL; l++) ctx.fillText(names[l] || '', colX[l], 6);
    }
  }

  LS.NNVisualizer = NNVisualizer;
})(globalThis.LS = globalThis.LS || {});
