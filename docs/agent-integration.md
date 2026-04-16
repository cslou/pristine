# Agent Framework Integration

Pristine ships CLI scripts that agent harnesses call via hooks and skills. All scripts are `.ts` files run with `npx tsx`.

## Scripts

| Script | Purpose | Init | Latency |
|--------|---------|------|---------|
| `scripts/store.ts` | Enqueue conversation for extraction | `createLite()` | <0.5s |
| `scripts/extract-worker.ts` | Background extraction worker | `PristineLocal.create()` | 8-12s/task |
| `scripts/search.ts` | Semantic memory search | `PristineLocal.create()` | <2s |
| `scripts/search-conversations.ts` | FTS5 conversation search | `createLite()` | <0.5s |
| `scripts/get-conversation.ts` | Retrieve conversation by ID | `createLite()` | <0.5s |

## Claude Code Hook

Store every conversation turn automatically using a `postToolUse` hook:

```json
// ~/.claude/hooks.json
{
  "hooks": {
    "postToolUse": [
      {
        "command": "echo '{\"messages\": $MESSAGES}' | npx tsx ~/projects/pristine/scripts/store.ts --user-id $USER_ID"
      }
    ]
  }
}
```

Search memory from a Claude Code skill:

```bash
npx tsx ~/projects/pristine/scripts/search.ts --user-id $USER_ID --query "$QUERY"
```

## Pi.dev Skill

Define a Pi skill that searches memory:

```yaml
---
name: memory-search
description: Search long-term memory for relevant facts
---

Run the following command and return the results:
npx tsx ~/projects/pristine/scripts/search.ts --user-id {{userId}} --query "{{query}}"
```

Store conversations via a Pi extension that hooks `tool_result` events:

```typescript
// extensions/pristine-store.ts
import { spawnSync } from 'node:child_process';

export default {
  event: 'tool_result',
  handler({ messages, userId }) {
    spawnSync(
      'npx',
      ['tsx', '~/projects/pristine/scripts/store.ts', '--user-id', userId],
      { input: JSON.stringify({ messages }), encoding: 'utf8' },
    );
  },
};
```

## Recovery

If the extraction worker crashes or Ollama was down, pending tasks accumulate. Process all pending tasks:

```bash
npx tsx scripts/extract-worker.ts --all
```

Retry previously failed tasks:

```bash
npx tsx scripts/extract-worker.ts --retry-failed --all
```

## Timestamp Guidance

Pristine uses a `REFERENCE_TIME` anchor to resolve relative temporal expressions ("yesterday", "two weeks ago") during fact extraction. Without correct timestamps, all extracted facts default to today's date, making temporal queries useless for historical conversations.

### The `Message.timestamp` Field

Each `Message` has an optional `timestamp?: string` field (ISO 8601 UTC). When set, Pristine includes it in the extraction prompt as a `[timestamp]` prefix:

```
[2023-05-08T14:00:00.000Z] user: I moved to Tokyo yesterday
assistant: That's exciting! How are you settling in?
```

This gives the LLM per-message temporal context. Messages without timestamps render normally.

### The `referenceTimestamp` IngestOption

For sources where messages lack individual timestamps but the session has a date (e.g., LOCOMO benchmark), pass the session date explicitly:

```typescript
await client.orchestrator.ingest(messages, userId, {
  referenceTimestamp: '2023-05-08T13:56:00.000Z',
});
```

### Three-Tier Resolution Chain

The extraction pipeline resolves `REFERENCE_TIME` in this order:

1. **Explicit `referenceTimestamp`** from `IngestOptions` — the caller knows best
2. **`deriveTimestamp(messages)`** — scans for the chronologically latest `Message.timestamp`
3. **`new Date().toISOString()`** — fallback to "now" (last resort)

### Hook Timestamp Sources

| Hook | Source Format | Timestamp Location | Pattern |
|------|-------------|-------------------|---------|
| Claude Code | `.jsonl` transcript at `transcript_path` | `entry.timestamp` on each entry | Per-message: set `Message.timestamp` |
| Pi.dev | `.jsonl` sessions at `~/.pi/agent/sessions/` | `entry.timestamp` on each entry | Per-message: set `Message.timestamp` |
| LOCOMO benchmark | `locomo10.json` dataset | `session.metadata.date` per session | Per-session: pass `referenceTimestamp` via `IngestOptions` |

**Claude Code** and **Pi.dev** hooks are documented for future implementation. The **LOCOMO** provider is the reference implementation: see `benchmarks/memorybench/src/providers/pristine/index.ts`.

### Timestamp Format

All timestamps must be ISO 8601 UTC with Z suffix:
```
2023-05-08T13:56:00.000Z
```

Do not use timezone offsets (`+05:30`) — always normalize to UTC.

## Database Location

All scripts default to `~/.pristine/data/pristine.db`. Override with `--db-path`:

```bash
npx tsx scripts/store.ts --user-id alice --db-path /custom/path/pristine.db
npx tsx scripts/search.ts --user-id alice --query "Tokyo" --db-path /custom/path/pristine.db
```
