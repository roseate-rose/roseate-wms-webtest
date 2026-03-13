import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/test-data';

// Compute boundary dates at runtime so the test is date-agnostic
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const TODAY       = dateOffset(0);   // expiry_date == today → "expired" (BUG-02 fixed: <= today)
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

  // ── 今天到期（BUG-02 已修复）──────────────────────────────────────────────
  //
  // 业务语义：到期日 = 今天 → 商品今天到期，应标记为 expired。
  //
  // 修复（commit 28e49eb）：将 `expiry_date < today` 改为 `expiry_date <= today`。
  // 以下测试验证修复后的正确行为。

  test('到期日 = 今天 → expired（BUG-02 修复验证）', async ({ request }) => {
    const token = await adminToken(request);

    // Today's batch must appear in "expired" filter
    const expiredResp = await request.get('/api/v1/inventory/expiry-report?status=expired', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const expiredItems: any[] = (await expiredResp.json()).data.items;
    const batchInExpired = expiredItems.find((i: any) => i.batch_no === 'BN-BD-TODAY');
    expect(batchInExpired).toBeDefined();
    expect(batchInExpired.status).toBe('expired');

    // Must NOT appear in "warning" filter
    const warningResp = await request.get('/api/v1/inventory/expiry-report?status=warning', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const warningItems: any[] = (await warningResp.json()).data.items;
    const batchInWarning = warningItems.find((i: any) => i.batch_no === 'BN-BD-TODAY');
    expect(batchInWarning).toBeUndefined();
  });
});
