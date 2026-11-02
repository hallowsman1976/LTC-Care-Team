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

test('shows open visits on the dashboard with a banner for staff but not caregivers', async ({ page }) => {
  const asRole = (role: string, capabilities: string[]) => page.route('**/api/v1/auth/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, code: 'OK', message: '', requestId: 'test', data: { userId: 'u', role, capabilities } })
  }));
  let dashboardRequests = 0;
  await page.route('**/api/v1/dashboard', async (route) => {
    dashboardRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, code: 'OK', message: '', requestId: 'test', data: { dueToday: 1, overdue: 0, reviewQueue: 0, highRiskAlerts: 0, drafts: 0, followUpVisits: [{ visitId: 'v1', visitDateTime: '2026-10-13T09:00:00+07:00', visitType: 'เยี่ยมบ้าน', status: 'SUBMITTED', patientName: 'นายทดสอบ ระบบ' }] } })
    });
  });

  await asRole('CM', ['patients:read', 'patients:write']);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ภาพรวมวันนี้' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'เพิ่มผู้รับบริการ' })).toBeVisible();
  await expect(page.getByText('นายทดสอบ ระบบ').locator('visible=true')).toBeVisible();
  // The count card's label and the visit's status.
  await expect(page.getByText('รอตรวจ', { exact: true }).locator('visible=true')).toHaveCount(2);

  const before = dashboardRequests;
  await page.getByRole('button', { name: 'รีเฟรชข้อมูล' }).click();
  await expect.poll(() => dashboardRequests).toBe(before + 1);

  await page.unroute('**/api/v1/auth/me');
  await asRole('CG', ['patients:read']);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'งานของฉัน' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ภาพรวมวันนี้' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'เพิ่มผู้รับบริการ' })).toHaveCount(0);
});

test('shows the demo sign-in form when there is no session',async ({ page }) => {
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
