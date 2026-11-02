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

test('shows the demo sign-in form when there is no session', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'UNAUTHENTICATED', message: 'กรุณาเข้าสู่ระบบ', requestId: 'test', data: null })
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบทดลอง' })).toBeVisible();
  const password = page.getByLabel('รหัสผ่าน', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill('correct horse battery');
  await page.getByRole('button', { name: 'แสดงรหัสผ่าน' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('correct horse battery');
  await page.getByRole('button', { name: 'ซ่อนรหัสผ่าน' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});
