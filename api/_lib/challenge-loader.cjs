// This CommonJS boundary keeps native import() intact when Vercel compiles the
// ESM API handler to CommonJS. The shared browser question bank remains .mjs.
exports.load = () => import('../../maanshan/challenge-data.mjs');
