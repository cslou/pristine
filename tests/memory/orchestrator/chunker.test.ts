import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/core/types.js';
import {
  chunkConversation,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
} from '../../../src/memory/orchestrator/chunker.js';

function msg(content: string): Message {
  return { role: 'user', content };
}

function msgs(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => msg(`msg-${i}`));
}

describe('chunkConversation', () => {
  it('empty input returns one empty chunk', () => {
    const chunks = chunkConversation([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([]);
  });

  it('single message returns one chunk', () => {
    const messages = msgs(1);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(messages);
  });

  it('exactly CHUNK_SIZE messages returns one chunk', () => {
    const messages = msgs(CHUNK_SIZE);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(messages);
  });

  it('CHUNK_SIZE + 1 messages returns two chunks', () => {
    const messages = msgs(CHUNK_SIZE + 1);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[1].length).toBeGreaterThan(0);
  });

  it('two full chunks (38 messages) produces 2 chunks of 20', () => {
    const messages = msgs(38);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
  });

  it('39 messages produces 3 chunks, last chunk shorter', () => {
    const messages = msgs(39);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2].length).toBeLessThan(20);
    expect(chunks[2].length).toBeGreaterThan(0);
  });

  it('adjacent chunks share exactly CHUNK_OVERLAP messages at boundary', () => {
    const messages = msgs(38);
    const chunks = chunkConversation(messages);
    const tailOfFirst = chunks[0]!.slice(-CHUNK_OVERLAP);
    const headOfSecond = chunks[1]!.slice(0, CHUNK_OVERLAP);
    expect(tailOfFirst).toEqual(headOfSecond);
  });

  it('custom chunkSize and overlap work correctly', () => {
    const messages = msgs(6);
    const chunks = chunkConversation(messages, 4, 1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(4);
    expect(chunks[1]).toHaveLength(3);
    expect(chunks[0]![chunks[0]!.length - 1]).toEqual(chunks[1]![0]);
  });

  it('overlap=0 produces non-overlapping chunks', () => {
    const messages = msgs(8);
    const chunks = chunkConversation(messages, 4, 0);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual(messages.slice(0, 4));
    expect(chunks[1]).toEqual(messages.slice(4, 8));
  });
});
