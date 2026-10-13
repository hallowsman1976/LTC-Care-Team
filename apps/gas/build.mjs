import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'iife',
  globalName: 'SmartLtc',
  target: 'es2020',
  footer: {
    js: [
      'function doPost(e) { return SmartLtc.doPost(e); }',
      'function initializeDemoWorkbook() { return SmartLtc.initializeDemoWorkbook(); }',
      'function runVisitScheduler() { return SmartLtc.runVisitScheduler(); }'
    ].join('\n')
  }
});
await copyFile('appsscript.json', 'dist/appsscript.json');

