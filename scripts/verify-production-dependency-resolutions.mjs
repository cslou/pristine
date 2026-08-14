#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXPECTED_VERSIONS = {
  'adm-zip': '0.6.0',
  protobufjs: '7.6.5',
  sharp: '0.35.3',
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const workspaceConfig = readFileSync('pnpm-workspace.yaml', 'utf8');
const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

if (Object.hasOwn(packageJson, 'overrides')) {
  throw new Error('Dependency overrides must be defined at the pnpm workspace root');
}

const listedGraph = JSON.parse(
  execFileSync(
    'pnpm',
    ['list', ...Object.keys(EXPECTED_VERSIONS), '--prod', '--depth', 'Infinity', '--json'],
    { encoding: 'utf8' },
  ),
);

const installedVersions = new Map(
  Object.keys(EXPECTED_VERSIONS).map((dependency) => [dependency, new Set()]),
);

const visit = (value) => {
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value)) {
    if (
      installedVersions.has(key) &&
      nested !== null &&
      typeof nested === 'object' &&
      typeof nested.version === 'string'
    ) {
      installedVersions.get(key).add(nested.version);
    }
    visit(nested);
  }
};

visit(listedGraph);

for (const [dependency, expectedVersion] of Object.entries(EXPECTED_VERSIONS)) {
  const escapedDependency = escapeRegExp(dependency);
  const escapedVersion = escapeRegExp(expectedVersion);
  const workspaceOverride = new RegExp(`^  ${escapedDependency}: ${escapedVersion}$`, 'm');
  if (!workspaceOverride.test(workspaceConfig)) {
    throw new Error(`Missing exact workspace override ${dependency}@${expectedVersion}`);
  }

  const lockedVersions = new Set(
    [...lockfile.matchAll(new RegExp(`^  ${escapedDependency}@([^:\\s(]+)`, 'gm'))].map(
      (match) => match[1],
    ),
  );
  if (lockedVersions.size !== 1 || !lockedVersions.has(expectedVersion)) {
    throw new Error(
      `Lockfile resolves ${dependency} to [${[...lockedVersions].join(', ')}], expected only ${expectedVersion}`,
    );
  }

  const resolvedVersions = installedVersions.get(dependency);
  if (resolvedVersions.size !== 1 || !resolvedVersions.has(expectedVersion)) {
    throw new Error(
      `Installed production graph resolves ${dependency} to [${[...resolvedVersions].join(', ')}], expected only ${expectedVersion}`,
    );
  }
}

process.stdout.write(
  `production dependency resolutions verified: ${Object.entries(EXPECTED_VERSIONS)
    .map(([dependency, version]) => `${dependency}@${version}`)
    .join(', ')}\n`,
);
