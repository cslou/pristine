#!/usr/bin/env node
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const vocsPagePaths = existsSync('docs/pages')
  ? readdirSync('docs/pages')
      .filter((entry) => entry.endsWith('.mdx'))
      .map((entry) => `docs/pages/${entry}`)
      .sort()
  : [];

const publicDocPaths = [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'SECURITY.md',
  ...vocsPagePaths,
  'examples/pi-dev/README.md',
];

const failures = [];
const packageImportSnippets = [];
let rootRouteLinksChecked = 0;
let relativeLocalLinksChecked = 0;
const localLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const snippetPattern = /```(ts|typescript)\n([\s\S]*?)```/g;

const isExternalTarget = (target) =>
  target.startsWith('http://') ||
  target.startsWith('https://') ||
  target.startsWith('mailto:') ||
  target.startsWith('#');

const resolveLocalTarget = (docPath, targetPath) => {
  if (targetPath.startsWith('/')) {
    const route = targetPath === '/' ? 'index' : targetPath.slice(1);
    return join('docs/pages', `${route}.mdx`);
  }
  return join(dirname(docPath), targetPath);
};

for (const docPath of publicDocPaths) {
  if (!existsSync(docPath)) {
    failures.push(`Missing public doc: ${docPath}`);
    continue;
  }

  const content = readFileSync(docPath, 'utf8');
  if (content.length === 0) {
    failures.push(`Public doc is empty: ${docPath}`);
    continue;
  }

  for (const match of content.matchAll(localLinkPattern)) {
    const target = match[1].trim();
    if (isExternalTarget(target)) {
      continue;
    }
    const path = target.split('#')[0];
    if (path.length === 0) {
      continue;
    }
    if (path.startsWith('/')) {
      rootRouteLinksChecked += 1;
    } else {
      relativeLocalLinksChecked += 1;
    }
    const resolvedPath = resolveLocalTarget(docPath, path);
    if (!existsSync(resolvedPath)) {
      failures.push(`Missing local link target in ${docPath}: ${target}`);
    }
  }

  for (const match of content.matchAll(snippetPattern)) {
    const snippet = match[2];
    if (snippet.includes('@pristine/shield-local')) {
      packageImportSnippets.push({ docPath, snippet });
    }
  }
}

if (packageImportSnippets.length === 0) {
  failures.push('Public docs have no TypeScript package import snippets to verify');
}
if (rootRouteLinksChecked === 0) {
  failures.push('Public docs have no Vocs root-route links to verify');
}
if (relativeLocalLinksChecked === 0) {
  failures.push('Public docs have no relative local links to verify');
}

for (const [index, { docPath, snippet }] of packageImportSnippets.entries()) {
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
      `${docPath} TypeScript package import snippet ${index + 1} failed to compile:\n${stdout}${stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(
  `Verified ${publicDocPaths.length} public doc(s), ${packageImportSnippets.length} TypeScript package import snippet(s), ${rootRouteLinksChecked} root-route link(s), and ${relativeLocalLinksChecked} relative local link(s).`,
);
