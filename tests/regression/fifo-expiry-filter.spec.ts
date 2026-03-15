import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

// ─────────────────────────────────────────────────────────────────────────────
// BUG-NEW-01: reserve_product_inventory() 未过滤过期批次
//
// 业务背景：
//   FIFO 按 expiry_date ASC 排序，过期批次排在最前面。
//   当前代码没有跳过过期批次（expiry_date <= today）的逻辑，
//   导致订单预占的是已过期的库存，客户会收到过期商品。
//
// 种子数据（HB001）：
//   BN-2024-01  expiry=2024-06-01  qty=50  ← 已过期约 21 个月
//   BN-2026-01  expiry=2026-03-30  qty=100 ← 临期但未过期
//
// 期望行为：订单分配应跳过过期批次，只从未过期批次分配
// 实际行为：FIFO 优先命中 BN-2024-01（最早到期 = 已过期）
// ─────────────────────────────────────────────────────────────────────────────

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

test.describe('[BUG-NEW-01] FIFO 应跳过过期批次', () => {

  test('[已知缺陷] 订单预占不应分配到过期批次', async ({ request }) => {
    const token = await adminToken(request);
    const today = new Date().toISOString().split('T')[0];

    // HB001 有两个批次：BN-2024-01（已过期）和 BN-2026-01（临期）
    // 创建一笔小量订单，检查分配来源
    const syncResp = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        channel_name: 'taobao',
        external_sku_id: 'SKU-HB001',
        quantity: 1,
        external_order_no: `BUG-NW01-${Date.now()}`,
      },
    });
    expect(syncResp.status()).toBe(200);
    const body = await syncResp.json();
    const allocations: any[] = body.data.allocations;

    // 验证每一条分配都来自未过期批次（expiry_date > today）
    for (const alloc of allocations) {
      const expiryDate: string = alloc.expiry_date;
      // WILL FAIL: BN-2024-01 expiry=2024-06-01 < today → 过期批次被分配
      expect(expiryDate).toBeGreaterThan(today);
      // ↑ actual: expiryDate="2024-06-01" which is < today
    }
  });

  test('[已知缺陷] 过期批次的库存不计入可售库存（sellable_stock）', async ({ request }) => {
    const token = await adminToken(request);

    // 获取 HB001 当前库存
    const productResp = await request.get('/api/v1/products/HB001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(productResp.status()).toBe(200);
    const product = (await productResp.json()).data.product;

    // 统计未过期批次的可用数量
    const today = new Date().toISOString().split('T')[0];
    const batches: any[] = product.batches || [];
    const nonExpiredSellable = batches
      .filter((b: any) => b.expiry_date > today)
      .reduce((sum: number, b: any) => sum + Math.max(b.current_quantity - b.reserved_quantity, 0), 0);

    // sellable_stock 应等于未过期批次的可用量
    // WILL FAIL: sellable_stock includes expired batch BN-2024-01's available qty
    expect(product.sellable_stock).toBe(nonExpiredSellable);
    // ↑ actual: sellable_stock includes ~45 units from expired BN-2024-01
  });

  test('过期批次可通过 expiry-report 确认存在（基准）', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.get('/api/v1/inventory/expiry-report?status=expired', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.status()).toBe(200);
    const items: any[] = (await resp.json()).data.items;

    // 确认过期批次确实存在于数据库中
    const expiredBatch = items.find((i: any) => i.batch_no === 'BN-2024-01');
    expect(expiredBatch).toBeDefined();
    expect(expiredBatch.current_quantity).toBeGreaterThan(0);
    // 这一条 PASSES — 证明过期库存真实存在，FIFO 会命中它
  });

});
