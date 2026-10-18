/*
 * neural.js
 * Feed-forward multilayer perceptron whose parameters are a flat genome.
 *
 * Genome layout, for each layer l (from l-1 with nin nodes to l with nout nodes):
 *   W_l  : nout * nin weights, row-major (W[j * nin + i] connects input i -> neuron j)
 *   b_l  : nout biases
 * Hidden layers use tanh. Output 0 (throttle) uses (tanh(z) + 1) / 2 -> [0, 1];
 * output 1 (pitch command) uses tanh(z) -> [-1, 1].
 * All layer activations are kept so the visualiser can draw live signal flow.
 */
(function (LS) {
  'use strict';

  class MLP {
    constructor(layers) {
      this.layers = layers.slice();
      this.nParams = MLP.paramCount(layers);
      this.w = new Float64Array(this.nParams);
      this.acts = layers.map((n) => new Float64Array(n));
      this.offsets = [];
      let off = 0;
      for (let l = 1; l < layers.length; l++) {
        this.offsets.push(off);
        off += layers[l - 1] * layers[l] + layers[l];
      }
    }

    static paramCount(layers) {
      let n = 0;
      for (let l = 1; l < layers.length; l++) n += layers[l - 1] * layers[l] + layers[l];
      return n;
    }

    // Xavier/Glorot-normal initialisation, suited to tanh units.
    static randomGenome(layers, rng) {
      const g = new Float64Array(MLP.paramCount(layers));
      let off = 0;
      for (let l = 1; l < layers.length; l++) {
        const nin = layers[l - 1], nout = layers[l];
        const std = 1 / Math.sqrt(nin);
        for (let k = 0; k < nin * nout; k++) g[off++] = rng.gauss() * std;
        const bstd = l === layers.length - 1 ? 0.5 : 0.1;
        for (let k = 0; k < nout; k++) g[off++] = rng.gauss() * bstd;
      }
      return g;
    }

    setWeights(genome) {
      this.w = genome;
    }

    weight(layerIndex, j, i) {
      const nin = this.layers[layerIndex];
      return this.w[this.offsets[layerIndex] + j * nin + i];
    }

    forward(input) {
      const L = this.layers, w = this.w, acts = this.acts;
      acts[0].set(input);
      const last = L.length - 1;
      for (let l = 1; l <= last; l++) {
        const nin = L[l - 1], nout = L[l];
        const prev = acts[l - 1], cur = acts[l];
        const off = this.offsets[l - 1];
        const boff = off + nin * nout;
        for (let j = 0; j < nout; j++) {
          let z = w[boff + j];
          const row = off + j * nin;
          for (let i = 0; i < nin; i++) z += w[row + i] * prev[i];
          if (l < last) cur[j] = Math.tanh(z);
          else cur[j] = j === 0 ? 0.5 * (Math.tanh(z) + 1) : Math.tanh(z);
        }
      }
      return acts[last];
    }
  }

  LS.MLP = MLP;
})(globalThis.LS = globalThis.LS || {});
