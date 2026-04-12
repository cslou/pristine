# Memory Approaches: Raw Embedding vs Fact Extraction

Two approaches to persistent memory for AI agents. Both use an embedding model for search. Both store results in the same SQLite + sqlite-vec infrastructure. An agent should pick one — running both adds complexity without proportional value.

---

## Approach 1: Raw Embedding

### How it works

Every message (or turn) from the conversation is embedded directly and stored as a vector. No LLM involved. The original text is the memory.

```
User: "I just moved to Tokyo last month. Started at Google as a software engineer."

    ↓ embed (Nomic Embed v1.5, 768-dim, ~0.2s)

Store:
  text: "I just moved to Tokyo last month. Started at Google as a software engineer."
  embedding: [0.023, -0.041, 0.078, ...]
  source_conversation_id: "session-abc-123"
  timestamp: "2026-04-10T14:00:00Z"
```

Search embeds the query and finds similar messages:

```
Query: "Where does the user live?"

    ↓ embed query (~0.2s)
    ↓ cosine similarity against stored vectors (~0.05s)

Result:
  score: 0.82
  text: "I just moved to Tokyo last month. Started at Google as a software engineer."
  source_conversation_id: "session-abc-123"
```

### What accumulates over time

```
Session 1: "I'm thinking about moving to Tokyo"           → stored as vector
Session 2: "I've decided, I'm moving to Tokyo next month"  → stored as vector
Session 3: "I just arrived in Tokyo last week"              → stored as vector
Session 4: "Tokyo is great, I love living here"             → stored as vector
Session 5: "Yeah I still live in Tokyo"                     → stored as vector
```

Five vectors, all similar. Search returns all five. The consuming agent sees redundant results and must reason about which is current. No deduplication, no contradiction handling, no temporal awareness. The vector count grows linearly with conversation volume — permanently.

### Latency

- Ingest: ~0.2s (embed only)
- Search: ~0.3s (embed query + vector search)

### Source conversation linkage

Each stored message carries `source_conversation_id` and `timestamp`. The agent can request the full conversation from its session storage or from Pristine's `user_raw` record. Straightforward — the stored text IS the original message, so the link is direct.

### Who uses this

- Zep (conversation chunks + summaries)
- Most RAG systems (LangChain, LlamaIndex)
- Google NotebookLM (source document chunks)
- Mem0 in `infer=False` mode

---

## Approach 2: Fact Extraction + Temporal

### How it works

An LLM reads the conversation and extracts discrete factual statements with temporal annotations. Each fact is then embedded and stored. A second LLM call compares new facts against existing memories to decide: is this new (ADD), a refinement (UPDATE), a contradiction (SUPERSEDE), a retraction (DELETE), or already known (NOOP)?

```
User: "I just moved to Tokyo last month. Started at Google as a software engineer."
Assistant: "Welcome! How are you finding Tokyo?"

    ↓ LLM extract (~3-5s, one call)

Facts:
  { text: "User lives in Tokyo", validFrom: "2026-03", validUntil: null }
  { text: "User works at Google as a software engineer", validFrom: "2026-03", validUntil: null }

    ↓ embed each fact (~0.2s per fact)
    ↓ search existing memories for similar facts (~0.05s per fact)

Similar existing: none found (first session)

    ↓ LLM consolidate (~3-5s, one call)

Decisions:
  "User lives in Tokyo" → ADD (new fact)
  "User works at Google as a software engineer" → ADD (new fact)

    ↓ store both facts with embeddings
```

Search embeds the query and finds matching facts:

```
Query: "Where does the user live?"

    ↓ embed query (~0.2s)
    ↓ cosine similarity against fact vectors (~0.05s)

Result:
  score: 0.91
  text: "User lives in Tokyo"
  validFrom: "2026-03"
  source_conversation_id: "session-abc-123"
```

### What accumulates over time

```
Session 1: "I'm thinking about moving to Tokyo"
  → LLM extracts: "User is considering moving to Tokyo"
  → Consolidator: ADD (new fact)

Session 2: "I've decided, I'm moving to Tokyo next month"
  → LLM extracts: "User is moving to Tokyo next month"
  → Consolidator: SUPERSEDE (contradicts "considering" — now decided)
  → Old fact marked: validUntil=now, supersededBy=new

Session 3: "I just arrived in Tokyo last week"
  → LLM extracts: "User lives in Tokyo"
  → Consolidator: SUPERSEDE (now actually there, not just planning)
  → Supersession chain: considering → decided → lives there

Session 4: "Tokyo is great, I love living here"
  → LLM extracts: "User lives in Tokyo" 
  → Consolidator: NOOP (already known)

Session 5: "Yeah I still live in Tokyo"
  → LLM extracts: "User lives in Tokyo"
  → Consolidator: NOOP (already known)
```

One fact in the store: "User lives in Tokyo." Sessions 4 and 5 added nothing. The supersession chain records the evolution: considering → decided → lives there. Search with `temporalMode: 'current'` returns only the current fact. The vector count stays bounded — it grows with unique knowledge, not conversation volume.

### Latency

- Ingest: ~6-10s (LLM extract + embed + search similar + LLM consolidate + store). Runs as fire-and-forget after the agent turn — the user never waits.
- Search: ~0.3s (embed query + vector search). The query analyzer LLM call is optional and adds ~3-5s — skip it by default, use heuristic fallback.

### Source conversation linkage

Every extracted fact carries `source_conversation_id` pointing to the conversation that produced it. The full conversation is also stored as a `user_raw` memory record (not searchable — zero vector, archival only). The agent can retrieve the original conversation for context when a fact alone isn't sufficient.

For superseded facts, the chain is traversable:
```
"User lives in Tokyo" 
  → supersedes: "User is moving to Tokyo next month"
    → supersedes: "User is considering moving to Tokyo"
```
Each link carries `supersession_reason` explaining what changed and `source_conversation_id` for the conversation where the change happened.

### Who uses this

- Mem0 in `infer=True` mode (default) — extraction + consolidation, but no temporal metadata
- ChatGPT memory — extraction, but no consolidation or temporal
- Pristine — extraction + consolidation + temporal + supersession chains

---

## Why one and not both

Running both means:
1. Every message gets embedded raw (fast path)
2. Then the LLM extracts facts and embeds those too (slow path)
3. Search returns both raw messages and extracted facts
4. Fusion must rank and deduplicate across two different result types

The problems:

**Redundant results.** "I just moved to Tokyo last month" (raw) and "User lives in Tokyo" (fact) both match the same query. The agent gets duplicate information in different forms. Fusion can deduplicate by `source_conversation_id`, but now you're adding complexity to solve a problem you created.

**Conflicting signals.** The raw embedding of "I'm thinking about moving to Tokyo" (session 1) is still in the store even after the fact was superseded through "decided" → "lives there." Temporal supersession only applies to extracted facts, not raw embeddings. The raw path has no mechanism to invalidate stale messages. Search returns the outdated raw message alongside the current fact.

**The gap is too small to justify.** The only window where raw embeddings provide value that facts don't is the 6-10 seconds between `store()` and extraction completing. During that window, the conversation is still in the agent's context window — it doesn't need to search for what it just discussed. By the time the next session starts (seconds to days later), extraction is long finished.

**Double storage cost.** Every piece of information is stored twice — once as raw text + vector, once as extracted fact + vector. The raw embeddings grow linearly and never get cleaned up. The facts stay bounded via consolidation. Over months, the raw embeddings dominate storage and degrade search quality (more vectors = more noise in results).

**Pick the one that matches the use case:**
- Short-lived agents, no cross-session memory needed → raw embedding (or no memory at all — the context window is enough)
- Long-running agents, user knowledge persists across sessions → fact extraction + temporal

---

## Implementation comparison

Both approaches share the same infrastructure:

| Component | Raw Embedding | Fact Extraction + Temporal |
|-----------|--------------|---------------------------|
| **Embedding model** | Nomic Embed v1.5 (768-dim) | Same |
| **Vector store** | SQLite + sqlite-vec | Same |
| **Full-text search** | FTS5 on message text | FTS5 on fact text |
| **Storage format** | `memories` table | Same table |
| **Source linkage** | `source_conversation_id` per message | `source_conversation_id` per fact + `user_raw` archival record |
| **LLM required** | No | Yes — extraction + consolidation |
| **Deduplication** | Content hash only (exact match) | Semantic dedup via consolidation (LLM judges similarity) |
| **Temporal** | Timestamp only (when was it said) | validFrom/validUntil (when was it true) + supersession chains |
| **Contradiction handling** | None — all versions coexist | SUPERSEDE — old marked invalid, new linked |
| **Growth** | Linear with conversation volume | Bounded by unique knowledge |
| **Ingest latency** | ~0.2s | ~6-10s (fire-and-forget) |
| **Search latency** | ~0.3s | ~0.3s (same) |
