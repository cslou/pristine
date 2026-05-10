# Pristine Local

Local-first privacy and source-pointer memory SDK. No server; no user data leaves the device by default. The default local embedder may download model files on first use unless pre-cached or configured offline.

Pristine indexes source-owned text chunks with local embeddings and returns semantic search hits containing snippets plus optional source pointers. The source system remains authoritative for full raw transcripts/files/events; Pristine stores indexed chunk text/snippets, embeddings, source metadata, and privacy vault data in a local SQLite database.

## Install

```bash
npm install @pristine/shield-local
```

Pristine is MIT licensed and currently tested on Node.js 22 or newer. It is ESM-only and uses native SQLite dependencies (`better-sqlite3` and `sqlite-vec`), so install/build behavior follows the platform support of those packages.

## Quick start

```ts
import { PristineLocal } from '@pristine/shield-local';

const client = await PristineLocal.create();

try {
  await client.indexSourceChunks(
    [
      {
        text: 'Pi JSONL source pointer architecture cleanup notes',
        chunkId: 'session-1:line-42',
        sourceKind: 'pi-jsonl',
        sourceUri: 'file:///Users/me/.pi/agent/sessions/session.jsonl',
        lineNumber: 42,
        metadata: { cwd: '/Users/me/project' },
      },
    ],
    { projectId: 'my-project' },
  );

  const hits = await client.searchSourceChunks('source pointer cleanup', {
    projectId: 'my-project',
    limit: 5,
  });

  console.log(hits[0]);
  // {
  //   chunkId: 'session-1:line-42',
  //   projectId: 'my-project',
  //   text: 'Pi JSONL source pointer architecture cleanup notes',
  //   score: 0.91,
  //   sourceKind: 'pi-jsonl',
  //   sourceUri: 'file:///Users/me/.pi/agent/sessions/session.jsonl',
  //   lineNumber: 42,
  //   ...
  // }

  await client.deleteSourceChunks(['session-1:line-42'], { projectId: 'my-project' });
} catch (error) {
  // AppError subclasses from Pristine include validation, config, and embedder failures.
  // Unknown errors should still be logged/handled by your application boundary.
  console.error(error);
  throw error;
} finally {
  await client.dispose();
}
```

## Public documentation map

- **Core SDK primitives:** `PristineLocal.create`, `indexSourceChunks`, `searchSourceChunks`, `deleteSourceChunks`, `secureAndRedact`, `reveal`, and `scrubOutput` are the supported public package surface.
- **Reference implementations:** `examples/pi-dev/` shows one Pi JSONL integration built from the primitives. It is not required for normal SDK use.
- **Historical design notes:** `docs/specs/` and `docs/sprints/` preserve planning context and may mention APIs removed before `0.0.1`; use this README as the public onboarding contract.

## Core API

### `PristineLocal.create(config?)`

Creates a local client. Omit config to use the default local SQLite database and in-process local embedder.

| Option | Purpose |
| --- | --- |
| `baseDir` | Root directory for `models.json`, `data/pristine.db`, and default `keys/`. Defaults to `~/.pristine`. |
| `keysDir` | Filesystem key directory. Defaults to `<baseDir>/keys`, or `~/.pristine/keys` when both `db` and `embedder` are injected. |
| `db` | Inject a `better-sqlite3` database, usually for tests. |
| `embedder` | Inject a custom embedder, usually for tests or offline deployments. |
| `privacy` | Deterministic privacy classifier config. Supports `confidenceThreshold`, `customPatternsPath`, and `customPatterns`. |

If both `db` and `embedder` are injected, Pristine skips `initPristine()` and does not create the default data/config directories. Keys still default to `~/.pristine/keys` unless `keysDir` is provided.

### `indexSourceChunks(chunks, { projectId })`

Indexes source-owned chunks. `text` is required; all source metadata is optional. Duplicate `(projectId, chunkId)` values replace the existing chunk and vector atomically. If `chunkId` is omitted, Pristine generates one.

Validation highlights:

- `projectId` must be a non-empty string.
- `text` must be non-empty after trimming.
- `metadata`, when provided, must be a JSON-serializable object up to 16 KiB.
- Embeddings must match the configured embedder dimension.

### `searchSourceChunks(query, { projectId, limit? })`

Runs vector search over indexed chunks and returns pointer-oriented hits. Results include `chunkId`, indexed text, score, nullable source fields, and metadata. Search is project-scoped and does not require raw conversation/message tables.

`limit` defaults to `10` and must be a positive integer no greater than `1000`.

### `deleteSourceChunks(chunkIds, { projectId })`

Deletes source chunks and their vector rows atomically within one project. Use this when the authoritative source system deletes, truncates, rotates, or supersedes records so Pristine does not return stale pointers/snippets. `chunkIds` must be a non-empty string array.

### Privacy APIs

- `secureAndRedact(text, userId, classifier?)`
- `reveal(redactedText, userId)`
- `scrubOutput(text, allowlist?)`

These remain local-only and use the SQLite vault plus filesystem keys. The `scrubOutput` second parameter is named `allowlist` in the current TypeScript signature for compatibility, but the values are scrubbed from output; pass revealed/sensitive values that must be removed.

```ts
const secured = await client.secureAndRedact(
  'Deploy with token REDACTED_API_TOKEN_EXAMPLE',
  'user-123',
);

if (!secured.ok) {
  throw new Error(`Blocked by privacy safety scan: ${secured.reason}`);
}

// Store or send only the redacted text.
console.log(secured.redactedText);

const revealed = await client.reveal(secured.redactedText, 'user-123');
console.log(revealed.text);

// Before sending tool/model output back out, remove revealed values and any
// leftover placeholders or obvious structured secrets.
const safeOutput = client.scrubOutput(revealed.text, revealed.revealedValues);
```

`secureAndRedact` returns a `SecureAndRedactResult` union:

- success: `{ ok: true, redactedText, placeholderIds, warnings? }`
- blocked: `{ ok: false, reason: 'safety_scan', redactedText, safetyViolations, warnings? }`

`reveal` returns `{ text, revealedValues }`. Pass `revealedValues` to `scrubOutput`; they are values to remove from output.

The built-in classifier is deterministic and local. It detects common API keys, auth tokens, private keys, JWTs, and password/secret assignments. Add custom local patterns through `PristineLocal.create({ privacy: { customPatterns: [...] } })` or `customPatternsPath`.

## Source chunk shape

```ts
interface SourceChunkInput {
  text: string;
  chunkId?: string;
  sourceKind?: string;
  sourceUri?: string;
  entryId?: string;
  parentId?: string;
  lineNumber?: number;
  lineStart?: number;
  lineEnd?: number;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}
```

Source pointers are intentionally generic. For Pi JSONL, `sourceUri` can point to the session JSONL file and line fields can identify the relevant entry/window. For other systems, use `sourceKind`, `sourceUri`, `entryId`, `parentId`, and `metadata` to point back to the authoritative source record.

## Storage layout

Default first run creates:

```text
~/.pristine/                         mode 0700
  models.json                        embedder config
  data/                              mode 0700
    pristine.db                      SQLite database
  keys/                              mode 0700
```

Privacy operations create per-user key files on first use:

```text
~/.pristine/keys/
  {encodedUserId}-private.pem        private key, owner-only
  {encodedUserId}-public.pem         public key
```

`pristine.db` stores:

- `source_chunks` — indexed chunk text/snippets plus source metadata and pointers.
- `vec_source_chunks` — sqlite-vec embeddings for source chunk search.
- privacy vault tables — encrypted sensitive values, wrapped DEKs, and wrapped per-user KEKs.

Pristine does **not** store full authoritative raw transcripts/files/events. It stores enough text to perform semantic recall and enough pointer metadata to let the calling system inspect the original source.

### Backup and restore

Back up the database and keys together:

```bash
cp -R ~/.pristine /path/to/backup/pristine
```

Encrypted vault values require the matching filesystem private keys. If `data/pristine.db` is restored without `keys/`, previously encrypted values may be unrecoverable. Source search hits may also require the original source files/events to still exist, because Pristine only stores snippets and pointers.

### Filesystem permissions

On non-Windows systems, Pristine creates private directories and rejects overly-open key material. Typical repair commands are:

```bash
chmod 700 ~/.pristine ~/.pristine/data ~/.pristine/keys
chmod 600 ~/.pristine/keys/*-private.pem
```

## Embedder configuration

`~/.pristine/models.json` is embedder-only by default:

```json
{
  "embedder": { "engine": "local" }
}
```

Supported engines:

- `local` — default `@huggingface/transformers` embedder using Nomic Embed v1.5. It runs in process and may download model files on first embedding/search unless cached or configured offline.
- `ollama` — local Ollama embedding endpoint, for example:

```json
{
  "embedder": {
    "engine": "ollama",
    "model": "nomic-embed-text",
    "host": "http://localhost:11434"
  }
}
```

`dim` is optional and defaults to the embedder's configured default. Existing `vec_source_chunks` tables are validated against the configured dimension on init.

For deterministic tests or strict offline deployments, inject a custom `Embedder` and `db` into `PristineLocal.create()`.

## Privacy threat model

Pristine is local-first by default, but it is still an index and vault you run on your machine:

- **Default model behavior:** the default `local` embedder runs through `@huggingface/transformers` in process and may download Nomic Embed v1.5 model files from Hugging Face on first embedding/search. After the files are cached, normal embedding work is local. Strict offline deployments should pre-populate the Transformers cache or inject a custom offline `Embedder`.
- **Plaintext source index:** `source_chunks` stores the indexed chunk `text`, snippets, source pointer fields, and JSON metadata in plaintext so semantic search can return useful local results. Do not index text you are unwilling to store in the local SQLite file.
- **Encrypted privacy vault:** detected sensitive values are stored in vault tables encrypted with AES-256-GCM DEKs; DEKs are wrapped by per-user KEKs; KEKs are wrapped by filesystem RSA keys.
- **Keys and recovery:** private keys live under `keys/` with owner-only permissions on Unix-like systems. There is no server-side recovery; back up the database and matching keys together.
- **Ollama host configuration:** the `ollama` embedder sends text to the configured Ollama `host`. Keep the host on `localhost` for local-only behavior. A remote or container-network host receives the text you embed/search.
- **No raw source ownership:** full transcripts/files/events remain in the calling harness/source system. Pristine stores indexed text chunks plus pointers, not a complete authoritative source archive.

Privacy vault data is encrypted locally:

- Each user gets a filesystem RSA key pair.
- Each user has a generated KEK stored in SQLite wrapped by the RSA public key.
- Each sensitive value is encrypted with a DEK using AES-256-GCM.
- DEKs are wrapped by the KEK; plaintext KEKs are cached only in process memory.

## Isolation model

- Source index isolation is by `projectId`. Index, search, and delete calls are project-scoped.
- Privacy vault isolation is by `userId`.
- Use separate `projectId`s for projects that share one database.
- Use separate `baseDir`s or injected databases for stronger environment or agent isolation.

## Local-first guarantees

- Embeddings run locally through the configured embedder.
- Indexed chunk text/snippets, embeddings, metadata, and vault entries are stored in a local SQLite file.
- No user data is sent to an API by default. The default Transformers-based embedder may download model files from Hugging Face on first use unless the model is already cached or an offline/local embedder is configured.
- Full raw source records remain in the calling harness/source system.

## Native/runtime troubleshooting

- **Node.js:** use Node.js 22 or newer. The package is ESM-only (`"type": "module"`); CommonJS `require()` is not a supported import path.
- **Native SQLite packages:** `better-sqlite3` and `sqlite-vec` install native/prebuilt artifacts. If install fails, confirm your Node version, platform architecture, and local compiler toolchain match those packages' support matrix.
- **Model cache:** first local embedding/search can be slower while Transformers downloads and initializes the Nomic model. Pre-cache model files or inject a custom `Embedder` for fully offline startup.
- **Filesystem permissions:** if privacy operations fail on Unix-like systems, check that `~/.pristine`, `~/.pristine/data`, and `~/.pristine/keys` are `0700`, and private key files are `0600`.
- **Ollama:** when using the `ollama` engine, verify the configured `host` is reachable and that the model exists in that Ollama instance.

## Sprint 023 breaking change note

Sprint 023 removed the previous raw-transcript ownership surface. These concepts are no longer public live APIs:

- raw conversation/message storage through Pristine
- `storeAsync`
- `getConversation`
- `drainEmbedQueue`
- `buildSessionVector`
- `searcher.sql`
- FTS, hybrid, and session-vector search APIs
- ingest queue and embed-worker APIs

Use `indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks` against source-owned records instead.

## Development and verification

Common local checks:

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run test:smoke
SKIP_SLOW_TESTS=1 npm run test:integration
npm run test:e2e
npm run verify:package
```

GitHub's deterministic public CI gate runs `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:smoke`, `SKIP_SLOW_TESTS=1 npm run test:integration`, `npm run test:e2e`, and `npm run verify:package`. Maintainers run the full local regression tier before release when real local model checks are needed.

Full regression, including real-model integration and source-index smoke:

```bash
.checks/regression.sh --tier=full
```

Full real-model source-index smoke after build:

```bash
node scripts/smoke-source-index.mjs
```

`npm run test:smoke` builds first because package-entrypoint smoke tests import `dist`. Real-model checks may load/download the local embedding model on first use unless it is already cached.
