import { Page, request as playwrightRequest } from '@playwright/test';
import { ADMIN, STAFF } from '../fixtures/test-data';

type Role = 'admin' | 'staff';

const CREDS: Record<Role, { username: string; password: string }> = {
  admin: ADMIN,
  staff: STAFF,
};

/**
 * Navigate to /login and submit credentials, then wait for redirect to /.
 */
export async function loginAs(page: Page, role: Role): Promise<void> {
  const { username, password } = CREDS[role];
  await page.goto('/login');
  await page.locator('label').filter({ hasText: '用户名' }).locator('input').fill(username);
  await page.locator('label').filter({ hasText: '密码' }).locator('input').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/');
}

/**
 * Obtain a JWT token directly via the API (no browser involved).
 * Useful for setting up auth state before UI interaction.
 */
export async function getToken(baseURL: string, role: Role): Promise<string> {
  const { username, password } = CREDS[role];
  const ctx = await playwrightRequest.newContext({ baseURL });
  const resp = await ctx.post('/api/v1/auth/login', {
    data: { username, password },
  });
  const body = await resp.json();
  await ctx.dispose();
  return body.data.token as string;
}

/**
 * Inject a JWT token directly into localStorage so the Vue app considers the
 * user logged in without going through the login page.
 */
export async function injectToken(page: Page, baseURL: string, role: Role): Promise<void> {
  const token = await getToken(baseURL, role);
  // Navigate to a minimal page first so localStorage is accessible
  await page.goto('/login');
  await page.evaluate(
    ({ token, role }) => {
      localStorage.setItem('roseate_wms_token', token);
      // The app also persists the user object; provide the minimum needed
      localStorage.setItem(
        'roseate_wms_user',
        JSON.stringify({ username: role === 'admin' ? 'admin' : 'staff', role }),
      );
    },
    { token, role },
  );
}
