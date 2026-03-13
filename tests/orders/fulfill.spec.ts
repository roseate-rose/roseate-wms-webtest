import { test, expect } from '@playwright/test';
import { loginAs } from '../../helpers/auth';
import { SEED_ORDER } from '../../fixtures/test-data';

test.describe('订单发货核销', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/orders');
    await page.waitForLoadState('networkidle');
  });

  test('种子订单以"待发货"状态出现在订单列表', async ({ page }) => {
    // The seeded order is taobao / SKU-HB001, status=reserved
    await expect(page.getByText(SEED_ORDER.channel_name)).toBeVisible();
    await expect(page.getByText(SEED_ORDER.external_sku_id)).toBeVisible();
    await expect(page.getByText('待发货')).toBeVisible();
    // Fulfill button present
    await expect(page.getByRole('button', { name: '发货核销' })).toBeVisible();
  });

  test('点击"发货核销"后订单变为已发货', async ({ page }) => {
    const fulfillBtn = page.getByRole('button', { name: '发货核销' }).first();
    await fulfillBtn.click();

    // Success message appears (e.g. "订单 1 已发货")
    await expect(page.getByText(/订单 \d+ 已发货/)).toBeVisible();
    // Fulfill button disappears
    await expect(page.getByRole('button', { name: '发货核销' })).toHaveCount(0);
  });

  test('通过表单同步一笔新订单', async ({ page }) => {
    const channelInput = page.locator('label').filter({ hasText: '渠道' }).locator('input');
    const skuInput = page.locator('label').filter({ hasText: '外部 SKU ID' }).locator('input');
    const qtyInput = page.locator('label').filter({ hasText: '数量' }).locator('input');

    await channelInput.fill('taobao');
    await skuInput.fill('SKU-HB002');
    await qtyInput.fill('3');

    await page.getByRole('button', { name: '同步订单' }).click();

    await expect(page.getByText(/订单已同步并锁定库存/)).toBeVisible();
    // New order should now appear in the list
    await expect(page.getByText('SKU-HB002')).toBeVisible();
  });
});
