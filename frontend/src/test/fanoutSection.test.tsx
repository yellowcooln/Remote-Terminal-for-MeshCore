import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SettingsFanoutSection } from '../components/settings/SettingsFanoutSection';
import type { HealthStatus, FanoutConfig } from '../types';

// Mock the api module
vi.mock('../api', () => ({
  api: {
    getFanoutConfigs: vi.fn(),
    createFanoutConfig: vi.fn(),
    updateFanoutConfig: vi.fn(),
    deleteFanoutConfig: vi.fn(),
    getChannels: vi.fn(),
    getContacts: vi.fn(),
  },
}));

// Suppress BotCodeEditor lazy load in tests
vi.mock('../components/BotCodeEditor', () => ({
  BotCodeEditor: () => <textarea data-testid="bot-code-editor" />,
}));

import { api } from '../api';

const mockedApi = vi.mocked(api);

const baseHealth: HealthStatus = {
  status: 'connected',
  radio_connected: true,
  connection_info: 'Serial: /dev/ttyUSB0',
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
  bots_disabled: false,
};

const webhookConfig: FanoutConfig = {
  id: 'wh-1',
  type: 'webhook',
  name: 'Test Hook',
  enabled: true,
  config: { url: 'https://example.com/hook', method: 'POST', headers: {} },
  scope: { messages: 'all', raw_packets: 'none' },
  sort_order: 0,
  created_at: 1000,
};

function renderSection(overrides?: { health?: HealthStatus }) {
  return render(
    <SettingsFanoutSection
      health={overrides?.health ?? baseHealth}
      onHealthRefresh={vi.fn(async () => {})}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getFanoutConfigs.mockResolvedValue([]);
  mockedApi.getChannels.mockResolvedValue([]);
  mockedApi.getContacts.mockResolvedValue([]);
});

describe('SettingsFanoutSection', () => {
  it('shows add buttons for all integration types', async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Private MQTT' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Webhook' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Apprise' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Bot' })).toBeInTheDocument();
    });
  });

  it('hides bot add button when bots_disabled', async () => {
    renderSection({ health: { ...baseHealth, bots_disabled: true } });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Bot' })).not.toBeInTheDocument();
    });
  });

  it('shows bots disabled banner when bots_disabled', async () => {
    renderSection({ health: { ...baseHealth, bots_disabled: true } });
    await waitFor(() => {
      expect(screen.getByText(/Bot system is disabled/)).toBeInTheDocument();
    });
  });

  it('lists existing configs after load', async () => {
    mockedApi.getFanoutConfigs.mockResolvedValue([webhookConfig]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Test Hook')).toBeInTheDocument();
    });
  });

  it('navigates to edit view when clicking edit', async () => {
    mockedApi.getFanoutConfigs.mockResolvedValue([webhookConfig]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Test Hook')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit' });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeInTheDocument();
    });
  });

  it('calls toggle enabled on checkbox click', async () => {
    mockedApi.getFanoutConfigs.mockResolvedValue([webhookConfig]);
    mockedApi.updateFanoutConfig.mockResolvedValue({ ...webhookConfig, enabled: false });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Test Hook')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockedApi.updateFanoutConfig).toHaveBeenCalledWith('wh-1', { enabled: false });
    });
  });

  it('navigates to create view when clicking add button', async () => {
    const createdWebhook: FanoutConfig = {
      id: 'wh-new',
      type: 'webhook',
      name: 'Webhook',
      enabled: false,
      config: { url: '', method: 'POST', headers: {} },
      scope: { messages: 'all', raw_packets: 'none' },
      sort_order: 0,
      created_at: 2000,
    };
    mockedApi.createFanoutConfig.mockResolvedValue(createdWebhook);
    // After creation, getFanoutConfigs returns the new config
    mockedApi.getFanoutConfigs.mockResolvedValueOnce([]).mockResolvedValueOnce([createdWebhook]);

    renderSection();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Webhook' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Webhook' }));

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeInTheDocument();
      // Should show the URL input for webhook type
      expect(screen.getByLabelText(/URL/)).toBeInTheDocument();
    });
  });
});
