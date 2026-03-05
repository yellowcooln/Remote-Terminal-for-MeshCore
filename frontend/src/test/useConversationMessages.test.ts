/**
 * Tests for useConversationMessages hook utilities.
 *
 * These tests verify the message deduplication key generation.
 */

import { describe, it, expect } from 'vitest';
import { getMessageContentKey } from '../hooks/useConversationMessages';
import type { Message } from '../types';

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'channel123',
    text: 'Hello world',
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
    ...overrides,
  };
}

describe('getMessageContentKey', () => {
  it('generates key from type, conversation_key, text, and sender_timestamp', () => {
    const msg = createMessage({
      type: 'CHAN',
      conversation_key: 'abc123',
      text: 'Hello',
      sender_timestamp: 1700000000,
    });

    const key = getMessageContentKey(msg);

    expect(key).toBe('CHAN-abc123-Hello-1700000000');
  });

  it('generates different keys for different message types', () => {
    const chanMsg = createMessage({ type: 'CHAN' });
    const privMsg = createMessage({ type: 'PRIV' });

    expect(getMessageContentKey(chanMsg)).not.toBe(getMessageContentKey(privMsg));
  });

  it('generates different keys for different conversation keys', () => {
    const msg1 = createMessage({ conversation_key: 'channel1' });
    const msg2 = createMessage({ conversation_key: 'channel2' });

    expect(getMessageContentKey(msg1)).not.toBe(getMessageContentKey(msg2));
  });

  it('generates different keys for different text', () => {
    const msg1 = createMessage({ text: 'Hello' });
    const msg2 = createMessage({ text: 'World' });

    expect(getMessageContentKey(msg1)).not.toBe(getMessageContentKey(msg2));
  });

  it('generates different keys for different timestamps', () => {
    const msg1 = createMessage({ sender_timestamp: 1700000000 });
    const msg2 = createMessage({ sender_timestamp: 1700000001 });

    expect(getMessageContentKey(msg1)).not.toBe(getMessageContentKey(msg2));
  });

  it('generates same key for messages with same content', () => {
    const msg1 = createMessage({
      id: 1,
      type: 'CHAN',
      conversation_key: 'abc',
      text: 'Test',
      sender_timestamp: 1700000000,
    });
    const msg2 = createMessage({
      id: 2, // Different ID
      type: 'CHAN',
      conversation_key: 'abc',
      text: 'Test',
      sender_timestamp: 1700000000,
    });

    expect(getMessageContentKey(msg1)).toBe(getMessageContentKey(msg2));
  });

  it('handles null sender_timestamp by falling back to received_at and id', () => {
    const msg = createMessage({ sender_timestamp: null });

    const key = getMessageContentKey(msg);

    // Falls back to `r${received_at}-${id}` when sender_timestamp is null
    expect(key).toBe('CHAN-channel123-Hello world-r1700000001-1');
  });

  it('handles empty text', () => {
    const msg = createMessage({ text: '' });

    const key = getMessageContentKey(msg);

    expect(key).toContain('--'); // Empty text between dashes
  });

  it('handles text with special characters', () => {
    const msg = createMessage({ text: 'Hello: World! @user #channel' });

    const key = getMessageContentKey(msg);

    expect(key).toContain('Hello: World! @user #channel');
  });

  it('null-timestamp messages with different received_at produce different keys', () => {
    const msg1 = createMessage({ sender_timestamp: null, received_at: 1700000001 });
    const msg2 = createMessage({ sender_timestamp: null, received_at: 1700000002 });

    expect(getMessageContentKey(msg1)).not.toBe(getMessageContentKey(msg2));
  });

  it('null-timestamp key does not collide with numeric timestamp key', () => {
    // A message with sender_timestamp=null and received_at=123
    // should not match a message with sender_timestamp that looks similar
    const nullTsMsg = createMessage({ sender_timestamp: null, received_at: 123 });
    const numericTsMsg = createMessage({ sender_timestamp: 123 });

    expect(getMessageContentKey(nullTsMsg)).not.toBe(getMessageContentKey(numericTsMsg));
  });

  it('same text and null timestamp but different conversations produce different keys', () => {
    const msg1 = createMessage({
      sender_timestamp: null,
      conversation_key: 'chan1',
      received_at: 1700000001,
    });
    const msg2 = createMessage({
      sender_timestamp: null,
      conversation_key: 'chan2',
      received_at: 1700000001,
    });

    expect(getMessageContentKey(msg1)).not.toBe(getMessageContentKey(msg2));
  });

  it('null-timestamp messages with same text and same received_at but different ids produce different keys', () => {
    // This is the key fix: two genuinely different messages arriving in the same second
    // with null sender_timestamp must NOT collide, even if text is identical
    const msg1 = createMessage({ id: 10, sender_timestamp: null, received_at: 1700000001 });
    const msg2 = createMessage({ id: 11, sender_timestamp: null, received_at: 1700000001 });

    expect(getMessageContentKey(msg1)).not.toBe(getMessageContentKey(msg2));
  });

  it('null-timestamp messages with same id produce same key (true duplicates dedup)', () => {
    // Same message arriving via WS + API fetch has the same id — should still dedup
    const msg1 = createMessage({ id: 42, sender_timestamp: null, received_at: 1700000001 });
    const msg2 = createMessage({ id: 42, sender_timestamp: null, received_at: 1700000001 });

    expect(getMessageContentKey(msg1)).toBe(getMessageContentKey(msg2));
  });
});
