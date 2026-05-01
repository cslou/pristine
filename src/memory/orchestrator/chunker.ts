// Sliding-window conversation chunker.
//
// Two sibling primitives live here:
// - `chunkConversation` — splits a message array into overlapping windows
//   for callers that batch-process conversations.
// - `splitOversizeMessage` — splits a single message that exceeds the
//   embedder's context budget into smaller chunks.

import { parse as babelParse } from '@babel/parser';
import type { Message } from '../../core/types.js';

// ---------------------------------------------------------------------------
// chunkConversation — sliding-window chunker
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// splitOversizeMessage — per-message chunking for oversize turns
// ---------------------------------------------------------------------------

/**
 * Threshold above which a single message is considered too large for one
 * embedding pass. Graphiti's default; Nomic v1.5's hard context is 8192,
 * so 3000 leaves headroom for the role-prefix concat and other framing.
 */
export const OVERSIZE_TOKEN_THRESHOLD = 3000;

/**
 * Tokens of overlap between adjacent prose chunks. Recovers context across
 * chunk boundaries so retrieval doesn't lose answers that straddle a split.
 */
export const OVERSIZE_OVERLAP_TOKENS = 200;

/**
 * Approximate-tokens-from-text counter. The Embedder interface doesn't
 * expose a tokenizer accessor (its contract is `embed(text)` and
 * `embedBatch(texts)` only), so we approximate by `Math.ceil(text.length / 4)`
 * — the conventional 4-chars/token estimate.
 *
 * The embedder's actual tokenizer (Nomic v1.5 is BERT-style WordPiece) may
 * count slightly fewer tokens for English prose and slightly more for code.
 * We accept the approximation because the threshold is itself a heuristic
 * (Graphiti default, well below the embedder's hard limit) — exact counts
 * matter less than catching the obvious oversize case. Callers that want
 * precision pass an injected `TokenCounter`.
 */
export type TokenCounter = (text: string) => number;

export const defaultTokenCounter: TokenCounter = (text) => Math.ceil(text.length / 4);

/**
 * One chunk of an oversize message. The shape mirrors the addMessage input
 * (role + content + optional timestamp) so the indexer can re-emit chunks
 * as ordinary messages with `parent_message_id` set on each child row.
 */
export interface SplitResult {
  readonly role: string;
  readonly content: string;
  readonly timestamp?: string;
}

export interface OversizeMessageInput {
  readonly role: string;
  readonly content: string;
  readonly timestamp?: string;
  /** Optional MIME hint. `text/x-typescript` / `text/x-javascript` /
   *  `application/typescript` / `application/javascript` route to the AST
   *  splitter; anything else falls through to the prose splitter. */
  readonly mimeType?: string;
}

export interface SplitOversizeOptions {
  readonly tokenCounter?: TokenCounter;
  readonly threshold?: number;
  readonly overlapTokens?: number;
}

/**
 * Split a message that exceeds the per-embed token budget into chunks
 * that each fit. The chunker never splits within a paragraph or AST
 * boundary — the chunk seam lives between sub-segments (Graphiti
 * invariant). Callers are responsible for the `parent_message_id`
 * linkage; this function returns the chunk shapes only.
 *
 * Routing:
 *   - Code-tagged content (mimeType says JS/TS, OR role='tool' with
 *     ```js / ```ts / ```javascript / ```typescript fenced) → AST split
 *     at function/class/top-level-statement boundaries via
 *     @babel/parser. Falls back to the line-aware splitter on any
 *     parser error (so garbage code doesn't crash the chunker).
 *   - Everything else → prose splitter at paragraph (double-newline)
 *     or single-newline boundaries with the configured token overlap.
 *
 * Messages at or below the threshold are returned unchanged in a
 * single-element array.
 */
export const splitOversizeMessage = (
  message: OversizeMessageInput,
  options: SplitOversizeOptions = {},
): SplitResult[] => {
  const tokenCounter = options.tokenCounter ?? defaultTokenCounter;
  const threshold = options.threshold ?? OVERSIZE_TOKEN_THRESHOLD;
  const overlap = options.overlapTokens ?? OVERSIZE_OVERLAP_TOKENS;

  const tokens = tokenCounter(message.content);
  if (tokens <= threshold) {
    return [stripMime(message)];
  }

  if (isCodeContent(message)) {
    // Strip the code fence once so both the AST path and the fallback
    // line-splitter receive clean code — not the raw ``` delimiters.
    const strippedContent = stripCodeFence(message.content);
    const strippedMessage: OversizeMessageInput = {
      ...message,
      content: strippedContent,
    };
    try {
      return splitByAst(strippedMessage, tokenCounter, threshold);
    } catch {
      // AST parser failure (garbage code, unsupported syntax) — fall
      // through to the line-aware splitter so the message still gets
      // chunked rather than overflowing the embedder.
      return splitByLines(strippedMessage, tokenCounter, threshold);
    }
  }

  return splitByParagraphs(message, tokenCounter, threshold, overlap);
};

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

const CODE_MIME_TYPES = new Set([
  'application/javascript',
  'application/typescript',
  'text/x-javascript',
  'text/x-typescript',
  'text/javascript',
  'text/typescript',
]);

const CODE_FENCE_REGEX = /```(?:js|ts|javascript|typescript)\b/i;

const isCodeContent = (message: OversizeMessageInput): boolean => {
  if (message.mimeType !== undefined && CODE_MIME_TYPES.has(message.mimeType)) {
    return true;
  }
  return message.role === 'tool' && CODE_FENCE_REGEX.test(message.content);
};

const stripMime = (message: OversizeMessageInput): SplitResult => ({
  role: message.role,
  content: message.content,
  ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
});

// ---------------------------------------------------------------------------
// Prose splitter — paragraph boundaries with token overlap
// ---------------------------------------------------------------------------

const splitByParagraphs = (
  message: OversizeMessageInput,
  tokenCounter: TokenCounter,
  threshold: number,
  overlapTokens: number,
): SplitResult[] => {
  // Prefer double-newline boundaries; fall back to single-newline if no
  // double-newlines exist in the content (e.g., a single huge paragraph).
  const segments = message.content.includes('\n\n')
    ? message.content.split(/\n\n+/)
    : message.content.split(/\n/);

  return assembleChunks(message, segments, '\n\n', tokenCounter, threshold, overlapTokens);
};

// ---------------------------------------------------------------------------
// AST splitter — function/class/top-level statement boundaries (JS/TS)
// ---------------------------------------------------------------------------

interface AstSegment {
  readonly start: number;
  readonly end: number;
}

const splitByAst = (
  message: OversizeMessageInput,
  tokenCounter: TokenCounter,
  threshold: number,
): SplitResult[] => {
  // Caller is responsible for stripping code-fence delimiters before
  // invoking splitByAst (done in splitOversizeMessage). message.content
  // here is already bare code.
  const codeText = message.content;

  // Parse as a TS module — most permissive; accepts JS too, plus type
  // annotations. JSX is enabled to avoid choking on common React code.
  const ast = babelParse(codeText, {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    plugins: ['typescript', 'jsx'],
    errorRecovery: false,
  });

  const segments: AstSegment[] = [];
  for (const node of ast.program.body) {
    if (
      typeof node.start === 'number' &&
      typeof node.end === 'number' &&
      node.start >= 0 &&
      node.end > node.start
    ) {
      segments.push({ start: node.start, end: node.end });
    }
  }

  if (segments.length === 0) {
    // Empty top-level body (shouldn't happen for >threshold content but
    // defensive). Fall back to lines.
    return splitByLines(message, tokenCounter, threshold);
  }

  // Carve substrings at AST boundaries; preserve original whitespace
  // between top-level nodes by extending each segment to include the
  // gap up to the next segment's start.
  const sliced: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].start;
    const end = i === segments.length - 1 ? codeText.length : segments[i + 1].start;
    sliced.push(codeText.slice(start, end));
  }
  // Preserve any leading whitespace before the first node by prepending
  // it to the first segment.
  if (segments[0].start > 0) {
    sliced[0] = codeText.slice(0, segments[0].start) + sliced[0];
  }

  return assembleChunks(message, sliced, '', tokenCounter, threshold, 0);
};

// Remove leading/trailing Markdown code-fence lines if present. Single-pass
// regex; idempotent on un-fenced input.
//
// Greedy `([\s\S]*)` matches to the LAST close-fence rather than the first,
// so code containing triple-backticks in strings or comments (e.g.
// `// \`\`\`js`) is captured in full instead of being truncated.
// `^\s*` allows for leading whitespace before the opening fence.
const stripCodeFence = (content: string): string => {
  const fenceMatch = content.match(/^\s*```[a-zA-Z0-9_-]*\n([\s\S]*)\n```\s*$/);
  return fenceMatch ? fenceMatch[1] : content;
};

// ---------------------------------------------------------------------------
// Line-aware fallback — splits at line boundaries when AST fails
// ---------------------------------------------------------------------------

const splitByLines = (
  message: OversizeMessageInput,
  tokenCounter: TokenCounter,
  threshold: number,
): SplitResult[] => {
  const lines = message.content.split(/\n/);
  return assembleChunks(message, lines, '\n', tokenCounter, threshold, 0);
};

// ---------------------------------------------------------------------------
// Greedy chunk assembler
// ---------------------------------------------------------------------------

/**
 * Pack `segments` into chunks under `threshold` tokens each, using
 * `joiner` between segments. Never splits within a segment (Graphiti
 * invariant); a single oversize segment becomes its own chunk regardless
 * of size.
 *
 * `overlapTokens > 0`: for prose, the chunk seam is followed by a small
 * carry-over of trailing characters from the previous chunk so retrieval
 * doesn't miss answers straddling a boundary. Approximated by character
 * slice (overlapTokens × 4 chars).
 */
const assembleChunks = (
  message: OversizeMessageInput,
  segments: readonly string[],
  joiner: string,
  tokenCounter: TokenCounter,
  threshold: number,
  overlapTokens: number,
): SplitResult[] => {
  const chunks: string[] = [];
  let current = '';

  for (const segment of segments) {
    const candidate = current === '' ? segment : current + joiner + segment;
    if (tokenCounter(candidate) > threshold && current !== '') {
      chunks.push(current);
      // Apply prose-style overlap: carry the tail of the just-flushed
      // chunk into the next chunk so context bleeds across the seam.
      // overlapTokens of 0 means clean cut — used for AST + line splits
      // where the segment is itself a logical unit.
      if (overlapTokens > 0) {
        const overlapChars = overlapTokens * 4;
        const tail = current.slice(Math.max(0, current.length - overlapChars));
        current = tail + joiner + segment;
      } else {
        current = segment;
      }
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    chunks.push(current);
  }

  return chunks.map((content) => ({
    role: message.role,
    content,
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  }));
};
