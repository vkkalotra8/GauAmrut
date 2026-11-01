const { test, expect } = require('@playwright/test');

test('admin signs in to the permission-scoped console', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Email address').fill('admin-e2e@example.com');
  await page.getByLabel('Password', { exact: true }).fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'admin-e2e@example.com', exact: true })).toBeVisible();

  // Full account details open in a modal.
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Account details/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('admin-e2e@example.com');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: /Account details/ })).toBeHidden();

  await page.getByRole('link', { name: 'Dairies', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dairy directory' })).toBeVisible();

  // Publish a platform-wide announcement and watch it go live instantly.
  const announcement = 'E2E check: platform settings are live for everyone.';
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Announcements & support' })).toBeVisible();
  await page.getByLabel('Show the announcement banner to everyone').check();
  await page.getByLabel('Announcement message').fill(announcement);
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await expect(page.getByText(/Saved\. Every signed-in user sees this change right away\./)).toBeVisible();
  await expect(page.locator('.announcement-banner > span')).toHaveText(announcement);

  // The activity log reads like a human story: who did it, what changed.
  await page.getByRole('link', { name: 'Activity log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /updated the announcements & support settings/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /E2E Admin/ })).toBeVisible();

  // Sign out and back in: the announcement is stored server-side, so a fresh
  // session of any user still sees it. (Login returns the admin to the page
  // they signed out from.)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.getByLabel('Email address').fill('admin-e2e@example.com');
  await page.getByLabel('Password', { exact: true }).fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await expect(page.locator('.announcement-banner > span')).toHaveText(announcement);

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
});
