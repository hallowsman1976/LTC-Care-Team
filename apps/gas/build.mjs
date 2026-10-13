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
      'function initializePilotWorkbook() { return SmartLtc.initializePilotWorkbook(); }',
      'function setDemoCredential(userId, identifier, password) { return SmartLtc.setDemoCredential(userId, identifier, password); }',
      'function runVisitScheduler() { return SmartLtc.runVisitScheduler(); }',
      // Trigger handlers receive an event object; never pass it through as a parameter.
      'function archiveAuditLogs() { return SmartLtc.archiveAuditLogs(); }',
      'function installAuditArchiveTrigger() { return SmartLtc.installAuditArchiveTrigger(); }',
      'function seedLoadTestData(options) { return SmartLtc.seedLoadTestData(options); }',
      'function runLoadProbe(repeats) { return SmartLtc.runLoadProbe(repeats); }'
    ].join('\n')
  }
});
await copyFile('appsscript.json', 'dist/appsscript.json');

