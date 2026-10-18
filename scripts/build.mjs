import * as esbuild from 'esbuild';
const options = {
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian', 'electron'],
  platform: 'node', format: 'cjs', target: 'es2020', outfile: 'main.js',
  logLevel: 'info', sourcemap: false, banner: { js: '/* AI Box — generated bundle */' }
};
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else await esbuild.build(options);
