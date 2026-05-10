#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];

const secretAssignmentNamePattern = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'DATABASE_URL',
  'JWT_SECRET',
  'NPM_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'DEPLOYER_PRIVATE_KEY',
  'PASSWORD',
  'PRIVATE_KEY',
  'API_KEY',
  'SECRET',
  'TOKEN',
].join('|');

const pattern = [
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY',
  'ghp_[A-Za-z0-9_]{20,}',
  'sk-[A-Za-z0-9_-]{20,}',
  `(${secretAssignmentNamePattern})[[:space:]]*=[[:space:]]*["'\\]?[A-Za-z0-9_./+=-]{12,}`,
].join('|');

const pathspec = [
  '--',
  '.',
  ':(exclude)package-lock.json',
  ':(exclude)node_modules/**',
  ':(exclude)dist/**',
  ':(exclude)scripts/audit-repository-secrets.mjs',
];

const allowedFalsePositiveSnippets = [
  'sk-ant-example-secret-token-value',
  'sk-ant-api03-real-secret-value',
  'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-preabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-beforeabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-afterabcdefghijklmnopqrstuvwxyz1234567',
  'sk-ant-api03-alphaabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-bravoabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-charlieabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-afterrotateabcdefghijklmnopqrstuvwxyz123456',
  'sk-ant-api03-multirotateabcdefghijklmnopqrstuvwxyz123456',
  'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
  'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  "'-----BEGIN PRIVATE KEY-----'",
  "expect(result.privateKey).toContain('BEGIN PRIVATE KEY')",
  'expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/)',
  'beach-landscape-sea-coast-water-sand-ocean-horizon-cloud-sky-sun-sunrise-sunset-shore',
];

const hasExitStatus = (error) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number';

const runGit = (args, options = {}) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options,
    });
  } catch (error) {
    if (hasExitStatus(error) && error.status === 1) {
      return '';
    }
    throw error;
  }
};

const parseCurrentGrep = (output) => output
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [path, lineNumber, ...contextParts] = line.split(':');
    return {
      commit: 'WORKTREE',
      path,
      line: lineNumber,
      context: contextParts.join(':').trim(),
    };
  });

const parseHistoryGrep = (output) => output
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const firstColon = line.indexOf(':');
    const commit = line.slice(0, firstColon);
    const rest = line.slice(firstColon + 1);
    const [path, lineNumber, ...contextParts] = rest.split(':');
    return {
      commit,
      path,
      line: lineNumber,
      context: contextParts.join(':').trim(),
    };
  });

const isAllowed = (finding) =>
  allowedFalsePositiveSnippets.some((snippet) => finding.context.includes(snippet));

const currentOutput = runGit(['grep', '-I', '-n', '-E', pattern, ...pathspec]);
const currentFindings = parseCurrentGrep(currentOutput).map((finding) => ({
  ...finding,
  allowed: isAllowed(finding),
}));

const commits = runGit(['rev-list', '--all']).split('\n').filter(Boolean);
const historyFindings = [];
const batchSize = 100;
for (let index = 0; index < commits.length; index += batchSize) {
  const batch = commits.slice(index, index + batchSize);
  const output = runGit(['grep', '-I', '-n', '-E', pattern, ...batch, ...pathspec]);
  historyFindings.push(...parseHistoryGrep(output).map((finding) => ({
    ...finding,
    allowed: isAllowed(finding),
  })));
}

const uniqueHistoryFindings = new Map();
for (const finding of historyFindings) {
  const key = `${finding.path}:${finding.line}:${finding.context}`;
  uniqueHistoryFindings.set(key, finding);
}

const unresolvedFindings = [...currentFindings, ...uniqueHistoryFindings.values()].filter((finding) => !finding.allowed);

const renderFindings = (findings) => {
  if (findings.length === 0) {
    return '- None';
  }
  return findings
    .slice(0, 200)
    .map((finding) =>
      `- ${finding.allowed ? 'False positive' : 'Unresolved'} | ${finding.commit.slice(0, 12)} | ${finding.path}:${finding.line} | ${finding.context.slice(0, 200)}`,
    )
    .join('\n');
};

const report = `# Repository Secret Audit — Sprint 025\n\n` +
  `**Commit scanned:** ${runGit(['rev-parse', 'HEAD']).trim()}\n` +
  `**Reachable commits scanned:** ${commits.length}\n` +
  `**Current findings:** ${currentFindings.length}\n` +
  `**History findings:** ${uniqueHistoryFindings.size}\n` +
  `**Unresolved findings:** ${unresolvedFindings.length}\n\n` +
  `## Commands\n\n` +
  `- \`node scripts/audit-repository-secrets.mjs --output docs/security-audits/2026-05-10-sprint-025-history-audit.md\`\n\n` +
  `## Current tree findings\n\n${renderFindings(currentFindings)}\n\n` +
  `## Reachable history findings\n\n${renderFindings([...uniqueHistoryFindings.values()])}\n\n` +
  `## Remediation status\n\n` +
  (unresolvedFindings.length === 0
    ? '- No unresolved secret findings. Findings above, if any, are documented placeholders or synthetic examples, not credentials.\n'
    : '- Public release remains blocked until unresolved findings are remediated or Lou records an accepted resolution.\n');

if (outputPath) {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, report);
}

console.log(report);
if (unresolvedFindings.length > 0) {
  process.exitCode = 1;
}
