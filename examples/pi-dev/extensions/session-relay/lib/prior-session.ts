import { parsePiSessionJsonlFile } from '../../../shared/lib/pi-jsonl-session.js';
import type { HistoricalSession, HistoricalSessionQuery, SessionMetadataStore } from './types.js';

export interface RelayVisibleMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface LoadedPriorSessionMessages {
  readonly session: HistoricalSession;
  readonly messages: readonly RelayVisibleMessage[];
  readonly truncated: boolean;
  readonly charBudget: number;
}

export const findLatestPriorSession = (
  store: SessionMetadataStore,
  query: HistoricalSessionQuery,
): HistoricalSession | null => store.findLatestPriorSession(query);

export const loadBoundedPiPriorSessionMessages = async (params: {
  readonly session: HistoricalSession;
  readonly charBudget: number;
}): Promise<LoadedPriorSessionMessages> => {
  const charBudget = Math.max(0, Math.floor(params.charBudget));
  const parsedMessages = await parsePiSessionJsonlFile(params.session.sourceUri);
  const visibleMessages = parsedMessages.map((message) => ({
    role: message.role,
    text: message.text,
  }));

  if (charBudget === 0) {
    return {
      session: params.session,
      messages: [],
      truncated: visibleMessages.length > 0,
      charBudget,
    };
  }

  const tailMessages: RelayVisibleMessage[] = [];
  let usedChars = 0;
  let truncated = false;
  for (let index = visibleMessages.length - 1; index >= 0; index--) {
    const message = visibleMessages[index];
    if (message === undefined) continue;
    const messageChars = message.text.length;
    if (messageChars > charBudget) {
      tailMessages.unshift({
        role: message.role,
        text: message.text.slice(message.text.length - charBudget),
      });
      truncated = true;
      break;
    }
    if (usedChars + messageChars > charBudget) {
      truncated = true;
      break;
    }
    tailMessages.unshift(message);
    usedChars += messageChars;
  }

  return {
    session: params.session,
    messages: tailMessages,
    truncated,
    charBudget,
  };
};
