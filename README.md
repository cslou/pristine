# Pristine

Local-first source-pointer memory SDK for TypeScript. Pristine helps apps and agents store useful memory locally and recall it by semantic query.

Pristine stores indexed chunks, snippets, embeddings, and source metadata; your application or harness remains the source of truth for full raw records.

- No Pristine server required.
- SQLite-backed local storage.
- Local embedding configuration by default.
- Source-pointer recall for inspecting authoritative context.

## Install

```bash
npm install @pristine/sdk
```

Requires Node.js 22 or newer.

## Quickstart

```ts
import { Pristine } from '@pristine/sdk';

const pristine = await Pristine.create();
const projectId = 'local-project';

try {
  await pristine.store(
    [
      {
        chunkId: 'note-1',
        text: 'Pristine keeps memory local by default.',
        sourceKind: 'note',
        sourceUri: 'file:///notes/project.md',
      },
    ],
    { projectId },
  );

  const hits = await pristine.recall('local project memory', { projectId, limit: 3 });
  await pristine.forget(['note-1'], { projectId });

  const firstSourceUri = hits[0]?.sourceUri;
} finally {
  await pristine.dispose();
}
```

## Core API

- `Pristine.create(config?)` — create a local client.
- `store(chunks, { projectId })` — store source-owned memory chunks.
- `recall(query, { projectId, limit? })` — semantically search one project.
- `forget(chunkIds, { projectId })` — delete stored chunks in one project.

## Documentation

Canonical public documentation lives in [`docs/pages/`](docs/pages/):

- [Quickstart](docs/pages/quickstart.mdx)
- [Concepts](docs/pages/concepts.mdx)
- [API](docs/pages/api.mdx)
- [Configuration](docs/pages/configuration.mdx)
- [Examples](docs/pages/examples.mdx)
- [Pi-dev integration](docs/pages/pi-dev.mdx)

Build the Vocs docs locally:

```bash
pnpm run docs:build
```

## Pi-dev integration

Agents integrating Pristine into Pi-dev should start at [`examples/pi-dev/README.md`](examples/pi-dev/README.md). The canonical Pi recall tool is `pristine_recall`.

## Local model

Pristine does not require a hosted API. The default local embedder may download model files on first use unless model assets are pre-cached or the runtime is configured for offline operation.

## Status

Pristine is pre-1.0 and preparing for public release. APIs may still change before a stable release.

## Links

- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
