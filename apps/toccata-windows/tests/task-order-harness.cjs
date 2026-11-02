'use strict';
// Reuse the isolated host services, while allowing the same UI test against ASAR.
const path = require('node:path');
const Module = require('node:module');
const sourceMain = path.resolve(__dirname, '../main.js');
const featuresHarness = path.resolve(__dirname, 'features-harness.cjs');
const requested = process.env.TOCCATA_ORDER_TEST_APP;
if (requested && !path.isAbsolute(requested)) throw Error('TOCCATA_ORDER_TEST_APP must be absolute');
const targetMain = requested ? path.join(requested, 'main.js') : sourceMain;
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '../main.js' && parent?.filename === featuresHarness) {
    return load.call(this, targetMain, parent, ...rest);
  }
  if (request === 'electron' && parent?.filename === targetMain && targetMain !== sourceMain) {
    // features-harness owns the Electron mock; preserve its source-main guard.
    return Module._load(request, { ...parent, filename: sourceMain }, ...rest);
  }
  return load.call(this, request, parent, ...rest);
};
require('./features-harness.cjs');
