/**
 * Integration tests for useWebSocket onmessage dispatch.
 *
 * Verifies that the switch statement in useWebSocket.ts:91-134 routes
 * incoming JSON messages to the correct handler callbacks with the
 * correct data shapes.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWebSocket } from '../useWebSocket';
import fixtures from './fixtures/websocket_events.json';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  send(): void {}
}

const originalWebSocket = globalThis.WebSocket;

/** Send a JSON message through the most recent MockWebSocket instance. */
function fireMessage(data: unknown): void {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  act(() => {
    ws.onmessage?.({ data: JSON.stringify(data) });
  });
}

describe('useWebSocket dispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it('routes health message to onHealth', () => {
    const onHealth = vi.fn();
    renderHook(() => useWebSocket({ onHealth }));

    const healthData = {
      status: 'ok',
      radio_connected: true,
      connection_info: 'TCP: 1.2.3.4:4000',
      database_size_mb: 1.5,
      oldest_undecrypted_timestamp: null,
    };
    fireMessage({ type: 'health', data: healthData });

    expect(onHealth).toHaveBeenCalledOnce();
    expect(onHealth).toHaveBeenCalledWith(healthData);
  });

  it('routes message event to onMessage with correct Message shape', () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ onMessage }));

    const { type, data } = fixtures.channel_message.expected_ws_event;
    fireMessage({ type, data });

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(data);
  });

  it('routes contact event to onContact with correct Contact shape', () => {
    const onContact = vi.fn();
    renderHook(() => useWebSocket({ onContact }));

    const { type, data } = fixtures.advertisement_with_gps.expected_ws_event;
    fireMessage({ type, data });

    expect(onContact).toHaveBeenCalledOnce();
    expect(onContact).toHaveBeenCalledWith(data);
    expect(onContact.mock.calls[0][0]).toHaveProperty('public_key');
    expect(onContact.mock.calls[0][0]).toHaveProperty('name');
  });

  it('routes message_acked to onMessageAcked with (messageId, ackCount, paths)', () => {
    const onMessageAcked = vi.fn();
    renderHook(() => useWebSocket({ onMessageAcked }));

    const { type, data } = fixtures.message_acked.expected_ws_event;
    fireMessage({ type, data });

    expect(onMessageAcked).toHaveBeenCalledOnce();
    expect(onMessageAcked).toHaveBeenCalledWith(42, 1, undefined);
  });

  it('routes message_acked with paths', () => {
    const onMessageAcked = vi.fn();
    renderHook(() => useWebSocket({ onMessageAcked }));

    const paths = [{ path: 'aabb', received_at: 1700000000 }];
    fireMessage({ type: 'message_acked', data: { message_id: 7, ack_count: 2, paths } });

    expect(onMessageAcked).toHaveBeenCalledWith(7, 2, paths);
  });

  it('routes error event to onError', () => {
    const onError = vi.fn();
    renderHook(() => useWebSocket({ onError }));

    const errorData = { message: 'Send failed', details: 'Radio busy' };
    fireMessage({ type: 'error', data: errorData });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(errorData);
  });

  it('routes success event to onSuccess', () => {
    const onSuccess = vi.fn();
    renderHook(() => useWebSocket({ onSuccess }));

    const successData = { message: 'Message sent' };
    fireMessage({ type: 'success', data: successData });

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(successData);
  });

  it('pong message calls no handlers', () => {
    const handlers = {
      onHealth: vi.fn(),
      onMessage: vi.fn(),
      onContact: vi.fn(),
      onMessageAcked: vi.fn(),
      onError: vi.fn(),
      onSuccess: vi.fn(),
    };
    renderHook(() => useWebSocket(handlers));

    fireMessage({ type: 'pong', data: null });

    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('unknown message type calls no handlers', () => {
    const handlers = {
      onHealth: vi.fn(),
      onMessage: vi.fn(),
      onContact: vi.fn(),
      onMessageAcked: vi.fn(),
      onError: vi.fn(),
      onSuccess: vi.fn(),
    };
    renderHook(() => useWebSocket(handlers));

    fireMessage({ type: 'something_unexpected', data: {} });

    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('malformed JSON calls no handlers (catch branch)', () => {
    const handlers = {
      onHealth: vi.fn(),
      onMessage: vi.fn(),
      onContact: vi.fn(),
      onMessageAcked: vi.fn(),
      onError: vi.fn(),
      onSuccess: vi.fn(),
    };
    renderHook(() => useWebSocket(handlers));

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.onmessage?.({ data: 'not valid json{{{' });
    });

    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });
});
