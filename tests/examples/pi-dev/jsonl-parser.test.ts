import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  parsePiSessionJsonlFile,
  parsePiSessionJsonlText,
  PiJsonlParseError,
} from '../../../examples/pi-dev/jsonl-index/src/pi-jsonl-parser.js';

const fixturePath = 'tests/fixtures/pi-jsonl/mixed-session.jsonl';

describe('Pi JSONL parser reference', () => {
  it('extracts user and assistant text with Pi source pointers', async () => {
    const messages = await parsePiSessionJsonlFile(fixturePath);

    expect(messages).toEqual([
      {
        role: 'user',
        text: 'Please remember the sapphire migration note.',
        pointer: {
          sourceKind: 'pi-jsonl',
          sourceUri: fixturePath,
          entryId: 'u0000001',
          lineNumber: 2,
          timestamp: '2026-05-06T10:00:01.000Z',
          cwd: '/Users/lou/projects/test-pristine',
        },
      },
      {
        role: 'assistant',
        text: 'Noted: sapphire migration note is important.',
        pointer: {
          sourceKind: 'pi-jsonl',
          sourceUri: fixturePath,
          entryId: 'a0000002',
          parentId: 'u0000001',
          lineNumber: 3,
          timestamp: '2026-05-06T10:00:02.000Z',
          cwd: '/Users/lou/projects/test-pristine',
        },
      },
      {
        role: 'user',
        text: 'The repo-local install phrase is amber-coyote.',
        pointer: {
          sourceKind: 'pi-jsonl',
          sourceUri: fixturePath,
          entryId: 'u0000004',
          parentId: 't0000003',
          lineNumber: 5,
          timestamp: '2026-05-06T10:00:04.000Z',
          cwd: '/Users/lou/projects/test-pristine',
        },
      },
    ]);
  });

  it('ignores tool results, custom messages, image blocks, and thinking-only assistant entries', async () => {
    const jsonl = await readFile(fixturePath, 'utf8');
    const messages = parsePiSessionJsonlText(jsonl, { sourceUri: 'pi://fixture' });
    const joined = messages.map((message) => message.text).join('\n');

    expect(joined).not.toContain('tool output should be ignored');
    expect(joined).not.toContain('custom message should be ignored');
    expect(joined).not.toContain('custom role should be ignored');
    expect(joined).not.toContain('I should not be indexed');
    expect(joined).not.toContain('thinking-only assistant should be ignored');
    expect(joined).not.toContain('abc123');
  });

  it('extracts multiple text blocks from one assistant message and skips non-text blocks', () => {
    const jsonl = [
      JSON.stringify({ type: 'session', version: 3, cwd: '/tmp/project' }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        timestamp: '2026-05-06T11:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private reasoning' },
            { type: 'text', text: 'First public sentence.' },
            { type: 'toolCall', id: 'call-2', name: 'read', arguments: { path: 'README.md' } },
            { type: 'text', text: 'Second public sentence.' },
          ],
        },
      }),
    ].join('\n');

    expect(parsePiSessionJsonlText(jsonl, { sourceUri: '/tmp/session.jsonl' })).toEqual([
      {
        role: 'assistant',
        text: 'First public sentence.\nSecond public sentence.',
        pointer: {
          sourceKind: 'pi-jsonl',
          sourceUri: '/tmp/session.jsonl',
          entryId: 'assistant-1',
          parentId: 'user-1',
          lineNumber: 2,
          timestamp: '2026-05-06T11:00:00.000Z',
          cwd: '/tmp/project',
        },
      },
    ]);
  });

  it('filters to active branch entry IDs when provided by the Pi extension', async () => {
    const jsonl = await readFile(fixturePath, 'utf8');
    const messages = parsePiSessionJsonlText(jsonl, {
      sourceUri: 'pi://fixture',
      activeEntryIds: new Set(['u0000004']),
    });

    expect(messages.map((message) => message.pointer.entryId)).toEqual(['u0000004']);
    expect(messages).toHaveLength(1);
  });

  it('skips message entries without stable entry IDs', () => {
    const jsonl = JSON.stringify({
      type: 'message',
      parentId: null,
      timestamp: '2026-05-06T12:00:00.000Z',
      message: { role: 'user', content: 'No stable ID means no idempotence key.' },
    });

    expect(parsePiSessionJsonlText(jsonl, { sourceUri: '/tmp/no-id.jsonl' })).toEqual([]);
  });

  it('throws a parser-specific error for malformed JSONL', () => {
    expect(() => parsePiSessionJsonlText('{not-json}', { sourceUri: '/tmp/bad.jsonl' })).toThrow(
      PiJsonlParseError,
    );
  });
});
