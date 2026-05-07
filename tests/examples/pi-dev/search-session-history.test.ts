import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixturePath = 'tests/fixtures/pi-jsonl/mixed-session.jsonl';
const skillPath = 'examples/pi-dev/search-session-history/SKILL.md';

const visibleContextJq = String.raw`
  def text_blocks($m):
    if ($m.content | type) == "string" then [$m.content]
    elif ($m.content | type) == "array" then
      [$m.content[]? | select(.type == "text") | .text]
    else [] end;

  [
    split("\n")
    | to_entries[]
    | select(.value | length > 0)
    | { lineNumber: (.key + 1), parsed: (.value | fromjson?) }
    | select(.parsed.type == "message")
    | .parsed as $entry
    | $entry.message as $m
    | select($m.role == "user" or $m.role == "assistant")
    | (text_blocks($m) | join("\n")) as $text
    | select(($text | length) > 0)
    | {
        lineNumber,
        entryId: ($entry.id // ""),
        parentId: ($entry.parentId // ""),
        timestamp: ($entry.timestamp // ""),
        role: $m.role,
        text: $text
      }
  ] as $msgs
  | (
      $msgs
      | map(
          (if ($lineNumber // 0) > 0 then .lineNumber == $lineNumber else false end)
          or (if ($entryId // "") != "" then .entryId == $entryId else false end)
        )
      | index(true)
    ) as $idx
  | if $idx == null then empty
    else $msgs[([0, ($idx - $before)] | max):($idx + $after + 1)][]
    | [.lineNumber, .entryId, .parentId, .timestamp, .role, .text]
    | @tsv
    end
`;

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'pristine-session-history-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

const runBash = (script: string): string => {
  const result = spawnSync('bash', ['-lc', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bash failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
};

const visibleContextCommand = (params: {
  readonly sourceUri: string;
  readonly lineNumber?: number;
  readonly entryId?: string;
  readonly before: number;
  readonly after: number;
}): string => `
  jq -R -s -r \
    --argjson lineNumber ${params.lineNumber ?? 0} \
    --arg entryId ${JSON.stringify(params.entryId ?? '')} \
    --argjson before ${params.before} \
    --argjson after ${params.after} \
    '${visibleContextJq}' \
    ${JSON.stringify(params.sourceUri)}
`;

describe('search-session-history skill', () => {
  it('documents vector-first jq-based user/assistant context inspection', () => {
    expect(existsSync(skillPath)).toBe(true);
    const text = runBash(`cat ${skillPath}`);

    expect(text).toContain('allowed-tools: pristine_vector_search bash read');
    expect(text).toContain('pristine_vector_search');
    expect(text).toContain('Pointer-known mode');
    expect(text).toContain('Do not search globally');
    expect(text).toContain('Inspect only `sourcePointer.sourceUri`');
    expect(text).toContain('Global grep fallback');
    expect(text).toContain('Use `rg` only inside `$SOURCE_URI`');
    expect(text).toContain('jq');
    expect(text).toContain('user/assistant');
    expect(text).toContain('5 user/assistant natural-language messages before');
    expect(text).toContain('10 after');
    expect(text).toContain('Missing Pi JSONL file');
    expect(text).toContain('Invalid pointer');
    expect(text).toContain('No nearby user/assistant natural-language messages');
  });

  it('line-number jq template extracts bounded user/assistant text and excludes hidden blocks', () => {
    const output = runBash(
      visibleContextCommand({ sourceUri: fixturePath, lineNumber: 5, before: 5, after: 10 }),
    );

    expect(output).toContain('u0000001');
    expect(output).toContain('Please remember the sapphire migration note.');
    expect(output).toContain('a0000002');
    expect(output).toContain('Noted: sapphire migration note is important.');
    expect(output).toContain('u0000004');
    expect(output).toContain('The repo-local install phrase is amber-coyote.');
    expect(output).not.toContain('tool output should be ignored');
    expect(output).not.toContain('thinking-only assistant should be ignored');
    expect(output).not.toContain('custom message should be ignored');
    expect(output).not.toContain('abc123');
  });

  it('entry-ID template resolves context from the visible message stream', () => {
    const output = runBash(`
      SOURCE_URI=${JSON.stringify(fixturePath)}
      ENTRY_ID=u0000004
      rg -q --fixed-strings '"id":"'"$ENTRY_ID"'"' "$SOURCE_URI"
      ${visibleContextCommand({ sourceUri: fixturePath, entryId: 'u0000004', before: 1, after: 1 })}
    `);

    expect(output).toContain('u0000004');
    expect(output).toContain('The repo-local install phrase is amber-coyote.');
    expect(output).not.toContain('tool output should be ignored');
  });

  it('counts multi-text-block entries as one visible message', async () => {
    const dir = await makeTempDir();
    const fixture = join(dir, 'multi-block.jsonl');
    const lines = [
      { type: 'message', id: 'before', message: { role: 'user', content: 'Before.' } },
      {
        type: 'message',
        id: 'hit',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hit first block.' },
            { type: 'text', text: 'Hit second block.' },
          ],
        },
      },
      { type: 'message', id: 'after', message: { role: 'user', content: 'After.' } },
    ];
    await writeFile(fixture, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    const output = runBash(
      visibleContextCommand({ sourceUri: fixture, entryId: 'hit', before: 0, after: 0 }),
    );

    expect(output.trim().split('\n')).toHaveLength(1);
    expect(output).toContain('Hit first block.');
    expect(output).toContain('Hit second block.');
    expect(output).not.toContain('before');
    expect(output).not.toContain('after');
  });

  it('selects 5/10 context by visible messages, not raw JSONL lines', async () => {
    const dir = await makeTempDir();
    const fixture = join(dir, 'dense-tools.jsonl');
    const lines = [
      {
        type: 'message',
        id: 'before-visible',
        message: { role: 'user', content: 'Visible before hit.' },
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        type: 'message',
        id: `tool-${index}`,
        message: { role: 'toolResult', content: [{ type: 'text', text: `tool ${index}` }] },
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        type: 'custom_message',
        id: `custom-${index}`,
        customType: 'hidden-context',
        content: `custom ${index}`,
        display: false,
      })),
      { type: 'message', id: 'hit-visible', message: { role: 'user', content: 'Visible hit.' } },
      {
        type: 'message',
        id: 'after-visible',
        message: { role: 'assistant', content: 'Visible after hit.' },
      },
    ];
    await writeFile(fixture, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    const output = runBash(
      visibleContextCommand({ sourceUri: fixture, entryId: 'hit-visible', before: 5, after: 10 }),
    );

    expect(output).toContain('before-visible');
    expect(output).toContain('Visible before hit.');
    expect(output).toContain('hit-visible');
    expect(output).toContain('after-visible');
    expect(output).not.toContain('tool 0');
    expect(output).not.toContain('tool-4');
    expect(output).not.toContain('custom 0');
    expect(output).not.toContain('custom-4');
  });
});
