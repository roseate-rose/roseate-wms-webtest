import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

// ─────────────────────────────────────────────────────────────────────────────
// BUG-NEW-02: POST /api/v1/inventory/reserve 创建孤儿预占
//
// 业务背景：
//   /inventory/reserve 直接修改 batch.reserved_quantity，但：
//   1. 不创建 SalesOrder 记录
//   2. 不创建 OrderAllocation 记录
//   3. 系统中没有 /inventory/unreserve 或订单取消端点
//
//   结果：reserved_quantity 被永久增加，无法通过任何 API 途径释放，
//         库存永久锁死在"预占"状态，sellable_stock 虚减。
//
// 期望行为：应该返回 405/400，或者必须关联一个订单
// 实际行为：成功预占，但生成无主预占记录，库存无法释放
// ─────────────────────────────────────────────────────────────────────────────

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

test.describe('[BUG-NEW-02] /inventory/reserve 孤儿预占问题', () => {

  test('[已知缺陷] reserve 后 sellable_stock 永久减少且无法恢复', async ({ request }) => {
    const token = await adminToken(request);

    // 记录 HB002 当前可售库存（HB002 无过期批次，数字干净）
    const before = await request.get('/api/v1/products/HB002', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sellableBefore: number = (await before.json()).data.product.sellable_stock;

    // 通过 reserve 端点直接预占 2 个
    const reserveResp = await request.post('/api/v1/inventory/reserve', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB002', quantity: 2 },
    });
    expect(reserveResp.status()).toBe(200);

    // 可售库存应该减少了 2
    const afterReserve = await request.get('/api/v1/products/HB002', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sellableAfterReserve: number = (await afterReserve.json()).data.product.sellable_stock;
    expect(sellableAfterReserve).toBe(sellableBefore - 2); // 减少了 2

    // 检查是否有对应的订单被创建（应该没有）
    const ordersResp = await request.get('/api/v1/orders?status=reserved', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const orders: any[] = (await ordersResp.json()).data.items;
    const hb002Orders = orders.filter((o: any) => o.hb_code === 'HB002');

    // WILL FAIL: reserve 不创建订单，但库存已被预占，形成孤儿预占
    // 如果没有订单，这 2 个预占库存无法被 fulfill 释放
    expect(hb002Orders.length).toBeGreaterThan(0);
    // ↑ actual: length=0 — no order record for the reservation
  });

  test('[已知缺陷] 没有 unreserve 或 cancel 端点可释放孤儿预占', async ({ request }) => {
    const token = await adminToken(request);

    // 确认没有任何释放预占的 API 端点
    // 试探可能的端点（均应不存在）
    const attempts = [
      { method: 'post', path: '/api/v1/inventory/unreserve' },
      { method: 'delete', path: '/api/v1/inventory/reserve' },
      { method: 'post', path: '/api/v1/inventory/reserve/cancel' },
    ];

    for (const attempt of attempts) {
      const resp = await (attempt.method === 'post'
        ? request.post(attempt.path, {
            headers: { Authorization: `Bearer ${token}` },
            data: { hb_code: 'HB002', quantity: 1 },
          })
        : request.delete(attempt.path, {
            headers: { Authorization: `Bearer ${token}` },
          }));

      // 这些端点不应存在（404），证明没有释放机制
      expect(resp.status()).toBe(404);
    }
    // PASSES — confirms there's no release mechanism (documents the gap)
  });

  test('[已知缺陷] reserved 订单没有取消 API，预占库存无法通过订单流程释放', async ({ request }) => {
    const token = await adminToken(request);
    const ts = Date.now();

    // 通过正常 order/sync 创建订单（正确流程）
    const syncResp = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        channel_name: 'taobao',
        external_sku_id: 'SKU-HB002',
        quantity: 1,
        external_order_no: `CANCEL-TEST-${ts}`,
      },
    });
    expect(syncResp.status()).toBe(200);
    const orderId: number = (await syncResp.json()).data.order.id;

    // 尝试取消这笔订单
    const cancelAttempts = [
      () => request.delete(`/api/v1/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } }),
      () => request.post(`/api/v1/orders/${orderId}/cancel`, { headers: { Authorization: `Bearer ${token}` }, data: {} }),
      () => request.post('/api/v1/orders/cancel', { headers: { Authorization: `Bearer ${token}` }, data: { order_id: orderId } }),
    ];

    for (const attempt of cancelAttempts) {
      const resp = await attempt();
      // PASSES — none of these exist, confirming no cancel mechanism
      expect(resp.status()).toBe(404);
    }
    // The order stays "reserved" forever; stock allocation cannot be released
  });

});
