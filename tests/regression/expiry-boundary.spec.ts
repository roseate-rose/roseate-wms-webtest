import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

// Compute boundary dates at runtime so the test is date-agnostic
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const TODAY       = dateOffset(0);   // should be classified as "warning" (NOT "expired")
const TODAY_P30   = dateOffset(30);  // expiry_date <= today+30 → "warning" (inclusive bound)
const TODAY_P31   = dateOffset(31);  // expiry_date > today+30 → "healthy"
const TODAY_M1    = dateOffset(-1);  // expiry_date < today → "expired" (baseline check)

async function adminToken(request: any): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  return (await resp.json()).data.token as string;
}

// Create a dedicated boundary-test product so these batches don't pollute
// dashboard/stock counts that earlier inventory/ tests already verified.
async function ensureBoundaryProduct(request: any, token: string): Promise<void> {
  await request.post('/api/v1/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      hb_code: 'HBBD', name: '边界测试商品', spec: '1ml/支',
      unit: '支', base_unit: '支', purchase_unit: '支', conversion_rate: 1,
    },
  });
  // Ignore 409 if already exists from a previous run
}

async function inbound(request: any, token: string, batchNo: string, expiryDate: string) {
  const resp = await request.post('/api/v1/inventory/inbound', {
    headers: { Authorization: `Bearer ${token}` },
    data: { hb_code: 'HBBD', batch_no: batchNo, expiry_date: expiryDate, quantity: 5, cost: 1.0 },
  });
  return resp;
}

test.describe('[到期日边界] classify_expiry_status 分类逻辑', () => {

  test.beforeAll(async ({ request }) => {
    const token = await adminToken(request);
    await ensureBoundaryProduct(request, token);

    // Seed four boundary batches
    await inbound(request, token, 'BN-BD-TODAY',    TODAY);
    await inbound(request, token, 'BN-BD-P30',      TODAY_P30);
    await inbound(request, token, 'BN-BD-P31',      TODAY_P31);
    await inbound(request, token, 'BN-BD-M1',       TODAY_M1);
  });

  // ── 基准验证 ───────────────────────────────────────────────────────────────

  test('到期日 < 今天 → expired（基准）', async ({ request }) => {
    const token = await adminToken(request);
    const resp = await request.get('/api/v1/inventory/expiry-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const items: any[] = (await resp.json()).data.items;
    const batch = items.find((i: any) => i.batch_no === 'BN-BD-M1');
    expect(batch).toBeDefined();
    expect(batch.status).toBe('expired');
  });

  test('到期日 = today+30 → warning（包含边界）', async ({ request }) => {
    const token = await adminToken(request);
    const resp = await request.get('/api/v1/inventory/expiry-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const items: any[] = (await resp.json()).data.items;
    const batch = items.find((i: any) => i.batch_no === 'BN-BD-P30');
    expect(batch).toBeDefined();
    expect(batch.status).toBe('warning');
  });

  test('到期日 = today+31 → healthy（刚超出警告窗口）', async ({ request }) => {
    const token = await adminToken(request);
    const resp = await request.get('/api/v1/inventory/expiry-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const items: any[] = (await resp.json()).data.items;
    const batch = items.find((i: any) => i.batch_no === 'BN-BD-P31');
    expect(batch).toBeDefined();
    expect(batch.status).toBe('healthy');
  });

  // ── [已知缺陷] 今天到期 ────────────────────────────────────────────────────
  //
  // 业务语义：到期日 = 今天 → 商品今天到期，应标记为 expired。
  //
  // 实际代码（backend/services/import_service.py line 13）：
  //   `if expiry_date < today: return "expired"`
  //   使用严格小于，今天到期判定为 warning。
  //
  // 以下测试断言"正确业务行为"，当前代码会导致失败，暴露该边界缺陷。

  test('[已知缺陷] 到期日 = 今天 → 应为 expired，当前错误返回 warning', async ({ request }) => {
    const token = await adminToken(request);

    // Verify via expiry-report API: today's batch should appear in "expired" filter
    const expiredResp = await request.get('/api/v1/inventory/expiry-report?status=expired', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const expiredItems: any[] = (await expiredResp.json()).data.items;
    const batchInExpired = expiredItems.find((i: any) => i.batch_no === 'BN-BD-TODAY');

    // WILL FAIL: today's batch is classified as "warning", so it won't be in the expired list
    expect(batchInExpired).toBeDefined();
    // ↑ WILL FAIL — actual: batch appears under "warning" not "expired"

    // Confirm it incorrectly appears in the "warning" filter (documents current wrong behavior)
    const warningResp = await request.get('/api/v1/inventory/expiry-report?status=warning', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const warningItems: any[] = (await warningResp.json()).data.items;
    const batchInWarning = warningItems.find((i: any) => i.batch_no === 'BN-BD-TODAY');
    // This assertion PASSES — confirming the bug: today's expiry shows as warning
    expect(batchInWarning).toBeDefined();
  });
});
