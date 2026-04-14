# Backlog

Future work items not yet assigned to a sprint.

---

## CLI Setup Command

**Context:** Sprint 004d introduces `~/.pristine/models.json` as the source of truth for model configuration. Users create it manually or copy-paste from error messages. A CLI command would automate this.

**Scope:**
- `npx pristine-local setup ollama <model>` — pulls model via Ollama, writes `models.json`
- `npx pristine-local setup llamacpp <model>` — downloads GGUF from registry to `~/.pristine/models/`, writes `models.json` with the absolute path
- Interactive mode: `npx pristine-local setup` — asks which engine, which model, then does the above

**Depends on:** Sprint 004d (models.json), SDK packaging (Phase 7)

**Priority:** After SDK is shippable. This is onboarding UX, not core functionality.

---

## Per-Module Model Configuration

**Context:** Sprint 004d `models.json` has `privacy` and `memory` fields that can point to different models. Initially both will use the same model. When we have benchmarks showing that a smaller model works for classification but extraction needs a larger one, this becomes useful.

**Depends on:** Sprint 004d, benchmarks (Phase 8)

**Priority:** Low. Only matters when we have data showing model-per-pipeline improves quality or performance.

---

## Clarify `scrubOutput()` Scope in Documentation

**Context:** `scrubOutput()` only strips `[SENSITIVE:...]` placeholder tokens from text. It does not re-detect PII in tool output or catch echoed plaintext. This is by design -- it's a UI cleanup function, not an output guard. But the docs don't say that explicitly, which could lead callers to assume it provides full output protection.

**Source:** Issue #31, Finding 4.

**Scope:**
- Update `scrubOutput()` JSDoc to clarify it only removes placeholder tokens
- Update README privacy section to note that `scrubOutput()` is not a re-classification step
- If output re-classification is needed (e.g., tool echoes back revealed PII), that would be a new `classifyOutput()` function -- separate feature

**Priority:** Low. Documentation clarification only.

---

## LLM Span Grounding Improvement (Discussion)

**Context:** The LLM classifier's `findingToEntity` uses `indexOf` to locate PII spans in source text. If the LLM paraphrases or normalizes the span, it falls back to redacting the entire text (fail-closed). If the same string appears multiple times, `indexOf` returns the first occurrence, potentially redacting the wrong one.

**Source:** Issue #31, Finding 2.

**Current behavior is intentionally fail-closed:** if the span can't be found, the entire text is redacted. This is the safe direction (over-redact vs under-redact). The deterministic classifier handles exact-match PII (credit cards, SSN, email) where position matters.

**Discussion points:**
- Is the first-match `indexOf` problem a real risk? Duplicate PII strings in a single message are rare for contextual types (health conditions, relationships)
- Could we use the LLM's character offsets instead of text matching? Depends on model reliability
- Fuzzy matching (Levenshtein distance) for paraphrased spans? Adds complexity, may not be worth it
- Should we track this as a known limitation or actively fix it?

**Priority:** Low. Current fail-closed behavior is safe. Improvement would reduce over-redaction, not prevent under-redaction.

---

## Retrieve Pipeline: Source Conversation Context

**Context:** When the retriever returns memories, each result includes the extracted fact text, similarity score, and temporal metadata — but no link back to the original conversation that produced the fact. The consuming LLM has no way to judge the quality, confidence, or context of a retrieved memory.

Pristine already stores the raw conversation as a `user_raw` memory with a `sourceConversationId`, and each extracted fact carries the same `sourceConversationId`. The plumbing exists but the retrieve pipeline doesn't surface it.

**Comparison:** Mem0 returns bare facts with scores and timestamps. Zed has no semantic search. Neither surfaces original conversation context on retrieval.

**Scope:**
- Add `sourceConversation?: { messages: Message[]; timestamp: string }` to `RankedMemory` or a new `EnrichedRetrieveResult` type
- In the retrieve pipeline, after ranking, look up the `user_raw` memory by `sourceConversationId` for each result
- Optionally add `citationSpan?: string` (the exact message segment the fact was extracted from) — requires extractor changes to track spans
- Optionally add extraction `confidence` score — requires extractor to output confidence alongside facts

**Depends on:** Sprint 006 (orchestrator), Store query by sourceConversationId

**Priority:** Medium. High value for LLM consumers that need to judge memory quality. Not blocking for basic retrieve functionality.

---

## Role-Aware Memory Extraction

**Context:** The extractor currently processes all message roles (system, user, assistant) without filtering. Mem0 distinguishes between user-fact extraction and agent-fact extraction using different prompts depending on whether an `agent_id` is present. Neither Pristine nor Mem0 handles tool-role messages.

**Current behavior:** All messages (system, user, assistant) are formatted as `role: content` and sent to the LLM for fact extraction. No role-based filtering or prompt specialization exists.

**Scope:**
- Evaluate whether system messages should be excluded from extraction (they typically contain instructions, not user facts)
- Consider separate extraction prompts for user vs assistant messages (Mem0's approach)
- Add `tool` to `MessageRole` and decide whether tool call results should be extractable (tool outputs may contain valuable facts)
- Benchmark extraction quality with and without role filtering

**Depends on:** Sprint 006 (orchestrator), extraction quality benchmarks

**Priority:** Medium. Current approach works but may extract noise from system prompts or miss facts in tool outputs.

---

## Agent Integration Pattern: Tool-Based Search + Background Ingest

**Context:** The orchestrator exposes `search()` and `store()` as awaitable async functions. For agent integration, the expected pattern is:

1. **Search as an LLM tool, not per-turn** — embedding + vector search + ranking adds latency that's wasted on conversational turns ("yes", "sounds good"). Expose `search_memory` as a tool the LLM calls when it decides it needs context. This avoids unnecessary latency on most turns.

2. **Ingest as fire-and-forget after the turn** — the conversation is already in the LLM's context window, so extracted facts aren't needed immediately. Run `orchestrator.store(conversation, userId)` in parallel after the response is returned. Edge case: ensure pending ingests complete on session shutdown (shutdown hook that awaits the promise).

**Scope:**
- Define a `search_memory` tool schema for LLM tool-use (name, description, parameters: query, topK?, temporalMode?)
- Define an `ingest_conversation` background task pattern with graceful shutdown
- Consider a lightweight `PendingIngestQueue` that tracks in-flight ingests and exposes `drain()` for shutdown
- Document the recommended agent turn lifecycle

**Depends on:** Sprint 006 (orchestrator), agent framework choice

**Priority:** High. This is the integration surface between Pristine and any agent that uses it.

---

## Ingest Queue with Graceful Drain

**Context:** When an agent fires `void pristine.store(conversation, userId)` after each turn, the store() promise runs in the background. During fast conversation, multiple ingestions queue up — each takes 6-10 seconds (LLM extraction + embedding + consolidation), and Ollama serializes inference requests internally.

**The problem:** If the user closes the session while ingestions are in-flight, those promises get abandoned. Node exits, the LLM calls are cancelled mid-extraction, and those conversation turns are never stored as memories. The last few turns of every session are at risk of being lost — and those are often the most important turns (conclusions, decisions, action items).

**The fix:** A `PendingIngestQueue` that the agent framework integrates with:

```typescript
const queue = pristine.ingestQueue;

// After each turn — non-blocking, returns immediately
queue.enqueue(conversation, userId);

// On session shutdown — blocks until all pending ingests complete
await queue.drain();

// Observability
queue.pending;      // number of in-flight ingestions
queue.on('error', (err, conversation) => { ... });  // failed ingestion callback
```

**Scope:**
- `IngestQueue` class wrapping `pristine.store()` with a tracked promise set
- `enqueue(conversation, userId)` — fires store() and tracks the promise
- `drain()` — awaits all pending promises, returns when queue is empty
- `pending` property — number of in-flight ingestions
- Error callback — so the agent can log or retry failed ingestions without crashing
- Optional: max concurrency limit (prevent 10+ simultaneous LLM calls during catch-up)

**Depends on:** Sprint 007 (SDK)

**Priority:** Medium. The fire-and-forget pattern works today for sessions that end gracefully. This matters when sessions are interrupted (tab close, crash, timeout).
