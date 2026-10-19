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
      'function diagnoseDemoLogin(identifier, password) { return SmartLtc.diagnoseDemoLogin(identifier, password); }',
      'function diagnoseLogin(identifier, password) { return SmartLtc.diagnoseDemoLogin(identifier, password); }',
      'function seedDemoData(cgIdentifier) { return SmartLtc.seedDemoData(cgIdentifier); }',
      'function createPilotCaseManager(input) { return SmartLtc.createPilotCaseManager(input); }',
      'function renewCaseManagerCredential(username, credentialType, qualificationExpiry) { return SmartLtc.renewCaseManagerCredential(username, credentialType, qualificationExpiry); }',
      'function resetUserPassword(username, newPassword) { return SmartLtc.resetUserPassword(username, newPassword); }',
      'function addApprovedRuleset(input) { return SmartLtc.addApprovedRuleset(input); }',
      'function runVisitScheduler() { return SmartLtc.runVisitScheduler(); }',
      // Trigger handlers receive an event object; never pass it through as a parameter.
      'function archiveAuditLogs() { return SmartLtc.archiveAuditLogs(); }',
      'function backupWorkbook() { return SmartLtc.backupWorkbook(); }',
      'function installBackupTrigger() { return SmartLtc.installBackupTrigger(); }',
      'function installAuditArchiveTrigger() { return SmartLtc.installAuditArchiveTrigger(); }',
      'function seedLoadTestData(options) { return SmartLtc.seedLoadTestData(options); }',
      'function runLoadProbe(repeats) { return SmartLtc.runLoadProbe(repeats); }'
    ].join('\n')
  }
});
await copyFile('appsscript.json', 'dist/appsscript.json');

