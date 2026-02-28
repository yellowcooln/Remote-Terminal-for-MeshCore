import { test, expect } from '@playwright/test';

test.describe('Node Map page', () => {
  test('node map page loads', async ({ page }) => {
    await page.goto('/#map');

    // Verify heading (also appears in sidebar, so scope to main)
    await expect(page.getByRole('main').getByText('Node Map')).toBeVisible({ timeout: 10_000 });

    // Verify legend elements
    await expect(page.getByText('<1h')).toBeVisible();
    await expect(page.getByText('<1d')).toBeVisible();
  });
});
