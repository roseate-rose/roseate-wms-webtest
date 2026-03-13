import { test, expect } from '@playwright/test';
import { loginAs } from '../../helpers/auth';

test.describe('RBAC 访问控制', () => {
  test.describe('staff 角色限制', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'staff');
    });

    test('staff 访问 adminOnly 路由 /settings 被重定向到 /', async ({ page }) => {
      await page.goto('/settings');
      await expect(page).toHaveURL('/');
    });

    test('staff 访问 adminOnly 路由 /finance 被重定向到 /', async ({ page }) => {
      await page.goto('/finance');
      await expect(page).toHaveURL('/');
    });

    test('staff 侧边栏不显示"设置"入口', async ({ page }) => {
      await page.goto('/');
      // Sidebar link with text "设置" should not be rendered for staff
      const settingsLink = page.locator('nav a', { hasText: '设置' });
      await expect(settingsLink).toHaveCount(0);
    });
  });

  test.describe('admin 角色权限', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin');
    });

    test('admin 可以访问 /settings', async ({ page }) => {
      await page.goto('/settings');
      await expect(page).toHaveURL('/settings');
    });

    test('admin 可以访问 /finance', async ({ page }) => {
      await page.goto('/finance');
      await expect(page).toHaveURL('/finance');
    });

    test('admin 侧边栏显示"设置"入口', async ({ page }) => {
      await page.goto('/');
      const settingsLink = page.locator('nav a', { hasText: '设置' });
      await expect(settingsLink).toBeVisible();
    });
  });
});
