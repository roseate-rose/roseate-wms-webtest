import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-04: Product.barcode 列在数据库中没有 unique 约束，
//         API 层 create_product() 也不检查条码重复。
//         结果：两个商品可共用同一条码；
//         find_product(barcode=X) 只返回第一个匹配结果（不确定性）。
//
// 业务场景：扫码入库时，条码应唯一确定一款商品。
//           若两款商品共用同一条码，入库会命中任意一款，导致入错批次。
//
// 期望行为：POST /api/v1/products 若条码已存在应返回 409
// 实际行为：返回 201，两款商品均创建成功
// ─────────────────────────────────────────────────────────────────────────────

const DUPE_BARCODE = 'BC-DUPE-99999';

test.describe('[BUG-04] 商品条码唯一性', () => {

  test('[已知缺陷] 相同条码创建第二个商品时应返回 409，当前实际允许创建', async ({ request }) => {
    const token = await adminToken(request);

    // First product with this barcode
    const first = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC1', name: '条码测试商品A', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: DUPE_BARCODE,
      },
    });
    // Ignore 409 if already created from a previous run
    expect([201, 409]).toContain(first.status());

    // Second product with SAME barcode — should be rejected
    const second = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC2', name: '条码测试商品B', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: DUPE_BARCODE,
      },
    });

    // WILL FAIL: returns 201 (product created), not 409
    expect(second.status()).toBe(409);
    // ↑ actual: 201 — both HB-BC1 and HB-BC2 exist with the same barcode
  });

  test('[已知缺陷] 条码碰撞时入库命中结果不确定', async ({ request }) => {
    const token = await adminToken(request);

    // Ensure both collision products exist (created by the previous test or seeded here)
    await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC1', name: '条码测试商品A', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: DUPE_BARCODE,
      },
    });
    await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-BC2', name: '条码测试商品B', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
        barcode: DUPE_BARCODE,
      },
    });

    // Inbound using only barcode — which product gets the stock?
    const inboundResp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        barcode: DUPE_BARCODE,          // Ambiguous — matches 2 products
        batch_no: 'BN-BC-COLLISION',
        expiry_date: '2030-01-01',
        quantity: 5,
        cost: 1.0,
      },
    });

    if (inboundResp.status() === 200) {
      const result = (await inboundResp.json()).data;
      // Documents that only ONE product was hit (non-deterministic which one)
      // A correct implementation should return 409 "ambiguous barcode"
      const hbCodeHit: string = result.hb_code;
      // Both HB-BC1 and HB-BC2 are valid matches — the one returned is arbitrary
      expect(['HB-BC1', 'HB-BC2']).toContain(hbCodeHit);
      // WILL FAIL with correct behavior: should return 409 for ambiguous barcode
      expect(inboundResp.status()).toBe(409);
    }
    // If inbound returns 404/400 before even hitting the ambiguity — also worth documenting
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
