import { test, expect } from '@playwright/test';
import { loginAs } from '../../helpers/auth';
import { DASHBOARD } from '../../fixtures/test-data';

test.describe('保质期预警看板', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
  });

  test('看板显示正确的过期/临期/健康批次数量', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Expired card
    const expiredCard = page.locator('button').filter({ hasText: '已过期' });
    await expect(expiredCard).toBeVisible();
    await expect(expiredCard.locator('p.text-4xl')).toHaveText(String(DASHBOARD.expired_count));

    // Warning card
    const warningCard = page.locator('button').filter({ hasText: '临期 30 天' });
    await expect(warningCard).toBeVisible();
    await expect(warningCard.locator('p.text-4xl')).toHaveText(String(DASHBOARD.warning_count));

    // Healthy card
    const healthyCard = page.locator('button').filter({ hasText: '健康库存' });
    await expect(healthyCard).toBeVisible();
    await expect(healthyCard.locator('p.text-4xl')).toHaveText(String(DASHBOARD.healthy_count));
  });

  test('点击"已过期"跳转到 /stock?status=expired', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: '已过期' }).click();
    await expect(page).toHaveURL(/\/stock.*expired/);
  });

  test('点击"临期 30 天"跳转到 /stock?status=warning', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: '临期 30 天' }).click();
    await expect(page).toHaveURL(/\/stock.*warning/);
  });

  test('点击"健康库存"跳转到 /stock?status=healthy', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: '健康库存' }).click();
    await expect(page).toHaveURL(/\/stock.*healthy/);
  });
});
