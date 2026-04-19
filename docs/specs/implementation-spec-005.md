# Pristine — Implementation Spec 005: Memory Rethink for Developer Agents

**Status:** Draft / Discovery
**Last updated:** 2026-04-18
**Author:** Lou + Claude (paired during PR #94 wrap-up)

---

## 1. Why this spec exists

PR #94 (`fix/gemma4-extraction-diagnostic`) succeeded at its stated goal: gemma4:e4b now reliably extracts facts from dialogue-dense LOCOMO sessions, lifting the `--limit 1` baseline from 54 memories / 8 sessions to **83 memories / 10 sessions**. But the work also surfaced deeper questions about whether our memory architecture is aimed at the right user — and whether fact extraction on small local models is the right primary mechanism at all.

Today's discovery session added a comparison against [claude-mem](https://github.com/thedotmack/claude-mem) (61.8k stars, dominant Claude Code memory plugin) — see `docs/analysis/claude-mem-vs-pristine.html`. claude-mem makes architectural choices that look almost opposite to ours on every axis, and it forced us to articulate what we believe and why.

This spec captures the rethink in progress. **It is not a build plan.** Its job is to:

- Record findings before they go stale
- Frame the design questions clearly enough that future-us can pick up cleanly
- Resist premature commitment to architecture we haven't validated

**In scope:** What pristine's memory system should do, for whom, using what mechanisms. The case for narrowing to a developer focus. Hook surface, layering, retrieval philosophy.

**Out of scope:** Phase/story breakdown, sprint plan, file-level changes. Those follow once we've validated the direction with small prototypes.

---

## 2. What's in place today

The pristine memory pipeline as of `fix/gemma4-extraction-diagnostic` (15 commits, PR #94 open and pending merge):

```
PostToolUse hook
    ↓
scripts/store.ts (createLite, <0.5s)
    ↓
SQLite outbox (conversations + pending_ingest_tasks, atomic)
    ↓
Detached extract-worker.ts (full PristineLocal)
    ↓
Per chunk (CHUNK_SIZE=20, OVERLAP=2):
  1. Extractor LLM call (gemma4:e4b via Ollama)
       → facts[] {text, validFrom, validUntil, temporalConfidence}
  2. Consolidator LLM call (gemma4:e4b via Ollama)
       → decisions[] {ADD | UPDATE | NOOP | SUPERSEDE | DELETE}
    ↓
SQLite + sqlite-vec + FTS5
    ↓
scripts/search.ts exposed as agent tool
```

### What we shipped in PR #94

- `SENSITIVE_PLACEHOLDER_RULES` removed from default extractor prompt (was causing `{facts:[]}` on placeholder-free transcripts)
- `extractor.systemPrompt` config hook on `PristineLocalConfig` for users who need to re-inject privacy rules
- Extractor prompt rewritten with role/goal, schema-in-prompt, mode disambiguation, two few-shot examples
- User prompt wrapped with `Transcript:\n---\n...\n---\nExtract facts...`
- `OllamaClient` defensively strips ` ```json ` / ``` ``` ``` markdown fences
- Consolidator `DEFAULT_BATCH_MAX_TOKENS` raised 4096 → 16384 (output truncation fix)
- Diagnostic scripts: `debug-extract.mjs`, `debug-prompt.mjs`, `debug-schema.mjs`, `debug-failing-sessions.mjs`, `debug-pristine-extractor.mjs`, `debug-orchestrator.mjs`
- `buildExtractionPrompt` exported from `pristine` so callers can compose on the default
- 3 P2 fixes from Greptile (export `ExtractorConfig`, docstring fix, README caveat on REFERENCE_TIME staleness)

### Measured behavior

| Metric | Pre-PR #94 | Post-PR #94 |
|---|---|---|
| Memories on conv-26 `--limit 1` | 54 | **83** |
| Successful sessions | 8 | 10 |
| Probe extraction (session_5/12/14, 3 runs each) | 0/0/0, 0/0/0, 0/12/varies | 10/10/10, 10/10/10, 19/19/19 |
| Retrieval Hit@10 | — | 100% |
| Answer accuracy | — | 0/1 (gemma4:e4b answerer is the bottleneck) |

### Known unaddressed

- 9 sessions still produce 0 memories in the v2 baseline (session_5, 7, 8, 9, 11, 13, 15, 17, 18). Sprint 012 is drafted to diagnose.
- Provider WARN message at `benchmarks/memorybench/src/providers/pristine/index.ts:232` is misleading — blames "content-hash duplicate detection" for every `memoryIds.length === 0`, hiding the real per-step error.
- Consolidator can still truncate or NOOP-all when DB has many similar prior memories.
- Answer quality on local models is the actual bottleneck for end-to-end task accuracy, not retrieval.

---

## 3. Findings from discovery

Four observations, all surfaced during PR #94 work and the claude-mem comparison.

### 3.1 Fact extraction is fragile on small local models

Two days of diagnostic work surfaced multiple failure modes that were brittle, prompt-dependent, and only diagnosable with custom probe scripts:

- **Prompt sensitivity.** The `SENSITIVE_PLACEHOLDER_RULES` chunk (a paragraph of "CRITICAL: ... MUST preserve" framing) caused gemma4:e4b to return `{facts:[]}` on every transcript without placeholders. The bisect (`debug-prompt.mjs`) showed every prompt variant including the chunk returned 0 facts; every variant excluding it returned 8. Llama3.2 ignored the framing (weaker instruction following), masking the bug.
- **Mode ambiguity.** Gemma 4 has both structured-output and function-calling as native trained modes. Without explicit disambiguation in the prompt ("the response IS the output, not a function call"), the model can pattern-match to function-call mode and emit `{facts:[]}` as a legitimate "I chose not to call" response.
- **Markdown fence mimicry.** When the system prompt embedded the schema inside ` ```json ` fences, the model began emitting its responses inside the same fences — breaking `JSON.parse()`. Required adding `stripJsonWrapper()` to `OllamaClient` as defensive parsing.
- **Output truncation.** Consolidator batch calls truncated mid-JSON ("Unexpected end of JSON input") when fact count × similar-memory count exceeded `num_predict=4096`. Fixed by bumping to 16384, but the fix only addresses isolated probes — full-baseline runs still see truncation when prior-session memories accumulate.
- **Sampler instability.** Even at `temperature=0`, gemma4:e4b produced different outputs across runs on the same input (session_14: 0 facts in baseline, 12 facts in probe). The refined prompt made it deterministic in our 9 probes, but this is empirical, not guaranteed.

**Each failure mode required custom tooling to even detect.** None would surface in unit tests or the test suite. The observability gap is severe: the provider's WARN message blamed content-hash dedup for every failure regardless of cause.

This isn't a "we just need a better prompt" problem. It's a structural mismatch between asking a 3.6B-parameter model to produce strict JSON over multi-paragraph instructions and our reliance on that output being usable downstream without manual review.

### 3.2 Our default prompt targets LOCOMO personal-life facts, not dev use

The current extractor prompt (`src/memory/extractor/prompts.ts`) instructs the model to focus on:

> *"(1) personal preferences (likes, dislikes, favorites), (2) important personal details (names, relationships, dates), (3) plans and intentions (upcoming events, goals), (4) activity and service preferences (dining, travel, hobbies), (5) health and wellness information (dietary restrictions, fitness), (6) professional details (job title, career goals, work habits), (7) miscellaneous details (favorite books, movies, brands)."*

This category list was built around the LOCOMO benchmark — a dataset of 10 long peer-to-peer dialogues between two people about their personal lives. It tests whether a memory system can recall facts like "Caroline went to a pride parade on July 3, 2023" or "Melanie has kids."

These are not the facts a coding agent needs to remember. The prompt has been optimized for the wrong target. Even a perfect implementation against this taxonomy would produce memories of marginal value to the developer using Pristine.

A coding-agent memory system should be extracting facts like:
- "We chose `sqlite-vec` over Chroma to avoid a Python subprocess."
- "The `consolidator` truncates on dialogue-dense sessions; bumping `DEFAULT_BATCH_MAX_TOKENS` partially fixes."
- "PR #94 is waiting for Greptile re-review on three P2 fixes."
- "The provider WARN message hides real errors — log `result.errors` instead."

claude-mem's observation taxonomy (`bugfix | feature | refactor | change | discovery | decision`) is much closer to this need.

### 3.3 claude-mem comparison surfaced design patterns we don't use

Full analysis: `docs/analysis/claude-mem-vs-pristine.html` (21 slides). Key takeaways for spec-005:

- **SessionStart auto-injection is a UX win we don't have.** claude-mem's `SessionStart` hook fetches relevant prior context and injects it via `hookSpecificOutput.additionalContext` on every session start (including post-compaction). Pristine's tool-only retrieval requires the agent to remember to search, which is unreliable.
- **Per-session summarization is missing from our pipeline.** claude-mem's `Stop` hook generates a structured `session_summaries` row (request / investigated / learned / completed / next_steps / notes). This is arguably more useful for "what did I do last time" recall than per-fact extraction.
- **Per-tool-call observation captures intent + parameters + outcome together.** Higher fidelity than dialogue-only extraction. The unit of memory matches the unit of work.
- **Append-only with recency cutoff is a real alternative to LLM consolidation.** claude-mem doesn't consolidate — it appends, dedups by content hash within a 30s window, and filters retrieval to the last 90 days. Less powerful than our SUPERSEDE/DELETE, but vastly more reliable on small-model deployments. Worth considering as a fallback or alternative mode.
- **claude-mem pays for it with operational complexity.** Express daemon on :37777 + Chroma subprocess via `uvx chroma-mcp` + N observer Claude subprocesses + supervisor + zombie reaper. Pristine's single-file deployment is a real differentiator we should preserve.
- **claude-mem has zero memory-recall benchmarks despite 61k stars.** All quality claims are vibes. Pristine's LOCOMO baseline is a genuine talking-point asset — we should keep measuring.

### 3.4 No user-segment narrowing — memory hasn't pivoted like privacy did

`implementation-spec-004` (Secret Redaction for Agent Harnesses) made a deliberate pivot: it narrowed pristine's privacy module from "general PII detection" to "secrets that developers paste into agent conversations" (API keys, tokens, private keys). The narrowing made the privacy module:

- Easier to specify (clear use case, clear data shapes)
- Easier to evaluate (regex-deterministic, sub-millisecond)
- Easier to dogfood (Lou uses it daily)
- Easier to ship (smaller surface, faster wins)

The memory module never had an equivalent narrowing. It still tries to be "useful for any user with any kind of long-term memory need" — which is why the prompt has 7 personal-life categories, why we benchmark on LOCOMO (peer-to-peer life dialogues), and why every design discussion gets stuck on tradeoffs that wouldn't matter for a narrower scope.

**Spec-005's central claim:** memory should pivot the same way privacy did. Narrow to developer/coding agent memory. Same dogfood discipline. Same evaluation rigor.

---

## 4. What does a coding-agent memory actually need?

Reframing the design question. If we narrow to developer use, what are we actually building?

### 4.1 Five concrete scenarios

These are the recall situations a developer-focused memory system should handle. Written from the dev's POV — what they ask the agent, and what the agent needs to know.

**Scenario A — Resuming after a break.** *"I haven't touched this branch for a week. Where was I?"* The agent needs the last session's summary: what was being worked on, what was tried, what's incomplete, what was the next planned step. claude-mem's `session_summaries` row is exactly this.

**Scenario B — Recalling a decision.** *"Why did we go with sqlite-vec instead of Chroma?"* The agent needs durable decision facts with rationale. These were said once weeks ago and need to persist. Most useful when paired with the conversation excerpt where the decision was made.

**Scenario C — Avoiding a known gotcha.** *"Add JSON output to the extractor."* The agent should remember: gemma4:e4b emits markdown fences sometimes; we have `stripJsonWrapper()`; the SENSITIVE rules chunk was toxic. Searchable by keyword (`extractor`, `json`, `gemma4`) and triggered on context match, not just user query.

**Scenario D — Following the project conventions.** *"Add a new TypeScript file."* The agent should know the repo conventions (no `any`, conventional commits, kebab-case files, ESM imports) without the user repeating them. These are stated infrequently but apply universally.

**Scenario E — Cross-referencing prior work.** *"Did we ever discuss the consolidator truncation issue?"* The agent should be able to grep past conversations by keyword and surface the thread, not just an extracted fact. The conversation has more nuance than the fact.

### 4.2 Memory type taxonomy

Different scenarios → different memory shapes → different retention policies. This is the architecture lens.

| Type | Example | Lifecycle | Best layer |
|---|---|---|---|
| **Session summary** | "Implemented PR #94 fence fix; verified with 9 probes; pending Greptile re-review" | Persists indefinitely; accumulates one per session | LLM-generated at `Stop` hook |
| **Decision** | "Use sqlite-vec; avoid Chroma for single-file deploy" | Persists until explicitly superseded | Durable fact; agent-authored or extracted |
| **Convention** | "No `any` in TypeScript; conventional commits" | Persists; rarely changes | Durable fact; project-scoped |
| **WIP state** | "PR #94 waiting for Greptile" | Expires when work completes | Session summary or scratchpad |
| **Gotcha** | "gemma4:e4b emits markdown fences sometimes" | Persists until the underlying cause is gone | Durable fact; keyword-indexed |
| **Activity log** | "Edited `prompts.ts` line 44 — added `stripJsonWrapper`" | Recent only (last few sessions); searchable | Per-tool-call observation |
| **Conversation** | The full dialogue thread where a decision was made | Persists indefinitely; searchable by FTS5 | Conversation store (already exists) |

Observations on this table:

- The **session summary** layer is missing entirely from pristine today. It's probably the highest-value addition.
- The **conversation store** is undervalued — for many recall situations, FTS5-grepping past conversations is more useful than retrieving extracted facts. We built it but treat it as secondary.
- The **per-tool-call observation** layer (claude-mem's primary surface) doesn't exist for us. It's expensive (one LLM call per tool) but high-fidelity. Worth considering as an optional "deep capture" mode.
- The **durable facts** are what we currently extract. They cover decisions, conventions, gotchas — but only when the dialogue is rich enough. Missing the activity-log + session-summary layers means a lot of useful context never makes it in.
- **Retention policy varies by type.** WIP state should expire; conventions should persist; activity logs should age out. Our current consolidator-based forgetting (LLM judgment) is one-size-fits-all and unreliable. A simpler per-type policy would be more reliable.

### 4.3 What we can take from claude-mem's taxonomy (without taking the architecture)

claude-mem's observation `type` field is `bugfix | feature | refactor | change | discovery | decision`. This is a small, closed enum that maps cleanly to coding work. We can adopt the taxonomy without adopting the implementation (per-tool-call Sonnet observer subprocess).

A narrowed pristine extractor prompt could ask: *"Categorize this fact as one of: decision, convention, gotcha, state, activity, none. Skip anything that doesn't fit."* That's a much simpler classification task than our current 7-category personal-memory split — and the categories are actually useful for coding-agent retrieval.

---

## 5. Design direction (preliminary)

> *Skeleton only. We have ideas, not commitments. Each subsection deliberately avoids file paths, schema, or sequencing — those follow once we've validated the layering with prototypes.*

### 5.1 Layered memory architecture

Three candidate layers, each serving different scenarios from §4.1:

1. **Raw conversation + FTS5** — already shipped (Sprint 009). Underused. The grep fallback for "did we ever discuss X."
2. **Session summary (per-session)** — new. Generated by one LLM call at `Stop` hook. Structured: request / investigated / decided / completed / next_steps / open_questions. Serves Scenario A (resume) and Scenario E (cross-reference).
3. **Durable facts** — exists today, but pivoted to dev categories (decisions / conventions / gotchas). Probably agent-authored more than auto-extracted, given small-model reliability concerns.

The split lets us minimize per-turn LLM dependence (Layer 1 is free, Layer 2 is one call per session, Layer 3 is selective) while still enabling structured long-horizon recall.

### 5.2 Hook surface

Hooks we should consider, beyond the `PostToolUse` we already have:

| Hook | Matcher | Layer it serves | Purpose |
|---|---|---|---|
| `SessionStart` | `startup`, `clear`, `compact` | Layer 1 + 2 | Inject relevant project context — last summary, recent decisions, open WIP |
| `UserPromptSubmit` | — | Layer 1 + 3 | Optional surgical injection per query |
| `PostToolUse` | `*` | Layer 1 (always) + Layer 3 (selective) | Capture activity; gate extraction by tool type |
| `Stop` | — | Layer 2 | Generate session summary |
| `SessionEnd` | — | — | Flush pending background work |

`SessionStart(compact)` is particularly important — when Claude compresses context, working memory is gone but long-term memory should still be accessible. Re-injecting then is the highest-leverage moment.

### 5.3 Storage and retrieval

- **Stay with `sqlite-vec`.** Single-file deployment is a real differentiator. claude-mem's Chroma subprocess is the worst part of their architecture for our target user.
- **Hybrid retrieval (semantic + FTS5).** We have the pieces; not yet wired together. Code-adjacent queries need keyword fallback (file paths, error strings, issue numbers).
- **Project-scoped namespacing.** Memories partition by git root or workspace. Mirrors claude-mem's per-project Chroma collections. Avoids cross-project pollution.
- **Per-type retention policy.** WIP expires, conventions persist, activity ages out. Replaces the LLM consolidator's one-size-fits-all judgment.

---

## 6. Open questions

The load-bearing decisions we need to make before any implementation. Capturing these now while context is fresh.

1. **Auto-injection vs tool-only retrieval — which layers does which?** SessionStart auto-inject of session summaries seems clearly right. Auto-injecting durable facts on every session is more controversial (token cost, noise). Probably a config flag.

2. **Agent-authored vs auto-extracted durable facts — what's the proportion?** Letta/MemGPT's "scratchpad memory the agent writes to" is way more reliable than auto-extraction on small models. But it requires the agent to recognize memory-worthy moments. Could be hybrid: automatic for session summaries, agent-authored for durable facts via an explicit `remember(text, type)` tool.

3. **Project scoping mechanism.** Git root? Workspace dir? Config-driven? What about projects without a git root (one-off scripts)?

4. **Per-type retention policy.** Concrete policy needed: WIP expires after N sessions of no reference, conventions never expire, activity logs decay over 30 days. These numbers need to be defended.

5. **Eval target post-LOCOMO.** LOCOMO is wrong for the developer pivot. Options: (a) build a small coding-session benchmark by recording real sessions and writing recall questions, (b) borrow LongMemEval's coding subset if it exists, (c) accept evaluating qualitatively via dogfooding for now.

6. **Per-tool-call observation layer — adopt or not?** claude-mem's per-tool extraction gives high fidelity but at high cost. We'd want it on a small local model — could it work? Worth a prototype before deciding.

7. **What happens to the existing extractor + consolidator?** If we add session summaries as Layer 2 and shift durable facts to agent-authored, the per-turn extract+consolidate pipeline becomes redundant for many use cases. Do we deprecate it, keep it as opt-in, or rebuild it for the new categories?

8. **Backwards compatibility with existing data.** Pristine has shipped. Existing memory DBs use the LOCOMO-aimed extraction. Migration path? Or accept a clean break (we're pre-1.0)?

---

## 7. Goals and non-goals

> *Scaffold only. To be filled once §5 design direction is validated by prototypes.*

### Goals (placeholder)
- *(TBD: 4–6 goals matching the developer pivot)*

### Non-goals (placeholder)
- *(TBD: explicit exclusions to prevent scope creep)*

---

## 8. Validation experiments before committing

> *Scaffold only. Small prototypes worth running before locking in §5.*

Likely candidates:

- **Session-summary prototype** — Stop-hook script that calls gemma4:e4b once with last N turns, produces structured summary. Measure: can gemma4 produce a useful summary? How long does it take? Is the recall quality on Scenario A (resume) actually better than current per-turn extraction?
- **Narrow-extractor prompt A/B** — replace the 7-category personal prompt with a coding-focused one (decisions / conventions / gotchas / state). Re-run baseline. Measure: do the extracted facts feel more useful for dev recall, even if LOCOMO numbers drop?
- **Agent-authored `remember()` tool** — explicit tool the agent calls when the user says "remember X" or when a decision is made. Measure: is this more reliable than auto-extraction for durable facts?
- **SessionStart injection prototype** — minimal hook script that fetches the last 3 session summaries and injects them as context. Measure: does it actually help in dogfooding?

> *(To be expanded once we know which subset to run.)*

---

## 9. Relation to prior specs

| Spec | Relation |
|---|---|
| `implementation-spec-001.md` | Original architecture. Memory-related phases mostly superseded by spec-003. spec-005 modifies the "what to extract" question further. |
| `implementation-spec-002.md` | (separate scope) |
| `implementation-spec-003.md` | Memory architecture refinement (conversation store, embedder engines, ingest queue, CLI scripts). spec-005 **modifies** Phases 1–6 of this spec at the semantic layer (what we extract, what we store) but does **not** invalidate the storage / hook / scripts infrastructure already built. |
| `implementation-spec-004.md` | Privacy narrowed to secrets for developer use. spec-005 is the parallel pivot for memory. Same target user (developers, dogfooded). Same narrowing discipline. |

Nothing is superseded outright. spec-005 is a **refinement layer** on top of spec-003's infrastructure, with a sharper user focus inherited from spec-004's discipline.

---

## 10. References

### From this codebase
- `docs/analysis/claude-mem-vs-pristine.html` — 21-slide comparison deck (open in browser)
- `docs/sprints/sprint-012.md` — drafted sprint for consolidator failure diagnosis (not committed)
- `src/memory/extractor/prompts.ts` — current LOCOMO-aimed default prompt
- `src/memory/consolidator/index.ts` — current LLM-based consolidator
- `benchmarks/memorybench/scripts/debug-orchestrator.mjs` — diagnostic tool that revealed consolidator truncation
- PR #94 — `fix/gemma4-extraction-diagnostic`, branch with all the work this spec reflects on

### External
- claude-mem repo: <https://github.com/thedotmack/claude-mem>
- Anthropic Claude Code hooks reference: <https://docs.claude.com/en/docs/claude-code/hooks>
- LOCOMO benchmark paper (the eval we currently run)
- Letta / MemGPT memory model (alternative agent-authored approach)

### Prior pristine specs
- `docs/specs/implementation-spec-001.md`
- `docs/specs/implementation-spec-003.md`
- `docs/specs/implementation-spec-004.md`
