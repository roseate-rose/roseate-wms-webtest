import { test, expect } from '@playwright/test';
import { ADMIN, STAFF } from '../../fixtures/test-data';

async function getToken(request: any, username: string, password: string): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', { data: { username, password } });
  return (await resp.json()).data.token as string;
}

test.describe('报表导出 /api/v1/reports/export', () => {

  test('admin 可下载 CSV 报表，Content-Disposition 包含文件名', async ({ request }) => {
    const token = await getToken(request, ADMIN.username, ADMIN.password);

    const resp = await request.get('/api/v1/reports/export?format=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(200);
    const contentType = resp.headers()['content-type'];
    expect(contentType).toContain('text/csv');

    const disposition = resp.headers()['content-disposition'];
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/filename=/);

    // Response body should be non-empty CSV text
    const body = await resp.text();
    expect(body.length).toBeGreaterThan(0);
    // CSV must have a header row
    expect(body).toContain('\n');
  });

  test('admin 可下载 xlsx 报表', async ({ request }) => {
    const token = await getToken(request, ADMIN.username, ADMIN.password);

    const resp = await request.get('/api/v1/reports/export?format=xlsx', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(200);
    const contentType = resp.headers()['content-type'];
    expect(contentType).toContain('spreadsheetml');

    const disposition = resp.headers()['content-disposition'];
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/\.xlsx/);
  });

  test('staff 访问报表接口返回 403', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.get('/api/v1/reports/export?format=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(403);
  });

  test('未登录访问报表接口返回 401', async ({ request }) => {
    const resp = await request.get('/api/v1/reports/export?format=csv');
    // No Authorization header — should be rejected
    expect([401, 403]).toContain(resp.status());
  });

  test('非法 format 参数返回 400', async ({ request }) => {
    const token = await getToken(request, ADMIN.username, ADMIN.password);

    const resp = await request.get('/api/v1/reports/export?format=json', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/format must be one of/);
  });
});

test.describe('账本导出 /api/v1/reports/ledger-export', () => {

  test('admin 可下载 ledger CSV（product 维度）', async ({ request }) => {
    const token = await getToken(request, ADMIN.username, ADMIN.password);

    const resp = await request.get('/api/v1/reports/ledger-export?format=csv&balance_scope=product', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('text/csv');
    expect(resp.headers()['content-disposition']).toMatch(/ledger\.csv/);
  });

  test('非法 balance_scope 返回 400', async ({ request }) => {
    const token = await getToken(request, ADMIN.username, ADMIN.password);

    const resp = await request.get('/api/v1/reports/ledger-export?format=csv&balance_scope=sku', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(400);
    expect((await resp.json()).msg).toMatch(/balance_scope must be one of/);
  });

  test('staff 访问 ledger 导出返回 403', async ({ request }) => {
    const token = await getToken(request, STAFF.username, STAFF.password);

    const resp = await request.get('/api/v1/reports/ledger-export?format=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.status()).toBe(403);
  });
});
