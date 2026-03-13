import { test, expect } from '@playwright/test';
import { loginAs } from '../../helpers/auth';
import { BATCHES, PRODUCTS } from '../../fixtures/test-data';

test.describe('库存到期报表 /stock', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');
  });

  test('默认"全部"视图显示所有批次', async ({ page }) => {
    // All 4 seeded batches should be visible
    await expect(page.getByText(BATCHES.HB001_expired.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB001_warning.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB002_healthy.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB003_warning.batch_no)).toBeVisible();
  });

  test('筛选"已过期"只显示过期批次', async ({ page }) => {
    await page.getByRole('button', { name: '已过期' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/status=expired/);
    await expect(page.getByText(BATCHES.HB001_expired.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB001_warning.batch_no)).not.toBeVisible();
    await expect(page.getByText(BATCHES.HB002_healthy.batch_no)).not.toBeVisible();
    await expect(page.getByText(BATCHES.HB003_warning.batch_no)).not.toBeVisible();
  });

  test('筛选"临期 30 天"只显示临期批次', async ({ page }) => {
    await page.getByRole('button', { name: '临期 30 天' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/status=warning/);
    await expect(page.getByText(BATCHES.HB001_warning.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB003_warning.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB001_expired.batch_no)).not.toBeVisible();
    await expect(page.getByText(BATCHES.HB002_healthy.batch_no)).not.toBeVisible();
  });

  test('筛选"健康"只显示健康批次', async ({ page }) => {
    await page.getByRole('button', { name: '健康' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/status=healthy/);
    await expect(page.getByText(BATCHES.HB002_healthy.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB001_expired.batch_no)).not.toBeVisible();
    await expect(page.getByText(BATCHES.HB001_warning.batch_no)).not.toBeVisible();
  });

  test('过期批次卡片使用红色背景', async ({ page }) => {
    // Find the article card containing the expired batch number
    const expiredCard = page.locator('article').filter({
      hasText: BATCHES.HB001_expired.batch_no,
    });
    await expect(expiredCard).toHaveClass(/bg-red-50/);
  });

  test('临期批次卡片使用橙色背景', async ({ page }) => {
    const warningCard = page.locator('article').filter({
      hasText: BATCHES.HB001_warning.batch_no,
    });
    await expect(warningCard).toHaveClass(/bg-amber-50/);
  });

  test('健康批次卡片使用绿色背景', async ({ page }) => {
    const healthyCard = page.locator('article').filter({
      hasText: BATCHES.HB002_healthy.batch_no,
    });
    await expect(healthyCard).toHaveClass(/bg-emerald-50/);
  });

  test('批次卡片展示到期日与库存数字', async ({ page }) => {
    const expiredCard = page.locator('article').filter({
      hasText: BATCHES.HB001_expired.batch_no,
    });
    // expiry date
    await expect(expiredCard.getByText(BATCHES.HB001_expired.expiry_date)).toBeVisible();
    // product name
    await expect(expiredCard.getByText(PRODUCTS.HB001.name)).toBeVisible();
  });
});
