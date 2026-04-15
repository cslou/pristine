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

## Database Location

All scripts default to `~/.pristine/data/pristine.db`. Override with `--db-path`:

```bash
npx tsx scripts/store.ts --user-id alice --db-path /custom/path/pristine.db
npx tsx scripts/search.ts --user-id alice --query "Tokyo" --db-path /custom/path/pristine.db
```
