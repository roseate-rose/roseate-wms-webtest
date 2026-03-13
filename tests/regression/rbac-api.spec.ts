import { test, expect } from '@playwright/test';
import { ADMIN, STAFF } from '../../fixtures/test-data';

async function getToken(request: any, username: string, password: string): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', { data: { username, password } });
  return (await resp.json()).data.token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC API 层一致性观察
//
// 前端已限制 /settings 和 /finance 路由仅限 admin。
// 但后端 API 层存在以下不一致：
//
//   POST /api/v1/products          → @jwt_required()   (staff 可创建商品)
//   POST /api/v1/products/import   → @admin_required   (staff 不可批量导入)
//   POST /api/v1/orders/fulfill    → @jwt_required()   (staff 可发货核销)
//   GET  /api/v1/inventory/test    → @jwt_required()   (遗留调试端点，泄露身份信息)
//
// 标记为 [安全观察] 的测试当前通过（文档化现状）；
// 标记为 [已知缺陷] 的测试预期失败（暴露问题）。
// ─────────────────────────────────────────────────────────────────────────────

test.describe('[安全] API 层 RBAC 一致性', () => {

  // ── 调试端点 ────────────────────────────────────────────────────────────────

  test('[安全观察] GET /api/v1/inventory/test 遗留调试端点在生产环境中存在', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.get('/api/v1/inventory/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Endpoint exists and leaks JWT identity info (username, role, user id)
    // to any authenticated user — should not exist in production
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.data.current_user.username).toBe(STAFF.username);
    expect(body.data.current_user.role).toBe('staff');
    // This assertion documents the current (bad) state.
    // Correct: endpoint should not exist (404) in production builds.
  });

  // ── staff 能操作商品 ────────────────────────────────────────────────────────

  test('[安全观察] staff 可调用 POST /api/v1/products 创建商品（与产品批量导入仅限 admin 不一致）', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-STAFF-01', name: 'Staff 创建的商品', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
      },
    });

    // PASSES: staff currently CAN create products (201 or 409 if already exists)
    expect([201, 409]).toContain(resp.status());
    // If 403, RBAC has been fixed. This test then needs to be updated.
  });

  test('[已知缺陷] staff 创建商品应返回 403（与产品 import @admin_required 保持一致）', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.post('/api/v1/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-STAFF-02', name: 'Staff 越权创建', spec: '1ml/支',
        unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
      },
    });

    // WILL FAIL: returns 201 (created) or 409 (already exists), not 403
    expect(resp.status()).toBe(403);
  });

  // ── staff 能发货核销 ────────────────────────────────────────────────────────

  test('[安全观察] staff 可调用 POST /api/v1/orders/fulfill 发货（永久扣减库存）', async ({ request }) => {
    const adminTok = await getToken(request, ADMIN.username, ADMIN.password);
    const staffTok = await getToken(request, STAFF.username, STAFF.password);

    // Create an order as admin
    const syncResp = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1 },
    });
    expect(syncResp.status()).toBe(200);
    const orderId: number = (await syncResp.json()).data.order.id;

    // Fulfill it as staff — staff should arguably not be allowed to do this
    const fulfillResp = await request.post('/api/v1/orders/fulfill', {
      headers: { Authorization: `Bearer ${staffTok}` },
      data: { order_id: orderId },
    });

    // PASSES: staff currently CAN fulfill orders
    expect(fulfillResp.status()).toBe(200);
    // If 403, RBAC has been tightened. This test then needs to be updated.
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
