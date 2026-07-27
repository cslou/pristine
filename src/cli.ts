#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Pristine } from './client.js';
import type { SourceChunkInput } from './core/types.js';

type Agent = 'claude' | 'codex';
interface Parsed {
  cwd: string;
  chunk: SourceChunkInput;
}

const textOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const text = value
    .filter((x): x is { type?: string; text?: string } => typeof x === 'object' && x !== null)
    .filter((x) => x.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text)
    .join('\n')
    .trim();
  return text || null;
};

const filesUnder = async (root: string): Promise<string[]> => {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? filesUnder(join(root, entry.name))
        : entry.isFile() && entry.name.endsWith('.jsonl')
          ? [join(root, entry.name)]
          : [],
    ),
  );
  return nested.flat();
};

const parse = (agent: Agent, file: string, content: string): Parsed[] => {
  const codexCwd =
    agent === 'codex'
      ? content.split('\n').flatMap((line) => {
          try {
            const row = JSON.parse(line) as { type?: string; payload?: { cwd?: unknown } };
            return row.type === 'session_meta' && typeof row.payload?.cwd === 'string'
              ? [row.payload.cwd]
              : [];
          } catch {
            return [];
          }
        })[0]
      : undefined;
  return content.split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    const row = JSON.parse(line) as Record<string, unknown>;
    if (agent === 'claude') {
      if (
        (row.type !== 'user' && row.type !== 'assistant') ||
        row.isMeta === true ||
        typeof row.cwd !== 'string'
      )
        return [];
      const message = row.message as Record<string, unknown> | undefined;
      const text = textOf(message?.content);
      const id = typeof row.uuid === 'string' ? row.uuid : null;
      if (!text || !id) return [];
      return [
        {
          cwd: row.cwd,
          chunk: {
            chunkId: `claude:${row.sessionId ?? file}:${id}`,
            text,
            sourceKind: 'claude-session',
            sourceUri: file,
            entryId: id,
            lineNumber: index + 1,
            timestamp: typeof row.timestamp === 'string' ? row.timestamp : undefined,
          },
        },
      ];
    }
    const payload = row.payload as Record<string, unknown> | undefined;
    if (
      row.type !== 'response_item' ||
      payload?.type !== 'message' ||
      (payload.role !== 'user' && payload.role !== 'assistant')
    )
      return [];
    const text = textOf(payload.content);
    const id = typeof payload.id === 'string' ? payload.id : `${index + 1}`;
    const cwd = typeof row.cwd === 'string' ? row.cwd : codexCwd;
    if (!text || !cwd) return [];
    return [
      {
        cwd,
        chunk: {
          chunkId: `codex:${file}:${id}`,
          text,
          sourceKind: 'codex-session',
          sourceUri: file,
          entryId: id,
          lineNumber: index + 1,
          timestamp: typeof row.timestamp === 'string' ? row.timestamp : undefined,
        },
      },
    ];
  });
};

const repoInfo = (): { root: string; projectId: string } => {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  let projectId = `local:${root}`;
  try {
    projectId = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
    })
      .trim()
      .replace(/^git@/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\.git$/, '')
      .replace(':', '/');
  } catch {
    /* local fallback */
  }
  return { root, projectId };
};
const within = (path: string, root: string): boolean => {
  const r = relative(resolve(root), resolve(path));
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..');
};

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};

const positiveIntegerOption = (args: readonly string[], name: string, fallback: number): number => {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

const emit = (value: unknown, json: boolean, message: string): void => {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`);
};

const usage = `Usage:
  pristine backfill <claude|codex> [--dry-run] [--project ID] [--json]
  pristine recall <query> [--limit N] [--project ID] [--json]
  pristine remember <text> [--kind KIND] [--source URI] [--project ID] [--json]
  pristine forget <chunk-id>... [--project ID] [--json]
  pristine status [--project ID] [--json]`;

async function main(): Promise<void> {
  const [command, subject, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const json = process.argv.includes('--json');
  const repo = repoInfo();
  const allArgs = process.argv.slice(2);
  const projectId = option(allArgs, '--project') ?? repo.projectId;

  if (command === 'recall') {
    if (!subject || subject.startsWith('--')) throw new Error(`recall requires a query\n${usage}`);
    const pristine = await Pristine.create();
    try {
      const results = await pristine.recall(subject, {
        projectId,
        limit: positiveIntegerOption(allArgs, '--limit', 10),
      });
      emit(
        { projectId, results },
        json,
        results.length === 0
          ? 'No memories found.'
          : results
              .map(
                (result) =>
                  `${result.chunkId}\t${result.score.toFixed(4)}\t${result.text}\n  ${result.sourceUri ?? '(no source)'}`,
              )
              .join('\n'),
      );
    } finally {
      await pristine.dispose();
    }
    return;
  }

  if (command === 'remember') {
    if (!subject || subject.startsWith('--')) throw new Error(`remember requires text\n${usage}`);
    const pristine = await Pristine.create();
    try {
      const sourceUri = option(allArgs, '--source');
      const kind = option(allArgs, '--kind') ?? 'memory';
      const [stored] = await pristine.store(
        [{ text: subject, sourceKind: kind, sourceUri, metadata: { kind } }],
        { projectId },
      );
      emit(stored, json, `Remembered ${stored!.chunkId}.`);
    } finally {
      await pristine.dispose();
    }
    return;
  }

  if (command === 'forget') {
    const ids = [subject, ...args].filter(
      (value): value is string => value !== undefined && !value.startsWith('--'),
    );
    const optionValues = new Set(
      ['--project'].flatMap((name) => {
        const value = option(allArgs, name);
        return value ? [value] : [];
      }),
    );
    const chunkIds = ids.filter((id) => !optionValues.has(id));
    if (chunkIds.length === 0) throw new Error(`forget requires at least one chunk ID\n${usage}`);
    const pristine = await Pristine.create();
    try {
      const result = pristine.forget(chunkIds, { projectId });
      emit(result, json, `Forgot ${result.deletedCount} memories.`);
    } finally {
      await pristine.dispose();
    }
    return;
  }

  if (command === 'status') {
    const pristine = await Pristine.create();
    try {
      const status = pristine.status(projectId);
      emit(status, json, `${status.storedCount} memories in ${projectId}.`);
    } finally {
      await pristine.dispose();
    }
    return;
  }

  if (command !== 'backfill' || (subject !== 'claude' && subject !== 'codex'))
    throw new Error(usage);
  const source = subject;
  const dryRun = args.includes('--dry-run');
  const root =
    source === 'claude' ? join(homedir(), '.claude', 'projects') : join(homedir(), '.codex');
  const files = await filesUnder(root);
  process.stderr.write(`Scanning ${files.length} ${source} session files…\n`);
  let matched = 0;
  let accepted = 0;
  let failures = 0;
  const pristine = dryRun ? null : await Pristine.create();
  for (const [index, file] of files.entries())
    try {
      const records = parse(source, file, await readFile(file, 'utf8')).filter((item) =>
        within(item.cwd, repo.root),
      );
      if (records.length) {
        matched++;
        accepted += records.length;
        if (pristine)
          await pristine.store(
            records.map((r) => r.chunk),
            { projectId },
          );
        process.stderr.write(
          `[${index + 1}/${files.length}] matched ${records.length} messages · ${file}\n`,
        );
      } else if ((index + 1) % 50 === 0 || index + 1 === files.length) {
        process.stderr.write(
          `[${index + 1}/${files.length}] ${matched} matching sessions, ${accepted} messages\n`,
        );
      }
    } catch (error) {
      failures++;
      process.stderr.write(`${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  await pristine?.dispose();
  emit(
    { projectId, source, dryRun, matchedFiles: matched, acceptedMessages: accepted, failures },
    json,
    `${dryRun ? 'Would index' : 'Indexed'} ${accepted} messages from ${matched} ${source} session files into ${projectId}.`,
  );
  if (failures) process.exitCode = 1;
}
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
