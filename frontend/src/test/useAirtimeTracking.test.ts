import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAirtimeTracking } from '../hooks/useAirtimeTracking';
import type { Message, TelemetryResponse } from '../types';

function createTelemetry(overrides: Partial<TelemetryResponse> = {}): TelemetryResponse {
  return {
    pubkey_prefix: 'AABB',
    battery_volts: 3.7,
    tx_queue_len: 0,
    noise_floor_dbm: -120,
    last_rssi_dbm: -80,
    last_snr_db: 10,
    packets_received: 100,
    packets_sent: 50,
    airtime_seconds: 10,
    rx_airtime_seconds: 5,
    uptime_seconds: 3600,
    sent_flood: 30,
    sent_direct: 20,
    recv_flood: 60,
    recv_direct: 40,
    flood_dups: 5,
    direct_dups: 2,
    full_events: 0,
    clock_output: null,
    neighbors: [],
    acl: [],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mockRequestTelemetry = vi.fn<(...args: unknown[]) => Promise<TelemetryResponse>>();

vi.mock('../api', () => ({
  api: {
    requestTelemetry: (...args: unknown[]) => mockRequestTelemetry(...args),
  },
}));

describe('useAirtimeTracking stale poll guard', () => {
  beforeEach(() => {
    mockRequestTelemetry.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards poll response when tracking was stopped during in-flight request', async () => {
    const setMessages = vi.fn<React.Dispatch<React.SetStateAction<Message[]>>>();

    // Initial telemetry for dutycycle_start succeeds immediately
    mockRequestTelemetry.mockResolvedValueOnce(createTelemetry());

    const { result } = renderHook(() => useAirtimeTracking(setMessages));

    // Start tracking
    await act(async () => {
      await result.current.handleAirtimeCommand('dutycycle_start', 'repeater_a');
    });

    // setMessages was called with the start message
    const startCallCount = setMessages.mock.calls.length;
    expect(startCallCount).toBeGreaterThanOrEqual(1);

    // Set up a deferred telemetry response for the poll
    const deferred = createDeferred<TelemetryResponse>();
    mockRequestTelemetry.mockReturnValueOnce(deferred.promise);

    // Advance timer to trigger the 5-minute poll
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    // Poll is now in-flight. Stop tracking (simulates conversation switch).
    act(() => {
      result.current.stopTracking();
    });

    // Resolve the stale telemetry response
    await act(async () => {
      deferred.resolve(createTelemetry({ uptime_seconds: 7200 }));
    });

    // setMessages should NOT have been called with the stale poll result
    // Only the start message calls should exist
    expect(setMessages.mock.calls.length).toBe(startCallCount);
  });

  it('appends poll result when tracking is still active', async () => {
    const setMessages = vi.fn<React.Dispatch<React.SetStateAction<Message[]>>>();

    // Initial telemetry for dutycycle_start
    mockRequestTelemetry.mockResolvedValueOnce(createTelemetry());

    const { result } = renderHook(() => useAirtimeTracking(setMessages));

    await act(async () => {
      await result.current.handleAirtimeCommand('dutycycle_start', 'repeater_a');
    });

    const startCallCount = setMessages.mock.calls.length;

    // Set up poll response
    mockRequestTelemetry.mockResolvedValueOnce(createTelemetry({ uptime_seconds: 7200 }));

    // Advance timer to trigger the 5-minute poll
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    // setMessages SHOULD have been called with the poll result
    expect(setMessages.mock.calls.length).toBeGreaterThan(startCallCount);
  });
});
