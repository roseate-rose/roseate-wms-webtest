import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

// Helper: login and return JWT token
async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

// State assumptions when regression/ runs (after inventory/, orders/, products/ have finished):
//   HB001: BN-2024-01 (avail≥44), BN-2026-01 (avail=100), TEST-PURCHASE-LOT (avail=12)
//   HB002: BN-2027-01 (sellable≈197 — 3 reserved by orders/fulfill test)
//   HB003: BN-2026-04 (avail=80), TEST-LOT-001 (avail=20) → sellable≥100

test.describe('[FIFO 边界] 库存预占与分配规则', () => {

  test('FIFO 优先消耗最早到期批次，跨批次时分配量之和等于请求量', async ({ request }) => {
    const token = await adminToken(request);

    // Fetch HB001 batch details to determine available quantities
    const productResp = await request.get('/api/v1/products/HB001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(productResp.status()).toBe(200);
    const product = (await productResp.json()).data.product;

    const availableBatches = product.batches
      .filter((b: any) => b.available_quantity > 0)
      .sort((a: any, b: any) => a.expiry_date.localeCompare(b.expiry_date));

    // Need at least 2 batches with stock to test spanning
    expect(availableBatches.length).toBeGreaterThanOrEqual(2);

    const firstBatch = availableBatches[0];
    // Reserve more than the first batch holds — forces allocation into the second batch
    const reserveQty = firstBatch.available_quantity + 1;

    const resp = await request.post('/api/v1/inventory/reserve', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB001', quantity: reserveQty },
    });
    expect(resp.status()).toBe(200);

    const data = (await resp.json()).data;

    // Allocation must span at least 2 batches
    expect(data.allocations.length).toBeGreaterThanOrEqual(2);

    // First allocation must come from the earliest-expiry batch
    expect(data.allocations[0].batch_no).toBe(firstBatch.batch_no);
    expect(data.allocations[0].reserved_quantity).toBe(firstBatch.available_quantity);

    // Allocations must be sorted oldest-expiry-first (FIFO guarantee)
    const expiries = data.allocations.map((a: any) => a.expiry_date);
    for (let i = 1; i < expiries.length; i++) {
      expect(expiries[i] >= expiries[i - 1]).toBe(true);
    }

    // Total allocated == requested
    const totalAllocated = data.allocations.reduce(
      (sum: number, a: any) => sum + a.reserved_quantity, 0
    );
    expect(totalAllocated).toBe(reserveQty);
  });

  test('超出可售库存时 API 返回 409 "insufficient sellable stock"', async ({ request }) => {
    const token = await adminToken(request);

    // Dynamically get current HB003 sellable to avoid hardcoding
    const productResp = await request.get('/api/v1/products/HB003', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sellable: number = (await productResp.json()).data.product.sellable_stock;
    expect(sellable).toBeGreaterThan(0);

    const resp = await request.post('/api/v1/inventory/reserve', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB003', quantity: sellable + 1 },
    });

    expect(resp.status()).toBe(409);
    expect((await resp.json()).msg).toMatch(/insufficient sellable stock/);
  });

  test('精确耗尽可售库存后再预占 1 个返回 409', async ({ request }) => {
    const token = await adminToken(request);

    // Read current HB002 sellable stock
    const productResp = await request.get('/api/v1/products/HB002', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sellable: number = (await productResp.json()).data.product.sellable_stock;
    expect(sellable).toBeGreaterThan(0);

    // Reserve exactly all sellable stock
    const reserveAll = await request.post('/api/v1/inventory/reserve', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB002', quantity: sellable },
    });
    expect(reserveAll.status()).toBe(200);

    // Any further reservation — even 1 unit — must fail
    const reserveOne = await request.post('/api/v1/inventory/reserve', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB002', quantity: 1 },
    });
    expect(reserveOne.status()).toBe(409);
  });

  test('重复发货同一订单返回 409 "not in reserved status"', async ({ request }) => {
    const token = await adminToken(request);

    // Create a fresh order
    const syncResp = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', quantity: 1 },
    });
    expect(syncResp.status()).toBe(200);
    const orderId: number = (await syncResp.json()).data.order.id;

    // First fulfill — must succeed
    const first = await request.post('/api/v1/orders/fulfill', {
      headers: { Authorization: `Bearer ${token}` },
      data: { order_id: orderId },
    });
    expect(first.status()).toBe(200);

    // Second fulfill on same order — must be rejected
    const second = await request.post('/api/v1/orders/fulfill', {
      headers: { Authorization: `Bearer ${token}` },
      data: { order_id: orderId },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).msg).toMatch(/not in reserved status/);
  });

  test('不存在的订单 ID 发货返回 404', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/orders/fulfill', {
      headers: { Authorization: `Bearer ${token}` },
      data: { order_id: 999999 },
    });
    expect(resp.status()).toBe(404);
  });

  test('未建档商品预占库存返回 404', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/reserve', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB-NONEXISTENT', quantity: 1 },
    });
    expect(resp.status()).toBe(404);
  });

  test('未知渠道/SKU 同步订单返回 409 "channel mapping not found"', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/orders/sync', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_name: 'wechat', external_sku_id: 'SKU-GHOST', quantity: 1 },
    });
    expect(resp.status()).toBe(409);
    expect((await resp.json()).msg).toMatch(/channel mapping not found/);
  });
});
