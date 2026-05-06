import { readFile } from 'node:fs/promises';

export type PiJsonlRole = 'user' | 'assistant';

export interface PiJsonlSourcePointer {
  readonly sourceKind: 'pi-jsonl';
  readonly sourceUri: string;
  readonly entryId?: string;
  readonly parentId?: string;
  readonly lineNumber: number;
  readonly timestamp?: string;
  readonly cwd?: string;
}

export interface PiJsonlParsedMessage {
  readonly role: PiJsonlRole;
  readonly text: string;
  readonly pointer: PiJsonlSourcePointer;
}

export interface ParsePiSessionJsonlOptions {
  readonly sourceUri: string;
  /**
   * Optional active-branch filter supplied by the Pi extension from
   * ctx.sessionManager.getBranch(). When present, only message entries whose
   * IDs are in this set are indexed.
   */
  readonly activeEntryIds?: ReadonlySet<string>;
}

export class PiJsonlParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PiJsonlParseError';
  }
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readTextBlocks = (content: unknown): string[] => {
  if (typeof content === 'string') {
    return content.trim().length > 0 ? [content] : [];
  }
  if (!Array.isArray(content)) return [];

  const texts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type !== 'text') continue;
    if (typeof block.text !== 'string') continue;
    if (block.text.trim().length === 0) continue;
    texts.push(block.text);
  }
  return texts;
};

function* iterateJsonlLines(jsonl: string): Generator<{ readonly line: string; readonly lineNumber: number }> {
  let lineStart = 0;
  let lineNumber = 1;

  for (let index = 0; index <= jsonl.length; index++) {
    const isEnd = index === jsonl.length;
    const char = isEnd ? '' : jsonl[index];
    if (!isEnd && char !== '\n') continue;

    const lineEnd = index > lineStart && jsonl[index - 1] === '\r' ? index - 1 : index;
    yield { line: jsonl.slice(lineStart, lineEnd), lineNumber };
    lineStart = index + 1;
    lineNumber++;
  }
}

const parseJsonLine = (line: string, lineNumber: number, sourceUri: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PiJsonlParseError(
      `Failed to parse Pi JSONL line ${lineNumber} from ${sourceUri}: ${message}`,
    );
  }
};

export const parsePiSessionJsonlText = (
  jsonl: string,
  options: ParsePiSessionJsonlOptions,
): readonly PiJsonlParsedMessage[] => {
  const results: PiJsonlParsedMessage[] = [];
  let cwd: string | undefined;

  for (const { line, lineNumber } of iterateJsonlLines(jsonl)) {
    if (line.trim().length === 0) continue;

    const entry = parseJsonLine(line, lineNumber, options.sourceUri);
    if (!isObject(entry)) continue;

    if (entry.type === 'session') {
      cwd = optionalString(entry.cwd) ?? cwd;
      continue;
    }

    if (entry.type !== 'message') continue;
    if (!isObject(entry.message)) continue;

    const entryId = optionalString(entry.id);
    if (entryId === undefined) continue;
    if (options.activeEntryIds !== undefined && !options.activeEntryIds.has(entryId)) continue;

    const role = entry.message.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const texts = readTextBlocks(entry.message.content);
    if (texts.length === 0) continue;

    const text = texts.join('\n').trim();
    if (text.length === 0) continue;

    results.push({
      role,
      text,
      pointer: {
        sourceKind: 'pi-jsonl',
        sourceUri: options.sourceUri,
        entryId,
        ...(optionalString(entry.parentId) !== undefined
          ? { parentId: optionalString(entry.parentId) }
          : {}),
        lineNumber,
        ...(optionalString(entry.timestamp) !== undefined
          ? { timestamp: optionalString(entry.timestamp) }
          : {}),
        ...(cwd !== undefined ? { cwd } : {}),
      },
    });
  }

  return results;
};

export const parsePiSessionJsonlFile = async (
  sessionFilePath: string,
): Promise<readonly PiJsonlParsedMessage[]> => {
  const jsonl = await readFile(sessionFilePath, 'utf8');
  return parsePiSessionJsonlText(jsonl, { sourceUri: sessionFilePath });
};
