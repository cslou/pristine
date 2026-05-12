# Pristine — Implementation Spec 005: Source-Pointer Semantic Index

**Status:** Draft — Sprint 023 source-pointer cleanup target
**Last updated:** 2026-05-08
**Author:** Lou + Claude (paired across PR #94 wrap-up, research synthesis, and architecture alignment)

---

## Product Overview

Pristine is a local-first privacy and memory SDK for coding agents. The memory subsystem is a **source-pointer semantic index** — not a raw transcript store and not a compressed fact ledger — and exposes primitives that consumers compose into tools, hooks, and integrations. Host harnesses remain authoritative for raw conversations, threads, messages, JSONL files, or other source records; Pristine stores embeddings, indexed text/snippets, and optional source pointers so an agent can find the right source and inspect it in the owning system. No API calls, no server, no data leaving the device. This spec defines the memory subsystem's architecture after the pivot from extraction-based storage and raw-conversation ownership to source-owned semantic retrieval.

### Key References

- `docs/specs/implementation-spec-001.md` — original Pristine architecture
- `docs/specs/implementation-spec-003.md` — historical memory infrastructure; Sprint 023 preserves reusable embedder/sqlite/hook learnings but removes raw conversation-store and raw-transcript FTS/SQL ownership from the target architecture
- `docs/specs/implementation-spec-004.md` — privacy narrowed to secrets for developer use; same narrowing discipline applied here
- `docs/analysis/claude-mem-vs-pristine.html` — 21-slide comparison deck
- `docs/analysis/developer-memory-pain-research.html` — 55-source developer-memory-pain research deck
- PR #94 — `fix/gemma4-extraction-diagnostic` (extraction-fix work the pivot builds on)
- PR #95 — architecture-docs PR (claude-mem comparison, developer-memory-pain research)

---

## 0. Philosophy

Three principles shape every design decision in this spec. They are stated upfront because downstream sections lean on them.

### 0.1 The 2×2 of agent behavior

Every behavior a developer wants — or doesn't want — from a coding agent falls into one of four quadrants, cut across two axes: what the developer is **conscious** of wanting, and whether the agent should **do** or **not do** it.

|                         | Conscious                                | Unconscious    |
| ----------------------- | ---------------------------------------- | -------------- |
| **Agent should do**     | Recency, checklists, hooks *(harness)*   | Search tools   |
| **Agent should NOT do** | Recency, checklists, hooks *(harness)*   | *(empty)*      |

Three of the four quadrants are **harness problems** — enforced through hooks, injected checklists, and recency management. They belong to Claude Code, Cursor, Cline, Copilot — not to Pristine.

**Pristine owns only the top-right quadrant.** The agent doesn't know what it doesn't know, and the answer is *a search away*. Our job is to provide the search primitives and the index over the corpus that lets the agent find it. The conscious-should-do and conscious-should-not-do quadrants are out of scope — not because they're unimportant, but because they belong to a different layer of the stack.

### 0.2 Memory is a corpus, not a ledger

Production memory systems — mem0, claude-mem, Letta — extract atomic facts from conversations and store those facts as the memory. They compress at write-time to save tokens at read-time. This design is forced by their architecture: they don't store raw conversations as a queryable corpus, so extraction is the only way to build useable memory.

**Pristine's architecture is different.** Raw source records already live locally in the harness that produced them: Pi JSONL, another harness's SQLite store, project files, or future source-owned stores. sqlite-vec retrieval over source-indexed chunks is fast enough that Pristine does not need to mirror complete transcripts to be useful. The host agent is fully capable of synthesizing from primary sources once search returns the right pointer. Under these constraints, pre-compression and raw-transcript duplication are both tax — and lossy/risky tax, because they bake in write-time guesses and create competing sources of truth.

The right analogy is **llms.txt over pre-summarization**. Given a capable reader and fast access to primary sources, an index that points to content beats a summary that replaces it. Same principle applies to memory: source-owned records + semantic index beats compressed ledger or raw transcript mirror whenever the reader can search and inspect the authoritative source.

Consequence: **no fact extraction.** The existing extractor and consolidator modules are removed from the SDK entirely. There is no opt-in mode, no legacy flag, no dormant import path.

### 0.3 Primitives ship; opinions are reference implementations

Pristine ships **primitives** — composable, opinion-free building blocks that anything else can be built on top of. Anything opinionated — tools, hooks, file formats, integration wiring — is a **reference implementation** documented separately. Users can adopt references verbatim, fork them, or replace them entirely.

| Layer | Example |
|---|---|
| **Primitive** (core SDK) | `client.store(chunks)` |
| **Reference** | Pi JSONL `jsonl-index` extension that feeds active-session snippets/windows |
| **Primitive** | `client.recall(query, opts)` returning recalled chunks/snippets, scores, and source pointers |
| **Reference** (documented example, replaceable) | `pristine_recall` / `search_memory` tool that wraps vector search for agent tool-use |
| **Primitive** | embedder factory and configured vector dimension |
| **Reference** | Nomic local embedder setup and warmup docs |

The previous raw-transcript primitives — `indexer.ingest(turns)`, `storeAsync(conversation)`, `buildSessionVector(conversationId)`, `searcher.ftsSearch`, `searcher.hybridSearch`, `searcher.sessionVectorSearch`, and `searcher.sql(rawSql, opts?)` over `messages_public` / `conversations_public` — are not part of the target architecture unless explicitly reintroduced over source-index tables. Sprint 023 removes the current `searcher.sql(...)` raw-transcript read primitive rather than preserving a SQL surface that implies Pristine owns conversations/messages. A future source-index-only SQL debug primitive may be designed later, but it must not expose harness-owned raw context.

Reference implementations live in `examples/<harness>/<artifact-type>/<tool>/` (or as separately-versioned `@pristine/<harness>-<tool>` packages); see [`docs/conventions/reference-implementation-layout.md`](../conventions/reference-implementation-layout.md). Each human-facing installable artifact README opens with: *"This is one way to use Pristine primitives. You can write your own."*

This principle has teeth: if a feature requires an opinion (a file format, a hook matcher, a prompt shape, a tool schema), it is not a primitive. It is either a reference implementation or out of scope. Pristine may choose to ship any given reference or none; consumers are never blocked by the absence of one.

---

## 1. Why this spec exists

PR #94 (`fix/gemma4-extraction-diagnostic`) succeeded at its stated goal: gemma4:e4b now reliably extracts facts from dialogue-dense LOCOMO sessions, lifting the `--limit 1` baseline from 54 memories / 8 sessions to **83 memories / 10 sessions**. PR #95 followed with architectural docs — claude-mem comparison, developer-memory-pain research. But the work surfaced a deeper question: is fact extraction on small local models the right primary mechanism at all?

Two weeks of discovery — claude-mem architecture review, 55-source developer-pain research, and chunking-pattern research across seven shipping memory systems — converged on a reversal: **the extraction model is wrong for our constraints.** Production systems extract because they don't store raw corpora as queryable memory. Sprint 022 then proved Pristine can instead index source-owned snippets and return pointers into an authoritative harness store. Under those constraints, pre-compression and raw transcript mirroring are pure tax. The pivot is toward source-pointer semantic search with agent-driven navigation.

This spec captures that pivot. It supersedes the extraction-based memory design from spec-001 / spec-003 at the semantic layer while preserving reusable local embedder/sqlite lessons. Raw conversation-store and raw-transcript FTS/SQL surfaces are not preserved by the target architecture. **It is not a build plan.** Its job is to:

- Lock in the architectural direction so future decisions stay coherent
- Define the primitive/reference split that governs SDK surface decisions
- Frame remaining design questions clearly enough to validate with prototypes

**In scope:** primitives, philosophy, scope boundaries, the corpus architecture, validation experiments.

**Out of scope:** phase/story breakdown, sprint plan, file-level changes, specific reference implementation choreography. Those follow once primitives are validated.

---

## 1A. Sprint 023 target architecture: source-pointer semantic index

Sprint 022's Pi reference flow proved the target shape: Pi JSONL remains authoritative, Pristine indexes semantic snippets/windows, vector search returns a source pointer, and a harness skill/tool inspects the raw JSONL context only after retrieval identifies the relevant source. Sprint 023 generalizes that proof into the core SDK.

### 1A.1 Ownership boundary

External harness stores are authoritative for raw transcripts and source records. Pristine does **not** own raw conversations, threads, or messages in the target architecture and does not require a SQL mirror of them. Pristine owns only the semantic index:

- generated or caller-supplied chunk ID
- indexed text and/or snippet used for retrieval
- embedding vector with validated configured dimension
- nullable `source_kind`
- nullable `source_uri`
- optional source entry identifiers such as `entry_id`, `parent_id`, or equivalent harness IDs
- optional source range identifiers such as `line_number`, `line_start`, `line_end`, byte offsets, or token offsets when available
- optional timestamps such as `timestamp`, `timestamp_from`, or `timestamp_to`
- optional `metadata_json` for JSON-serializable harness metadata

Source metadata is intentionally optional. Indexing and search must work with only non-empty indexed text plus a generated chunk ID; every pointer field can be absent/null when the source system does not expose it.

### 1A.2 Minimal source chunk input

The canonical index input is conceptually:

```ts
interface SourceChunkInput {
  text: string;
  chunkId?: string;
  sourceKind?: string;
  sourceUri?: string;
  entryId?: string;
  parentId?: string;
  lineNumber?: number;
  lineStart?: number;
  lineEnd?: number;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}
```

Validation requirements:

- `text` is required, non-empty after trim, and bounded by the configured chunk text limit.
- `metadata` must be a JSON-serializable object, not an array or primitive, and no larger than 16 KiB once serialized.
- Embedding dimensions are validated before vector table creation and before vector writes/search.
- Stable source-pointer duplicate/replacement semantics must be documented and regression-tested before implementation is considered complete.

### 1A.3 Search result shape

The retained core search primitive is vector search over source chunks. It returns ranked hits with:

- `chunkId`
- `snippet` or indexed text preview
- `score`/rank
- optional source pointer fields (`sourceKind`, `sourceUri`, source entry/range identifiers, timestamps)
- optional metadata when safe and requested by the API contract

Search results must never require `conversationId`, `messageIds`, or raw-message joins. A harness that needs exact surrounding context uses the returned pointer to inspect its authoritative store.

### 1A.4 SQL primitive removal

The current public `searcher.sql(...)` primitive is removed in the target architecture because it exists to query curated views over raw transcript mirrors (`messages_public`, `conversations_public`, `messages_fts`, and `summaries_public`). Keeping that API would preserve the wrong ownership model. A future source-index-only SQL/debug primitive may be designed later, but it is not this sprint's contract and must not expose raw harness-owned context.

---

## 2. What's in place today

The historical memory pipeline as of the earlier corpus-search pivot was:

```
PostToolUse hook
    ↓
scripts/store.ts (createLite, <0.5s)
    ↓
SQLite outbox (conversations + pending_ingest_tasks, atomic)
    ↓
Detached extract-worker.ts (full PristineLocal)
    ↓
[REMOVED in this spec]
Per chunk (CHUNK_SIZE=20, OVERLAP=2):
  1. Extractor LLM call (gemma4:e4b via Ollama)
  2. Consolidator LLM call (gemma4:e4b via Ollama)
    ↓
SQLite + sqlite-vec + FTS5
    ↓
scripts/search.ts exposed as agent tool
```

PRs #94 and #95 are historical context. Current `main` has already removed extractor/consolidator behavior, but it still contains raw conversation/message ownership (`conversations`, `messages`, `messages_fts`, `vec_windows`, `vec_sessions`, `messages_public`, `conversations_public`) and conversation-centric APIs. Sprint 023 supersedes those raw-transcript ownership pieces with source-chunk indexing.

### Infrastructure preserved or reconsidered by this pivot

- `PostToolUse` hook wiring (ingestion entry point)
- SQLite outbox + `pending_ingest_tasks` queue
- Detached worker architecture
- `sqlite-vec` storage + embedder abstraction
- `FTS5` full-text index on conversations
- `scripts/search.ts` shape (repurposed as a reference implementation)

### Infrastructure removed in this pivot

- `src/memory/extractor/` — prompt-based LLM extraction of atomic facts
- `src/memory/consolidator/` — LLM-based ADD/UPDATE/NOOP/SUPERSEDE/DELETE judgments
- LOCOMO-aimed prompt in `src/memory/extractor/prompts.ts`
- Extractor/consolidator exports from `src/index.ts`
- Associated tests under `tests/memory/extractor/` and `tests/memory/consolidator/`

These modules are deleted from the SDK. No opt-in mode, no legacy flag, no dormant import path. Consumers who want fact extraction can fork from a historical commit or build their own on top of the primitives in §5.1.

---

## 3. Findings from discovery

Five observations, across PR #94 diagnostic work, the claude-mem comparison, and two research deep-dives.

### 3.1 Fact extraction is fragile on small local models

Two days of diagnostic work surfaced multiple failure modes that were brittle, prompt-dependent, and only diagnosable with custom probe scripts:

- **Prompt sensitivity** — `SENSITIVE_PLACEHOLDER_RULES` caused `{facts:[]}` on every placeholder-free transcript.
- **Mode ambiguity** — gemma4's dual structured-output + function-calling training let it emit `{facts:[]}` as a legitimate "I chose not to call" response.
- **Markdown fence mimicry** — schema embedded in ` ```json ` fences caused responses to mimic the wrapper.
- **Output truncation** — consolidator batch calls truncated mid-JSON when fact count × similar-memory count exceeded `num_predict=4096`.
- **Sampler instability** — at `temperature=0`, gemma4:e4b produced different outputs across runs on the same input.

**Each failure mode required custom tooling to even detect.** This is a structural mismatch between asking a 3.6B-parameter model to produce strict JSON over multi-paragraph instructions and relying on that output being usable without manual review.

### 3.2 Extraction is the wrong abstraction for our constraints

Production memory systems (mem0, claude-mem, Letta) extract because they don't store raw conversations as queryable corpora. Their extraction is a forced move. Pristine's current prototype proved local vector retrieval is fast enough to retrieve source-owned snippets without pre-extraction; under these constraints, pre-extraction is a lossy compression step with no payoff.

Moving extraction from a weak local model to the host agent (as claude-mem does) improves quality but doesn't fix the abstraction mismatch — it just makes extraction more expensive. claude-mem spends ~2× the tokens of an equivalent corpus-search system because every `Stop` / `PreCompact` / per-tool-observer call pays an LLM roundtrip that wouldn't be needed against a raw log.

The chunking research (see `docs/analysis/`) confirmed: no shipping system embeds raw dialogue turns with token-window chunking — because they all pre-extract. Our constraint set is genuinely different, and the right move is to stay in corpus mode rather than inherit an architectural shape designed around cloud-hosted ledgers.

### 3.3 Our default prompt targets LOCOMO personal-life facts

The current extractor prompt targets personal preferences, personal details, plans, activities, health, professional details, and misc facts — the LOCOMO benchmark's shape. These are not the facts a coding agent needs. Even a perfect implementation against this taxonomy would produce memories of marginal value to the developer using Pristine.

This observation stood at PR #94 wrap-up; the pivot in §0.2 obsoletes it by removing the extraction step entirely.

### 3.4 Developers want search + handoff, not a fact ledger

55-source research across X, GitHub, HN, blogs (see `docs/analysis/developer-memory-pain-research.html`) found the real developer asks are:

- *"What was I doing last session?"* (handoff / resume)
- *"Did we discuss X?"* (search through history)
- *"What did we decide about Y?"* (decision recall)
- *"Remember this so we don't hit it again"* (explicit capture)

Every one is a **search/retrieve operation against a corpus**, not a lookup against a pre-compressed fact ledger. The emergent product spec from developers (Lucas Beyer's self-maintaining MEMORIES.md, jongeibel's "commit to memory button", awesamarth_'s handoff pattern) all describe corpus-based architectures, not extraction-based ones.

### 3.5 Session-start injection is a harness concern, not a primitive concern

Session-start research across Cursor Memories, Cline Memory Bank, Claude Code CLAUDE.md, Aider conventions, Continue rules, and Copilot Spaces showed strong patterns: markdown-in-repo, ≤500 lines, startup-only hook, transparency UX, aggressive decay. **But these are all harness-level decisions** — belonging to the conscious-should-do quadrant of §0.1. They inform how *reference implementations* should be built, not what Pristine's core primitives expose. Pristine itself stays out of session-start choreography.

---

## 4. Scope — what Pristine's memory is for

Reframing the design question given the pivot.

### 4.1 What Pristine provides

Pristine provides the **primitives** needed to index source-owned records and retrieve them semantically:

- **Index** source chunks/snippets with vector embeddings and optional source pointers/metadata
- **Search** the semantic index via vector retrieval, returning snippets plus source pointers
- **Replace/delete** indexed chunks by stable chunk ID or stable source pointer when the source changes
- **Embed** text via a swappable local embedder (default: Nomic v1.5 through `@huggingface/transformers`)

That is the complete functional scope of the core SDK. Pristine does not ingest raw turns as an authoritative transcript store and does not expose a raw-transcript SQL query primitive. Everything a consumer wants to build around these primitives — tools for agent tool-calling, source-inspection skills, hook scripts, markdown-file integrations, or condensation generators — are reference implementations documented separately.

### 4.2 Retrieval queries the primitives must support

The primitives must support the recall situations developers actually have through source-pointer retrieval and harness-owned context inspection. These drive API shape, not feature count:

- **Semantic query** — *"something about the extractor truncating"* → vector search across indexed source chunks
- **Scoped source filter** — *"what did we discuss yesterday in this repo"* → vector search narrowed by project and optional source metadata/timestamp fields
- **Decision recall** — *"why did we go with sqlite-vec"* → source-chunk hits plus source pointers for harness-side context inspection
- **Handoff context** — *"last session's summary"* → a harness/reference can index summary chunks with source metadata, then inspect the owning source on demand

Exact keyword search, hybrid retrieval, source-context expansion, and summary maintenance are reference or future-extension concerns unless implemented over source chunks without reintroducing raw transcript ownership. The core target primitives are listed in §5.1.

### 4.3 What Pristine does NOT provide as core SDK

- A `search_memory` tool — **reference implementation** that wraps source-chunk vector search and source-pointer formatting
- A `search-session-history` or equivalent source-inspection skill — **reference implementation** that reads the authoritative harness store after vector search returns a pointer
- A `MEMORY.md` file or format — **reference implementation** specific to filesystem-based consumers
- A session-summary generator — **reference implementation** that writes summaries to a harness-owned file/store or indexes them as source chunks
- Ingestion hook wiring — **reference implementation** of a harness-specific source-chunk indexing script

Each reference implementation is optional. Pristine may or may not ship any given one. Users are expected to fork or rewrite them as their harness requires.

### 4.4 Scope boundary: harness vs memory

The 2×2 in §0.1 cleanly separates our concerns from the harness's:

| Concern | Pristine | Harness |
|---|---|---|
| What to store | X | |
| How to retrieve | X | |
| When to retrieve (triggers) | | X |
| How to present results to the agent | | X |
| Behavioral enforcement (checklists, hooks) | | X |
| Session-boot context injection | | X (using our primitives) |

---

## 5. Design direction

This section splits into primitives (what the core SDK exposes) and reference implementations (what we may or may not choose to ship as examples).

### 5.1 Core SDK primitives

Primitives live in `src/`. Anything that wraps them for a specific host environment (a tool-calling agent, a harness hook, a CLI) is a **reference implementation**, not a primitive — see §5.2 for the layout convention (`examples/<harness>/<artifact-type>/<tool>/` source dirs, `@pristine/<harness>-<tool>` published packages).

#### 5.1.1 Source-index storage

```
client.store(chunks: SourceChunkInput[], opts: { projectId: string }): Promise<StoredMemory[]>
client.recall(query: string, opts: { projectId: string; limit?: number }): Promise<RecalledMemory[]>
client.forget(chunkIds: string[], opts: { projectId: string }): Promise<ForgetResult>
```

Source chunks are the storage contract. A chunk has required non-empty `text`, a generated or caller-supplied `chunkId`, an embedding, and optional source pointer fields. Pristine persists indexed text/snippet and pointer metadata, not raw conversation/thread/message ownership. Project scoping is required on all queries; the projectId source (git root vs. workspace dir vs. config) is discussed in §6.

The source-index schema stores nullable source fields (`source_kind`, `source_uri`, source entry/range identifiers, timestamps) plus bounded `metadata_json`. The vector table uses sqlite-vec `float[N]` where `N` is the configured embedder dimension and is validated before interpolation.

#### 5.1.2 Indexing

```
interface SourceChunkInput {
  text: string;
  chunkId?: string;
  sourceKind?: string;
  sourceUri?: string;
  entryId?: string;
  parentId?: string;
  lineNumber?: number;
  lineStart?: number;
  lineEnd?: number;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}
```

Indexing embeds each chunk and writes text/snippet, vector, and metadata atomically. Project scope is required at the indexing call boundary (`opts.projectId`) but is not source metadata; minimal metadata still means a chunk can provide only non-empty `text` and receive a generated chunk ID. The primitive must support three metadata levels: full pointer metadata, partial metadata, and text-only indexing with a generated chunk ID. Stable source-pointer duplicate/replacement behavior is part of the primitive contract and must be deterministic: indexing the same stable source pointer can either replace the existing row or follow documented duplicate behavior, but tests must pin the choice.

Harness-specific windowing is a reference concern. For Pi, `examples/pi-dev/extensions/jsonl-index/` indexes active-session JSONL user/assistant snippets/windows with Pi source pointers. Another harness may index message windows, file sections, log entries, or summaries, but Pristine's core API sees all of them as source chunks.

#### 5.1.3 Retrieval

```
client.recall(query: string, opts: { projectId: string; limit?: number }): Promise<RecalledMemory[]>
```

Recall options currently support project scope and an optional result limit. A recalled memory returns `chunkId`, snippet/indexed text preview, score/rank, and optional source pointer fields. It never requires `conversationId`, `messageIds`, or raw-message joins. Source metadata filters are a future extension unless added through a typed public API change.

FTS, hybrid, session-vector, and SQL retrieval from the raw-conversation design are not target primitives unless adapted to source chunks in a later reviewed design. The default Sprint 023 cleanup removes them when they depend on `conversations`, `messages`, `messages_fts`, `vec_sessions`, or raw transcript public views.

#### 5.1.4 Embedding

```
embedder.embed(text): Promise<Vector>
embedder.embedBatch(texts): Promise<Vector[]>
```

Default: Nomic Embed v1.5 via `@huggingface/transformers`, 768 dimensions, 8192-token window, CPU inference. Users can swap in any embedder matching the interface. No dimension padding, no remote service.

### 5.2 Reference implementations

The canonical layout convention lives at [`docs/conventions/reference-implementation-layout.md`](../conventions/reference-implementation-layout.md). The summary below restates the rules; the conventions doc is the source of truth.

Each reference lives **outside `src/`** so it is structurally distinct from the SDK primitives it composes. Two artifact shapes are supported:

1. **Source-tree examples (initial form):** `examples/<harness>/<artifact-type>/<tool>/` — one directory per installable reference artifact. The `<harness>` segment names the host environment the reference targets (`pi-dev`, `claude-code`, `cursor`, ...). The `<artifact-type>` segment names the host artifact category users recognize (`extensions`, `skills`, `hooks`, `commands`, ...). The `<tool>` segment names the reference itself (`search-memory`, `query-memory`, `session-start-hook`, `post-tool-use-ingest`, ...). Source examples are the entry shape — fastest to iterate, easiest to fork.
2. **Published adapter packages (mature form):** `@pristine/<harness>-<tool>` — promoted from the source-tree example once the reference stabilises and a downstream consumer wants `npm install` rather than copy-paste. The promotion preserves the `(harness, tool)` axes from the source layout so the package boundary mirrors the directory boundary.

The two shapes coexist: a reference can live as `examples/pi-dev/extensions/search-memory/` while still incubating, and graduate to `@pristine/pi-dev-search-memory` once it ships externally. Either way, the **boundary against the primitives is the same**: a reference depends on `@pristine/shield-local` (or its successors) the way any external consumer would, and never reaches into `src/` internals.

This split mirrors the package convention proposed in PR #153 (Draft `implementation-spec-006.md` §13) for the privacy / tool-wrapper surface (`@pristine/privacy-core` engine + `@pristine/pi-privacy` adapter): primitives are runtime-agnostic; adapters are runtime-specific. The same axis applies to reference search/query tools — they are runtime-specific and never become canon for the SDK.

Why split by `(harness, tool)`:
- **No conflation.** A reviewer (or a `git log`) sees immediately whether a change belongs to a primitive or to a harness adapter; primitives stay in `src/`, adapters never do.
- **Per-harness lifecycle.** Each harness adapter can adopt or pin a specific SDK version, ship its own README/CI/release notes, and be owned by a different person from the SDK core.
- **Clean dep graph.** A pi-dev consumer who wants only the search-memory adapter does not have to install Claude Code's hook script or the SessionStart wrapper.

Each reference opens with *"This is one way to use Pristine primitives. You can write your own."*


### Pi JSONL source-pointer reference flow

Sprint 022 adds a source-tree Pi reference under `examples/pi-dev/` before the core source-pointer cleanup. The flow keeps Pi JSONL as the source of truth and uses Pristine as a semantic index over source-owned records:

1. `examples/pi-dev/extensions/jsonl-index/` parses the active Pi session JSONL on `agent_end` and `session_start` reconciliation, indexing user/assistant text snippets with `sourceKind: 'pi-jsonl'`, `sourceUri`, `entryId`, `parentId`, `lineNumber`, `timestamp`, and `cwd`.
2. `examples/pi-dev/extensions/search-memory/` exposes `pristine_recall`, which searches `~/.pi/pristine/pristine.db` (or `PRISTINE_DB_PATH`) and returns ranked hits plus JSONL source pointers.
3. `examples/pi-dev/skills/search-session-history/` is a Pi skill that uses the returned pointer to inspect bounded user/assistant context directly from the authoritative JSONL file with existing `bash`/`read`/jq tools.

This reference intentionally does not mirror raw Pi transcripts into a Pristine conversation store. The evidence from this flow informs the later architecture cleanup that formalizes source-pointer indexing across hosts.


#### Candidate reference set (each may or may not ship)

- **`search_memory` / `pristine_recall` tool** — JSON-schema tool wrapper for Claude / Cursor / Pi / any tool-calling agent. Composes source-chunk vector search and formats snippets plus source pointers.
- **Source-inspection helper or skill** — given a returned pointer, reads bounded context from the authoritative harness store (for example Pi JSONL via `search-session-history`).
- **Harness indexing hook** — feeds source chunks into `store` on a harness-specific event such as `agent_end`, session close, file save, or explicit user command.
- **`MEMORY.md` maintainer** — optional reference that writes timestamped summaries to a project-scoped markdown file or indexes summary text as source chunks with file pointers.
- **Session-summary generator** — optional reference that calls a host LLM and then writes to a harness-owned source store or indexes generated summary chunks. LLM, prompt, and schema are consumer opinions.

None are required for Pristine to function as an SDK. A consumer can build any of them from the primitives with a weekend of work.

> **Historical note:** The remaining subsections in this spec were written for the prior raw-conversation corpus design and are retained only as research/background until Sprint 023 finishes the cleanup. Where they mention `conversations`, `messages`, `messages_public`, `messages_fts`, `vec_sessions`, `storeAsync`, `indexer.ingest`, `hybridSearch`, neighbor expansion over `searcher.sql`, `query_memory`, or raw-SQL tools, those references are **not** the target architecture. The target architecture for implementation is §1A plus §5.1: source-owned records, source chunks, vector search returning pointers, and removal of the current raw-transcript `searcher.sql(...)` primitive.

#### Historical migration recipe — keyword search across a project's conversations

Pristine v0.x exposed `client.searchConversations({ userId, keyword, ... })` as a built-in. v1 removes that method (sprint-019 Story 5) — keyword-search composition belongs at the consumer / reference-tool layer, not on the SDK surface. The canonical replacement is a project-scoped raw SQL query against the public-view allowlist:

```ts
import { PristineLocal } from 'pristine';

// Caller-supplied helper that wraps each whitespace-separated term in
// double quotes so FTS5 doesn't interpret `-` as NOT or other syntax.
const escapeFts5Query = (keyword: string): string =>
  keyword
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');

const client = await PristineLocal.create({ ... });

// Caller MUST validate / clamp `limit` before calling — see precondition
// notes below; pass the clamped value as the third positional parameter.
// `Math.trunc(Number(...))` is used instead of `| 0` because the bitwise
// OR wraps to a negative 32-bit integer for inputs ≥ 2^31, which would
// then clamp to 1 and silently underdeliver results.
const limit = Math.min(Math.max(Math.trunc(Number(callerLimit)) || 0, 1), 1000);

const rows = await client.searcher.sql(
  `SELECT m.id, m.conversation_id, m.role, m.timestamp,
          snippet(messages_fts, 0, '<b>', '</b>', '...', 32) AS snippet
   FROM messages_fts
   JOIN messages_public m ON m.id = messages_fts.rowid
   WHERE messages_fts MATCH ? AND m.project_id = ?
   ORDER BY rank
   LIMIT ?`,
  { params: [escapeFts5Query(keyword), projectId, limit] },
);
```

**Returned shape:** one row per matching message — the legacy method returned one row per conversation, so consumers that need conversation-grouped output should aggregate by `conversation_id` after the call.

**Scope difference:** the recipe is scoped by `project_id` (exposed on `messages_public`), not by `user_id` (the underlying `conversations.user_id` is not exposed on `conversations_public`). Consumers whose user-to-project mapping is 1-to-many can compose multiple per-project recipe calls.

**Caller-side preconditions** (caller MUST enforce; the SDK does not):

1. **`limit` is a positive integer in `[1, rowCap]`** (`rowCap` defaults to 1000). Validate / clamp before calling — reject `limit = 0` and `limit < 0` rather than passing them through. SQLite's behavior on non-positive `LIMIT` is surprising: `LIMIT 0` returns zero rows silently (valid SQL); `LIMIT -1` is treated as "unlimited" so the SDK's row-cap cursor becomes the only bound (still bounded but degraded UX).
2. **HTML-escape the `snippet` column before browser insertion.** The body is user-supplied content stored in `messages_public.content`, so the snippet string can contain `<script>`, HTML entities, or other browser-active payloads independent of the `<b>` / `</b>` markers or the `keyword` argument. Escape the entire snippet string before insertion into the DOM (escape first, then re-substitute neutral wrapper tokens for the bold markers if the UI wants emphasis). XSS risk applies to the body content, not just the markers.
3. **Watch the row-cap-truncation interaction on multi-project corpora.** The FTS5 MATCH executes BEFORE the `project_id` filter narrows results. If the cross-project FTS hit set exceeds `rowCap`, the row-cap cursor truncates BEFORE the project filter narrows results, producing silently-incomplete project-scoped output. Mitigation: increase `rowCap` proportional to corpus cross-project breadth, or scope to single-project use until a `messages_fts_per_project` view ships.

The recipe-equivalence integration tests at `tests/integration/searcher-sql-recipe.test.ts` cover three representative inputs (different keyword, different project, empty result) plus a project-scoped-leakage check.

### 5.3 Removal of the extractor and consolidator

`src/memory/extractor/` and `src/memory/consolidator/` are removed entirely from the SDK along with their tests and public-index exports. No opt-in flag, no dormant module, no alternative pipeline. The corpus-based primitives in §5.1 replace them. Consumers who need fact-ledger semantics can build on top of the primitives or fork a historical commit; it is not Pristine's surface.

### 5.4 Reference repos

Repos whose patterns informed this architecture. See `docs/analysis/` for the full comparisons.

| Repo | Why relevant | Pattern to adopt | Pattern to avoid |
|------|--------------|------------------|------------------|
| thedotmack/claude-mem | Dominant Claude Code memory plugin (61k+ stars); local-first sqlite + vector | PostToolUse / Stop hook wiring (for reference impls); SHA-256 content-hash dedup with a time-windowed guard; per-field semantic splitting when vectorizing structured records | ChromaDB subprocess + Express daemon + observer Claude subprocesses; extraction-default pipeline; zero memory-recall benchmarks |
| mem0ai/mem0 | Largest fact-extraction memory system (53k+ stars) | `infer=False` raw-message escape-hatch pattern; UUID→integer remapping to prevent extraction-prompt hallucination | Cloud-first architecture; fact extraction as the default path |
| letta-ai/letta | MemGPT lineage, agent-authored archival | Summarizer-based context compression (sliding window); file-processor chunking strategy (`CodeSplitter` for code, `MarkdownNodeParser` for docs) | pgvector padding to `MAX_EMBEDDING_DIM`; reliance on agent-called `archival_memory_insert` |
| getzep/graphiti | Message-boundary-preserving chunker | "Never split mid-message" rule; density-gated chunking (only when entity-rich); token-aware window with parent-link metadata | Neo4j dependency; fixed 4-chars-per-token estimate (off by 30%+ on code and JSON) |
| run-llama/llama_index | Broad retrieval ecosystem | `SentenceSplitter` / `SemanticSplitterNodeParser` as oversize-fallback reference; batched-by-user-message as a benchmarkable alternative in §8.1 | Deprecated `VectorMemory` (turn-pair vectors) |
| jina-ai/late-chunking | Long-context embedding research | Token-span chunking over pre-embedded long context (if we later adopt Nomic's 8192 window fully) | Not a v1 adoption — pure-JS Nomic integration of late-chunking is non-trivial |

> **Historical note:** Sections 5.5–5.9 below are the prior raw-conversation target stack/diagram/module map/repo structure/decision table. They are retained as background only until Sprint 023 cleanup deletes or rewrites them. The current target architecture is §1A plus §5.1.

### 5.5 Historical stack

- **Language:** TypeScript (strict mode, ESM only)
- **Runtime:** Node.js 20+ (Bun has known incompatibilities with `better-sqlite3`)
- **Storage:** SQLite via `better-sqlite3` (synchronous, file-backed, single-file deploy)
- **Vector index:** `sqlite-vec` (vec0 virtual table — no Python, no daemon, no subprocess)
- **Full-text:** SQLite FTS5 (built-in, BM25-ranked, porter stemmer)
- **Embedder:** Nomic Embed v1.5 via `@huggingface/transformers` (768-d, 8192-token window, CPU-viable)
- **Harness targets (via reference impls):** Claude Code (primary dogfood), Cursor, Cline, Continue
- **Test framework:** Vitest
- **Hard constraints:** No external services. No network calls at SDK runtime. No daemon. No subprocess. Single-file deploy.

### 5.6 Historical system diagram (prior target state)

```
                     [Host agent / harness]
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
    [Reference:        [Reference:         [Reference:
     search_memory      SessionStart        PostToolUse
     tool]              hook]               ingestion]
           │                  │                  │
           ▼                  ▼                  ▼
    ╔══════════════════════════════════════════════╗
    ║             Pristine Core SDK                ║
    ║                                              ║
    ║  searcher       indexer        store         ║
    ║  - vector       - ingest       - addConv     ║
    ║  - fts          - chunk        - addMessage  ║
    ║  - hybrid       - embed        - addSummary  ║
    ║  - sql          - index        - getSummaries║
    ║  (neighbor expansion is         - query       ║
    ║   a reference helper, not                     ║
    ║   a primitive)                                ║
    ║                                              ║
    ║  embedder.embed(text) → Vector (Nomic v1.5)  ║
    ╚══════════════════════════════════════════════╝
                          │
                          ▼
             ┌────────────────────────────┐
             │     SQLite (single file)   │
             │                            │
             │  conversations             │
             │  messages                  │
             │  summaries                 │
             │  vec_windows (sqlite-vec)  │
             │  window_messages           │
             │  vec_sessions (sqlite-vec) │
             │  messages_fts (FTS5)       │
             │  *_public views            │
             └────────────────────────────┘
```

### 5.7 Historical module overview

- **Core Layer** (`src/core/`) — types, interfaces, errors, database bootstrap, shared utilities
- **Storage Layer** (`src/memory/store/`) — conversations, messages, summaries; stable public views; read-only SQL surface
- **Indexing Layer** (`src/memory/indexer/`) — per-message ingestion, oversize-message chunking, embedding orchestration, FTS5 insert
- **Retrieval Layer** (`src/memory/searcher/`) — vector / FTS / hybrid / SQL search; hit expansion (±N neighbors)
- **Embedder Layer** (`src/embedder/`) — Nomic Embed v1.5 default via `@huggingface/transformers`; swappable `Embedder` interface
- **Engine Layer** (`src/engine/`) — LLM clients used only by reference implementations that need an LLM (summary generator, etc.); **not** a core primitive
- **Privacy Layer** (`src/privacy/`) — unchanged per spec-004 (secret redaction for developer use)
- **Reference Implementations** (`examples/<harness>/<artifact-type>/<tool>/` or `@pristine/<harness>-<tool>` packages — see [`docs/conventions/reference-implementation-layout.md`](../conventions/reference-implementation-layout.md)) — `search_memory` tool, `SessionStart` hook for Claude Code, `MEMORY.md` maintainer, session-summary generator, PostToolUse ingestion script

### 5.8 Historical repo structure (prior target)

```
pristine/
├── src/
│   ├── core/                    # types, interfaces, errors, db bootstrap
│   ├── memory/
│   │   ├── store/               # conversations, messages, summaries, views
│   │   ├── indexer/             # per-message ingestion + oversize chunking
│   │   └── searcher/            # vector/fts/hybrid/sql
│   ├── embedder/                # Nomic default + swappable interface
│   ├── engine/                  # llm clients (for reference impls only)
│   ├── privacy/                 # unchanged (spec-004)
│   └── index.ts                 # public API surface
├── tests/
│   ├── memory/{store,indexer,searcher}/
│   ├── embedder/
│   └── integration/
├── docs/
│   ├── specs/                   # implementation-spec-*.md
│   ├── sprints/                 # sprint-*.md
│   ├── examples/                # reference implementations
│   │   ├── search-memory-tool/
│   │   ├── session-start-hook/
│   │   ├── memory-md-maintainer/
│   │   ├── summary-generator/
│   │   └── posttooluse-ingestion/
│   └── analysis/                # research decks
├── scripts/                     # current CLI scripts (reframed as examples)
├── benchmarks/memorybench/      # eval harness
└── package.json

REMOVED IN THIS PIVOT:
├── src/memory/extractor/
├── src/memory/consolidator/
├── tests/memory/extractor/
└── tests/memory/consolidator/
```

### 5.9 Historical technical decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary retrieval strategy | Raw-corpus with vector + FTS + SQL | §0.2 — memory is search, not compression. Local storage + sub-ms retrieval removes the reason to pre-extract. |
| Embedding unit | Sliding-window (primary, `windowSize=3` / `windowOverlap=1` defaults, tunable via `IndexerConfig`) + session-level concatenation (secondary) | §5.1.2 — short context-dependent turns have no standalone signal; sliding-window bakes the exchange into the vector. Per-message retained as a benchmarked alternative in §8.1. |
| Oversize message handling | Never split mid-message (Graphiti rule); 3000-token threshold; AST / paragraph fallback with 200-token overlap | §5.1.2 — tool outputs and code blocks must stay intact. |
| Storage engine | SQLite via `better-sqlite3` + `sqlite-vec` + FTS5 | Single-file, no daemon, no subprocess. ChromaDB's operational complexity was our headline critique of claude-mem. |
| Embedder | Nomic Embed v1.5 (768-d, 8192 window) | CPU-viable, no padding, no network, `@huggingface/transformers` integration exists. |
| Fact extraction | Removed entirely | §0.2, §5.3 — structural mismatch with corpus architecture. |
| SQL surface | Read-only connection + row cap + query timeout + stable public view | §5.1.3 — DoS prevention and schema stability. |
| Primitive / reference split | Core = opinion-free primitives; opinionated layers = reference implementations | §0.3 — composability over prescription. |
| Project scoping | On by default; mechanism TBD (git root vs workspace dir) | Cross-project memory bleed is a known failure mode (research, §3.5). |
| Eval strategy | LOCOMO as regression-only; dogfood coding-session corpus is the primary target | §3.3, §7 non-goal 9, §8.5. |

---

> **Historical sections note:** Sections 6 and later are prior raw-conversation design notes, validation plans, schema sketches, flow diagrams, and phase checklists. They are not the Sprint 023 target where they conflict with §1A or §5.1. Sprint 023 implementation must update or delete those legacy sections as code removal proceeds; Story 1's architectural source of truth is §1A plus §5.1.

## 6. Open questions

Triage from prior version: items resolved by this pivot, items still open, and items newly surfaced by the architectural commitment.

### Resolved by this pivot

- ~~Auto-injection vs tool-only retrieval~~ → out of core scope (harness concern); both live as possible reference implementations.
- ~~Agent-authored vs auto-extracted durable facts~~ → neither; no extraction layer at all in the default path.
- ~~Per-tool-call observation layer~~ → no (claude-mem-style per-tool extraction is not added).
- ~~Backwards compatibility with existing extracted data~~ → pre-1.0; clean break acceptable. Existing memories can be rebuilt by re-indexing raw conversations.
- ~~Storage: `sqlite-vec` vs ChromaDB~~ → sqlite-vec. ChromaDB's daemon + subprocess complexity violates single-file local-first.
- ~~Storage unit for embeddings~~ → sliding-window (primary, `windowSize=3`, `windowOverlap=1` defaults) + session-level (secondary) per §5.1.2. Per-message remains benchmarked in §8.1.
- ~~Session-start injection format~~ → harness concern; not a primitive.

### Still open

1. **Project-scoping mechanism.** Git root via `git rev-parse --show-toplevel`? Workspace dir? Explicit `projectId` override only? Behavior for projects without a git root. Prototype required.

2. **Sliding-window parameter defaults.** Starting point: `windowSize=3`, `windowOverlap=1`. Alternatives to benchmark on dogfood corpus: `(4, 2)` for more context, `(2, 1)` for finer granularity, `(3, 2)` for heavier coverage. Both values exposed via `IndexerConfig` so consumers can retune without forking. §8.1 drives the locked-in default.

3. **Chunking boundary for oversize messages.** "Never split mid-message" handles the common case. For code blocks, split at AST boundaries (tree-sitter)? For long JSON tool outputs, split at top-level object boundaries? Concrete fallback algorithm needed.

4. **Hybrid-search scoring.** Reciprocal rank fusion (RRF) is the standard; confirm weights empirically before locking defaults.

5. **Summary metadata shape.** `store.addSummary(sessionId, text, metadata)` — text is opaque; metadata `Record<string, unknown>` vs. lightly-typed slots (tags, author, schema-version)? Lean toward unknown for flexibility; revisit if consumers duplicate the same metadata fields.

6. **Eval target post-LOCOMO.** LOCOMO stays as regression eval. Primary target shifts to coding-session recall — record real sessions and write recall questions, or adopt LongMemEval's coding subset if available.

7. **Embedder choice confirmation.** Nomic v1.5 (768d, 8192 window, CPU-viable) vs. a smaller default (all-MiniLM-L6-v2, 384d). Measure retrieval quality on a coding corpus before locking in.

8. **Read-path caching.** Hot vector searches within a session can be cached. Primitive concern or reference concern? Default: reference — caches are opinionated.

9. **Entity-retrieval path (future work).** Frontier conversation-memory systems (REM Labs 90%, Memento 92%, Memoria ~89% on LongMemEval) include a third parallel retrieval path alongside vector and FTS: an **entity index** that catches identifier-flavored queries (file paths, function names, CAPS_CASE constants, SHAs, error codes, package names, PR refs, URLs). For coding-agent corpora these queries are a large share of recall traffic, and both vector search (Nomic wasn't heavily trained on code-style identifiers) and FTS5 (default tokenizer splits `DEFAULT_BATCH_MAX_TOKENS` into four words, creating noise) handle them imperfectly. Evidence suggests adding an entity path is the single largest remaining gap between our current design and SOTA on conversation-memory benchmarks.

    Proposed zero-LLM starting shape:

    - At ingestion, regex-extract entities per message — file paths, URLs, SHAs, `SCREAMING_SNAKE_CASE` constants, backtick-quoted identifiers, `#NNN` PR/issue refs, function-call-shaped tokens, npm package names, shell flags, error codes.
    - New tables: `entities (id, text, normalized_form)`, `message_entities (message_id, entity_id)`.
    - New primitive: `searcher.entitySearch(entity: string, filters, limit): Hit[]`.
    - Extend `hybridSearch` to fuse vector + FTS + entity via RRF.
    - Extend `Filters` with `mentions: string[]` so any retrieval call can narrow to turns mentioning specific entities.

    Future directions to research before implementing:

    - **Is regex enough?** Frontier systems (Memento) use tiered entity resolution — exact → fuzzy → phonetic → embedding-based → LLM tie-break. Regex approximates the exact-match tier only. Worth benchmarking regex-only vs. tiered (with a small NER model or opt-in LLM extraction) on a dogfood corpus before committing.
    - **Which entity patterns to ship?** The pattern list needs empirical tuning — which patterns catch real recall-relevant entities without flooding the index with false positives in coding-agent prose.
    - **Does it still matter once §8.1 chunking benchmark is in?** Sliding-window already improves context preservation; the marginal lift from entity path on top of sliding-window should be measured, not assumed.
    - **Cross-harness generality.** Coding-agent corpora have dense identifier traffic; general-purpose conversations do not. If Pristine stays developer-focused, entity path is high-value. If scope broadens, the case weakens.

    Not in scope for v1 primitives. Revisit after §8.1 benchmark results + real dogfood usage.

---

## 7. Goals and non-goals

### Goals

1. **Primitives that anything can build on.** Every feature a consumer needs should be expressible as a composition of the §5.1 primitives. If it isn't, the missing capability becomes a primitive — not a reference.
2. **Sub-millisecond local retrieval** for both semantic and keyword queries. Local-first, no network, no daemon, no subprocess.
3. **Stable primitive API.** Public types, storage schema, and public views evolve slowly and with explicit deprecation cycles. Reference implementations can churn freely.
4. **Hard privacy boundary.** SQL access is read-only through a stable public view; sensitive surfaces (vault, any future secret store) never reachable via the SQL primitive. Row caps + query timeouts prevent DoS.
5. **Dogfoodable via reference implementations.** Ship enough reference examples (even if docs-only) that a Claude Code user can have a working memory system in an hour.

### Non-goals

1. **A tool-call schema.** Not our format; reference only.
2. **A hook wiring choreography.** Not our concern; reference only.
3. **A file-format standard (`MEMORY.md`, CLAUDE.md integration, etc.).** Reference only.
4. **A prompt shape for summarization.** Reference only; users bring their own LLM and prompt.
5. **Behavioral enforcement** (checklists, "you must", mandatory hooks). Harness problem per §0.1.
6. **Cross-project memory intelligence.** Project scope is the boundary; cross-project surfacing is a consumer choice.
7. **A compressed-fact ledger of any kind.** §0.2. Extractor + consolidator are removed; Pristine does not ship a fact-ledger surface.
8. **Daemon or subprocess architecture.** Single-file local-first is a hard constraint.
9. **LOCOMO leaderboard chasing.** LOCOMO becomes a regression eval, not a target.

---

## 8. Validation experiments

Prototypes to run before declaring primitives stable.

### 8.1 Chunk strategy validation

Decision: per-message embedding with retrieval-time expansion. Validate by measuring retrieval quality on a real coding-session corpus against:

- **A**: Sliding window, `windowSize=3`, `windowOverlap=1` (proposed default)
- **B**: Sliding window, `windowSize=4`, `windowOverlap=2` (heavier context)
- **C**: Sliding window, `windowSize=2`, `windowOverlap=1` (finer granularity)
- **D**: Per-message (one vector per turn, as in prior drafts)
- **E**: User-message batch (LlamaIndex's deprecated-but-conversation-appropriate shape — one vector per user turn plus all subsequent tool/assistant replies until next user turn)

All run with the session-level secondary index (`vec_sessions`) enabled. Also measure each with and without the session index to isolate its contribution.

Metric: Recall@10 on a benchmark of 50+ recall queries spanning semantic, keyword, decision, and handoff categories. Success: **A** matches or beats **D** and **E**. If **B** wins, lock `windowSize=4` / `windowOverlap=2` as the default. If **D** wins, revisit the whole pivot.

### 8.2 Primitive composability

Build three reference implementations from only the primitives in §5.1. Confirm no consumer-only extension to the primitive surface is needed.

- Reference 1: `search_memory` tool → composes `hybridSearch` + neighbor-expansion helper (over `searcher.sql`)
- Reference 2: `SessionStart` hook for Claude Code → composes `getRecentSummaries` + output formatting
- Reference 3: `MEMORY.md` maintainer → composes `getRecentSummaries` + filesystem write + decay

Success: each reference is ≤200 LOC and requires no changes to the primitive surface.

### 8.3 Oversize-message handling

Ingest a real Pristine development session (contains long tool outputs, code blocks, JSON). Confirm:
- No message silently truncated
- Oversize messages split at chosen boundary without losing context
- Retrieval over split messages reconstructs full context via `parent_message_id` join and the reference neighbor-expansion helper

### 8.4 Retrieval quality on coding-session recall

Record 10+ real sessions (dogfood). Write 50+ recall questions spanning semantic queries, keyword queries, decision recall, and handoff. Measure Recall@10 and agent-synthesis quality.

Success: median Recall@10 ≥ 0.7; agent answers ≥ 80% of handoff questions given top-5 expanded hits.

### 8.5 LOCOMO regression

Re-run LOCOMO on the new corpus-based pipeline. Success: retrieval Hit@10 matches or exceeds the post-PR #94 baseline of 100%. Answer quality is a separate host-LLM concern, not a pipeline concern.

### 8.6 Privacy boundary

Adversarial SQL queries against the `searcher.sql` primitive: attempt to access raw tables, issue DoS queries (cross joins, large scans), reach the vault. Confirm all rejected by the read-only view + row cap + timeout.

---

## 9. Relation to prior specs

| Spec | Relation |
|---|---|
| `implementation-spec-001.md` | Original architecture. Memory-extraction and -consolidation phases are **superseded entirely** by this spec — extractor/consolidator modules are removed from the SDK. Storage and embedder infrastructure that underpins corpus retrieval is preserved. |
| `implementation-spec-002.md` | (separate scope) |
| `implementation-spec-003.md` | Memory infrastructure (conversation store, embedder, ingest queue, FTS5, hook scripts) is **preserved** — this spec uses all of it. The extractor/consolidator semantic layer from spec-003 is superseded. |
| `implementation-spec-004.md` | Privacy narrowed to secrets for developer use. This spec is the parallel pivot for memory — same target user (developers), same dogfood discipline, same scope narrowing. |

---

## 10. References

### From this codebase
- `docs/analysis/claude-mem-vs-pristine.html` — 21-slide comparison deck
- `docs/analysis/developer-memory-pain-research.html` — 55-source developer-memory-pain research deck
- `src/memory/extractor/prompts.ts` — current LOCOMO-aimed default prompt (removed in this pivot)
- `src/memory/consolidator/index.ts` — current LLM-based consolidator (removed in this pivot)
- PR #94 — `fix/gemma4-extraction-diagnostic`, merged
- PR #95 — architecture docs (claude-mem comparison, developer-memory-pain research), merged

### External
- claude-mem: <https://github.com/thedotmack/claude-mem>
- mem0: <https://github.com/mem0ai/mem0>
- Letta / MemGPT: <https://github.com/letta-ai/letta>
- Graphiti: <https://github.com/getzep/graphiti>
- LangChain: <https://github.com/langchain-ai/langchain>
- LlamaIndex: <https://github.com/run-llama/llama_index>
- Jina late-chunking: <https://github.com/jina-ai/late-chunking>
- Anthropic Claude Code hooks reference: <https://docs.claude.com/en/docs/claude-code/hooks>
- Cursor Rules / Memories docs: <https://cursor.com/docs>
- Cline Memory Bank docs: <https://docs.cline.bot/prompting/cline-memory-bank>
- Continue.dev Rules docs: <https://docs.continue.dev/customize/deep-dives/rules>
- Aider conventions docs: <https://aider.chat/docs/usage/conventions.html>
- LOCOMO benchmark paper (regression eval)
- llms.txt proposal (analogy source)

### Research outputs (this spec)
- Session-start injection survey — Cursor / Cline / Continue / Aider / Claude Code / Copilot Spaces / Cody, 36 primary sources
- Conversation-memory chunking patterns — mem0 / claude-mem / Letta / Graphiti / LangChain / LlamaIndex / Jina, source-grounded against commit SHAs

### Prior pristine specs
- `docs/specs/implementation-spec-001.md`
- `docs/specs/implementation-spec-003.md`
- `docs/specs/implementation-spec-004.md`

---

## 11. External integrations

**N/A.** Pristine is local-first. The SDK makes no network calls, requires no API keys, and depends on no third-party services at runtime. Embedder models are loaded locally via `@huggingface/transformers`. LLM clients (used only by reference implementations) are consumer-provided — the consumer decides which LLM, if any, their reference composition calls.

The `benchmarks/memorybench/` harness may reach out to local Ollama or hosted LLM APIs for evaluation purposes, but that is an eval-harness concern, not an SDK runtime dependency.

---

## 12. Data model

Concrete schema for the SQLite store. Public views (exposed via `searcher.sql`) are the stable consumer contract; underlying tables are free to evolve.

### conversations

```
id          TEXT PRIMARY KEY     -- UUID
project_id  TEXT NOT NULL
started_at  INTEGER NOT NULL     -- unix ms
metadata    TEXT                 -- JSON, opaque to the SDK
```

### messages

```
id                TEXT PRIMARY KEY
conversation_id   TEXT NOT NULL REFERENCES conversations(id)
turn_index        INTEGER NOT NULL       -- ordinal within conversation
role              TEXT NOT NULL          -- 'user' | 'assistant' | 'system' | 'tool'
content           TEXT NOT NULL
timestamp         INTEGER NOT NULL
parent_message_id TEXT                   -- set when a chunk of an oversize parent; NULL otherwise
metadata          TEXT                   -- JSON, opaque
```

### summaries

```
id          TEXT PRIMARY KEY
session_id  TEXT NOT NULL    -- harness-provided identifier
project_id  TEXT NOT NULL
text        TEXT NOT NULL    -- opaque content (format is the reference impl's choice)
timestamp   INTEGER NOT NULL
metadata    TEXT             -- JSON, opaque
```

### vec_windows (sqlite-vec virtual table) — primary semantic index

```
conversation_id TEXT NOT NULL
window_index    INTEGER NOT NULL     -- 0, 1, 2, … within conversation
embedding       BLOB                 -- 768-d Nomic Embed v1.5 of role-prefixed concatenation
PRIMARY KEY (conversation_id, window_index)
```

One row per sliding-window of messages. `INSERT OR REPLACE` on each update (windows re-embed during fill-up until `windowSize` is reached — see §5.1.2 incremental-updates note). Window parameters (`windowSize`, `windowOverlap`) come from `IndexerConfig`; defaults 3 / 1.

### window_messages (join table)

```
conversation_id TEXT NOT NULL
window_index    INTEGER NOT NULL
message_id      TEXT NOT NULL REFERENCES messages(id)
position        INTEGER NOT NULL     -- 0..windowSize-1 within the window
PRIMARY KEY (conversation_id, window_index, message_id)
```

Records which message IDs are in each window. Enables retrieval callers to resolve a window hit → constituent messages.

### vec_sessions (sqlite-vec virtual table) — secondary whole-conversation index

```
conversation_id TEXT PRIMARY KEY
embedding       BLOB                 -- 768-d Nomic Embed v1.5 of full-conversation role-prefixed concatenation
updated_at      INTEGER NOT NULL
```

Zero-LLM, produced by `indexer.buildSessionVector(conversationId)`. Catches multi-session / long-range-reference queries that the window index alone misses.

### messages_fts (FTS5 virtual table) — keyword index at turn granularity

```
message_id UNINDEXED
content    TEXT    -- tokenized via porter stemmer
```

### Public views (stable surface for `searcher.sql`)

- `messages_public (id, conversation_id, turn_index, role, content, timestamp, project_id)`
- `conversations_public (id, project_id, started_at)`
- `summaries_public (id, session_id, project_id, text, timestamp)`

The `metadata` columns and the `parent_message_id` linkage are **not** exposed in the public views. Internal tables are free to evolve; views are the consumer contract.

### Indexes

- `conversations(project_id, started_at DESC)`
- `messages(conversation_id, turn_index)`
- `messages(timestamp DESC) WHERE parent_message_id IS NULL`
- `summaries(project_id, timestamp DESC)`
- `vec_windows` and `vec_sessions` via sqlite-vec's vec0 KNN
- `messages_fts` auto-rebuild on insert/update

---

## 13. Environment setup

### Required env vars

None for the core SDK.

Optional (only if reference implementations or benchmarks use them):

```bash
# Reference summary-generator calling local Ollama
OLLAMA_HOST=http://localhost:11434

# Reference summary-generator calling a hosted LLM
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Embedder model-cache directory (default: ~/.pristine/models)
PRISTINE_MODEL_CACHE=
```

### Local dev

```bash
git clone <repo>
cd pristine
npm install
npm run build
npm test
```

### Deployment

N/A. Pristine ships as an npm package. Consumers install and run it locally in their own process — no daemon, no subprocess, no hosted service.

### Harness integration

Reference implementations (see §5.2 and `docs/examples/`) document how to wire Pristine into specific harnesses. Each example is self-contained and can be copied, forked, or ignored.

---

## 14. Success criteria

Checklist derived from §8 Validation experiments plus architectural commitments.

- [ ] Extractor + consolidator modules fully removed from SDK (no opt-in surface remains)
- [ ] Core primitives implemented: `store`, `indexer` (ingest + buildSessionVector), `searcher` (vector / FTS / hybrid / SQL), `embedder`
- [ ] Public views (`messages_public`, `conversations_public`, `summaries_public`) stable and documented
- [ ] Sliding-window defaults (`windowSize=3`, `windowOverlap=1`) validated against alternatives (§8.1, incl. per-message, user-cycle, `(4,2)`) — Recall@10 ≥ baseline on dogfood corpus
- [ ] Session-level vector index (`vec_sessions`) improves multi-session Recall@10 over window-only baseline
- [ ] Three reference implementations built from primitives alone, each ≤ 200 LOC (§8.2)
- [ ] Oversize-message handling preserves full context via `parent_message_id` (§8.3)
- [ ] Median Recall@10 on coding-session recall ≥ 0.7 (§8.4)
- [ ] Agent answers ≥ 80% of handoff questions given top-5 expanded hits (§8.4)
- [ ] LOCOMO regression: Hit@10 matches or exceeds post-PR #94 baseline of 100% (§8.5)
- [ ] SQL privacy boundary validated against adversarial queries (§8.6)
- [ ] Full test suite passing; strict TypeScript; ESM-only; no `any` uses
- [ ] Single-file deploy — no daemon, no subprocess, no network at SDK runtime

---

## 15. User & data flows

Five flows — three primitive, two reference. Deferred reference integrations (see §5.2) get their flows in a future spec.

### Flow 1 — Ingestion (primitive + SDK surface)

**SDK surface (sprint-016 Story 1):** `Pristine.create({...}).storeAsync(messages, userId, projectId?)` — fire-and-forget. Returns the `conversationId` synchronously; embed work runs asynchronously via the embed-worker. Composes the primitive flow described below.

**Primitive composition:** `storeAsync` → `store.addEmptyConversation` (writes the conversation row + content_hash, no message rows yet) → `indexer.ingest` (writes message rows + enqueues per-message embed tasks, atomically) → `IngestQueue.processNext` (drained by detached `embed-worker.ts`) → `embedder.embed` → `vec_windows` (tail window assembled / re-embedded on each growth) + `messages_fts` per turn

```
Consumer calls: client.storeAsync(messages, userId, projectId?)
                    │
                    ▼
     [Fast path — <0.5s, caller unblocked]
     storeAsync orchestrates:
       store.addEmptyConversation(userId, messages, projectId)   ← creates conversation row only;
                                                                   content_hash computed from messages;
                                                                   message_count starts at 0,
                                                                   indexer.ingest bumps it
       (on UNIQUE collision: store.findByMessages returns the existing id; early-return, no re-enqueue)

       indexer.ingest(messages, { projectId, conversationId }):
         atomic transaction:
           store.addMessage × N                  ← per-turn (oversize chunker may split into chunks)
           IngestQueue.enqueueMessageEmbed × N   ← one task per inserted message row
                    │
                    ▼
     storeAsync returns conversationId
                    │
                    ▼
     Detached embed-worker (sprint-015 Story 6, rewrite of extract-worker.ts):
       while queue not empty:
         task = queue.claimNext()                ← self-healing stale-row reset
         message = SELECT FROM messages WHERE id = task.message_id
         insert into messages_fts (if not present)
         # Assemble/update tail window(s) that contain this message:
         for each window covering this message's sort_order:
           window_text = concat(role-prefixed messages in window)
           embedder.embed(window_text)
           INSERT OR REPLACE into vec_windows + window_messages
         queue.markCompleted(task.id)
       exit on idle
```

**Design notes:**

- **storeAsync vs. indexer.ingest direct.** `storeAsync` is the consumer-facing one-shot ingest (whole conversation up front). `indexer.ingest` is the lower primitive that appends turns to an existing conversation — used by `storeAsync`'s composition and by callers that stream turns over time (e.g., `addEmptyConversation` once, then `indexer.ingest(newTurns)` per arrival). Both write through the same `pending_ingest_tasks` queue.
- **Session vector is NOT auto-built.** `storeAsync` writes message + window vectors via the embed-worker; building `vec_sessions` is a separate explicit call (`indexer.buildSessionVector(conversationId)`). Sprint-015 §5 deferred auto-invocation until retrieval pressure is real; revisit in sprint-017+.
- **Crash safety** — message row persisted in the same transaction as the pending task (within `indexer.ingest`'s outer transaction); worker crash recovers via self-healing claim (existing behavior from spec-003 Phase 5).
- **Idempotency** — windows re-embed on each fill-up step via `INSERT OR REPLACE` keyed by `(conversation_id, window_index)`. Content-hash dedup applies at the conversation level via `UNIQUE(user_id, content_hash)` on `conversations`; `storeAsync`'s duplicate path returns the existing `conversationId` without re-enqueueing.
- **Latency** — <0.5s for the synchronous storeAsync path (no model load — the embedder is lazy); ~0.1s per message in the embed-worker (Nomic CPU embedding).

### Flow 2 — Retrieval (primitive)

**SDK surface (sprint-016 Stories 2-5):** `client.searcher.{vector,fts,session}Search` are individually callable for single-source retrieval; `client.searcher.hybridSearch` fans out across all three sources in parallel and fuses them with RRF (k=60). The hybrid path is the consumer-facing default; single-source methods are exposed for callers that need a specific signal (e.g., FTS-only for boolean queries).

**Composes (hybrid):** `searcher.hybridSearch` → filters (over `conversations`) → `vectorSearch` (over `vec_windows`) ‖ `ftsSearch` (over `messages_fts`) ‖ `sessionVectorSearch` (over `vec_sessions`) → RRF over the three ranked lists → `HybridHit[]`

```
Consumer calls: searcher.hybridSearch(query, filters, limit)
                    │
                    ▼
   [Filters applied FIRST to build candidate conversation set]
   Build candidate SQL:
     SELECT c.id AS conversation_id FROM conversations c WHERE
       c.project_id = filters.projectId
       AND (c.id = filters.conversationId          if set)
       AND (c.created_at >= filters.dateFrom       if set)
       AND (c.created_at <= filters.dateTo         if set)
   (filters.role is applied per-leg, not at the candidate stage —
    semantics differ by granularity; see SearchFilters JSDoc)
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
   vectorSearch  ftsSearch   sessionVectorSearch
   over          over        over
   vec_windows   messages_fts vec_sessions
   - embed(q)    - FTS5 MATCH - embed(q)
   - vec0 KNN    - BM25 rank  - vec0 KNN
   - join to     - join to    - join to
     candidates    candidates   candidates
   - top 2*limit - top 2*limit - top 2*limit
        │           │            │
        └───────────┼────────────┘
                    ▼
       Promise.allSettled — partial-failure resilient:
         any leg returning [] does NOT short-circuit the others;
         if all three legs reject, hybridSearch rethrows the
         vectorSearch error (highest-impact)
                    ▼
       Reciprocal rank fusion (k=60) over disjoint id-spaces:
         vector hits keyed `window:<convId>:<windowIndex>`
         FTS hits keyed `message:<messageId>`
         session hits keyed `session:<convId>`
       Each hit's source tag = 'vector' | 'fts' | 'session' | 'both'
                    ▼
            HybridHit[] (kind: 'window' | 'message' | 'session')
            ranked by fused RRF score, truncated to `limit`
```

**Key design notes:**

- **Filter-first is deliberate.** sqlite-vec KNN over an unfiltered index can miss hits that fall outside the top-K globally but are top-K within a filter. For correctness, we pre-filter candidates (via `conversations`), then KNN over them.
- **3-source fan-out, not 2-source.** Story 5 added `sessionVectorSearch` as a third leg. Sessions provide a coarser-grained semantic signal than per-message windows — useful for "which conversations were about X" queries where window-level matches miss thematic relevance. Session vectors are populated by the explicit `indexer.buildSessionVector(conversationId)` call (NOT by `storeAsync`); a corpus that has only run `storeAsync` will see the session leg return `[]` and the hybrid result will fuse vector + FTS alone.
- **Disjoint id-spaces.** Each leg returns hits over a different SQL identity (window vs message vs session); RRF needs unique keys across legs to avoid spurious "both" tags. Hybrid keys the fusion map by prefix (`window:` / `message:` / `session:`) so a window and a message that happen to share an integer id are treated as distinct candidates.
- **Role-filter asymmetry.** `filters.role` is applied per-leg, not at the candidate stage: vectorSearch does a permissive "window contains a message of this role" post-pass over its `limit*2` over-fetch; ftsSearch applies a strict "message.role = filter" SQL clause; sessionVectorSearch silently ignores it (a session aggregates messages of every role). Documented at the `SearchFilters.role` field; intentional per-engine granularity fit.

**Latency:** ~100–200 ms for corpora up to ~100K messages. Vector + session legs each embed the query independently (~50 ms each, parallel via `Promise.allSettled`); FTS leg adds ~10–20 ms; RRF fusion ≈ 5 ms. Sharing the embed across legs is a deferred optimization — flagged in Story 5 Technical Notes for sprint-017+ once eval signal demands it.

### Flow 3 — SQL query (primitive)

**Composes:** `searcher.sql` → validate → read-only connection → public view → row cap + timeout

```
Consumer calls: searcher.sql(rawSql, opts?)
                    │
                    ▼
       Validate access surface
       - parse SQL; reject if (a) non-SELECT, (b) references tables
         not in public-view allowlist (messages_public,
         conversations_public, summaries_public, messages_fts)
                    │
                    ▼
       Open read-only connection (SQLITE_OPEN_READONLY)
       Attach per-iteration elapsed-time timeout (default 5s)
       Wrap cursor with row cap (default 1000)
                    │
                    ▼
       Execute; return Row[] (≤ row_cap)
```

**Safety envelope:**

- **Read-only connection** → no DML possible even if the parser fails
- **Public-view restriction** → cannot SELECT from internal tables (`messages`, `conversations`) or any privacy/vault surface
- **Row cap + timeout** → DoS prevention (§8.6)
- **Views hide internal columns** (`parent_message_id`, `metadata`) → consumer contract stable even when internals evolve

**Public surface:** the primitive accepts raw SQL only — no DSL escape hatch. Positional `?` parameter binding is forwarded to better-sqlite3 for safe quoting; consumers compose JOINs / aggregates / CTEs against the allowlist directly.

### Flow 4 — `search_memory` tool (reference implementation)

**Composes Flow 2 for agent tool-calling.**

```
Agent emits tool_use: search_memory({
  query: "why did we pick sqlite-vec",
  projectId: "pristine",
  limit: 10,
})
                    │
                    ▼
Harness dispatches to reference handler
                    │
                    ▼
Handler calls: searcher.hybridSearch(query, { projectId, limit })
                    │
                    ▼
For top-5 hits: neighborExpand(hit, windowSize=2)  // reference helper over searcher.sql
                    │
                    ▼
Format as text:
   ---
   [conv-abc123, turn 12, 2026-04-18T15:22Z, assistant]
   "We picked sqlite-vec because single-file deploy matters
    more than ChromaDB's query flexibility at this scale..."
   (±2 neighbors shown for context)
   ---
                    │
                    ▼
Tool returns text to agent
```

**Reference impl size target:** ≤ 200 LOC. Composes only §5.1 primitives. Users can fork or replace entirely.

### Flow 5 — `query_memory` tool (reference implementation)

**Composes Flow 3 for agent tool-calling.**

```
Agent emits tool_use: query_memory({
  view: "messages_public",
  where: { role: "user", project_id: "pristine" },
  orderBy: { timestamp: "desc" },
  limit: 10,
})
                    │
                    ▼
Harness dispatches to reference handler
                    │
                    ▼
Handler composes raw SQL: client.searcher.sql(rawSql, { params })
                    │
                    ▼
Format rows as JSON table or markdown
                    │
                    ▼
Tool returns to agent
```

**Reference impl shape:** the LLM emits a raw SELECT against the public-view allowlist (`messages_public`, `conversations_public`, `summaries_public`, `messages_fts`); the handler validates + executes via `client.searcher.sql(rawSql, { params })`. No DSL or translator step in between — the SDK's parser-level allowlist gate (sprint-019 Story 2) is the single privacy boundary; LLMs are competent at SQL, so a second grammar adds no value.

**Reference impl size target:** ≤ 150 LOC.

### Privacy integration point (pointer, not a flow)

Spec-004's privacy module handles secret redaction and reveal via separate hooks (`PreToolUse`, `PostToolUse`). Pristine memory stores whatever content it receives — if a consumer wants secrets redacted before storage, they wire privacy hooks upstream of `indexer.ingest`. This is a composition concern for the deferred reference implementation that owns PostToolUse wiring. See spec-004 for the contract.

---

## 16. Phases

Incremental delivery. Each phase is a shippable milestone. Phases deliberately factor in the preexisting SDK (`src/conversations/`, `src/embedder/`, `src/queue/`, `src/core/`, `src/privacy/`) — much of the storage, embedding, queue, and privacy infrastructure is preserved.

### Phase 1: Remove extraction, consolidation, and legacy memory modules

Clean slate — delete the LOCOMO-aimed subsystem. The SDK stops doing fact extraction. Every `src/memory/*` directory is either deleted entirely or partial-deleted with specific survivors called out for Phase 3/4 reuse.

#### Modules

- **Delete entirely:** `src/memory/extractor/`, `src/memory/consolidator/`, `src/memory/episodes/`, `src/memory/graph/`, `src/memory/temporal/`, `src/memory/query-analyzer/` — LOCOMO-aimed fact pipeline and legacy subsystems
- **Delete entirely:** `src/memory/store/` — fact-ledger storage replaced by per-message vector table in the extended `ConversationStore` (Phase 2)
- **Partial delete:** `src/memory/orchestrator/` — remove `pipeline.ts`, `retrieve.ts`, `ingest.ts`, `turn-order.ts`. **Preserve `chunker.ts`** (adapted in Phase 3 for oversize-message handling)
- **Partial delete:** `src/memory/retriever/` — remove `index.ts` (fact-retrieval path). **Preserve `ranking.ts`** (RRF utilities reused in Phase 4)
- **Delete:** corresponding `tests/memory/{extractor,consolidator,episodes,graph,temporal,query-analyzer,store}/` + tests for the removed orchestrator/retriever files
- **Modify:** `src/core/interfaces.ts` — remove `Extractor`, `Consolidator`, `Store` (memory), fact-type interfaces
- **Modify:** `src/core/types.ts` — remove `Fact`, `Episode`, `Entity`, `Relationship`, consolidation + temporal types
- **Modify:** `src/index.ts` — drop extractor/consolidator/episodes exports
- **Modify:** `src/client.ts` — drop extractor/consolidator wiring from `PristineLocal.create()`

#### Stories

- **P1-S1:** Delete extractor + consolidator modules and tests; update `src/core/interfaces.ts` and `src/index.ts`.
- **P1-S2:** Delete legacy episodic/graph/temporal/query-analyzer modules and their tests; remove types from `src/core/types.ts`.
- **P1-S3:** Delete `src/memory/store/` (fact-ledger) and tests; remove the memory-`Store` interface from `src/core/interfaces.ts` (distinct from `ConversationStore`, which is preserved).
- **P1-S4:** Update `src/client.ts` — `PristineLocal.create()` no longer wires extractor/consolidator/memory-store. `createLite()` stays.
- **P1-S5:** Partial-delete `src/memory/orchestrator/` — remove `pipeline.ts`, `retrieve.ts`, `ingest.ts`, `turn-order.ts` and their tests; preserve `chunker.ts` for Phase 3 reuse.
- **P1-S6:** Partial-delete `src/memory/retriever/` — remove `index.ts` (fact-retrieval path) and its tests; preserve `ranking.ts` for Phase 4 reuse.

#### Done when

- [ ] `npm run typecheck` and `npm test` pass (removed tests no longer referenced)
- [ ] No references to extractor/consolidator/episodes/graph/temporal/query-analyzer/memory-store in `src/`
- [ ] `src/memory/orchestrator/` contains only `chunker.ts`; `src/memory/retriever/` contains only `ranking.ts`
- [ ] `PristineLocal.create()` succeeds without any LLM client dependency

---

### Phase 2: Extend ConversationStore schema for corpus storage

The existing `src/conversations/` module (Sprint 009) already has `conversations` + `messages` + `messages_fts` tables with FTS5 triggers. Extend it for per-message embedding, project scoping, summaries, and public views.

#### Modules

- **Reuse (verbatim, preserve):** Sprint 009 infrastructure — `conversations`, `messages`, `messages_fts` tables and FTS5 triggers in `src/conversations/store.ts` stay as shipped. This phase extends the schema additively; existing tables and triggers are not altered.
- **Modify:** `src/conversations/store.ts` — extend DDL + methods
- **Add:** public-view migrations
- **Modify:** `src/core/database.ts` (if needed for additional virtual-table bootstrap)

#### Stories

- **P2-S1:** Add `project_id` column to `conversations` + `messages` (default-null migration; back-fill from `user_id` or new explicit scope key). Confirm `turn_index` is exposed (existing `sort_order` column may be renamed or aliased).
- **P2-S2:** Add `parent_message_id` column to `messages` with index on `(parent_message_id)`.
- **P2-S3:** Add `vec_windows` (sqlite-vec virtual table, dim=768, keyed on `(conversation_id, window_index)`), `window_messages` (join table), and `vec_sessions` (sqlite-vec virtual table, dim=768, keyed on `conversation_id`).
- **P2-S4:** Add `summaries` table (id, session_id, project_id, text, timestamp, metadata) with index on `(project_id, timestamp DESC)`.
- **P2-S5:** Add public views: `messages_public`, `conversations_public`, `summaries_public` — exclude `metadata` and `parent_message_id` columns.
- **P2-S6:** Extend `ConversationStore` with `addMessage`, `addSummary`, `getRecentSummaries`. Existing `addConversation`, `getConversation`, `searchConversations` preserved.

#### Done when

- [ ] Migration applies cleanly on a Sprint-009-era database
- [ ] All new columns + virtual tables created
- [ ] Public views return only the documented columns (§12)
- [ ] Existing Sprint-009 tests still pass — no regressions

---

### Phase 3: Indexer primitive — per-message embedding with oversize handling

Turn raw turns into a populated corpus. Borrows the shape of spec-003 Phase 10's `createRawIngestPipeline()` — deprioritized at the time but now the default — with oversize handling and explicit project scoping added.

#### Modules

- **Add:** `src/memory/indexer/` (new primitive facade)
- **Rewrite:** `scripts/extract-worker.ts` → `scripts/embed-worker.ts`
- **Reuse (adapted):** `src/memory/orchestrator/chunker.ts` — preserved in Phase 1 (P1-S5), adapted here for oversize-message handling (Graphiti never-split-mid-message rule, 3000-token threshold, 200-token overlap)
- **Reuse (verbatim):** `src/queue/ingest-queue.ts` — crash-recovery semantics from spec-003 unchanged; enqueue + self-healing claim as shipped
- **Reuse (verbatim):** `src/embedder/` — Nomic v1.5 interface unchanged
- **Reuse (design shape):** spec-003 Phase 10's `createRawIngestPipeline()` sketch — the per-message-embed-no-LLM shape is the starting point; oversize handling and explicit project scoping added

#### Stories

- **P3-S1:** Implement `indexer.ingest(turns, { projectId, conversationId, sessionId })` — atomic insert of messages + enqueue of window-embed tasks. Caller unblocked in <0.5s. Expose `IndexerConfig` with `windowSize` (default 3) and `windowOverlap` (default 1); validate `0 < overlap < windowSize`.
- **P3-S2:** Sliding-window assembly logic — for a conversation of length N, compute window start indices with stride `windowSize - windowOverlap`; apply tail-slide-back so the final window always has `windowSize` messages (unless conversation is shorter). Update logic: `INSERT OR REPLACE` into `vec_windows` + `window_messages` as each window fills during streaming ingest.
- **P3-S3:** Adapt `chunker.ts` for oversize-message handling — detect >3000 tok, split at AST boundaries for code / paragraph for prose with 200-token overlap, write chunks with `parent_message_id`. Preserve never-split-mid-message invariant. Oversize-chunks count as individual messages for window assembly.
- **P3-S4:** Implement `indexer.buildSessionVector(conversationId)` — concatenate all messages (role-prefixed), embed, `INSERT OR REPLACE` into `vec_sessions`. No LLM call, pure mechanical.
- **P3-S5:** Rewrite `extract-worker.ts` → `embed-worker.ts`: claim pending task → insert message into `messages_fts` → assemble/update containing tail window(s) via `INSERT OR REPLACE` into `vec_windows` + `window_messages` → mark complete. Self-terminate on idle (existing behavior). Content-hash dedup at the message level.
- **P3-S4:** Integration tests — end-to-end ingest → embed → retrieve round-trip on a small corpus, plus oversize-branch test with synthetic long messages.

#### Done when

- [ ] Raw turns flow to populated `messages` + `vec_windows` + `window_messages` + `messages_fts`
- [ ] `indexer.buildSessionVector` populates `vec_sessions`
- [ ] Oversize messages split correctly with `parent_message_id` linkage preserved
- [ ] Crash-recovery behavior verified (stale-row reset on claim)
- [ ] No LLM calls in the ingest path

---

### Phase 4: Searcher primitive — filter-first retrieval

Filter-first vector + FTS + hybrid + expansion. Repurposes `src/memory/retriever/` ranking logic where applicable.

#### Modules

- **Add:** `src/memory/searcher/` (new primitive)
- **Reuse (verbatim):** `src/memory/retriever/ranking.ts` — RRF / scoring utilities preserved in Phase 1 (P1-S6) specifically for use here
- **Reuse (verbatim):** `src/embedder/` — query-embedding path unchanged

#### Stories

- **P4-S1:** `searcher.vectorSearch(query, filters, limit)` — build candidate set via filter SQL, then sqlite-vec KNN over candidates. Explicit filter-first ordering.
- **P4-S2:** `searcher.ftsSearch(query, filters, limit)` — FTS5 MATCH scoped to candidate set.
- **P4-S3:** `searcher.hybridSearch(query, filters, limit)` — parallel vector + FTS, fuse via reciprocal rank fusion.
- **P4-S4:** `searcher.hybridSearch` fan-out — vector search runs against both `vec_windows` and `vec_sessions`; FTS5 runs against `messages_fts`; RRF fuses. Window hits resolve to constituent `message_ids` via `window_messages`. Session hits return the whole `conversation_id`.
- **P4-S5:** Tests — filter correctness, hybrid ranking stability, window-to-messages resolution, session-level match behavior, cross-project isolation.

#### Done when

- [ ] All retrieval primitives functional
- [ ] Filter-first ordering verified by test — vector KNN does not leak cross-project results
- [ ] RRF scoring blends correctly
- [ ] Window hits resolve to constituent messages correctly (via `window_messages` join)
- [ ] Session-level hits return whole-conversation context correctly

---

### Phase 5: SQL primitive — raw read-only surface

Read-only raw SQL over public views with row-cap + timeout.

#### Modules

- **Add:** `src/memory/searcher/sql-backend.ts` — `SQLITE_OPEN_READONLY` connection + per-iteration elapsed-time timeout + row-cap cursor + `withTimeout` primitive (sprint-019 Story 1).
- **Add:** `src/memory/searcher/sql-parser.ts` — `parseSqlAccess` + `validateSqlAccess` + `DEFAULT_PUBLIC_VIEW_ALLOWLIST` (sprint-019 Story 2).
- **Modify:** `src/memory/searcher/index.ts` — wire `Searcher.sql(sql, opts?)` linearly: `validateSqlAccess` → `executeReadOnly` (sprint-019 Story 3).

#### Stories (sprint-019)

- **P5-S1:** Open a read-only SQLite connection (`SQLITE_OPEN_READONLY`) per call. Per-iteration elapsed-time timeout between row yields (better-sqlite3 v12 has no JS-callable `db.interrupt()`); cursor wrapper for row cap. `withTimeout` primitive exported for cross-module reuse.
- **P5-S2:** Public-view allowlist — static parser extracts referenced tables; rejects queries touching non-allowlisted tables (including all privacy/vault surfaces) and any non-SELECT keyword. Default allowlist: `messages_public`, `conversations_public`, `summaries_public`, `messages_fts`.
- **P5-S3:** Wire `searcher.sql(sql, opts?)` on the public Searcher interface. Validate-then-execute ordering is non-negotiable. Adversarial privacy tests (matches §8.6) — DML, internal-table access, vault access, DoS queries — all rejected or row-capped.

#### Done when

- [x] SQL primitive safe + useful — raw SQL with positional `?` parameter binding covers all consumer queries against the public-view allowlist
- [x] All adversarial tests pass — DML / internal-table / vault / DoS / identifier-encoding classes each rejected or row-capped
- [x] Privacy boundary validated — `validateSqlAccess` is the parser-level gate, `SQLITE_OPEN_READONLY` is defence-in-depth

---

### Phase 6: Reference implementations — `search_memory` tool + `query_memory` tool

Two reference implementations with "this is one way, you can write your own" framing.

#### Modules

- **Add:** `docs/examples/search-memory-tool/` (JSON schema, handler, README)
- **Add:** `docs/examples/query-memory-tool/` (JSON schema, handler, README)

#### Stories

- **P6-S1:** `search_memory` tool — JSON schema compatible with Claude / Cursor tool-use; handler composes `searcher.hybridSearch` + a `~10 LOC` neighbor-expansion helper (via `searcher.sql`) to surface ±N surrounding turns. Returns formatted text. ≤ 200 LOC total.
- **P6-S2:** `query_memory` tool — JSON schema supporting DSL and raw-SQL modes; handler wraps `searcher.sql`; returns JSON or markdown rows. ≤ 150 LOC.
- **P6-S3:** READMEs for each example — installation, usage, customization, "this is one way" framing per §0.3. Cross-link from §5.2.

#### Done when

- [ ] Both tools ship as documented reference implementations
- [ ] Each implementation ≤ target LOC
- [ ] Documentation explicitly marks them as optional, forkable

---

### Phase 7: Validation + eval framework

Lock in the primitive defaults via §8 experiments.

#### Modules

- **Extend:** `benchmarks/memorybench/`
- **Add:** dogfood corpus fixtures

#### Stories

- **P7-S1:** Record ≥ 10 real Pristine dev sessions as reproducible fixtures covering dialogue + tool outputs + code.
- **P7-S2:** Write ≥ 50 recall questions across semantic, keyword, decision, and handoff categories with ground-truth answers.
- **P7-S3:** Chunking benchmark (§8.1) — implement sliding-window at `(3,1)`, `(4,2)`, `(2,1)`, plus per-message and user-message-batch baselines; measure Recall@10 on the corpus with and without the session-level index; lock in the winning `(windowSize, windowOverlap)` pair as the `IndexerConfig` default.
- **P7-S4:** LOCOMO regression — re-run on the new corpus-based pipeline; Hit@10 ≥ post-PR #94 baseline of 100%.
- **P7-S5:** Coding-session recall eval (§8.4) — median Recall@10 ≥ 0.7; handoff answer quality ≥ 80% on top-5 expanded hits.

#### Done when

- [ ] All §14 success criteria verifiable via automated tests or bench runs
- [ ] Chunking default justified by benchmark data
- [ ] Spec-005 can be marked "delivered"

---

## 17. Future work — deferred beyond v1

Items explicitly not in scope for the §16 phases. Each is documented here for traceability so future planning can pick them up with full context. None are commitments. Revisit after §8 validation, real dogfood usage, or specific user demand.

### Reference implementations deferred

The v1 sprint ships two reference implementations (`search_memory` + `query_memory`, Phase 6). Every other reference surface listed in §5.2 is deferred:

| Item | Source | Notes |
|---|---|---|
| `SessionStart` hook for Claude Code | §5.2 | Harness-specific; depends on session-summary generator existing first. |
| `MEMORY.md` maintainer | §5.2 | Filesystem surface, decay policy, scope resolution (git root vs. workspace) all require decisions. |
| Session-summary generator (`Stop` hook) | §5.2 | LLM call, prompt, and format are all consumer opinions. |
| Session-vector lifecycle wiring | §5.2 | When to call `indexer.buildSessionVector` — opinion. |
| `PostToolUse` ingestion script | §5.2 | Claude Code-specific event → `indexer.ingest` wiring. |
| Standalone neighbor-expansion helper (`expandHit`) | §5.2 | Often bundled into `search_memory` in v1; a standalone example could ship later. |
| Cursor integration | §5.2 | Requires research into Cursor's Rules / Memories API; may not be hook-shaped. |
| Cline integration | §5.2 | Requires mapping Pristine schema to Cline's Memory Bank six-file structure. |
| Continue.dev integration | §5.2 | Lower priority; smaller user base than Claude Code / Cursor. |
| Generic CLI adapter | §5.2 | Catch-all for non-hook-based harnesses. |

### Primitive / architectural additions flagged for research

| Item | Source | Notes |
|---|---|---|
| Entity-retrieval path (`entitySearch` + `entities` + `message_entities` tables + hybrid fusion) | §6.9 | Biggest single delta between our design and SOTA on LongMemEval (REM Labs 90%, Memento 92%). Regex-based zero-LLM starting shape documented in §6.9. |
| Richer entity extraction (NER model or Memento-style tiered resolution) | §6.9 | Upgrade path if regex-only proves insufficient after benchmark. |
| Contextual embeddings at ingestion (Anthropic-cookbook style LLM-generated per-turn context prefix) | §6 — considered, ruled out | 35-49% retrieval-failure reduction on documents. Violates the no-LLM-at-ingestion hard constraint. Revisit only if that constraint softens. |
| Query-side enhancements (query expansion, HyDE, multi-query fan-out) | not in current spec | Generally reference-impl territory — the host agent can do most of this. Flag if a primitive becomes necessary. |
| Conversation-tuned reranker | not in current spec | Mixed evidence — web-trained rerankers (BGE-reranker-v2-m3) **hurt** conversation recall per Ogham MCP research. Would require a conversation-specific reranker, which adds a model dependency. |
| Parent-document / hierarchical retrieval beyond window + session | §5.1.2 | LangChain-style small-chunk hits → parent-chunk retrieval. Our window + session already gives a two-level hierarchy; further levels (turn / window / session / project) could be measured. |

### Evaluation / benchmarking expansions

| Item | Source | Notes |
|---|---|---|
| LongMemEval as regression eval | §6.6, §8 | Adopt the Wu et al. ICLR 2025 benchmark after the dogfood corpus benchmark (§8.4) is stable. Publish our numbers. |
| Dogfood corpus expansion beyond ≥10 sessions | §8.4 | Scale as Pristine is dogfooded more widely; baseline established in v1. |
| Public eval publication | not in current spec | Once §8 results stabilize, publish methodology + numbers to close the "zero memory-recall benchmarks" critique of claude-mem (§3.3). |

### Architecture decisions to lock in during v1 (not deferred — listed for completeness)

These are in §6 "Still open" and are expected to be resolved during the v1 implementation, not after:

- §6.1 Project-scoping mechanism (git root vs. workspace dir vs. explicit)
- §6.2 Sliding-window parameter defaults — resolved by §8.1
- §6.4 Hybrid-search RRF weight tuning — resolved by §8 experiments
- §6.7 Embedder choice (Nomic v1.5 vs. smaller default) — measured on coding corpus during §8

---

*Created: 2026-04-22*
*Future-work table added: 2026-04-24*
