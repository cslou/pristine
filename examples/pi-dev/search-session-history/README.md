This is one way to use Pristine primitives. You can write your own.

# Pi Dev Search Session History Skill

`search-session-history` is a Pi skill for inspecting bounded context around a `pristine_vector_search` hit. Pi JSONL remains the source of truth; Pristine returns source pointers, and this skill uses existing Pi tools (`bash`, `read`, grep, jq) to inspect the authoritative session file.

## Install

Copy the skill into Pi's repo-local skill discovery path. Install `search-memory` separately when you need `pristine_vector_search`:

```bash
mkdir -p ~/projects/test-pristine/.pi/skills
rsync -a --delete examples/pi-dev/search-session-history/. ~/projects/test-pristine/.pi/skills/search-session-history/
```

## Reset

No state is stored by this skill. It follows pointers returned from the semantic index at `~/.pi/pristine/pristine.db` or `PRISTINE_DB_PATH`. Reset that semantic index with:

```bash
rm -f "${PRISTINE_DB_PATH:-$HOME/.pi/pristine/pristine.db}" "${PRISTINE_DB_PATH:-$HOME/.pi/pristine/pristine.db}"-*
```

## Known phrase verification

1. Run `pristine_vector_search` for a known phrase.
2. Use the returned `sourcePointer.sourceUri` and `sourcePointer.lineNumber` or `sourcePointer.entryId` with the skill.
3. Pass condition: bounded nearby user/assistant context is extracted from Pi JSONL without tool results, hidden custom messages, images, or thinking blocks.
