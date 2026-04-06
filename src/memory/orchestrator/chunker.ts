import type { Message } from '../../core/types.js';

export const CHUNK_SIZE = 20;
export const CHUNK_OVERLAP = 2;

export function chunkConversation(
  messages: readonly Message[],
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): Message[][] {
  if (messages.length <= chunkSize) {
    return [messages.slice()];
  }

  const step = Math.max(1, chunkSize - overlap);
  const chunks: Message[][] = [];

  for (let i = 0; i < messages.length; i += step) {
    chunks.push(messages.slice(i, i + chunkSize));
    if (i + chunkSize >= messages.length) {
      break;
    }
  }

  return chunks;
}
