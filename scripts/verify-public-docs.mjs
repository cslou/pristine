#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const readmePath = 'README.md';
const readme = execFileSync('git', ['show', `HEAD:${readmePath}`], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const workingReadme = await import('node:fs').then(({ readFileSync }) => readFileSync(readmePath, 'utf8'));
const content = workingReadme || readme;

const failures = [];

const localLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const match of content.matchAll(localLinkPattern)) {
  const target = match[1].trim();
  if (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('#')
  ) {
    continue;
  }
  const path = target.split('#')[0];
  if (path.length > 0 && !existsSync(path)) {
    failures.push(`Missing README local link target: ${target}`);
  }
}

const snippetPattern = /```(ts|typescript)\n([\s\S]*?)```/g;
const importSnippets = [...content.matchAll(snippetPattern)]
  .map((match) => match[2])
  .filter((snippet) => snippet.includes("@pristine/shield-local"));

if (importSnippets.length === 0) {
  failures.push('README has no TypeScript package import snippets to verify');
}

for (const [index, snippet] of importSnippets.entries()) {
  const dir = mkdtempSync('.tmp-pristine-docs-');
  const file = join(dir, `snippet-${index}.mts`);
  writeFileSync(file, snippet);
  try {
    execFileSync(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--skipLibCheck',
        file,
      ],
      { stdio: 'pipe' },
    );
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';
    failures.push(
      `README TypeScript import snippet ${index + 1} failed to compile:\n${stdout}${stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(`Verified ${importSnippets.length} README TypeScript package import snippet(s) and local links.`);
