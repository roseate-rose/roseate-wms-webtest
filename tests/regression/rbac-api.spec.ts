import { test, expect } from '@playwright/test';
import { ADMIN, STAFF } from '../../fixtures/test-data';

async function getToken(request: any, username: string, password: string): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', { data: { username, password } });
  return (await resp.json()).data.token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC API 层一致性（BUG-05 / OBS-01 / OBS-02 修复验证，commit 4dfb0ad / 8a3f36a）
//
// 修复后的预期状态：
//   POST /api/v1/products          → @admin_required   (staff → 403) ✓
//   POST /api/v1/products/import   → @admin_required   (staff → 403) ✓
//   POST /api/v1/orders/fulfill    → @admin_required   (staff → 403) ✓
//   GET  /api/v1/inventory/test    → 已移除/仅 debug 模式 (→ 404)    ✓
//
// 所有测试均验证修复后的正确行为。
// ─────────────────────────────────────────────────────────────────────────────

test.describe('[安全] API 层 RBAC 一致性', () => {

  // ── 调试端点 ────────────────────────────────────────────────────────────────

  test('GET /api/v1/inventory/test 调试端点已移除（OBS-01 修复验证）', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.get('/api/v1/inventory/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Endpoint is now debug-only (ENABLE_DEBUG_ENDPOINTS=0 in production).
    // In normal runs without the debug flag, it should return 404.
    expect(resp.status()).toBe(404);
  });

  // ── staff 能操作商品 ────────────────────────────────────────────────────────

  test('staff 调用 POST /api/v1/products 返回 403（BUG-05 修复验证）', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-STAFF-01', name: 'Staff 越权创建', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
      },
    });

    // POST /api/v1/products is now @admin_required — staff must get 403
    expect(resp.status()).toBe(403);
  });

  // ── staff 能发货核销 ────────────────────────────────────────────────────────

  test('staff 调用 POST /api/v1/orders/fulfill 返回 403（OBS-02 修复验证）', async ({ request }) => {
    const adminTok = await getToken(request, ADMIN.username, ADMIN.password);
    const staffTok = await getToken(request, STAFF.username, STAFF.password);

    // Create an order as admin
    const syncResp = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1, external_order_no: `OBS02-${Date.now()}` },
    });
    expect(syncResp.status()).toBe(200);
    const orderId: number = (await syncResp.json()).data.order.id;

    // Fulfill as staff — now @admin_required, must return 403
    const fulfillResp = await request.post('/api/v1/orders/fulfill', {
      headers: { Authorization: `Bearer ${staffTok}` },
      data: { order_id: orderId },
    });
    expect(fulfillResp.status()).toBe(403);
  });

  // ── admin 功能限制仍然有效 ──────────────────────────────────────────────────

  test('staff 调用 POST /api/v1/products/import 返回 403', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.post('/api/v1/products/import', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(403);
  });

  test('staff 调用 POST /api/v1/channel-mappings 返回 403', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.post('/api/v1/channel-mappings', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'test', external_sku_id: 'SKU-X', hb_code: 'HB001' },
    });

    expect(resp.status()).toBe(403);
  });

  test('staff 调用 GET /api/v1/reports/export 返回 403', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.get('/api/v1/reports/export?format=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(403);
  });
});
