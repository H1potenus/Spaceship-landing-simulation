'use strict';
/*
 * load-core.js
 * Loads the DOM-free simulation core (config -> simulation) into Node and returns
 * the shared `LS` namespace. The browser loads the same files through <script> tags.
 */
const path = require('path');

const CORE = ['config', 'rng', 'environment', 'physics', 'neural', 'evolution', 'simulation'];

function loadCore() {
  if (!globalThis.LS || !globalThis.LS.Trainer) {
    for (const f of CORE) require(path.join(__dirname, '..', 'js', f + '.js'));
  }
  return globalThis.LS;
}

module.exports = { loadCore };
