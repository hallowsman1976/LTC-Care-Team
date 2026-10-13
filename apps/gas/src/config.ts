export type AppMode = 'DEMO' | 'PILOT';

export function getAppMode(): AppMode {
  const mode = PropertiesService.getScriptProperties().getProperty('APP_MODE');
  if (mode !== 'DEMO' && mode !== 'PILOT') throw new Error('UNSUPPORTED_APP_MODE');
  return mode;
}

export function requireOperationalMode(): void {
  const mode = getAppMode();
  if (mode === 'PILOT') {
    getRequiredProperty('SPREADSHEET_ID');
    const secret = getRequiredProperty('GATEWAY_ASSERTION_SECRET');
    if (secret.length < 32 || secret.includes('replace')) throw new Error('INVALID_CONFIG:GATEWAY_ASSERTION_SECRET');
  }
}

export function requireDemoMode(): void {
  if (getAppMode() !== 'DEMO') throw new Error('DEMO_MODE_REQUIRED');
}

export function getRequiredProperty(name: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`MISSING_CONFIG:${name}`);
  return value;
}

export function getSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const id = getRequiredProperty('SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

