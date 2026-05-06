---
name: search-session-history
description: Inspect authoritative Pi JSONL session context around a Pristine vector-search hit. Use after `pristine_vector_search` returns a `sourcePointer`, or use `pristine_vector_search` first when the target session is unknown.
allowed-tools: bash read
---

# search-session-history

Use this skill when the user asks about prior Pi session history, previous decisions, or context found by Pristine memory search.

## Workflow

1. If the target session/pointer is unknown, call `pristine_vector_search` first with the user's semantic query.
2. Pick the best hit with a usable `sourcePointer.sourceUri` plus either `lineNumber` or `entryId`.
3. Inspect Pi's authoritative JSONL file directly with existing Pi tools (`bash`, `read`, grep, jq). Do not ask Pristine for raw transcript storage.
4. Default bounded context: 5 user/assistant natural-language messages before the hit and 10 after. Do not dump entire session files unless the user explicitly asks.
5. Exclude tool results, hidden custom/context messages, system content, images, thinking blocks, and non-text blocks.
6. Summarize the surrounding user/assistant context and cite the `sourceUri`, `entryId`, and/or `lineNumber` used.

## Pointer checks

Before reading, validate that the pointer has a file and at least one locator:

```bash
test -f "$SOURCE_URI" || { echo "Missing Pi JSONL file: $SOURCE_URI"; exit 2; }
test -n "${LINE_NUMBER:-}${ENTRY_ID:-}" || { echo "Invalid pointer: need lineNumber or entryId"; exit 2; }
```

If the file is missing or the pointer is invalid, report the limitation and try the next `pristine_vector_search` hit when available.

## Line-number lookup template

Set `SOURCE_URI` to `sourcePointer.sourceUri` and `LINE_NUMBER` to `sourcePointer.lineNumber`. This template extracts nearby user/assistant natural-language text while excluding tool results, custom/hidden messages, images, and thinking blocks:

```bash
SOURCE_URI="/path/to/pi-session.jsonl"
LINE_NUMBER=42
BEFORE=5
AFTER=10
START=$(( LINE_NUMBER > BEFORE ? LINE_NUMBER - BEFORE : 1 ))
END=$(( LINE_NUMBER + AFTER ))
awk -v start="$START" -v end="$END" 'NR >= start && NR <= end { print }' "$SOURCE_URI" \
  | jq -r '
      select(.type == "message")
      | . as $entry
      | .message as $m
      | select($m.role == "user" or $m.role == "assistant")
      | [
          ($entry.id // ""),
          ($entry.parentId // ""),
          ($entry.timestamp // ""),
          $m.role,
          (
            if ($m.content | type) == "string" then $m.content
            elif ($m.content | type) == "array" then
              ($m.content[]? | select(.type == "text") | .text)
            else empty end
          )
        ]
      | select(.[4] != null and (.[4] | length) > 0)
      | @tsv
    '
```

## Entry-ID lookup template

Set `ENTRY_ID` to `sourcePointer.entryId`. This resolves the line number, then reuses the bounded line-number lookup:

```bash
SOURCE_URI="/path/to/pi-session.jsonl"
ENTRY_ID="entry-id-from-source-pointer"
LINE_NUMBER=$(rg -n --fixed-strings "\"id\":\"$ENTRY_ID\"" "$SOURCE_URI" | head -1 | cut -d: -f1)
if [ -z "$LINE_NUMBER" ]; then
  echo "Invalid pointer: entryId $ENTRY_ID not found in $SOURCE_URI"
  exit 2
fi
BEFORE=5
AFTER=10
START=$(( LINE_NUMBER > BEFORE ? LINE_NUMBER - BEFORE : 1 ))
END=$(( LINE_NUMBER + AFTER ))
awk -v start="$START" -v end="$END" 'NR >= start && NR <= end { print }' "$SOURCE_URI" \
  | jq -r '
      select(.type == "message")
      | . as $entry
      | .message as $m
      | select($m.role == "user" or $m.role == "assistant")
      | [
          ($entry.id // ""),
          ($entry.parentId // ""),
          ($entry.timestamp // ""),
          $m.role,
          (
            if ($m.content | type) == "string" then $m.content
            elif ($m.content | type) == "array" then
              ($m.content[]? | select(.type == "text") | .text)
            else empty end
          )
        ]
      | select(.[4] != null and (.[4] | length) > 0)
      | @tsv
    '
```

## Fallbacks and limits

- Missing file: say the Pi JSONL file is unavailable and try another vector hit if present.
- Invalid `entryId`/`lineNumber`: report the bad pointer and try another vector hit if present.
- No nearby user/assistant natural-language messages: say the bounded range contained no visible user/assistant text, then widen modestly or try another vector hit.
- Do not print tool outputs, hidden custom messages, system/context content, image payloads, or thinking blocks.
