import { test, expect } from '@playwright/test';
import { ADMIN, STAFF } from '../../fixtures/test-data';

test.describe('登录流程', () => {
  test('admin 正常登录后跳转首页', async ({ page }) => {
    await page.goto('/login');
    await page.locator('label').filter({ hasText: '用户名' }).locator('input').fill(ADMIN.username);
    await page.locator('label').filter({ hasText: '密码' }).locator('input').fill(ADMIN.password);
    await page.getByRole('button', { name: '登录' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('保质期预警看板')).toBeVisible();
  });

  test('staff 正常登录后跳转首页', async ({ page }) => {
    await page.goto('/login');
    await page.locator('label').filter({ hasText: '用户名' }).locator('input').fill(STAFF.username);
    await page.locator('label').filter({ hasText: '密码' }).locator('input').fill(STAFF.password);
    await page.getByRole('button', { name: '登录' }).click();

    await expect(page).toHaveURL('/');
  });

  test('密码错误显示错误提示', async ({ page }) => {
    await page.goto('/login');
    await page.locator('label').filter({ hasText: '用户名' }).locator('input').fill(ADMIN.username);
    await page.locator('label').filter({ hasText: '密码' }).locator('input').fill('wrongpassword');
    await page.getByRole('button', { name: '登录' }).click();

    await expect(page.locator('p.text-red-600')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('未登录直接访问 /products 被重定向到 /login', async ({ page }) => {
    await page.goto('/products');
    await expect(page).toHaveURL(/\/login/);
  });

  test('未登录访问 /orders 跳转并携带 redirect 参数', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login.*redirect/);
  });
});
