This is one way to use Pristine primitives. You can write your own.

# Pi Dev Search Session History Skill

`search-session-history` is a Pi skill for inspecting bounded context around a `pristine_vector_search` hit. Pi JSONL remains the source of truth; Pristine returns source pointers, and this skill uses existing Pi tools (`bash`, `read`, grep, jq) to inspect the authoritative session file.

## Install

Copy all Pi dev examples so `search-memory` and this skill are installed together:

```bash
mkdir -p ~/projects/test-pristine/.pi
rsync -a --delete examples/pi-dev/. ~/projects/test-pristine/.pi/
```

## Reset

No state is stored by this skill. It follows pointers returned from the semantic index at `~/.pi/pristine/pristine.db` or `PRISTINE_DB_PATH`. Reset the semantic index by deleting `~/.pi/pristine/pristine.db` if needed.

## Known phrase verification

1. Run `pristine_vector_search` for a known phrase.
2. Use the returned `sourcePointer.sourceUri` and `sourcePointer.lineNumber` or `sourcePointer.entryId` with the skill.
3. Pass condition: bounded nearby user/assistant context is extracted from Pi JSONL without tool results, hidden custom messages, images, or thinking blocks.
