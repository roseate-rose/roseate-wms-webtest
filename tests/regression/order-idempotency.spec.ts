import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-03: POST /api/v1/orders/sync 对同一 (channel_name, external_sku_id)
//         没有幂等性检查，每次调用均创建新订单并额外锁定库存。
//
// 业务场景：电商平台 webhook 因网络抖动重推同一笔订单时，系统会产生重复订单，
//           导致库存被双倍甚至多倍预占。
//
// 期望行为：
//   - 方案 A：返回已有订单（幂等），不重复预占
//   - 方案 B：返回 409 Conflict，提示重复订单
//
// 实际行为：返回 200 并创建另一笔订单（orders 数量 +1，库存再次被预占）
// ─────────────────────────────────────────────────────────────────────────────

test.describe('[BUG-03] 订单同步幂等性', () => {

  test('[已知缺陷] 相同 channel+SKU 重复 sync 应返回 409，当前会创建重复订单', async ({ request }) => {
    const token = await adminToken(request);
    const payload = { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1 };

    // First sync — must succeed
    const first = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: payload,
    });
    expect(first.status()).toBe(200);
    const firstOrderId: number = (await first.json()).data.order.id;

    // Second sync with identical params — should be idempotent
    const second = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: payload,
    });

    // WILL FAIL: second call returns 200 and creates a NEW order
    expect(second.status()).toBe(409);
    // ↑ actual: 200, new order created with a different id

    // Extra assertion: verify only ONE order exists for this payload
    // (in practice, two orders are created — confirming the duplicate)
    const listResp = await request.get('/api/v1/orders?status=reserved', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const orders: any[] = (await listResp.json()).data.items;
    const matching = orders.filter(
      (o: any) => o.channel_name === 'taobao' && o.external_sku_id === 'SKU-HB001'
    );
    // WILL FAIL: there are at least 2 matching reserved orders
    expect(matching.length).toBe(1);
  });

  test('非同渠道/SKU 的独立订单正常创建', async ({ request }) => {
    const token = await adminToken(request);

    // taobao/SKU-HB001 and taobao/SKU-HB002 are different — both should succeed
    const a = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1 },
    });
    const b = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB002', quantity: 1 },
    });

    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    const idA = (await a.json()).data.order.id;
    const idB = (await b.json()).data.order.id;
    expect(idA).not.toBe(idB);
  });
});
