import { test, expect } from '@playwright/test';
import {
  createFanoutConfig,
  deleteFanoutConfig,
  getFanoutConfigs,
} from '../helpers/api';

test.describe('Apprise integration settings', () => {
  let createdAppriseId: string | null = null;

  test.afterEach(async () => {
    if (createdAppriseId) {
      try {
        await deleteFanoutConfig(createdAppriseId);
      } catch {
        console.warn('Failed to delete test apprise config');
      }
      createdAppriseId = null;
    }
  });

  test('create apprise via UI, configure URLs, save as enabled', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Connected')).toBeVisible();

    // Open settings and navigate to MQTT & Forwarding
    await page.getByText('Settings').click();
    await page.getByRole('button', { name: /MQTT.*Forwarding/ }).click();

    // Click the Apprise add button
    await page.getByRole('button', { name: 'Apprise' }).click();

    // Should navigate to the detail/edit view with default name
    await expect(page.getByDisplayValue('Apprise')).toBeVisible();

    // Fill in notification URL
    const urlsTextarea = page.locator('#fanout-apprise-urls');
    await urlsTextarea.fill('json://localhost:9999');

    // Verify preserve identity checkbox is checked by default
    const preserveIdentity = page.getByText('Preserve identity on Discord');
    await expect(preserveIdentity).toBeVisible();

    // Verify include routing path checkbox is checked by default
    const includePath = page.getByText('Include routing path in notifications');
    await expect(includePath).toBeVisible();

    // Rename it
    const nameInput = page.locator('#fanout-edit-name');
    await nameInput.clear();
    await nameInput.fill('E2E Apprise');

    // Save as enabled
    await page.getByRole('button', { name: /Save as Enabled/i }).click();
    await expect(page.getByText('Integration saved and enabled')).toBeVisible();

    // Should be back on list view with our apprise config visible
    await expect(page.getByText('E2E Apprise')).toBeVisible();

    // Clean up via API
    const configs = await getFanoutConfigs();
    const apprise = configs.find((c) => c.name === 'E2E Apprise');
    if (apprise) {
      createdAppriseId = apprise.id;
    }
  });

  test('create apprise via API, verify options persist after edit', async ({ page }) => {
    const apprise = await createFanoutConfig({
      type: 'apprise',
      name: 'API Apprise',
      config: {
        urls: 'json://localhost:9999\nslack://token_a/token_b/token_c',
        preserve_identity: false,
        include_path: false,
      },
      enabled: true,
    });
    createdAppriseId = apprise.id;

    await page.goto('/');
    await expect(page.getByText('Connected')).toBeVisible();

    await page.getByText('Settings').click();
    await page.getByRole('button', { name: /MQTT.*Forwarding/ }).click();

    // Click Edit on our apprise config
    const row = page.getByText('API Apprise').locator('..');
    await row.getByRole('button', { name: 'Edit' }).click();

    // Verify the URLs textarea has our content
    const urlsTextarea = page.locator('#fanout-apprise-urls');
    await expect(urlsTextarea).toHaveValue(/json:\/\/localhost:9999/);
    await expect(urlsTextarea).toHaveValue(/slack:\/\/token_a/);

    // Verify checkboxes reflect our config (both unchecked)
    const preserveCheckbox = page
      .getByText('Preserve identity on Discord')
      .locator('xpath=ancestor::label[1]')
      .locator('input[type="checkbox"]');
    await expect(preserveCheckbox).not.toBeChecked();

    const pathCheckbox = page
      .getByText('Include routing path in notifications')
      .locator('xpath=ancestor::label[1]')
      .locator('input[type="checkbox"]');
    await expect(pathCheckbox).not.toBeChecked();

    // Go back
    await page.getByText('← Back to list').click();
  });

  test('apprise shows scope selector', async ({ page }) => {
    const apprise = await createFanoutConfig({
      type: 'apprise',
      name: 'Scope Apprise',
      config: { urls: 'json://localhost:9999' },
    });
    createdAppriseId = apprise.id;

    await page.goto('/');
    await expect(page.getByText('Connected')).toBeVisible();

    await page.getByText('Settings').click();
    await page.getByRole('button', { name: /MQTT.*Forwarding/ }).click();

    const row = page.getByText('Scope Apprise').locator('..');
    await row.getByRole('button', { name: 'Edit' }).click();

    // Verify scope selector is present
    await expect(page.getByText('Message Scope')).toBeVisible();
    await expect(page.getByText('All messages')).toBeVisible();

    // Select "All except listed" mode
    await page.getByText('All except listed channels/contacts').click();

    // Should show channel and contact lists with exclude label
    await expect(page.getByText('(exclude)')).toBeVisible();

    // Go back
    await page.getByText('← Back to list').click();
  });

  test('apprise disabled config shows amber dot and can be enabled via save button', async ({
    page,
  }) => {
    const apprise = await createFanoutConfig({
      type: 'apprise',
      name: 'Disabled Apprise',
      config: { urls: 'json://localhost:9999' },
      enabled: false,
    });
    createdAppriseId = apprise.id;

    await page.goto('/');
    await expect(page.getByText('Connected')).toBeVisible();

    await page.getByText('Settings').click();
    await page.getByRole('button', { name: /MQTT.*Forwarding/ }).click();

    // Should show "Disabled" text
    const row = page.getByText('Disabled Apprise').locator('..');
    await expect(row.getByText('Disabled')).toBeVisible();

    // Edit it
    await row.getByRole('button', { name: 'Edit' }).click();

    // Save as enabled
    await page.getByRole('button', { name: /Save as Enabled/i }).click();
    await expect(page.getByText('Integration saved and enabled')).toBeVisible();

    // Verify it's now enabled via API
    const configs = await getFanoutConfigs();
    const updated = configs.find((c) => c.id === apprise.id);
    expect(updated?.enabled).toBe(true);
  });

  test('delete apprise via UI', async ({ page }) => {
    const apprise = await createFanoutConfig({
      type: 'apprise',
      name: 'Delete Me Apprise',
      config: { urls: 'json://localhost:9999' },
    });
    createdAppriseId = apprise.id;

    await page.goto('/');
    await expect(page.getByText('Connected')).toBeVisible();

    await page.getByText('Settings').click();
    await page.getByRole('button', { name: /MQTT.*Forwarding/ }).click();

    const row = page.getByText('Delete Me Apprise').locator('..');
    await row.getByRole('button', { name: 'Edit' }).click();

    // Accept the confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Integration deleted')).toBeVisible();

    // Should be back on list, apprise gone
    await expect(page.getByText('Delete Me Apprise')).not.toBeVisible();
    createdAppriseId = null;
  });
});
