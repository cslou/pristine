import type {
  PrivacyInputResolveSensitiveLike,
  PrivacyInputToolCallEventLike,
  PrivacyInputToolCallResultLike,
  PrivacyInputToolContentLike,
  PrivacyInputToolResultEventLike,
  PrivacyInputToolResultPatchLike,
  PrivacyInputToolRevealPolicyConfig,
} from './types.js';

const PLACEHOLDER_REGEX = /\[SENSITIVE:([a-z_]+):([0-9a-f-]+)\]/gu;

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

const mergeRevealed = (
  left: readonly RevealedPlaceholder[],
  right: readonly RevealedPlaceholder[],
): readonly RevealedPlaceholder[] => {
  const byPlaceholderAndValue = new Map<string, RevealedPlaceholder>();
  for (const entry of [...left, ...right]) {
    byPlaceholderAndValue.set(`${entry.placeholder}\u0000${entry.value}`, entry);
  }
  return [...byPlaceholderAndValue.values()];
};

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
  content.map((entry) => {
    if (entry.type !== 'text' || typeof entry.text !== 'string') return entry;
    return { ...entry, text: scrubString(entry.text, revealed) };
  });

export class PrivacyInputToolBoundaryController {
  private readonly resolveSensitive: PrivacyInputResolveSensitiveLike | undefined;
  private readonly policy: PrivacyInputToolRevealPolicyConfig;
  private readonly resolveUserId: () => Promise<string>;
  private readonly revealedByToolCallId = new Map<string, readonly RevealedPlaceholder[]>();

  public constructor(config: {
    readonly resolveSensitive?: PrivacyInputResolveSensitiveLike;
    readonly policy?: PrivacyInputToolRevealPolicyConfig;
    readonly resolveUserId: () => Promise<string>;
  }) {
    this.resolveSensitive = config.resolveSensitive;
    this.policy = {
      enabled: config.policy?.enabled ?? true,
      revealBashCommand: config.policy?.revealBashCommand ?? false,
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
        this.revealedByToolCallId.set(event.toolCallId, revealed);
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
    const revealed = this.revealedByToolCallId.get(event.toolCallId);
    this.revealedByToolCallId.delete(event.toolCallId);
    if (revealed === undefined || revealed.length === 0) return undefined;

    return {
      content: scrubContent(event.content, revealed),
      details: scrubUnknown(event.details, revealed),
    };
  }

  public close(): void {
    this.revealedByToolCallId.clear();
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

    if (event.toolName === 'bash' && this.policy.revealBashCommand === true) {
      return this.revealStringField(event.input, 'command');
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
    let revealedValues: readonly RevealedPlaceholder[] = [];

    for (const edit of edits) {
      if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) continue;
      const editable = edit as Record<string, unknown>;
      if (typeof editable.newText !== 'string') continue;
      const revealed = await this.revealString(editable.newText);
      if (revealed.revealed.length === 0) continue;
      replacements.push({ edit: editable, text: revealed.text });
      revealedValues = mergeRevealed(revealedValues, revealed.revealed);
    }

    for (const replacement of replacements) {
      replacement.edit.newText = replacement.text;
    }
    return revealedValues;
  }

  private async revealString(text: string): Promise<RevealedString> {
    const matches = collectPlaceholdersFromText(text);
    if (matches.length === 0) return { text, revealed: [] };
    if (this.resolveSensitive === undefined) {
      throw new Error('sensitive resolver is not configured');
    }

    const userId = await this.resolveUserId();
    let revealedText = text;
    const revealed: RevealedPlaceholder[] = [];
    const valuesByPlaceholder = new Map<string, string>();

    for (const match of matches) {
      if (valuesByPlaceholder.has(match.placeholder)) continue;
      const value = await this.resolveSensitive(match.sensitiveRef, userId);
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error('sensitive resolver returned an invalid value');
      }
      valuesByPlaceholder.set(match.placeholder, value);
      revealed.push({ placeholder: match.placeholder, value });
    }

    for (const [placeholder, value] of valuesByPlaceholder.entries()) {
      revealedText = replaceAllLiteral(revealedText, placeholder, value);
    }

    return { text: revealedText, revealed };
  }
}
