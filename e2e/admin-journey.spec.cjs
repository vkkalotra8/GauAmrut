const { test, expect } = require('@playwright/test');
test('admin signs in to the permission-scoped console', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Email address').fill('admin-e2e@example.com');
  await page.getByLabel('Password', { exact: true }).fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'admin-e2e@example.com', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Dairies', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dairy directory' })).toBeVisible();
  await page.getByRole('link', { name: 'Activity log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
});
