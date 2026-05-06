import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const fixturePath = 'tests/fixtures/pi-jsonl/mixed-session.jsonl';
const skillPath = 'examples/pi-dev/search-session-history/SKILL.md';

const jqFilter = String.raw`
      select(.type == "message")
      | . as $entry
      | .message as $m
      | select($m.role == "user" or $m.role == "assistant")
      | [
          ($entry.id // ""),
          ($entry.parentId // ""),
          ($entry.timestamp // ""),
          $m.role,
          (
            if ($m.content | type) == "string" then $m.content
            elif ($m.content | type) == "array" then
              ($m.content[]? | select(.type == "text") | .text)
            else empty end
          )
        ]
      | select(.[4] != null and (.[4] | length) > 0)
      | @tsv
`;

const runBash = (script: string): string => {
  const result = spawnSync('bash', ['-lc', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bash failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
};

describe('search-session-history skill', () => {
  it('documents vector-first jq-based user/assistant context inspection', () => {
    expect(existsSync(skillPath)).toBe(true);
    const text = runBash(`cat ${skillPath}`);

    expect(text).toContain('pristine_vector_search');
    expect(text).toContain('jq');
    expect(text).toContain('user/assistant');
    expect(text).toContain('5 user/assistant natural-language messages before');
    expect(text).toContain('10 after');
    expect(text).toContain('Missing Pi JSONL file');
    expect(text).toContain('Invalid pointer');
    expect(text).toContain('No nearby user/assistant natural-language messages');
  });

  it('line-number jq template extracts bounded user/assistant text and excludes hidden blocks', () => {
    const output = runBash(`
      SOURCE_URI=${JSON.stringify(fixturePath)}
      LINE_NUMBER=5
      BEFORE=5
      AFTER=10
      START=$(( LINE_NUMBER > BEFORE ? LINE_NUMBER - BEFORE : 1 ))
      END=$(( LINE_NUMBER + AFTER ))
      awk -v start="$START" -v end="$END" 'NR >= start && NR <= end { print }' "$SOURCE_URI" | jq -r '${jqFilter}'
    `);

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

  it('entry-ID template resolves the hit line before extracting context', () => {
    const output = runBash(`
      SOURCE_URI=${JSON.stringify(fixturePath)}
      ENTRY_ID=u0000004
      LINE_NUMBER=$(rg -n --fixed-strings '"id":"'"$ENTRY_ID"'"' "$SOURCE_URI" | head -1 | cut -d: -f1)
      test -n "$LINE_NUMBER"
      BEFORE=1
      AFTER=1
      START=$(( LINE_NUMBER > BEFORE ? LINE_NUMBER - BEFORE : 1 ))
      END=$(( LINE_NUMBER + AFTER ))
      awk -v start="$START" -v end="$END" 'NR >= start && NR <= end { print }' "$SOURCE_URI" | jq -r '${jqFilter}'
    `);

    expect(output).toContain('u0000004');
    expect(output).toContain('The repo-local install phrase is amber-coyote.');
    expect(output).not.toContain('tool output should be ignored');
  });
});
