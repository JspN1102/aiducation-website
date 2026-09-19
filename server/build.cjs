'use strict';

const path = require('node:path');
const { build } = require('esbuild');

// Only application sources are bundled. Node and installed dependencies remain
// runtime imports; credentials are read from process.env when the service runs.
build({
  absWorkingDir: path.join(__dirname, '..'),
  entryPoints: ['server/handler-registry.mjs'],
  outfile: 'server/.build/handlers.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning'
}).catch(() => { process.exitCode = 1; });
