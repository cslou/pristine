import { createWriteStream, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname } from 'node:path';
import { DownloadError } from '../core/errors.js';

export interface DownloadOptions {
  readonly url: string;
  readonly destPath: string;
  readonly expectedSha256?: string;
  readonly onProgress?: (downloaded: number, total: number) => void;
}

export async function downloadModel(options: DownloadOptions): Promise<void> {
  const { url, destPath, expectedSha256, onProgress } = options;
  const partialPath = `${destPath}.partial`;

  await mkdir(dirname(destPath), { recursive: true });

  let startByte = 0;
  if (existsSync(partialPath)) {
    startByte = statSync(partialPath).size;
  }

  const headers: Record<string, string> = {};
  if (startByte > 0) {
    headers['Range'] = `bytes=${startByte}-`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error: unknown) {
    throw new DownloadError(
      `Failed to fetch model: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  if (!response.ok && response.status !== 206) {
    throw new DownloadError(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalSize = contentLength ? startByte + parseInt(contentLength, 10) : 0;

  if (!response.body) {
    throw new DownloadError('Download failed: no response body');
  }

  const writeStream = createWriteStream(partialPath, {
    flags: startByte > 0 && response.status === 206 ? 'a' : 'w',
  });

  let downloaded = startByte;
  const reader = response.body.getReader();
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        downloaded += value.length;
        if (onProgress && totalSize > 0) {
          onProgress(downloaded, totalSize);
        }
        this.push(Buffer.from(value));
      }
    },
  });

  await pipeline(nodeStream, writeStream);

  if (expectedSha256) {
    const hash = await computeFileHash(partialPath);
    if (hash !== expectedSha256) {
      unlinkSync(partialPath);
      throw new DownloadError(
        `Checksum mismatch: expected ${expectedSha256}, got ${hash}. File deleted — re-run to download again.`,
      );
    }
  }

  renameSync(partialPath, destPath);
}

async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  await pipeline(stream, hash);
  return hash.digest('hex');
}
