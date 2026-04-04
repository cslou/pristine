import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadModel } from '../../src/models/download.js';
import { DownloadError } from '../../src/core/errors.js';

const originalFetch = globalThis.fetch;

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pristine-dl-test-'));
}

function createMockResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({
      'content-length': String(encoded.length),
      ...headers,
    }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
  } as Response;
}

describe('downloadModel', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads file to destPath', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');

    vi.mocked(globalThis.fetch).mockResolvedValue(createMockResponse('model-content'));

    await downloadModel({ url: 'https://example.com/model.gguf', destPath });

    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, 'utf8')).toBe('model-content');

    unlinkSync(destPath);
  });

  it('reports progress via callback', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');
    const progress: Array<{ downloaded: number; total: number }> = [];

    vi.mocked(globalThis.fetch).mockResolvedValue(createMockResponse('hello'));

    await downloadModel({
      url: 'https://example.com/model.gguf',
      destPath,
      onProgress: (downloaded, total) => progress.push({ downloaded, total }),
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]!.downloaded).toBe(5);

    unlinkSync(destPath);
  });

  it('throws DownloadError on network failure', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');

    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      downloadModel({ url: 'https://example.com/model.gguf', destPath }),
    ).rejects.toThrow(DownloadError);
  });

  it('throws DownloadError on HTTP error', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');

    vi.mocked(globalThis.fetch).mockResolvedValue(createMockResponse('', 404));

    await expect(
      downloadModel({ url: 'https://example.com/model.gguf', destPath }),
    ).rejects.toThrow(DownloadError);
  });

  it('verifies SHA-256 checksum on success', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');
    // SHA-256 of 'model-content'
    const correctHash = 'ca78ac8f57316892250cc56e5710a9b2f86e11d8dac856f2e9528327a577bbf6';

    vi.mocked(globalThis.fetch).mockResolvedValue(createMockResponse('model-content'));

    await downloadModel({
      url: 'https://example.com/model.gguf',
      destPath,
      expectedSha256: correctHash,
    });

    expect(existsSync(destPath)).toBe(true);
    unlinkSync(destPath);
  });

  it('throws DownloadError on checksum mismatch and deletes file', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');

    vi.mocked(globalThis.fetch).mockResolvedValue(createMockResponse('model-content'));

    await expect(
      downloadModel({
        url: 'https://example.com/model.gguf',
        destPath,
        expectedSha256: 'wrong-hash',
      }),
    ).rejects.toThrow(DownloadError);

    expect(existsSync(destPath)).toBe(false);
    expect(existsSync(`${destPath}.partial`)).toBe(false);
  });

  it('resumes download from existing partial file', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'model.gguf');
    const partialPath = `${destPath}.partial`;

    // Simulate a partial download (5 bytes already downloaded)
    writeFileSync(partialPath, 'hello');

    vi.mocked(globalThis.fetch).mockResolvedValue(
      createMockResponse(' world', 206, { 'content-range': 'bytes 5-10/11' }),
    );

    await downloadModel({ url: 'https://example.com/model.gguf', destPath });

    expect(existsSync(destPath)).toBe(true);
    // Partial content was appended since status is 206
    const content = readFileSync(destPath, 'utf8');
    expect(content).toBe('hello world');

    // Verify Range header was sent
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers['Range']).toBe('bytes=5-');

    unlinkSync(destPath);
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = createTempDir();
    const destPath = join(dir, 'nested', 'deep', 'model.gguf');

    vi.mocked(globalThis.fetch).mockResolvedValue(createMockResponse('content'));

    await downloadModel({ url: 'https://example.com/model.gguf', destPath });

    expect(existsSync(destPath)).toBe(true);
    unlinkSync(destPath);
  });
});
