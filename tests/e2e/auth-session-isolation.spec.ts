import { expect, test } from '@playwright/test';

const roles = ['SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'] as const;
const password = 'nivaas-e2e-test-password';
const authServer = 'http://127.0.0.1:43119';

test('keeps four real role sessions independent through expiry, reload, logout and duplicate-tab detection', async ({ context, page, request }) => {
  test.setTimeout(120_000);
  const tokenExpiry = (token: string) => Number(JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).exp) * 1000;
  const waitForExpiry = async (tokens: string[]) => {
    const remaining = Math.max(...tokens.map(tokenExpiry)) - Date.now() + 100;
    if (remaining > 0) await page.waitForTimeout(remaining);
  };
  const tabs = [page];
  for (let index = 1; index < roles.length; index += 1) tabs.push(await context.newPage());

  await Promise.all(roles.map(async (role, index) => {
    const tab = tabs[index]!;
    await tab.goto('/login');
    await tab.getByLabel('Email').fill(`${role.toLowerCase()}@example.test`);
    await tab.getByLabel('Password').fill(password);
    await tab.getByRole('button', { name: 'Sign in' }).click();
    await expect(tab).toHaveURL(/\/dashboard$/);
    await expect(tab.getByText(`Test ${role}`, { exact: true })).toBeVisible();
  }));

  const getSession = (tab: typeof page) => tab.evaluate(() => JSON.parse(sessionStorage.getItem('nivaas.auth.session') ?? '{}'));
  const sessions = await Promise.all(tabs.map(getSession));
  const sessionIds = sessions.map((session) => session.refreshSessionId as string);
  expect(new Set(sessionIds).size).toBe(4);

  const getProtectedStatus = (tab: typeof page, path: string) => tab.evaluate(async (targetPath) => {
    const session = JSON.parse(sessionStorage.getItem('nivaas.auth.session') ?? '{}');
    return (await fetch(targetPath, { headers: { Authorization: `Bearer ${session.token}` } })).status;
  }, path);
  const getContext = (tab: typeof page) => tab.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('nivaas.auth.session') ?? '{}');
    const response = await fetch('/api/e2e/session-context', { headers: { Authorization: `Bearer ${session.token}` } });
    return { status: response.status, body: await response.json() as { data?: { userId: string; societyId: string; role: string } } };
  });
  for (let index = 0; index < tabs.length; index += 1) {
    const result = await getContext(tabs[index]!);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data?.role).toBe(roles[index]);
    expect(result.body.data?.societyId).toBe('f'.repeat(24));
    expect(await getProtectedStatus(tabs[index]!, `/api/e2e/role-check/${roles[index]}`)).toBe(200);
    expect(await getProtectedStatus(tabs[index]!, '/api/e2e/role-check/COMMITTEE_MEMBER')).toBe(index === 1 ? 200 : 403);
    expect(await getProtectedStatus(tabs[index]!, '/api/e2e/society-check/same-society-resource')).toBe(200);
    expect(await getProtectedStatus(tabs[index]!, '/api/e2e/society-check/other-society-resource')).toBe(403);
  }

  await Promise.all(tabs.map(async (tab, index) => {
    const target = roles[index] === 'RESIDENT' ? { label: 'Notice Board', path: '/notices' } : { label: 'Projects', path: '/projects' };
    const primaryNavigation = tab.getByRole('navigation', { name: 'Primary navigation' });
    await primaryNavigation.getByRole('link', { name: target.label }).click({ timeout: 5000 });
    await expect(tab).toHaveURL(new RegExp(`${target.path}$`));
    await primaryNavigation.getByRole('link', { name: 'Dashboard' }).click();
    await expect(tab).toHaveURL(/\/dashboard$/);
    expect((await getContext(tab)).body.data?.role).toBe(roles[index]);
  }));

  const getRefreshCount = async () => {
    const response = await request.get(`${authServer}/api/e2e/metrics`);
    expect(response.ok()).toBeTruthy();
    return (await response.json() as { data: { refreshAttempts: number } }).data.refreshAttempts;
  };

  // Expire the real access JWT, then let parallel dashboard requests renew it once.
  const managerToken = (await getSession(tabs[0]!)).token as string;
  const beforeConcurrentRenewal = await getRefreshCount();
  await waitForExpiry([managerToken]);
  await tabs[0]!.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(getRefreshCount, { timeout: 10_000 }).toBe(beforeConcurrentRenewal + 1);
  await expect.poll(async () => (await getSession(tabs[0]!)).token).not.toBe(managerToken);
  await expect(tabs[0]!.getByText('Test SOCIETY_MANAGER', { exact: true })).toBeVisible();
  expect((await getContext(tabs[0]!)).body.data?.role).toBe('SOCIETY_MANAGER');

  // Expire all current JWTs and reload four pages at once; each tab renews its own session.
  const tokensBeforeReload = await Promise.all(tabs.map(async (tab) => (await getSession(tab)).token as string));
  const refreshesBeforeReload = await getRefreshCount();
  await waitForExpiry(tokensBeforeReload);
  await Promise.all(tabs.map((tab) => tab.reload()));
  await expect.poll(getRefreshCount).toBe(refreshesBeforeReload + 4);
  for (let index = 0; index < tabs.length; index += 1) {
    await expect.poll(async () => (await getSession(tabs[index]!)).token).not.toBe(tokensBeforeReload[index]);
  }
  for (let index = 0; index < tabs.length; index += 1) {
    await expect(tabs[index]!).toHaveURL(/\/dashboard$/);
    await expect(tabs[index]!.getByText(`Test ${roles[index]}`, { exact: true })).toBeVisible();
    const saved = await getSession(tabs[index]!);
    expect(saved.refreshSessionId).toBe(sessionIds[index]);
    expect(saved.token).not.toBe(tokensBeforeReload[index]);
    expect((await getContext(tabs[index]!)).body.data?.role).toBe(roles[index]);
  }
// Chromium clones opener sessionStorage for window.open. The duplicate must
  // clear its copy while the source remains authenticated.
  const duplicatePromise = context.waitForEvent('page');
  await tabs[0]!.evaluate(() => window.open('/dashboard', '_blank'));
  const duplicate = await duplicatePromise;
  await expect(duplicate).toHaveURL(/\/login$/);
  expect(await duplicate.evaluate(() => sessionStorage.getItem('nivaas.auth.session'))).toBeNull();
  expect((await getSession(tabs[0]!)).refreshSessionId).toBe(sessionIds[0]);
  await expect(tabs[0]!.getByText('Test SOCIETY_MANAGER', { exact: true })).toBeVisible();

  const managerSaved = await getSession(tabs[0]!);
  const beforeLogoutRefreshes = await getRefreshCount();
  await tabs[0]!.getByRole('button', { name: 'Sign out' }).click();
  await expect(tabs[0]!).toHaveURL(/\/login$/);
  expect(await tabs[0]!.evaluate(() => sessionStorage.getItem('nivaas.auth.session'))).toBeNull();

  // Other role sessions remain live and renew independently after inactivity.
  const otherTokens = await Promise.all(tabs.slice(1).map(async (tab) => (await getSession(tab)).token as string));
  await waitForExpiry(otherTokens);
  await Promise.all(tabs.slice(1).map((tab) => tab.reload()));
  await expect.poll(getRefreshCount).toBe(beforeLogoutRefreshes + 3);
  for (let index = 1; index < tabs.length; index += 1) {
    await expect.poll(async () => (await getSession(tabs[index]!)).token).not.toBe(otherTokens[index - 1]);
  }
  for (let index = 1; index < tabs.length; index += 1) {
    await expect(tabs[index]!).toHaveURL(/\/dashboard$/);
    expect((await getContext(tabs[index]!)).body.data?.role).toBe(roles[index]);
  }
// Reinstate the logged-out tab's expired data: the backend rejects its revoked
  // refresh session once, then the client clears only that tab.
  const beforeRevokedAttempt = await getRefreshCount();
  await tabs[0]!.evaluate((value) => sessionStorage.setItem('nivaas.auth.session', JSON.stringify(value)), managerSaved);
  await waitForExpiry([managerSaved.token as string]);
  await tabs[0]!.reload();
  await expect(tabs[0]!).toHaveURL(/\/login$/);
  await expect.poll(getRefreshCount).toBe(beforeRevokedAttempt + 1);

  // A validly shaped but unknown refresh secret is rejected once with no retry loop.
  const invalid = { ...managerSaved, refreshToken: '9'.repeat(43), refreshSessionId: 'invalid-test-session' };
  await tabs[0]!.evaluate((value) => sessionStorage.setItem('nivaas.auth.session', JSON.stringify(value)), invalid);
  const beforeInvalidAttempt = await getRefreshCount();
  await tabs[0]!.reload();
  await expect(tabs[0]!).toHaveURL(/\/login$/);
  await expect.poll(getRefreshCount).toBe(beforeInvalidAttempt + 1);
  expect(await tabs[0]!.evaluate(() => sessionStorage.getItem('nivaas.auth.session'))).toBeNull();
});








