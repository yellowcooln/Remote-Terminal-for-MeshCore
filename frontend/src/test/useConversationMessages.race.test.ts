import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as messageCache from '../messageCache';
import { useConversationMessages } from '../hooks/useConversationMessages';
import type { Conversation, Message } from '../types';

const mockGetMessages = vi.fn<(...args: unknown[]) => Promise<Message[]>>();

vi.mock('../api', () => ({
  api: {
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
  },
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
}));

function createConversation(): Conversation {
  return {
    type: 'contact',
    id: 'abc123',
    name: 'Test Contact',
  };
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 42,
    type: 'PRIV',
    conversation_key: 'abc123',
    text: 'hello',
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    outgoing: true,
    acked: 0,
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

describe('useConversationMessages ACK ordering', () => {
  beforeEach(() => {
    mockGetMessages.mockReset();
    messageCache.clear();
  });

  it('applies buffered ACK when message is added after ACK event', async () => {
    mockGetMessages.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversationMessages(createConversation()));

    await waitFor(() => expect(mockGetMessages).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.messagesLoading).toBe(false));

    const paths = [{ path: 'A1B2', received_at: 1700000010 }];
    act(() => {
      result.current.updateMessageAck(42, 2, paths);
    });

    act(() => {
      const added = result.current.addMessageIfNew(
        createMessage({ id: 42, acked: 0, paths: null })
      );
      expect(added).toBe(true);
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].acked).toBe(2);
    expect(result.current.messages[0].paths).toEqual(paths);
  });

  it('applies buffered ACK to message returned by in-flight fetch', async () => {
    const deferred = createDeferred<Message[]>();
    mockGetMessages.mockReturnValueOnce(deferred.promise);

    const { result } = renderHook(() => useConversationMessages(createConversation()));
    await waitFor(() => expect(mockGetMessages).toHaveBeenCalledTimes(1));

    const paths = [{ path: 'C3D4', received_at: 1700000011 }];
    act(() => {
      result.current.updateMessageAck(42, 1, paths);
    });

    deferred.resolve([createMessage({ id: 42, acked: 0, paths: null })]);

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].acked).toBe(1);
    expect(result.current.messages[0].paths).toEqual(paths);
  });

  it('keeps highest ACK state when out-of-order ACK updates arrive', async () => {
    mockGetMessages.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversationMessages(createConversation()));

    await waitFor(() => expect(mockGetMessages).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.messagesLoading).toBe(false));

    act(() => {
      result.current.addMessageIfNew(createMessage({ id: 42, acked: 0, paths: null }));
    });

    const highAckPaths = [
      { path: 'A1B2', received_at: 1700000010 },
      { path: 'A1C3', received_at: 1700000011 },
    ];
    const staleAckPaths = [{ path: 'A1B2', received_at: 1700000010 }];

    act(() => {
      result.current.updateMessageAck(42, 3, highAckPaths);
      result.current.updateMessageAck(42, 2, staleAckPaths);
    });

    expect(result.current.messages[0].acked).toBe(3);
    expect(result.current.messages[0].paths).toEqual(highAckPaths);
  });
});

describe('useConversationMessages conversation switch', () => {
  beforeEach(() => {
    mockGetMessages.mockReset();
    messageCache.clear();
  });

  it('resets loadingOlder when switching conversations mid-fetch', async () => {
    const convA: Conversation = { type: 'contact', id: 'conv_a', name: 'Contact A' };
    const convB: Conversation = { type: 'contact', id: 'conv_b', name: 'Contact B' };

    // Conv A initial fetch: return 200 messages so hasOlderMessages = true
    const fullPage = Array.from({ length: 200 }, (_, i) =>
      createMessage({
        id: i + 1,
        conversation_key: 'conv_a',
        text: `msg-${i}`,
        sender_timestamp: 1700000000 + i,
        received_at: 1700000000 + i,
      })
    );
    mockGetMessages.mockResolvedValueOnce(fullPage);

    const { result, rerender } = renderHook(
      ({ conv }: { conv: Conversation }) => useConversationMessages(conv),
      { initialProps: { conv: convA } }
    );

    await waitFor(() => expect(result.current.messagesLoading).toBe(false));
    expect(result.current.hasOlderMessages).toBe(true);
    expect(result.current.messages).toHaveLength(200);

    // Start fetching older messages — use a deferred promise so it stays in-flight
    const olderDeferred = createDeferred<Message[]>();
    mockGetMessages.mockReturnValueOnce(olderDeferred.promise);

    act(() => {
      result.current.fetchOlderMessages();
    });

    expect(result.current.loadingOlder).toBe(true);

    // Switch to conv B while older-messages fetch is still pending
    mockGetMessages.mockResolvedValueOnce([createMessage({ id: 999, conversation_key: 'conv_b' })]);
    rerender({ conv: convB });

    // loadingOlder must reset immediately — no phantom spinner in conv B
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));
    await waitFor(() => expect(result.current.messagesLoading).toBe(false));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].conversation_key).toBe('conv_b');

    // Resolve the stale older-messages fetch — should not affect conv B's state
    olderDeferred.resolve([
      createMessage({ id: 500, conversation_key: 'conv_a', text: 'stale-old' }),
    ]);

    // Give the stale response time to be processed (it should be discarded)
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].conversation_key).toBe('conv_b');
  });

  it('aborts in-flight fetch when switching conversations', async () => {
    const convA: Conversation = { type: 'contact', id: 'conv_a', name: 'Contact A' };
    const convB: Conversation = { type: 'contact', id: 'conv_b', name: 'Contact B' };

    // Conv A: never resolves (simulates slow network)
    mockGetMessages.mockReturnValueOnce(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ conv }: { conv: Conversation }) => useConversationMessages(conv),
      { initialProps: { conv: convA } }
    );

    // Should be loading
    expect(result.current.messagesLoading).toBe(true);

    // Verify the API was called with an AbortSignal
    const firstCallSignal = (mockGetMessages as Mock).mock.calls[0]?.[1];
    expect(firstCallSignal).toBeInstanceOf(AbortSignal);

    // Switch to conv B
    mockGetMessages.mockResolvedValueOnce([createMessage({ id: 1, conversation_key: 'conv_b' })]);
    rerender({ conv: convB });

    // The signal from conv A's fetch should have been aborted
    expect(firstCallSignal.aborted).toBe(true);

    // Conv B should load normally
    await waitFor(() => expect(result.current.messagesLoading).toBe(false));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].conversation_key).toBe('conv_b');
  });
});
