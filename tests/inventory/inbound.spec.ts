import { test, expect } from '@playwright/test';
import { loginAs } from '../../helpers/auth';
import { PRODUCTS } from '../../fixtures/test-data';

test.describe('H5 入库流程 /inbound', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/inbound');
    await page.waitForLoadState('networkidle');
  });

  test('页面展示三步引导', async ({ page }) => {
    await expect(page.getByText('1. 扫码/录码')).toBeVisible();
    await expect(page.getByText('2. 识别商品')).toBeVisible();
    await expect(page.getByText('3. 批次入库')).toBeVisible();
    await expect(page.getByText('Step 1/3')).toBeVisible();
  });

  test('输入条码后步骤推进到 Step 2', async ({ page }) => {
    const lookupInput = page.locator('input[placeholder*="HB2001"]');
    await lookupInput.fill(PRODUCTS.HB002.barcode);
    await expect(page.getByText('Step 2/3')).toBeVisible();
  });

  test('通过条码识别到商品', async ({ page }) => {
    const lookupInput = page.locator('input[placeholder*="HB2001"]');
    await lookupInput.fill(PRODUCTS.HB002.barcode);
    await page.getByRole('button', { name: '识别商品' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('已识别商品，请继续填写批次信息。')).toBeVisible();
    await expect(page.getByText(PRODUCTS.HB002.name)).toBeVisible();
    await expect(page.getByText('Step 3/3')).toBeVisible();
  });

  test('通过 HB 编码识别到商品', async ({ page }) => {
    const lookupInput = page.locator('input[placeholder*="HB2001"]');
    await lookupInput.fill(PRODUCTS.HB001.hb_code);
    await page.getByRole('button', { name: '识别商品' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(PRODUCTS.HB001.name)).toBeVisible();
  });

  test('不存在的编码显示未找到提示', async ({ page }) => {
    const lookupInput = page.locator('input[placeholder*="HB2001"]');
    await lookupInput.fill('NONEXISTENT-9999');
    await page.getByRole('button', { name: '识别商品' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('未找到对应商品，请先建档后再执行入库。')).toBeVisible();
  });

  test('完整入库流程：识别 → 填写批次 → 提交', async ({ page }) => {
    // Step 1: identify product by barcode
    const lookupInput = page.locator('input[placeholder*="HB2001"]');
    await lookupInput.fill(PRODUCTS.HB003.hb_code);
    await page.getByRole('button', { name: '识别商品' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(PRODUCTS.HB003.name)).toBeVisible();

    // Step 2: fill batch form
    await page.locator('label').filter({ hasText: '生产批号' }).locator('input').fill('TEST-LOT-001');
    await page.locator('label').filter({ hasText: '到期日期' }).locator('input').fill('2028-12-31');
    await page.locator('label').filter({ hasText: /入库数量/ }).locator('input').fill('20');
    await page.locator('label').filter({ hasText: '成本单价' }).locator('input').fill('18.00');

    // Step 3: submit
    await page.getByRole('button', { name: '确认入库' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('p.text-emerald-700')).toBeVisible();
    await expect(page.locator('p.text-emerald-700')).toContainText('入库成功');
  });

  test('采购单位入库换算后成功', async ({ page }) => {
    // HB001: purchase_unit=盒, base_unit=支, conversion_rate=6
    // Inbound 2 盒 should normalize to 12 支
    // NOTE: uses HB001 barcode lookup, not hb_code, to avoid ambiguous search match
    const lookupInput = page.locator('input[placeholder*="HB2001"]');
    await lookupInput.fill(PRODUCTS.HB001.barcode);
    await page.getByRole('button', { name: '识别商品' }).click();
    await page.waitForLoadState('networkidle');

    // Switch to 采购单位
    await page.locator('label').filter({ hasText: '数量单位' }).locator('select').selectOption('purchase');

    await page.locator('label').filter({ hasText: '生产批号' }).locator('input').fill('TEST-PURCHASE-LOT');
    await page.locator('label').filter({ hasText: '到期日期' }).locator('input').fill('2029-06-01');
    await page.locator('label').filter({ hasText: /入库数量/ }).locator('input').fill('2');
    await page.locator('label').filter({ hasText: '成本单价' }).locator('input').fill('60.00');

    await page.getByRole('button', { name: '确认入库' }).click();
    await page.waitForLoadState('networkidle');

    const successMsg = page.locator('p.text-emerald-700');
    await expect(successMsg).toBeVisible();
    // 2 盒 × 6 = 12 支
    await expect(successMsg).toContainText('12');
  });
});
