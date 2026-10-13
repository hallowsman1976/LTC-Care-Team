import { expect, test } from '@playwright/test';

test('shows the permanent demo warning', async ({ page }, testInfo) => {
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, code: 'OK', message: '', requestId: 'test', data: { userId: 'cm', role: 'CM', capabilities: [] } })
  }));
  await page.route('**/api/v1/dashboard', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, code: 'OK', message: '', requestId: 'test', data: { dueToday: 1, overdue: 0, reviewQueue: 0, highRiskAlerts: 0, drafts: 0 } })
  }));
  await page.goto('/');
  await expect(page.getByTestId('environment-banner')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
});
