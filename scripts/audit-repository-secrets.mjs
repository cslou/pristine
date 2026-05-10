#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, normalize } from 'node:path';

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
if (outputIndex !== -1 && (outputPath === undefined || outputPath.startsWith('-'))) {
  throw new Error('--output requires a repo-relative markdown path under docs/security-audits/');
}

const normalizeOutputPath = (path) => normalize(path).replace(/^\.\//, '');
const containsPathspecMeta = (path) => /[\[\]{}*?]/.test(path) || path.includes('..') || path.startsWith(':');

const normalizedOutputPath = outputPath === undefined ? undefined : normalizeOutputPath(outputPath);
if (normalizedOutputPath !== undefined) {
  if (
    containsPathspecMeta(normalizedOutputPath) ||
    !normalizedOutputPath.startsWith('docs/security-audits/') ||
    !normalizedOutputPath.endsWith('.md')
  ) {
    throw new Error('--output must be an exact repo-relative markdown path under docs/security-audits/');
  }
}

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

const secretAssignmentValuePattern = '"[^"]{12,}"|\'[^\']{12,}\'|[^[:space:]]{12,}';

const grepPattern = [
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY',
  'ghp_[A-Za-z0-9_]{20,}',
  'sk-[A-Za-z0-9_-]{20,}',
  `(${secretAssignmentNamePattern})[[:space:]]*=[[:space:]]*(${secretAssignmentValuePattern})`,
].join('|');

const jsPatterns = [
  { name: 'private-key-header', pattern: /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/g },
  { name: 'github-token', pattern: /ghp_[A-Za-z0-9_]{20,}/g },
  { name: 'openai-style-token', pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  {
    name: 'secret-env-assignment',
    pattern: new RegExp(
      `(?:${secretAssignmentNamePattern})\\s*=\\s*(?:"[^"]{12,}"|'[^']{12,}'|\\S{12,})`,
      'g',
    ),
  },
];

const basePathspec = [
  '--',
  '.',
  ':(exclude)package-lock.json',
  ':(exclude)node_modules/**',
  ':(exclude)scripts/audit-repository-secrets.mjs',
];
const historyPathspec = [...basePathspec];
const currentPathspec = [...basePathspec];
if (normalizedOutputPath !== undefined) {
  currentPathspec.push(`:(exclude)${normalizedOutputPath}`);
}

const allowedFalsePositiveEntries = [
  {
    match: 'sk-ant-example-secret-token-value',
    rationale: 'historical README synthetic token placeholder',
  },
  {
    match: 'sk-ant-api03-real-secret-value',
    rationale: 'implementation spec synthetic example explicitly using example.com',
  },
  {
    match: 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
    rationale: 'deterministic classifier synthetic GitHub token fixture',
  },
  {
    match: 'ANTHROPIC_API_KEY=sk-ant-...',
    rationale: 'documentation placeholder showing environment-variable usage, not a credential',
  },
  {
    match: 'API_KEY=sk-ant-...',
    rationale: 'documentation placeholder showing environment-variable usage, not a credential',
  },
  {
    match: 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    rationale: 'synthetic deterministic safety-scan fixture value',
  },
  {
    match: 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.',
    rationale: 'synthetic deterministic safety-scan fixture value with sentence punctuation',
  },
  {
    match: 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456',
    pathPrefix: 'docs/security-audits/',
    rationale: 'historical audit report line containing a truncated deterministic safety-scan fixture value',
  },
  {
    match: 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef012',
    pathPrefix: 'docs/security-audits/',
    rationale: 'historical audit report line containing a truncated deterministic safety-scan fixture value',
  },
  {
    match: 'BEGIN PRIVATE KEY',
    pathPrefix: 'tests/',
    rationale: 'unit test asserts generated PEM/header detection with ephemeral synthetic keys',
  },
  {
    match: 'BEGIN PRIVATE KEY',
    pathPrefix: 'docs/security-audits/',
    rationale: 'historical audit report line documenting a synthetic private-key header false positive',
  },
  {
    match: 'sk-sun-sunrise-sunset-shore-wave-dawn-dusk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-',
    pathPrefix: 'benchmarks/memorybench/data/benchmarks/locomo/',
    rationale: 'URL text false-positive from benchmark fixture, not a credential',
  },
  {
    match: 'sk-sun-sunrise-sunset-shore-wave-dawn-dusk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-',
    pathPrefix: 'docs/security-audits/',
    rationale: 'historical audit report line documenting a benchmark URL text false positive',
  },
  {
    match: 'sk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-clouds-afterglow-sunset-beach-gulf-of-mexico-wind-wave-515918',
    pathPrefix: 'benchmarks/memorybench/data/benchmarks/locomo/',
    rationale: 'URL slug false-positive from benchmark fixture, not a credential',
  },
  {
    match: 'sk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-clouds-afterglow-sunset-beach-gulf-of-mexico-wind-wave-515918',
    pathPrefix: 'docs/security-audits/',
    rationale: 'historical audit report line documenting a benchmark URL slug false positive',
  },
  {
    match: 'sk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-',
    pathPrefix: 'docs/security-audits/',
    rationale: 'historical audit report line documenting a truncated benchmark URL slug false positive',
  },
];

const syntheticTokenPrefixes = [
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

const expandMatchedFindings = (finding) => {
  const matchedFindings = [];
  for (const check of jsPatterns) {
    check.pattern.lastIndex = 0;
    for (const match of finding.context.matchAll(check.pattern)) {
      matchedFindings.push({
        ...finding,
        check: check.name,
        matchedText: match[0],
      });
    }
  }
  return matchedFindings;
};

const normalizeAllowedCandidate = (text) =>
  text.replace(/^[`'\"]+/, '').replace(/[)`'\",;]+$/g, '');

const allowedEntryFor = (finding) => {
  const normalizedMatchedText = normalizeAllowedCandidate(finding.matchedText);
  const explicitEntry = allowedFalsePositiveEntries.find((entry) =>
    normalizedMatchedText === entry.match &&
    (entry.pathPrefix === undefined || finding.path.startsWith(entry.pathPrefix)),
  );
  if (explicitEntry !== undefined) {
    return explicitEntry;
  }

  if (syntheticTokenPrefixes.includes(normalizedMatchedText)) {
    return {
      match: normalizedMatchedText,
      rationale: 'exact synthetic sk-ant fixture used by privacy redaction tests',
    };
  }

  return undefined;
};

const classifyFindings = (grepFindings) => grepFindings.flatMap(expandMatchedFindings).map((finding) => {
  const allowedEntry = allowedEntryFor(finding);
  return {
    ...finding,
    allowed: allowedEntry !== undefined,
    rationale: allowedEntry?.rationale,
  };
});

const currentOutput = runGit(['grep', '-I', '-n', '-E', grepPattern, ...currentPathspec]);
const currentFindings = classifyFindings(parseCurrentGrep(currentOutput));

const commits = runGit(['rev-list', '--all']).split('\n').filter(Boolean);
const historyFindings = [];
const batchSize = 100;
for (let index = 0; index < commits.length; index += batchSize) {
  const batch = commits.slice(index, index + batchSize);
  const output = runGit(['grep', '-I', '-n', '-E', grepPattern, ...batch, ...historyPathspec]);
  historyFindings.push(
    ...classifyFindings(parseHistoryGrep(output)).filter(
      (finding) =>
        !(finding.path.startsWith('docs/security-audits/') &&
          finding.context.includes('False positive |')),
    ),
  );
}

const uniqueHistoryFindings = new Map();
for (const finding of historyFindings) {
  const key = `${finding.path}:${finding.line}:${finding.matchedText}:${finding.context}`;
  uniqueHistoryFindings.set(key, finding);
}

const unresolvedFindings = [...currentFindings, ...uniqueHistoryFindings.values()].filter((finding) => !finding.allowed);

const renderFindings = (findings) => {
  if (findings.length === 0) {
    return '- None';
  }
  return [...findings]
    .sort((left, right) => Number(left.allowed) - Number(right.allowed))
    .slice(0, 200)
    .map((finding) => {
      if (!finding.allowed) {
        return `- Unresolved | ${finding.commit.slice(0, 12)} | ${finding.path}:${finding.line} | ${finding.check} | <redacted> | requires remediation | context redacted`;
      }
      return `- False positive | ${finding.commit.slice(0, 12)} | ${finding.path}:${finding.line} | ${finding.check} | ${finding.matchedText} | ${finding.rationale ?? 'documented false positive'} | ${finding.context.slice(0, 200)}`;
    })
    .join('\n');
};

const report = `# Repository Secret Audit — Sprint 025\n\n` +
  `**Scan target:** working tree at generation time, including uncommitted audit-script/report changes committed with this report\n` +
  `**History base before report commit:** ${runGit(['rev-parse', 'HEAD']).trim()}\n` +
  `**Reachable commits scanned before report commit:** ${commits.length}\n` +
  `**Current findings in working tree snapshot:** ${currentFindings.length}\n` +
  `**Unique history findings before report commit:** ${uniqueHistoryFindings.size}\n` +
  `**Unresolved findings:** ${unresolvedFindings.length}\n\n` +
  `## Commands\n\n` +
  `- \`node scripts/audit-repository-secrets.mjs --output docs/security-audits/2026-05-10-sprint-025-history-audit.md\`\n\n` +
  `## Current tree findings\n\n${renderFindings(currentFindings)}\n\n` +
  `## Reachable history findings\n\n${renderFindings([...uniqueHistoryFindings.values()])}\n\n` +
  `## Remediation status\n\n` +
  (unresolvedFindings.length === 0
    ? '- No unresolved secret findings. Findings above, if any, are documented placeholders or synthetic examples, not credentials.\n'
    : '- Public release remains blocked until unresolved findings are remediated or Lou records an accepted resolution.\n');

if (normalizedOutputPath !== undefined) {
  const dir = dirname(normalizedOutputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(normalizedOutputPath, report);
}

console.log(report);
if (unresolvedFindings.length > 0) {
  process.exitCode = 1;
}
