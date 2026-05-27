#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const piDevRoot = resolve(scriptDir, '..');
const repoRoot = resolve(piDevRoot, '../..');

const fakeProviderSource = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

export default function smokeProvider(pi) {
  pi.registerProvider('pristine-smoke', {
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'PRISTINE_SMOKE_API_KEY',
    api: 'openai-completions',
    models: [{
      id: 'smoke',
      name: 'Smoke',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 128,
    }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const output = {
          role: 'assistant',
          content: [{ type: 'text', text: 'SMOKE_PROVIDER_OK' }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        };
        stream.push({ type: 'start', partial: output });
        stream.push({ type: 'text_start', contentIndex: 0, partial: output });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'SMOKE_PROVIDER_OK', partial: output });
        stream.push({ type: 'text_end', contentIndex: 0, content: output.content[0], partial: output });
        stream.push({ type: 'done', reason: 'stop', message: output });
        stream.end();
      });
      return stream;
    },
  });
}
`;

const failureRelaySource = `import { registerSessionRelayExtension } from './.pi/extensions/session-relay/index.ts';
import { createPiSessionRelayRuntime } from './.pi/extensions/session-relay/lib/extension-runtime.ts';

export default function failureRelay(pi) {
  registerSessionRelayExtension(pi, () => createPiSessionRelayRuntime({
    summarizer: { async summarize() { return ''; } },
  }));
}
`;

const run = (label, command, args, options) => {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  writeFileSync(join(options.evidenceDir, `${label}.stdout.log`), result.stdout);
  writeFileSync(join(options.evidenceDir, `${label}.stderr.log`), result.stderr);
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with status ${result.status ?? 'signal'}; see ${options.evidenceDir}`,
    );
  }
  return result;
};

const createFixture = (prefix) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(root, 'repo');
  const evidenceDir = join(root, 'evidence');
  const agentDir = join(root, 'agent');
  const sessionDir = join(root, 'sessions');
  const dbDir = join(root, 'db');
  for (const path of [repo, evidenceDir, agentDir, sessionDir, dbDir]) {
    mkdirSync(path, { recursive: true });
  }
  for (const path of [agentDir, sessionDir, dbDir]) {
    chmodSync(path, 0o700);
  }
  mkdirSync(join(repo, '.pi/extensions'), { recursive: true });
  mkdirSync(join(repo, '.pi/shared'), { recursive: true });
  cpSync(join(piDevRoot, 'shared'), join(repo, '.pi/shared'), { recursive: true });
  cpSync(join(piDevRoot, 'extensions/session-relay'), join(repo, '.pi/extensions/session-relay'), {
    recursive: true,
  });
  writeFileSync(join(repo, 'fake-provider.ts'), fakeProviderSource);
  writeFileSync(join(repo, 'failure-relay.ts'), failureRelaySource);
  return { root, repo, evidenceDir, agentDir, sessionDir, dbPath: join(dbDir, 'pristine.db') };
};

const installRelayDeps = (fixture) => {
  run('npm-install-session-relay', 'npm', ['install', '--omit=dev', '--silent'], {
    cwd: join(fixture.repo, '.pi/extensions/session-relay'),
    env: process.env,
    evidenceDir: fixture.evidenceDir,
  });
};

const piArgs = (fixture, prompt, relayExtension = '.pi/extensions/session-relay') => [
  '--offline',
  '--no-extensions',
  '-e',
  relayExtension,
  '-e',
  './fake-provider.ts',
  '--provider',
  'pristine-smoke',
  '--model',
  'smoke',
  '--session-dir',
  fixture.sessionDir,
  '--no-tools',
  '-p',
  prompt,
];

const runPi = (fixture, label, prompt, relayExtension) =>
  run(label, 'pi', piArgs(fixture, prompt, relayExtension), {
    cwd: fixture.repo,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: fixture.agentDir,
      PRISTINE_DB_PATH: fixture.dbPath,
      PRISTINE_SMOKE_API_KEY: 'unused',
    },
    evidenceDir: fixture.evidenceDir,
  });

const listJsonlFiles = (dir) => {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
    }
  };
  visit(dir);
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
};

const newestSession = (fixture) => {
  const [file] = listJsonlFiles(fixture.sessionDir);
  if (file === undefined) throw new Error(`No Pi session JSONL files found in ${fixture.sessionDir}`);
  return file;
};

const relayEntryCount = (sessionFile) => {
  const contents = readFileSync(sessionFile, 'utf8');
  return contents
    .split(/\r?\n/)
    .filter((line) => line.includes('"customType":"pristine-session-relay"')).length;
};

const assertCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runSuccessSmoke = () => {
  const fixture = createFixture('pristine-pi-relay-smoke-');
  installRelayDeps(fixture);
  assertCondition(!existsSync(join(fixture.repo, '.pi/extensions/jsonl-index')), 'jsonl-index was installed');
  assertCondition(!existsSync(join(fixture.repo, '.pi/extensions/search-memory')), 'search-memory was installed');

  runPi(fixture, '01-prior-session', 'Record that we decided to use the relay smoke fixture.');
  const firstSession = newestSession(fixture);
  assertCondition(relayEntryCount(firstSession) === 0, 'first session should not receive a relay');

  runPi(fixture, '02-new-session-with-history', 'Start a new session and use any prior handoff.');
  const secondSession = newestSession(fixture);
  assertCondition(relayEntryCount(secondSession) === 1, 'new session should receive exactly one relay');

  run('03-resume-session-no-duplicate', 'pi', [
    '--offline',
    '--no-extensions',
    '-e',
    '.pi/extensions/session-relay',
    '-e',
    './fake-provider.ts',
    '--provider',
    'pristine-smoke',
    '--model',
    'smoke',
    '--session',
    secondSession,
    '--session-dir',
    fixture.sessionDir,
    '--no-tools',
    '-p',
    'Prompt again in the same session.',
  ], {
    cwd: fixture.repo,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: fixture.agentDir,
      PRISTINE_DB_PATH: fixture.dbPath,
      PRISTINE_SMOKE_API_KEY: 'unused',
    },
    evidenceDir: fixture.evidenceDir,
  });
  assertCondition(relayEntryCount(secondSession) === 1, 'resumed session should not duplicate relay');

  return fixture;
};

const runEmptyHistorySmoke = () => {
  const fixture = createFixture('pristine-pi-relay-empty-');
  installRelayDeps(fixture);
  runPi(fixture, '01-empty-history', 'Start with no previous session history.');
  const session = newestSession(fixture);
  assertCondition(relayEntryCount(session) === 0, 'empty-history session should not receive relay');
  const stderr = readFileSync(join(fixture.evidenceDir, '01-empty-history.stderr.log'), 'utf8');
  assertCondition(!stderr.includes('Pristine session relay skipped'), 'empty history should not warn');
  return fixture;
};

const runFailureSmoke = () => {
  const fixture = createFixture('pristine-pi-relay-failure-');
  installRelayDeps(fixture);
  runPi(fixture, '01-prior-session', 'Record prior visible history for a failure simulation.');
  runPi(fixture, '02-empty-summary-failure', 'Trigger empty-summary failure.', './failure-relay.ts');
  const session = newestSession(fixture);
  assertCondition(relayEntryCount(session) === 0, 'failure session should not receive partial relay');
  return fixture;
};

try {
  const success = runSuccessSmoke();
  const empty = runEmptyHistorySmoke();
  const failure = runFailureSmoke();
  process.stdout.write('Session relay smoke PASS\n');
  process.stdout.write(`success evidence: ${success.evidenceDir}\n`);
  process.stdout.write(`empty-history evidence: ${empty.evidenceDir}\n`);
  process.stdout.write(`failure evidence: ${failure.evidenceDir}\n`);
  process.stdout.write('Generated temp repos/DBs remain under /tmp for inspection; do not commit them.\n');
} catch (error) {
  process.stderr.write(`Session relay smoke FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`Repo root: ${repoRoot}\n`);
  process.exitCode = 1;
}
