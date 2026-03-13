import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-04 修复验证：条码唯一性在 API 层强制执行（commit 4dfb0ad）。
//
// 修复方案：
//   - POST /api/v1/products：若 barcode 已存在返回 409
//   - 入库时若 barcode 匹配多个商品返回 409 "ambiguous barcode"
// ─────────────────────────────────────────────────────────────────────────────

const DUPE_BARCODE = 'BC-DUPE-99999';

test.describe('[BUG-04] 商品条码唯一性', () => {

  test('相同条码创建第二个商品返回 409（BUG-04 修复验证）', async ({ request }) => {
    const token = await adminToken(request);

    // First product with this barcode — 201 first run, 409 on re-runs
    const first = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC1', name: '条码测试商品A', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: DUPE_BARCODE,
      },
    });
    expect([201, 409]).toContain(first.status());

    // Second product with SAME barcode — must be rejected
    const second = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC2', name: '条码测试商品B', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: DUPE_BARCODE,
      },
    });
    expect(second.status()).toBe(409);
  });

  test('通过条码入库精确命中唯一商品', async ({ request }) => {
    const token = await adminToken(request);
    const uniqueBarcode = `BC-INBOUND-${Date.now()}`;

    // Create a product with a unique barcode
    const createResp = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC-SCAN', name: '扫码入库测试商品', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: uniqueBarcode,
      },
    });
    // Ignore 409 if product was left over from a previous partial run
    expect([201, 409]).toContain(createResp.status());

    // Inbound using only the barcode — should route to HB-BC-SCAN deterministically
    const inboundResp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        barcode: uniqueBarcode,
        batch_no: `BN-SCAN-${Date.now()}`,
        expiry_date: '2030-01-01',
        quantity: 5,
        cost: 1.0,
      },
    });
    expect(inboundResp.status()).toBe(200);
    const result = (await inboundResp.json()).data;
    expect(result.hb_code).toBe('HB-BC-SCAN');
  });

  test('不同商品不同条码可以共存', async ({ request }) => {
    const token = await adminToken(request);

    // Baseline: distinct barcodes → both products fine
    const a = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-UA1', name: '唯一条码商品A', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: 'BC-UNIQUE-AAA',
      },
    });
    const b = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-UA2', name: '唯一条码商品B', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: 'BC-UNIQUE-BBB',
      },
    });

    expect([201, 409]).toContain(a.status()); // 201 first run, 409 if already exists
    expect([201, 409]).toContain(b.status());
  });
});
