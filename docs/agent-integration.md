# Agent Framework Integration (historical)

> **Historical archive:** This document described the pre-Sprint-023 conversation-ingest/extraction architecture and referenced scripts/APIs that are no longer part of the public SDK surface. It is retained only as planning history.
>
> For current public onboarding, use `README.md`.
> For the maintained Pi JSONL reference implementation, use `examples/pi-dev/README.md`.

## Current integration model

Pristine's supported public surface is source-pointer indexing:

1. The host harness remains authoritative for raw transcripts, files, or events.
2. The host passes bounded text snippets to `PristineLocal.indexSourceChunks()` with optional source pointer metadata.
3. The host calls `searchSourceChunks()` to find relevant snippets and then inspects the authoritative source through the returned pointer.
4. The host calls `deleteSourceChunks()` when source records are deleted, rotated, or superseded.
5. Privacy workflows use `secureAndRedact()`, `reveal()`, and `scrubOutput()`.

The removed raw-conversation/extraction workflow (`store.ts`, `extract-worker.ts`, conversation FTS search, `storeAsync`, `getConversation`, and related queue/worker APIs) should not be copied into new integrations.
