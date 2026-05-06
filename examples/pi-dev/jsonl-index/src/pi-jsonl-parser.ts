import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';

export type PiJsonlRole = 'user' | 'assistant';

export interface PiJsonlSourcePointer {
  readonly sourceKind: 'pi-jsonl';
  readonly sourceUri: string;
  readonly entryId: string;
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

interface ParserState {
  cwd?: string;
}

const parsePiJsonlEntry = (
  entry: unknown,
  lineNumber: number,
  options: ParsePiSessionJsonlOptions,
  state: ParserState,
): PiJsonlParsedMessage | null => {
  if (!isObject(entry)) return null;

  if (entry.type === 'session') {
    state.cwd = optionalString(entry.cwd) ?? state.cwd;
    return null;
  }

  if (entry.type !== 'message') return null;
  if (!isObject(entry.message)) return null;

  const entryId = optionalString(entry.id);
  if (entryId === undefined) return null;
  if (options.activeEntryIds !== undefined && !options.activeEntryIds.has(entryId)) return null;

  const role = entry.message.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const texts = readTextBlocks(entry.message.content);
  if (texts.length === 0) return null;

  const text = texts.join('\n').trim();
  if (text.length === 0) return null;

  return {
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
      ...(state.cwd !== undefined ? { cwd: state.cwd } : {}),
    },
  };
};

export const parsePiSessionJsonlText = (
  jsonl: string,
  options: ParsePiSessionJsonlOptions,
): readonly PiJsonlParsedMessage[] => {
  const results: PiJsonlParsedMessage[] = [];
  const state: ParserState = {};

  for (const { line, lineNumber } of iterateJsonlLines(jsonl)) {
    if (line.trim().length === 0) continue;
    const parsed = parsePiJsonlEntry(
      parseJsonLine(line, lineNumber, options.sourceUri),
      lineNumber,
      options,
      state,
    );
    if (parsed !== null) results.push(parsed);
  }

  return results;
};

export const parsePiSessionJsonlFile = async (
  sessionFilePath: string,
  options: Omit<ParsePiSessionJsonlOptions, 'sourceUri'> = {},
): Promise<readonly PiJsonlParsedMessage[]> => {
  const results: PiJsonlParsedMessage[] = [];
  const state: ParserState = {};
  const lines = createInterface({
    input: createReadStream(sessionFilePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (line.trim().length === 0) continue;
    const parsed = parsePiJsonlEntry(
      parseJsonLine(line, lineNumber, sessionFilePath),
      lineNumber,
      { ...options, sourceUri: sessionFilePath },
      state,
    );
    if (parsed !== null) results.push(parsed);
  }

  return results;
};
