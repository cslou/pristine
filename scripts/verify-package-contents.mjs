#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REQUIRED_PATHS = new Set([
  'package.json',
  'README.md',
  'LICENSE',
  'dist/index.js',
  'dist/index.d.ts',
]);

const FORBIDDEN_PREFIXES = [
  'dist/conversations/',
  'dist/engine/',
  'dist/models/',
  'dist/memory/indexer/',
  'dist/memory/searcher/',
  'dist/queue/',
  'dist/privacy/classifier/llm/',
  'dist/privacy/classifier/combined/',
];

const readPackJson = () => {
  const packJsonFlagIndex = process.argv.indexOf('--pack-json');
  if (packJsonFlagIndex !== -1) {
    const filePath = process.argv[packJsonFlagIndex + 1];
    if (!filePath) {
      throw new Error('--pack-json requires a file path');
    }
    return readFileSync(filePath, 'utf8');
  }

  return execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
};

const parsePackEntries = (rawJson) => {
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Expected npm pack --dry-run --json to return a one-item array');
  }

  const [entry] = parsed;
  if (!entry || !Array.isArray(entry.files)) {
    throw new Error('Expected npm pack output to include a files array');
  }

  return entry.files.map((file) => {
    if (!file || typeof file.path !== 'string') {
      throw new Error('Expected every packed file entry to include a string path');
    }
    return file.path;
  });
};

const paths = parsePackEntries(readPackJson());
const pathSet = new Set(paths);

const missingRequired = [...REQUIRED_PATHS].filter((path) => !pathSet.has(path));
if (missingRequired.length > 0) {
  throw new Error(`Package is missing required files: ${missingRequired.join(', ')}`);
}

const forbiddenPacked = paths.filter((path) =>
  FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)),
);
if (forbiddenPacked.length > 0) {
  throw new Error(`Package includes forbidden stale files: ${forbiddenPacked.join(', ')}`);
}

console.log(`package contents verified: ${paths.length} files`);
