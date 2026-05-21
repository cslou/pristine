import type {
  PrivacyInputResolveSensitiveLike,
  PrivacyInputToolCallEventLike,
  PrivacyInputToolCallResultLike,
  PrivacyInputToolContentLike,
  PrivacyInputToolResultEventLike,
  PrivacyInputToolResultPatchLike,
  PrivacyInputToolRevealPolicyConfig,
} from './types.js';

const PLACEHOLDER_REGEX = /\[SENSITIVE:([a-z0-9_]+):([0-9a-f-]+)\]/gu;
const REVEALED_TOOL_CALL_RETENTION_MS = 5 * 60 * 1000;
const EXPIRED_REVEAL_RESULT_MESSAGE =
  'Pristine scrubbed this tool result because its reveal context expired before result handling.';

class PrivacyInputToolBoundaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PrivacyInputToolBoundaryError';
  }
}

interface SensitivePlaceholderMatch {
  readonly placeholder: string;
  readonly sensitiveRef: string;
}

interface RevealedPlaceholder {
  readonly placeholder: string;
  readonly value: string;
}

interface RevealedString {
  readonly text: string;
  readonly revealed: readonly RevealedPlaceholder[];
}

interface TrackedReveal {
  readonly revealed: readonly RevealedPlaceholder[];
  readonly timeout: ReturnType<typeof setTimeout>;
}

const collectPlaceholdersFromText = (text: string): readonly SensitivePlaceholderMatch[] => {
  const matches: SensitivePlaceholderMatch[] = [];
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const placeholder = match[0];
    const sensitiveRef = match[2];
    if (placeholder === undefined || sensitiveRef === undefined) continue;
    matches.push({ placeholder, sensitiveRef });
  }
  return matches;
};

export const containsSensitivePlaceholder = (value: unknown): boolean => {
  if (typeof value === 'string') return collectPlaceholdersFromText(value).length > 0;
  if (Array.isArray(value)) return value.some((entry) => containsSensitivePlaceholder(entry));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Readonly<Record<string, unknown>>).some((entry) =>
    containsSensitivePlaceholder(entry),
  );
};

const replaceAllLiteral = (text: string, from: string, to: string): string => text.split(from).join(to);

const scrubString = (text: string, revealed: readonly RevealedPlaceholder[]): string => {
  const byValue = new Map<string, string>();
  for (const entry of revealed) {
    if (entry.value.length === 0 || byValue.has(entry.value)) continue;
    byValue.set(entry.value, entry.placeholder);
  }

  return [...byValue.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce((scrubbed, [value, placeholder]) => replaceAllLiteral(scrubbed, value, placeholder), text);
};

const scrubUnknown = (value: unknown, revealed: readonly RevealedPlaceholder[]): unknown => {
  if (typeof value === 'string') return scrubString(value, revealed);
  if (Array.isArray(value)) return value.map((entry) => scrubUnknown(entry, revealed));
  if (typeof value !== 'object' || value === null) return value;

  const scrubbed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Readonly<Record<string, unknown>>)) {
    scrubbed[key] = scrubUnknown(entry, revealed);
  }
  return scrubbed;
};

const scrubContent = (
  content: readonly PrivacyInputToolContentLike[],
  revealed: readonly RevealedPlaceholder[],
): readonly PrivacyInputToolContentLike[] =>
  content.map((entry) => scrubUnknown(entry, revealed) as PrivacyInputToolContentLike);

export class PrivacyInputToolBoundaryController {
  private readonly resolveSensitive: PrivacyInputResolveSensitiveLike | undefined;
  private readonly policy: PrivacyInputToolRevealPolicyConfig;
  private readonly resolveUserId: () => Promise<string>;
  private readonly revealedByToolCallId = new Map<string, TrackedReveal>();
  private readonly expiredRevealToolCallIds = new Set<string>();

  public constructor(config: {
    readonly resolveSensitive?: PrivacyInputResolveSensitiveLike;
    readonly policy?: PrivacyInputToolRevealPolicyConfig;
    readonly resolveUserId: () => Promise<string>;
  }) {
    this.resolveSensitive = config.resolveSensitive;
    this.policy = {
      enabled: config.policy?.enabled ?? true,
    };
    this.resolveUserId = config.resolveUserId;
  }

  public async handleToolCall(
    event: PrivacyInputToolCallEventLike,
  ): Promise<PrivacyInputToolCallResultLike | undefined> {
    if (this.policy.enabled === false) return undefined;

    try {
      const revealed = await this.revealAllowedFields(event);
      if (revealed.length > 0) {
        this.trackRevealed(event.toolCallId, revealed);
      }
      return undefined;
    } catch (error: unknown) {
      void error;
      return {
        block: true,
        reason: 'Pristine blocked this tool call because a sensitive placeholder could not be revealed locally.',
      };
    }
  }

  public async handleToolResult(
    event: PrivacyInputToolResultEventLike,
  ): Promise<PrivacyInputToolResultPatchLike | undefined> {
    const tracked = this.revealedByToolCallId.get(event.toolCallId);
    if (tracked === undefined) {
      if (!this.expiredRevealToolCallIds.delete(event.toolCallId)) return undefined;
      return {
        content: [{ type: 'text', text: EXPIRED_REVEAL_RESULT_MESSAGE }],
        details: undefined,
        isError: true,
      };
    }

    clearTimeout(tracked.timeout);
    this.revealedByToolCallId.delete(event.toolCallId);
    return {
      content: scrubContent(event.content, tracked.revealed),
      details: scrubUnknown(event.details, tracked.revealed),
    };
  }

  public close(): void {
    for (const tracked of this.revealedByToolCallId.values()) clearTimeout(tracked.timeout);
    this.revealedByToolCallId.clear();
    this.expiredRevealToolCallIds.clear();
  }

  private async revealAllowedFields(
    event: PrivacyInputToolCallEventLike,
  ): Promise<readonly RevealedPlaceholder[]> {
    if (event.toolName === 'write') {
      return this.revealStringField(event.input, 'content');
    }

    if (event.toolName === 'edit') {
      return this.revealEditNewText(event.input);
    }

    return [];
  }

  private async revealStringField(
    input: Record<string, unknown>,
    fieldName: string,
  ): Promise<readonly RevealedPlaceholder[]> {
    const fieldValue = input[fieldName];
    if (typeof fieldValue !== 'string') return [];
    const revealed = await this.revealString(fieldValue);
    if (revealed.revealed.length === 0) return [];
    input[fieldName] = revealed.text;
    return revealed.revealed;
  }

  private async revealEditNewText(
    input: Record<string, unknown>): Promise<readonly RevealedPlaceholder[]> {
    const edits = input.edits;
    if (!Array.isArray(edits)) return [];

    const replacements: Array<{ readonly edit: Record<string, unknown>; readonly text: string }> = [];
    const revealedByPlaceholderAndValue = new Map<string, RevealedPlaceholder>();

    for (const edit of edits) {
      if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) continue;
      const editable = edit as Record<string, unknown>;
      if (typeof editable.newText !== 'string') continue;
      const revealed = await this.revealString(editable.newText);
      if (revealed.revealed.length === 0) continue;
      replacements.push({ edit: editable, text: revealed.text });
      for (const entry of revealed.revealed) {
        revealedByPlaceholderAndValue.set(`${entry.placeholder}\u0000${entry.value}`, entry);
      }
    }

    for (const replacement of replacements) {
      replacement.edit.newText = replacement.text;
    }
    return [...revealedByPlaceholderAndValue.values()];
  }

  private async revealString(text: string): Promise<RevealedString> {
    const matches = collectPlaceholdersFromText(text);
    if (matches.length === 0) return { text, revealed: [] };
    if (this.resolveSensitive === undefined) {
      throw new PrivacyInputToolBoundaryError('sensitive resolver is not configured');
    }

    const userId = await this.resolveUserId();
    let revealedText = text;
    const uniqueMatchesByPlaceholder = new Map<string, SensitivePlaceholderMatch>();
    for (const match of matches) uniqueMatchesByPlaceholder.set(match.placeholder, match);

    const resolved = await Promise.all(
      [...uniqueMatchesByPlaceholder.values()].map(async (match) => {
        const value = await this.resolveSensitive?.(match.sensitiveRef, userId);
        if (typeof value !== 'string' || value.length === 0) {
          throw new PrivacyInputToolBoundaryError('sensitive resolver returned an invalid value');
        }
        return { placeholder: match.placeholder, value };
      }),
    );
    const valuesByPlaceholder = new Map(
      resolved.map((entry) => [entry.placeholder, entry.value] as const),
    );
    const revealed = resolved.map((entry) => ({
      placeholder: entry.placeholder,
      value: entry.value,
    }));

    for (const [placeholder, value] of valuesByPlaceholder.entries()) {
      revealedText = replaceAllLiteral(revealedText, placeholder, value);
    }

    return { text: revealedText, revealed };
  }

  private trackRevealed(
    toolCallId: string,
    revealed: readonly RevealedPlaceholder[],
  ): void {
    const existing = this.revealedByToolCallId.get(toolCallId);
    if (existing !== undefined) clearTimeout(existing.timeout);

    const timeout = setTimeout(() => {
      this.revealedByToolCallId.delete(toolCallId);
      this.expiredRevealToolCallIds.add(toolCallId);
    }, REVEALED_TOOL_CALL_RETENTION_MS);
    if (typeof timeout === 'object' && timeout !== null && 'unref' in timeout) {
      const unref = timeout.unref;
      if (typeof unref === 'function') unref.call(timeout);
    }
    this.expiredRevealToolCallIds.delete(toolCallId);
    this.revealedByToolCallId.set(toolCallId, { revealed, timeout });
  }
}
