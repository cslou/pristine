import { realpath, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  deriveActiveEntryIdsFromPiSessionFile,
  loadPiSessionJsonlVisibleMessageTail,
} from '../../../shared/lib/pi-jsonl-session.js';
import type {
  HistoricalSession,
  HistoricalSessionQuery,
  PriorSessionLookup,
  RelayVisibleMessage,
} from './types.js';

export interface LoadedPriorSessionMessages {
  readonly session: HistoricalSession;
  readonly messages: readonly RelayVisibleMessage[];
  readonly truncated: boolean;
  readonly charBudget: number;
}

export class PriorSessionLoadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PriorSessionLoadError';
  }
}

export const findLatestPriorSession = (
  store: PriorSessionLookup,
  query: HistoricalSessionQuery,
): HistoricalSession | null => store.findLatestPriorSession(query);

const assertReadablePiJsonlSource = async (sourceUri: string): Promise<string> => {
  const resolvedPath = await realpath(sourceUri);
  if (extname(resolvedPath) !== '.jsonl') {
    throw new PriorSessionLoadError(`Prior session source must be a .jsonl file: ${sourceUri}`);
  }
  const sourceStats = await stat(resolvedPath);
  if (!sourceStats.isFile()) {
    throw new PriorSessionLoadError(`Prior session source is not a file: ${sourceUri}`);
  }
  return resolvedPath;
};

export const loadBoundedPiPriorSessionMessages = async (params: {
  readonly session: HistoricalSession;
  readonly charBudget: number;
}): Promise<LoadedPriorSessionMessages> => {
  const charBudget = Math.max(0, Math.floor(params.charBudget));
  if (charBudget === 0) {
    return { session: params.session, messages: [], truncated: false, charBudget };
  }

  const sourcePath = await assertReadablePiJsonlSource(params.session.sourceUri);
  const activeEntryIds =
    params.session.activeEntryIds !== undefined
      ? new Set(params.session.activeEntryIds)
      : await deriveActiveEntryIdsFromPiSessionFile(sourcePath);
  if (activeEntryIds.size === 0) {
    return { session: params.session, messages: [], truncated: false, charBudget };
  }

  const tail = await loadPiSessionJsonlVisibleMessageTail(sourcePath, {
    activeEntryIds,
    charBudget,
  });

  return {
    session: params.session,
    messages: tail.messages.map((message) => ({
      role: message.role,
      text: message.text,
    })),
    truncated: tail.truncated,
    charBudget,
  };
};
