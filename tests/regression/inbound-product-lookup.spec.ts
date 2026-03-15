import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

// ─────────────────────────────────────────────────────────────────────────────
// BUG-NEW-03: find_product() 静默降级 — hb_code 不存在时用 barcode 替代
//
// 问题代码（backend/app.py find_product()）：
//   if hb_code:
//       product = Product.query.filter_by(hb_code=hb_code).first()
//       if product:
//           return product, None, None
//       # ← hb_code 有值但找不到时，直接往下走！
//   if barcode:
//       ...  # 静默使用 barcode 匹配的商品
//
// 业务场景：
//   仓库员工扫码入库时，同时传了 hb_code 和 barcode。
//   若 hb_code 笔误（如 HB00l vs HB001），系统不报错，
//   而是用 barcode 匹配到另一款商品，悄悄入错仓。
//
// 期望行为：hb_code 指定但不存在 → 404
// 实际行为：静默回退到 barcode，入库成功但商品不对
// ─────────────────────────────────────────────────────────────────────────────

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

test.describe('[BUG-NEW-03] find_product hb_code 未找到时应返回 404', () => {

  test('[已知缺陷] hb_code 不存在且提供 barcode → 应 404，当前静默使用 barcode 商品', async ({ request }) => {
    const token = await adminToken(request);

    // HB001 的 barcode = "6901234567890"（种子数据）
    // 使用一个不存在的 hb_code + HB001 的 barcode
    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-GHOST-9999',      // 不存在的 hb_code
        barcode: '6901234567890',        // HB001 的 barcode
        batch_no: 'BN-GHOST-TEST',
        expiry_date: '2030-01-01',
        quantity: 1,
        cost: 1.0,
      },
    });

    // WILL FAIL: returns 200 (uses HB001 via barcode fallthrough)
    expect(resp.status()).toBe(404);
    // ↑ actual: 200, hb_code=HB001 — silently used barcode product
  });

  test('[已知缺陷] hb_code 不存在但 barcode 明确存在时入库到哪个商品', async ({ request }) => {
    const token = await adminToken(request);

    // 这个测试记录当前的错误行为：如果上面的测试因为现在通过了 200，这里可以看到商品
    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-GHOST-8888',      // 不存在
        barcode: '6901234567891',        // HB002 的 barcode
        batch_no: `BN-GHOST-FALLTHROUGH-${Date.now()}`,
        expiry_date: '2030-01-01',
        quantity: 1,
        cost: 1.0,
      },
    });

    if (resp.status() === 200) {
      // 记录当前错误行为：入库到了 HB002，不是 404
      const result = (await resp.json()).data;
      // WILL FAIL with correct behavior: should be 404
      expect(resp.status()).toBe(404);
      // ↑ actual: 200, hb_code=HB002 — confirms silent fallthrough to barcode
      console.log(`BUG: inbound routed to hb_code=${result.product?.hb_code} instead of 404`);
    }
  });

  test('hb_code 存在时正常入库（基准，不受 fallthrough 影响）', async ({ request }) => {
    const token = await adminToken(request);

    // 控制组：hb_code 有效，入库正常
    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB001',
        batch_no: `BN-LOOKUP-BASELINE-${Date.now()}`,
        expiry_date: '2030-06-01',
        quantity: 1,
        cost: 1.0,
      },
    });
    expect(resp.status()).toBe(200);
    const result = (await resp.json()).data;
    expect(result.product.hb_code).toBe('HB001');
  });

  test('hb_code 和 barcode 均不提供返回 404（基准）', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        batch_no: 'BN-NO-PRODUCT',
        expiry_date: '2030-01-01',
        quantity: 1,
        cost: 1.0,
      },
    });
    expect(resp.status()).toBe(404);
  });

});
