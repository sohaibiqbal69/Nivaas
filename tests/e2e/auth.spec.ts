import { expect, test } from '@playwright/test';

test('shows the sign-in form with labelled credentials fields', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in to Nivaas' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email');
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('redirects unauthenticated users from meetings to sign-in', async ({ page }) => {
  await page.goto('/meetings');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Nivaas' })).toBeVisible();
});
