This is one way to use Pristine primitives. You can write your own.

# Pi Dev Search Session History Skill

Type: Pi skill. Install target: `.pi/skills/search-session-history/`. Entry point: `.pi/skills/search-session-history/SKILL.md`. User-facing entry point: ask the agent to use `search-session-history` for memory/history questions.

`search-session-history` is a Pi skill for directed pointer inspection around a `pristine_recall` hit. Pi JSONL remains the source of truth; Pristine returns bounded snippets for first-pass relevance judgment plus source pointers, and this skill uses existing Pi tools (`bash`, `read`, grep, jq) to inspect the authoritative session file.

`pristine_recall` is the discovery layer. Its snippets help choose a hit, but they are privacy-redacted previews rather than authoritative full context. This skill is the exact-context layer: once a `sourcePointer` is available, inspect only `sourcePointer.sourceUri` and do not run broad grep over all Pi sessions. `rg`/grep is used only inside the pointed file for exact pointer validation unless vector search is unavailable, the index is empty, the pointer file is missing, you are debugging index correctness, or the user explicitly asks for raw exact search.

## Install

Copy the skill into Pi's repo-local skill discovery path. Install `search-memory` separately when you need `pristine_recall`:

```bash
mkdir -p ~/projects/test-pristine/.pi/skills
rsync -a --delete examples/pi-dev/skills/search-session-history/. ~/projects/test-pristine/.pi/skills/search-session-history/
```

## Reset

No state is stored by this skill. It follows pointers returned from the semantic index at `~/.pi/pristine/pristine.db` or `PRISTINE_DB_PATH`. Reset that semantic index with:

```bash
db="${PRISTINE_DB_PATH:-$HOME/.pi/pristine/pristine.db}"
rm -f "$db" "$db-wal" "$db-shm" "$db-journal"
```

## Known phrase verification

1. Run `pristine_recall` for a known phrase.
2. Use the returned bounded `snippet` to pick the relevant hit, then use `sourcePointer.sourceUri` and `sourcePointer.lineNumber` or `sourcePointer.entryId` with the skill.
3. Pass condition: bounded nearby user/assistant context is extracted from only the pointed Pi JSONL file without tool results, hidden custom messages, images, thinking blocks, or broad session-history grep.
