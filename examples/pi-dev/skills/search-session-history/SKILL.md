---
name: search-session-history
description: Inspect authoritative Pi JSONL session context around a Pristine vector-search hit. Use after `pristine_recall` returns a `sourcePointer`, or use `pristine_recall` first when the target session is unknown.
allowed-tools: pristine_recall bash read
---

# search-session-history

Use this skill when the user asks about prior Pi session history, previous decisions, or context found by Pristine memory search.

## Workflow

This skill is the exact-context layer, not a second discovery/search mechanism. `pristine_recall` is the discovery layer; `search-session-history` inspects the authoritative Pi JSONL file named by the returned pointer.

### Pointer-known mode

Use this mode when the user or a prior `pristine_recall` result provides a `sourcePointer`.

1. Do not search globally. Inspect only `sourcePointer.sourceUri`.
2. Validate that `sourcePointer.sourceUri` exists and that either `entryId` or `lineNumber` is present.
3. Use `rg` only inside `$SOURCE_URI` for exact pointer validation, not for history discovery.
4. Use `jq` on `$SOURCE_URI` to locate the pointed visible message and extract bounded context.
5. Default bounded context: 5 user/assistant natural-language messages before the hit and 10 after. Do not dump entire session files unless the user explicitly asks.
6. Exclude tool results, hidden custom/context messages, system content, images, thinking blocks, and non-text blocks before selecting the 5/10-message context window.
7. Summarize the surrounding user/assistant context and cite the `sourceUri`, `entryId`, and/or `lineNumber` used.

### Pointer-unknown mode

Use this mode when the target session/pointer is unknown.

1. Call `pristine_recall` first with the user's semantic query.
2. Pick the best hit with a usable `sourcePointer.sourceUri` plus either `lineNumber` or `entryId`.
3. Switch immediately to pointer-known mode.

### Global grep fallback

Do not run broad `rg`/grep over `~/.pi/agent/sessions` after a usable `sourcePointer` is available. Broad session scans are fallback-only and allowed only when vector search is unavailable, the index is empty, the pointer file is missing and no alternate hit exists, you are debugging index correctness, or the user explicitly asks for raw exact grep.

## Pointer checks

Before reading, validate that the pointer has a file and at least one locator:

```bash
test -f "$SOURCE_URI" || { echo "Missing Pi JSONL file: $SOURCE_URI"; exit 2; }
test -n "${LINE_NUMBER:-}${ENTRY_ID:-}" || { echo "Invalid pointer: need lineNumber or entryId"; exit 2; }
```

If the file is missing or the pointer is invalid, report the limitation and try the next `pristine_recall` hit when available.

## Shared visible-message jq program

Both templates below first convert JSONL into visible user/assistant text messages while preserving original line numbers. Only after filtering do they select the default 5 messages before and 10 after.

```bash
VISIBLE_CONTEXT_JQ='
  def text_blocks($m):
    if ($m.content | type) == "string" then [$m.content]
    elif ($m.content | type) == "array" then
      [$m.content[]? | select(.type == "text") | .text]
    else [] end;

  [
    split("\n")
    | to_entries[]
    | select(.value | length > 0)
    | { lineNumber: (.key + 1), parsed: (.value | fromjson?) }
    | select(.parsed.type == "message")
    | .parsed as $entry
    | $entry.message as $m
    | select($m.role == "user" or $m.role == "assistant")
    | (text_blocks($m) | join("\n")) as $text
    | select(($text | length) > 0)
    | {
        lineNumber,
        entryId: ($entry.id // ""),
        parentId: ($entry.parentId // ""),
        timestamp: ($entry.timestamp // ""),
        role: $m.role,
        text: $text
      }
  ] as $msgs
  | (
      $msgs
      | map(
          (if ($lineNumber // 0) > 0 then .lineNumber == $lineNumber else false end)
          or (if ($entryId // "") != "" then .entryId == $entryId else false end)
        )
      | index(true)
    ) as $idx
  | if $idx == null then empty
    else $msgs[([0, ($idx - $before)] | max):($idx + $after + 1)][]
    | [.lineNumber, .entryId, .parentId, .timestamp, .role, .text]
    | @tsv
    end
'
```

## Line-number lookup template

Set `SOURCE_URI` to `sourcePointer.sourceUri` and `LINE_NUMBER` to `sourcePointer.lineNumber`:

```bash
SOURCE_URI="/path/to/pi-session.jsonl"
LINE_NUMBER=42
BEFORE=5
AFTER=10
test -f "$SOURCE_URI" || { echo "Missing Pi JSONL file: $SOURCE_URI"; exit 2; }
jq -R -s -r \
  --argjson lineNumber "$LINE_NUMBER" \
  --arg entryId "" \
  --argjson before "$BEFORE" \
  --argjson after "$AFTER" \
  "$VISIBLE_CONTEXT_JQ" \
  "$SOURCE_URI"
```

## Entry-ID lookup template

Set `ENTRY_ID` to `sourcePointer.entryId`. Use `rg` first for a fast pointer sanity check, then let jq select the visible-message window by entry ID:

```bash
SOURCE_URI="/path/to/pi-session.jsonl"
ENTRY_ID="entry-id-from-source-pointer"
BEFORE=5
AFTER=10
test -f "$SOURCE_URI" || { echo "Missing Pi JSONL file: $SOURCE_URI"; exit 2; }
rg -q --fixed-strings '"id":"'"$ENTRY_ID"'"' "$SOURCE_URI" || {
  echo "Invalid pointer: entryId $ENTRY_ID not found in $SOURCE_URI"
  exit 2
}
jq -R -s -r \
  --argjson lineNumber 0 \
  --arg entryId "$ENTRY_ID" \
  --argjson before "$BEFORE" \
  --argjson after "$AFTER" \
  "$VISIBLE_CONTEXT_JQ" \
  "$SOURCE_URI"
```

## Fallbacks and limits

- Missing file: say the Pi JSONL file is unavailable and try another vector hit if present.
- Invalid `entryId`/`lineNumber`: report the bad pointer and try another vector hit if present.
- No nearby user/assistant natural-language messages: say the bounded range contained no visible user/assistant text, then widen modestly or try another vector hit.
- Do not print tool outputs, hidden custom messages, system/context content, image payloads, or thinking blocks.
