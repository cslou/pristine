# Pristine Local — Sprint 012
**Date:** TBD
**Goal:** Diagnose and fix the consolidator step so dialogue-dense LOCOMO sessions stop producing 0 memories when ingested sequentially into a shared DB.
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec, Ollama (gemma4:e4b)
- **Current state:** Sprint 008c shipped the LOCOMO baseline infrastructure. PR #94 (fix/gemma4-extraction-diagnostic) then rescued the extractor so gemma4:e4b now reliably returns facts on dialogue-dense sessions (session_5/12/14: 10/10/19 facts in 3/3 probe runs) and bumped the consolidator batch budget 4096→16384 tokens. The full `--limit 1` baseline rose from 54 memories / 8 sessions to **83 memories / 10 sessions** — a real improvement, but 9 sessions (5, 7, 8, 9, 11, 13, 15, 17, 18) still produced 0 memories each in the shared-DB run even though the extractor emits facts for them in isolation. The remaining failures are **inside the consolidator**, not the extractor.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phases 4 + 8
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context

#### What we know so far
- **Extractor is solid.** `scripts/debug-pristine-extractor.mjs` and `debug-failing-sessions.mjs` consistently return 7–19 facts for the failing sessions when called in isolation. The `{facts: []}` failure mode is fixed.
- **Consolidator is the bottleneck.** `scripts/debug-orchestrator.mjs` (from PR #94) ingests five sessions through the real pipeline and showed:
  - session_1 (18 msgs, 8 facts) → 8 ADD → 8 memories ✓
  - session_5 (16 msgs, 10 facts) → 10 ADD → 10 memories ✓ (in isolation)
  - session_7 (27 msgs, 16 facts) → `consolidate: Ollama response parsing failed: Unexpected end of JSON input` → 0 memories ✗
  - session_8 (39 msgs, 15 facts) → same error → 0 memories ✗
  - session_12 (21 msgs, 7 facts) → 7 ADD → 7 memories ✓
- **Token budget helped but didn't finish the job.** Bumping `DEFAULT_BATCH_MAX_TOKENS` from 4096 → 16384 fixed the isolated-probe truncations for session_7 and session_8. But in the full baseline (all sessions ingested sequentially into one DB), session_5 — which succeeded in isolation — now fails too. Hypothesis: as prior-session memories accumulate in the DB, the search step retrieves more similar memories per fact, and either the input prompt overruns context, the output still truncates past 16384 on very-rich responses, or the model returns something outside the expected schema.
- **Provider WARN is misleading.** `src/providers/pristine/index.ts:232` warns "Likely cause: content-hash duplicate detection against a stale DB" on every `memoryIds.length === 0`, regardless of the actual failure. The real cause is buried in `result.errors[]` but never logged. This made the consolidator issue initially look like a DB-state bug.

#### What we don't know yet
- Whether the full-baseline failures are still truncation (at 16384), input-context overflow, schema rejections, or all-NOOP decision chains.
- Whether the failure rate correlates with fact count, similar-memory count, total prompt size, or session index.
- Whether gemma4:e4b has a lower effective output cap than 16384 (the configured `num_predict` might be advisory).
- Whether the pattern is gemma4-specific or reproduces on llama3.2:latest / gemma4:12b.

The first story fixes the diagnostic gap so the next two stories can be driven by real data.

### Parallelization
Sequential. Story 1 is the instrumentation that makes Story 2's diagnosis possible. Story 3 depends on what Story 2 uncovers. Story 4 is the verification baseline.

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story.

#### Story 1: Surface real pipeline errors in the provider WARN
- **Problem:** `src/providers/pristine/index.ts:232` emits a canned "content-hash duplicate detection against a stale DB" message for every `memoryIds.length === 0`. This was factually wrong across the last baseline — the real errors (`consolidate: Unexpected end of JSON input`) were sitting inside `result.errors` but never logged.
- **Change:** When `memoryIds.length === 0`, log `result.errors` (step name + message) verbatim, and only fall back to the content-hash hypothesis when `result.errors` is empty.
- **Acceptance:**
  - Running `--limit 1 --force` baseline on conv-26 emits the actual per-step error for every WARN'd session (truncation, schema, or other).
  - Existing tests still pass; new test asserts the WARN format includes at least one `step:` / `error:` pair when `result.errors` is non-empty.
- **Out of scope:** Changing the WARN vs ERROR severity. Keep WARN for now — downstream analysis decides if it should escalate.
- **Planned commits:** 1 (`fix: provider logs pipeline errors instead of canned dedup hypothesis`).

#### Story 2: Diagnose every failing session in the --limit 1 baseline
- **Prereq:** Story 1 (need real error messages first).
- **Change:** With the better log, re-run the full baseline (\`gemma4-refine-v3\`). Categorize each WARN'd session:
  - A. Output truncation at 16384 (`Unexpected end of JSON input` / matching substring)
  - B. Input context overflow (Ollama 400 / `n_ctx`-related error)
  - C. Schema rejection (`expected type … got …`)
  - D. All-NOOP decision chain (not a failure; facts deliberately merged)
  - E. Other / unknown
- **Add instrumentation** in `src/memory/consolidator/index.ts:callWithRetry` to log, per batch:
  - input prompt length in chars + approx tokens
  - output content length in chars
  - \`maxTokens\` requested
  - number of facts, number of similar memories total
- Write findings into \`docs/sprints/sprint-012-diagnosis.md\` (one line per failing session + totals per class).
- **Acceptance:**
  - Every WARN'd session has a class label (A/B/C/D/E).
  - Counts per class published in the diagnosis doc.
  - Instrumentation logs committed behind a debug flag (not enabled by default) so re-running diagnostics is a 1-line change.
- **Out of scope:** Fixes. This story only measures.
- **Planned commits:** 2 (`chore: add consolidator debug logging behind CONSOLIDATOR_DEBUG flag`, `docs: sprint-012 consolidator failure diagnosis`).

#### Story 3: Fix based on Story 2 findings
- **Prereq:** Story 2 (must know the class distribution first).
- **Anticipated paths (pick the one the data supports — do not pre-commit):**
  - Class A (truncation): bump again, or add a batch-split path when \`factCount > N\`.
  - Class B (input overflow): cap similar-memories-per-fact at top K (currently uncapped in the consolidator call path; search step's K feeds straight through).
  - Class C (schema): tighten the consolidator JSON schema or the prompt, mirroring what was done for the extractor in PR #94.
  - Class D (all-NOOP): not a fix — update Story 1's WARN to classify NOOP chains separately ("all facts merged — no new memories") rather than conflating with failures.
  - Class E: one-off investigation + targeted fix.
- **Acceptance:**
  - The class that dominates Story 2 counts is addressed.
  - Unit tests cover the fix (e.g., batch-splitter tests, K-cap tests, or schema tests).
  - Root cause written up in the commit message so future regressions have context.
- **Out of scope:** Fixing every class if one dominates. One story, one fix. Remaining classes become follow-ups.
- **Planned commits:** 1–3 depending on the fix path.

#### Story 4: Re-run full baseline and verify the fix holds
- **Prereq:** Story 3.
- **Change:** Execute \`npm run bench -- run -p pristine -b locomo -j ollama:gemma4:e4b -m ollama:gemma4:e4b -r gemma4-sprint012-verify --limit 1 --force\`. Compare to v2 baseline.
- **Acceptance:**
  - Memory count is ≥ 100 (v2 was 83; Story 3 should lift at least 3–4 sessions off the zero-floor).
  - Distinct successful sessions is ≥ 13 (v2 was 10).
  - \`validFrom\` distribution still centered on 2023.
  - No regression in retrieval quality (Hit@10, MRR).
  - Post-fix numbers recorded at the top of this sprint file.
- **Out of scope:** Question-accuracy improvements — the answering model is the bottleneck there, not retrieval. Keep --limit 1.
- **Planned commits:** 1 (\`docs: record sprint-012 verification baseline numbers\`).

---

## Notes for future sprints
- The consolidator and extractor use separate prompts. Any further extractor changes should mirror the structured-output best practices already applied (schema in prompt, mode framing, few-shot, no markdown fences) — otherwise the same gemma4 failure modes reappear.
- The misleading provider WARN was load-bearing in tooling — it survived two reviews. Be suspicious of any canned-hypothesis error message that doesn't actually read the error object.
- \`scripts/debug-orchestrator.mjs\` from PR #94 is the right tool to triage any future "X sessions produce 0 memories" mystery — it isolates per-session failures and prints per-step errors.
