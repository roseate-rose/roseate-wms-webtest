import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-03 修复验证：POST /api/v1/orders/sync 通过 external_order_no 实现幂等性。
//
// 修复方案（commit 8a3f36a）：
//   - 新增 external_order_refs 表，以 (channel_name, external_order_no) 为唯一键。
//   - 调用方传入 external_order_no 时，重复调用返回同一订单，不重复预占库存。
//   - 若调用方不传 external_order_no，行为保持非幂等（兼容旧调用方）。
// ─────────────────────────────────────────────────────────────────────────────

test.describe('[BUG-03] 订单同步幂等性', () => {

  test('携带 external_order_no 重复 sync → 返回同一订单（BUG-03 修复验证）', async ({ request }) => {
    const token = await adminToken(request);
    // Use a unique order number per test run to avoid cross-run collisions
    const externalOrderNo = `ORD-IDEM-${Date.now()}`;
    const payload = {
      channel_name: 'taobao',
      external_sku_id: 'SKU-HB001',
      quantity: 1,
      external_order_no: externalOrderNo,
    };

    // First sync — creates the order
    const first = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: payload,
    });
    expect(first.status()).toBe(200);
    const firstOrderId: number = (await first.json()).data.order.id;

    // Second sync with same external_order_no — must return the SAME order
    const second = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: payload,
    });
    expect(second.status()).toBe(200);
    const secondOrderId: number = (await second.json()).data.order.id;

    // Idempotent: same order ID returned, no duplicate created
    expect(secondOrderId).toBe(firstOrderId);
  });

  test('不同 external_order_no → 独立创建两笔订单', async ({ request }) => {
    const token = await adminToken(request);
    const ts = Date.now();

    const a = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1, external_order_no: `ORD-A-${ts}` },
    });
    const b = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1, external_order_no: `ORD-B-${ts}` },
    });

    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    const idA = (await a.json()).data.order.id;
    const idB = (await b.json()).data.order.id;
    expect(idA).not.toBe(idB);
  });

  test('非同渠道/SKU 的独立订单正常创建', async ({ request }) => {
    const token = await adminToken(request);
    const ts = Date.now();

    // taobao/SKU-HB001 and taobao/SKU-HB002 are different mappings — both should succeed
    const a = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1, external_order_no: `ORD-X1-${ts}` },
    });
    const b = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB002', quantity: 1, external_order_no: `ORD-X2-${ts}` },
    });

    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    const idA = (await a.json()).data.order.id;
    const idB = (await b.json()).data.order.id;
    expect(idA).not.toBe(idB);
  });
});
