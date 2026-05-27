import { realpath, stat } from 'node:fs/promises';
import { extname, sep } from 'node:path';
import { loadPiSessionJsonlVisibleMessageTail } from '../../../shared/lib/pi-jsonl-session.js';
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

const isWithinRoot = (path: string, root: string): boolean => path === root || path.startsWith(`${root}${sep}`);

const assertReadablePiJsonlSource = async (
  sourceUri: string,
  allowedSourceRoots?: readonly string[],
): Promise<string> => {
  const resolvedPath = await realpath(sourceUri);
  if (allowedSourceRoots !== undefined && allowedSourceRoots.length > 0) {
    const resolvedRoots = await Promise.all(allowedSourceRoots.map((root) => realpath(root)));
    if (!resolvedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
      throw new PriorSessionLoadError(`Prior session source is outside the allowed session roots: ${sourceUri}`);
    }
  }
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
  readonly allowedSourceRoots?: readonly string[];
}): Promise<LoadedPriorSessionMessages> => {
  const charBudget = Math.max(0, Math.floor(params.charBudget));
  if (charBudget === 0) {
    return { session: params.session, messages: [], truncated: false, charBudget };
  }

  const sourcePath = await assertReadablePiJsonlSource(
    params.session.sourceUri,
    params.allowedSourceRoots,
  );
  if (params.session.activeEntryIds === undefined) {
    return { session: params.session, messages: [], truncated: false, charBudget };
  }
  const activeEntryIds = new Set(params.session.activeEntryIds);
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
