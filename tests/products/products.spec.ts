import { test, expect } from '@playwright/test';
import { loginAs } from '../../helpers/auth';
import { PRODUCTS, BATCHES } from '../../fixtures/test-data';

test.describe('商品中心 /products', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
  });

  test('列表显示所有种子商品', async ({ page }) => {
    // The products page renders both a desktop <table> and mobile cards.
    // Use getByRole('cell') to target the desktop table td uniquely.
    await expect(page.getByRole('cell', { name: PRODUCTS.HB001.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: PRODUCTS.HB002.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: PRODUCTS.HB003.name })).toBeVisible();
  });

  test('搜索"蕴香"只显示相关商品', async ({ page }) => {
    await page.locator('input[placeholder*="搜索"]').fill('蕴香');
    await page.getByRole('button', { name: '查询' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('cell', { name: PRODUCTS.HB001.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: PRODUCTS.HB003.name })).toBeVisible();
    // HB002 filtered out — 0 elements in DOM → not.toBeVisible() is safe
    await expect(page.getByText(PRODUCTS.HB002.name)).not.toBeVisible();
  });

  test('按 HB 编码搜索精确命中', async ({ page }) => {
    await page.locator('input[placeholder*="搜索"]').fill('HB002');
    await page.getByRole('button', { name: '查询' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('cell', { name: PRODUCTS.HB002.name })).toBeVisible();
    await expect(page.getByText(PRODUCTS.HB001.name)).not.toBeVisible();
  });

  test('按条码搜索命中对应商品', async ({ page }) => {
    await page.locator('input[placeholder*="搜索"]').fill(PRODUCTS.HB002.barcode);
    await page.getByRole('button', { name: '查询' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('cell', { name: PRODUCTS.HB002.name })).toBeVisible();
  });

  test('回车也能触发搜索', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="搜索"]');
    await searchInput.fill('HB003');
    await searchInput.press('Enter');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('cell', { name: PRODUCTS.HB003.name })).toBeVisible();
    await expect(page.getByText(PRODUCTS.HB001.name)).not.toBeVisible();
  });

  test('点击"新建商品"展开建档表单', async ({ page }) => {
    await page.getByRole('button', { name: '新建商品' }).click();

    await expect(page.getByText('新建商品档案')).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'HB 编码' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: '商品名称' })).toBeVisible();
  });

  test('admin 看到"导入表格"按钮', async ({ page }) => {
    await expect(page.getByRole('button', { name: '导入表格' })).toBeVisible();
  });

  test('新建商品档案成功', async ({ page }) => {
    await page.getByRole('button', { name: '新建商品' }).click();

    await page.locator('label').filter({ hasText: 'HB 编码' }).locator('input').fill('HB999');
    await page.locator('label').filter({ hasText: '商品名称' }).locator('input').fill('测试商品');
    await page.locator('label').filter({ hasText: '规格' }).locator('input').fill('100ml/支');
    await page.locator('label').filter({ hasText: '计量单位' }).locator('input').fill('支');
    await page.locator('label').filter({ hasText: '最小售卖单位' }).locator('input').fill('支');
    await page.locator('label').filter({ hasText: '采购单位' }).locator('input').fill('盒');
    await page.locator('label').filter({ hasText: '换算率' }).locator('input').fill('12');

    await page.getByRole('button', { name: '保存档案' }).click();
    await page.waitForLoadState('networkidle');

    // Form collapses
    await expect(page.getByText('新建商品档案')).not.toBeVisible();
    // New product row appears in desktop table
    await expect(page.getByRole('cell', { name: '测试商品' })).toBeVisible();
  });

  test('staff 不显示"导入表格"按钮', async ({ page }) => {
    await loginAs(page, 'staff');
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: '导入表格' })).not.toBeVisible();
  });
});

test.describe('商品详情页 /products/:hbCode', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
  });

  test('HB001 详情页显示商品信息与批次', async ({ page }) => {
    await page.goto('/products/HB001');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(PRODUCTS.HB001.name)).toBeVisible();
    await expect(page.getByText('HB001')).toBeVisible();
    await expect(page.getByText(BATCHES.HB001_expired.batch_no)).toBeVisible();
    await expect(page.getByText(BATCHES.HB001_warning.batch_no)).toBeVisible();
  });

  test('HB001 三个库存卡片均显示非负整数', async ({ page }) => {
    await page.goto('/products/HB001');
    await page.waitForLoadState('networkidle');

    // Each card: <div class="... text-center"><p>标签</p><p>数值</p></div>
    const totalValue    = page.locator('div.text-center').filter({ hasText: '总库存' }).locator('p').last();
    const reservedValue = page.locator('div.text-center').filter({ hasText: '预占库存' }).locator('p').last();
    const sellableValue = page.locator('div.text-center').filter({ hasText: '可售库存' }).locator('p').last();

    await expect(totalValue).toHaveText(/^\d+$/);
    await expect(reservedValue).toHaveText(/^\d+$/);
    await expect(sellableValue).toHaveText(/^\d+$/);
  });

  test('HB001 库存满足：总库存 ≥ 可售库存（FIFO 不变式）', async ({ page, request }) => {
    const loginResp = await request.post('/api/v1/auth/login', {
      data: { username: 'admin', password: 'Admin@123456' },
    });
    const token = (await loginResp.json()).data.token as string;

    const resp = await request.get('/api/v1/products/HB001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const product = (await resp.json()).data.product;
    expect(product.total_stock).toBeGreaterThan(0);
    expect(product.total_stock).toBeGreaterThanOrEqual(product.sellable_stock);
    expect(product.total_stock).toBeGreaterThanOrEqual(product.reserved_stock);
  });

  test('单位换算信息正确展示', async ({ page }) => {
    await page.goto('/products/HB001');
    await page.waitForLoadState('networkidle');

    // HB001: 1 盒 = 6 支
    await expect(page.getByText('1 盒 = 6 支')).toBeVisible();
  });

  test('不存在的商品显示错误状态', async ({ page }) => {
    await page.goto('/products/NONEXISTENT');
    await page.waitForLoadState('networkidle');

    // The v-else error div has text-red-600 class; product card should not render
    await expect(page.locator('.text-red-600').first()).toBeVisible();
    await expect(page.getByText('Product Detail')).not.toBeVisible();
  });

  test('从商品列表点击"查看详情"进入详情页', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    const hb001Row = page.locator('tr').filter({ hasText: 'HB001' });
    await hb001Row.getByRole('link', { name: '查看详情' }).click();

    await expect(page).toHaveURL('/products/HB001');
    await expect(page.getByText(PRODUCTS.HB001.name)).toBeVisible();
  });
});
