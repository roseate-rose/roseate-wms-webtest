import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

test.describe('[入库边界] 入库接口输入校验与批次合并行为', () => {

  // ── 输入校验 ───────────────────────────────────────────────────────────────

  test('缺少 batch_no 时返回 400', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB001', expiry_date: '2030-01-01', quantity: 10, cost: 5.0 },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/batch_no is required/);
  });

  test('缺少 expiry_date 时返回 400', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: { hb_code: 'HB001', batch_no: 'TEST-NO-EXPIRY', quantity: 10, cost: 5.0 },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/expiry_date/);
  });

  test('quantity=0 时返回 400', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB001', batch_no: 'TEST-ZERO-QTY',
        expiry_date: '2030-01-01', quantity: 0, cost: 5.0,
      },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/quantity must be greater than 0/);
  });

  test('quantity 为负数时返回 400', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB001', batch_no: 'TEST-NEG-QTY',
        expiry_date: '2030-01-01', quantity: -5, cost: 5.0,
      },
    });
    expect(resp.status()).toBe(400);
  });

  test('cost 为负数时返回 400', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB001', batch_no: 'TEST-NEG-COST',
        expiry_date: '2030-01-01', quantity: 10, cost: -1.0,
      },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/cost must be greater than or equal to 0/);
  });

  test('未建档商品入库返回 404', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB-GHOST', batch_no: 'TEST-GHOST',
        expiry_date: '2030-01-01', quantity: 10, cost: 5.0,
      },
    });
    expect(resp.status()).toBe(404);
  });

  test('expiry_date 格式非 ISO 时返回 400', async ({ request }) => {
    const token = await adminToken(request);

    const resp = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB001', batch_no: 'TEST-BAD-DATE',
        expiry_date: '31/12/2030', quantity: 10, cost: 5.0,
      },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/YYYY-MM-DD/);
  });

  // ── [已知缺陷] 批次合并成本覆盖 ───────────────────────────────────────────
  //
  // 预期行为：同批次（相同 hb_code + expiry_date）二次入库时，
  //   成本应更新为加权平均：(旧qty × 旧cost + 新qty × 新cost) / (旧qty + 新qty)
  //
  // 实际行为：backend/app.py line 295 — `batch.cost = cost`
  //   直接覆盖，导致历史成本丢失。
  //
  // 以下测试断言"正确行为"，当前代码会导致测试失败，暴露该缺陷。

  test('[已知缺陷] 批次合并时成本被覆盖而非加权平均', async ({ request }) => {
    const token = await adminToken(request);

    // Read current HB002 state before the second inbound
    const beforeResp = await request.get('/api/v1/products/HB002', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const before = (await beforeResp.json()).data.product;
    const batchBefore = before.batches.find((b: any) => b.expiry_date === '2027-01-01');
    expect(batchBefore).toBeDefined();
    const origQty  = batchBefore.current_quantity as number;
    const origCost = batchBefore.cost as number;

    // Second inbound — same expiry_date triggers the merge path
    const mergeQty  = 10;
    const mergeCost = 99.0;
    const secondInbound = await request.post('/api/v1/inventory/inbound', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        hb_code: 'HB002',
        batch_no: 'BN-2027-01-MERGE',
        expiry_date: '2027-01-01',
        quantity: mergeQty,
        cost: mergeCost,
      },
    });
    expect(secondInbound.status()).toBe(200);
    expect((await secondInbound.json()).data.action).toBe('merged');

    // Fetch updated batch
    const afterResp = await request.get('/api/v1/products/HB002', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const batchAfter = (await afterResp.json()).data.product.batches
      .find((b: any) => b.expiry_date === '2027-01-01');
    expect(batchAfter).toBeDefined();

    // Quantity must always be accumulated regardless of the bug
    expect(batchAfter.current_quantity).toBe(origQty + mergeQty);

    // BUG: cost is overwritten to the newest value instead of weighted average.
    // Expected: (origQty × origCost + mergeQty × mergeCost) / (origQty + mergeQty)
    // Actual:   mergeCost (= 99.0), overwriting origCost
    //
    // This assertion reflects CORRECT business logic — it will FAIL against current code.
    const expectedWeightedAvg = (origQty * origCost + mergeQty * mergeCost) / (origQty + mergeQty);
    expect(batchAfter.cost).toBeCloseTo(expectedWeightedAvg, 1);
    // ↑ WILL FAIL: actual cost is 99.0, not the weighted average
  });
});
