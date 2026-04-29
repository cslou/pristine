# Pristine — Sprint 020
**Date:** TBD – TBD
**Goal:** Drop the LLM machinery from Pristine — delete the `LlmClient` interface, `LlmClients` bundle, the LlamaCpp/Ollama engine factory, the legacy `Memory` / `SanitizedMemory` type pair, and the legacy retriever — after the privacy classifier (separate developer track) has migrated to a deterministic alternative.
**Status:** 🟡 Planning

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first.
- **Current state:** Post-sprint-018 (public-API hygiene). The barrel exposes `Pristine.create({...})` accepting a `LlmClients` DI bundle that wires two `LlmClient` instances (one for the privacy classifier, one for the legacy memory pipeline). Post-spec-005 Phase-4 retrieval (sprint-016) does NOT use the memory `LlmClient` — that path is dead code reachable only via the legacy `src/memory/retriever/ranking.ts`. Privacy still uses the privacy `LlmClient` for the LLM-augmented classifier; sprint-020 is gated on the privacy track switching to a deterministic alternative.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — §5.1 enumerates the live primitives (`store`, `indexer`, `searcher`, `embedder`); the `LlmClient` interface and the legacy memory pipeline are NOT in §5.1 and are explicitly retired by this sprint.

### Sprint-Level Technical Context

- **Hard dependency on the privacy track.** Sprint-020 starts only after the privacy team's work to remove `LlmClient` from the privacy classifier has landed on `main`. While that work is in flight, sprint-020 stays in 🟡 Planning. **Coordination signal:** privacy track merges a PR that drops `secureAndRedact` / `reveal` / `scrubOutput`'s dependency on `LlmClient`. Sprint-020 kicks off the day after.
- **Two-track sprint.** The privacy team owns everything in `src/privacy/` (classifier swap, pipeline rewiring, classifier tests). Sprint-020 owns everything DOWNSTREAM of that work — public-API surface, engine factory, model registry, legacy memory pipeline, legacy types. The two tracks meet at the privacy classifier's `LlmClient` import: once that import is gone, sprint-020 can delete the interface.
- **Pure removal sprint.** No new features. Every commit deletes code or simplifies a public method's signature. Schema/DDL: NONE.
- **Two breaking changes to the public API.** Both documented in CHANGELOG / migration notes (Story 7, the final cleanup story):
  1. `PristineLocalConfig.llmClients` is removed (Story 2). Any consumer passing `llmClients` to `Pristine.create({...})` must drop the arg.
  2. `Pristine.createLite()` is removed (Story 6). Any consumer using the lightweight read-only factory must switch to `Pristine.create({...})` — the underlying read-only capabilities (`searchConversations`, `getConversation`) are preserved on the full client. The `createLite` factory shipped pre-sprint-020 with a speculative "skip the embedder/privacy load" optimization that turned out to have no real consumers (the embedder is already lazy on `Pristine.create`); collapsing the two entry points into one is part of the sprint's "intentional API surface" goal.
- **Out of scope (explicit):**
  - **Embedder spike (sprint-017).** Independent track.
  - **Phase-5 SQL primitive (sprint-019).** Independent track.
  - **Phase-6 reference tools.** Build on top of the post-sprint-020 surface; planned next.
  - **Privacy classifier itself.** Owned by the privacy track.
  - **Re-architecting the privacy API.** `secureAndRedact` / `reveal` / `scrubOutput` keep their current public signatures — only their internal `LlmClient` dependency disappears.

### User Flows

- **Affected (existing):**
  - **Flow 1 — Ingestion** (`docs/specs/implementation-spec-005.md` §15): `Pristine.create({...})` no longer accepts `llmClients`. The factory's internal call to `createLlmClients` is removed. `storeAsync` is unaffected (it never used the LLM clients post-spec-005).
  - **Flow 2 — Retrieval** (§15): unchanged behaviorally; `src/memory/retriever/ranking.ts`'s temporal-boost helpers either move into the searcher (if Phase-4 still wants them) or get deleted. To be decided in Story 5.
- **New (this sprint):** None.

### Test Harness Pattern

Story 1 ships a public-API integration harness extension (or new file) that:
- Asserts `LlmClient` / `LlmClients` are absent from the package barrel (runtime + static-grep, mirroring sprint-018 Story 4's hybrid mechanism).
- Asserts `Pristine.create({...})` rejects an `llmClients` arg via TypeScript error (the field is removed from `PristineLocalConfig`). Use the same `@ts-expect-error` removal-forcing function as sprint-018 Stories 2 + 3.
- Asserts `src/engine/` and `src/models/` directories no longer exist (filesystem grep).
- Asserts `Memory` and `SanitizedMemory` are absent from `src/core/types.ts`.
- Asserts `Pristine.createLite` is absent (runtime check on the static method) and `PristineLiteConfig` is absent from the barrel (static-grep).

Inner-loop tests (the engine + classifier + ranking tests being deleted) get their corresponding test files removed — those files are dead code post-removal.

### Stories

**Constraints:** Target a maximum of 5-8 stories per sprint. Target a maximum of 5-8 commits per story. Standing commit-floor exemption applies to Stories 2-7 — each is "single removal-set + test file deletions" and splitting per-symbol is artificial granularity.

#### Story 1: Public-API + filesystem absence harness

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **As a** Pristine SDK maintainer, **I want** an integration harness that fails RED if any of the LLM-removal or createLite-removal targets is still present, **so that** Stories 2-6 each turn one assertion GREEN as they ship and the sprint cannot be declared done while any target survives.
- **Dependencies:** None (Story 1 ships first).
- **Acceptance criteria:**
  - [ ] `tests/integration/llm-removal.test.ts` (or extension to `public-api.test.ts`) exists, imports only from the package barrel, and is wired into `npm run test:integration`.
  - [ ] RED outer-loop test for Story 2 — `Pristine.create({ llmClients: ... })` produces a TS error (covered via `@ts-expect-error` directive that self-removes via TS6133 once Story 2 strips the field from `PristineLocalConfig`).
  - [ ] RED outer-loop test for Story 3 — `LlmClient` and `LlmClients` are absent from `src/index.ts` exports (runtime + static-grep, sprint-018 Story 4 hybrid pattern).
  - [ ] RED outer-loop test for Story 4 — `src/engine/` and `src/models/` directories no longer exist (filesystem `existsSync` check). Currently FAILS (both dirs exist); Story 4's removal flips it GREEN.
  - [ ] RED outer-loop test for Story 5 — `Memory` and `SanitizedMemory` are absent from `src/core/types.ts` source (line-anchored regex per sprint-018 Story 4).
  - [ ] RED outer-loop test for Story 6 — `Pristine.createLite` is absent (runtime check: `expect(typeof PristineLocal.createLite).toBe('undefined')` since the static method's been removed) AND `PristineLiteConfig` is absent from the `src/index.ts` export source (line-anchored regex). Currently FAILS (both still exist); Story 6's removal flips it GREEN.
  - [ ] No regression in unit / integration suites.
- **Testing approach:** Mirror sprint-018 Story 1's harness shape — barrel-only imports, `@ts-expect-error` directives for unimplemented removals, runtime + static-grep for type-only / filesystem absence checks. ESLint barrel-only rule from sprint-018 covers the new file too (or extend the override to it).
- **QA:**
  - Manual: N/A (backend test harness).
  - Automated: `npm run test:integration` shows the new RED outer-loop tests.
- **Planned commits:**
  1. `chore(test): scaffold tests/integration/llm-removal.test.ts with imports-from-barrel-only ESLint coverage`
  2. `test(llm-removal): RED outer-loop test for Story 2 — Pristine.create rejects llmClients arg`
  3. `test(llm-removal): RED outer-loop test for Story 3 — LlmClient/LlmClients absent from barrel`
  4. `test(llm-removal): RED outer-loop test for Story 4 — src/engine + src/models directories absent`
  5. `test(llm-removal): RED outer-loop test for Story 5 — Memory/SanitizedMemory absent from src/core/types.ts`
  6. `test(llm-removal): RED outer-loop test for Story 6 — Pristine.createLite + PristineLiteConfig absent`
- **Technical notes:**
  - **Reuse sprint-018 Story 1 patterns.** `@ts-expect-error` for missing-symbol RED state; runtime + static-grep for export absence; `describe.skipIf(skipSlow)` + `SLOW_TEST_TIMEOUT_MS = 120_000` per-hook + per-it.
  - **Filesystem absence check.** `import { existsSync } from 'node:fs'; expect(existsSync(new URL('../../src/engine', import.meta.url))).toBe(false);` — same `import.meta.url` pattern as sprint-018 Story 4's source-file read. ESLint barrel-only rule does NOT block `node:fs` imports.
- **Priority:** Must-have

#### Story 2: Drop `llmClients` from `Pristine.create({...})`

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **As a** Pristine SDK consumer, **I want** `Pristine.create({...})` to stop accepting an `llmClients` arg I never used post-spec-005, **so that** the public API surface no longer advertises a now-defunct DI seam.
- **Dependencies:** Story 1 (outer-loop test exists). **Privacy track must have merged the classifier's `LlmClient` removal first** — otherwise `Pristine.create()` still needs to wire LlmClients for the privacy pipeline.
- **Acceptance criteria:**
  - [ ] `PristineLocalConfig.llmClients` removed.
  - [ ] `Pristine.create({...})` factory no longer calls `createLlmClients`. Internal `llmClients` field on `PristineLocal` removed.
  - [ ] Privacy methods (`secureAndRedact` / `reveal` / `scrubOutput`) still work — they consume the post-privacy-track classifier directly, not through `this.llmClients`.
  - [ ] Story 1's `@AC-Story2-1` outer-loop test goes GREEN.
  - [ ] No regression in unit / integration suites; typecheck + lint clean.
  - [ ] Migration note in PR body — what consumers passing `llmClients` need to change.
- **Testing approach:** Update `tests/client.test.ts`'s `Pristine.create` tests to drop `llmClients`. Verify the privacy pipeline tests still pass.
- **Planned commits:** TBD — sized at sprint-start once privacy track lands.
- **Technical notes:** Coordination point — the privacy classifier interface change must be in place before this story can ship.
- **Priority:** Must-have

#### Story 3: Drop `LlmClient` / `LlmClients` from the barrel + interfaces

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **As a** Pristine SDK maintainer, **I want** the `LlmClient` and `LlmClients` types removed from the package barrel and from `src/core/interfaces.ts` / `src/engine/index.ts`, **so that** consumers see only the live spec-005 §5.1 primitives.
- **Dependencies:** Story 2 (consumer-facing surface no longer references the types).
- **Acceptance criteria:**
  - [ ] `LlmClient` removed from `src/core/interfaces.ts`.
  - [ ] `LlmClients` removed from `src/engine/index.ts`.
  - [ ] Both removed from `src/index.ts` barrel.
  - [ ] Top-of-file JSDoc on `src/index.ts` (sprint-018 Story 5) updated — drop the DI section's `LlmClient` reference.
  - [ ] Story 1's `@AC-Story3-1` outer-loop test goes GREEN.
  - [ ] No internal consumer reaches the types through the barrel — verify via grep audit (sprint-018 Story 4 pattern).
- **Priority:** Must-have

#### Story 4: Delete `src/engine/` and `src/models/` directories

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **As a** Pristine SDK maintainer, **I want** the entire LLM engine machinery deleted, **so that** the codebase no longer carries `LlamaCppClient`, `OllamaClient`, the model registry, the model download script, and their tests as dead code.
- **Dependencies:** Story 3 (no consumers of the engine factory remain).
- **Acceptance criteria:**
  - [ ] `src/engine/` directory deleted (`LlamaCppClient`, `OllamaClient`, factory, types).
  - [ ] `src/models/` directory deleted (model registry, download script).
  - [ ] `tests/engine/` and `tests/models/` directories deleted.
  - [ ] `models.json` config file deleted (no consumer remains).
  - [ ] Story 1's `@AC-Story4-1` outer-loop test goes GREEN.
  - [ ] No surviving import of `./engine/` or `./models/` anywhere in `src/` or `scripts/`.
  - [ ] No regression in unit / integration suites.
- **Priority:** Must-have

#### Story 5: Delete `Memory` / `SanitizedMemory` + retire `src/memory/retriever/ranking.ts`

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **As a** Pristine SDK maintainer, **I want** the pre-spec-005 `Memory` / `SanitizedMemory` types deleted and the legacy `src/memory/retriever/ranking.ts` retired, **so that** the codebase no longer carries dead row-shape contracts from the retired fact-ledger era.
- **Dependencies:** Stories 2-4 (the privacy pipeline post-classifier-swap no longer uses `SanitizedMemory`; no other consumer remains).
- **Acceptance criteria:**
  - [ ] `Memory` and `SanitizedMemory` removed from `src/core/types.ts`.
  - [ ] `src/memory/retriever/ranking.ts` either deleted entirely OR refactored to drop the `Memory` import and operate on the post-spec-005 hit shapes (decision deferred to story-start review). Test file follows the same fate.
  - [ ] Story 1's `@AC-Story5-1` outer-loop test goes GREEN.
  - [ ] No surviving import of `Memory` / `SanitizedMemory` anywhere in `src/`.
  - [ ] Privacy pipeline (post-classifier-swap) doesn't reference `SanitizedMemory` — verified by privacy track + a grep here.
- **Priority:** Must-have

#### Story 6: Remove `Pristine.createLite()` + lite-throw guards

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **As a** Pristine SDK maintainer publishing a top-tier opensource SDK, **I want** `Pristine.createLite()` and its associated lite-throw guards removed, **so that** consumers see one canonical entry point (`Pristine.create({...})`), the public-API mental model stops requiring "lite vs full" branching, and the `null as unknown as ...` punning in the `createLite` factory disappears (resolving a pre-existing modularity finding from sprint-018's review).
- **Background.** `createLite` shipped pre-sprint-018 with a speculative "skip the embedder + privacy load" optimization. The embedder is already lazy on `Pristine.create({...})` (Nomic loads on first `embed()` call, not at construction), so `createLite`'s only real saving is skipping the privacy infra (RSA-4096 keygen on first run) — ~1-2 seconds, one-time. No real consumer outside `tests/client.test.ts` uses it; the harness was carrying weight for a use case nobody filed an issue requesting. Read-only access (`searchConversations`, `getConversation`) is preserved on the full client; this story removes only the redundant entry point.
- **Dependencies:** Story 1 (outer-loop absence test exists). Independent of Stories 2-5 (the LLM-removal track) — can ship in any order relative to them.
- **Acceptance criteria:**
  - [ ] `PristineLocal.createLite()` static method removed from `src/client.ts`.
  - [ ] `PristineLiteConfig` interface removed from `src/client.ts` and the `src/index.ts` barrel.
  - [ ] Lite-throw guards removed from `storeAsync`, `drainEmbedQueue`, `buildSessionVector` (the `if (this.indexer === null) throw new InvalidArgumentError(...)` early returns). These methods now assume a fully-constructed client.
  - [ ] `PristineLocal` private fields shed their `null as unknown as ...` punning. `embedder`, `llmClients` (until Story 3 deletes it), `keyManager`, `kekManager`, `vaultStore`, `indexer`, and `searcher` become non-nullable on the type level. Resolves the post-sprint-018 P2 modularity finding about `createLite`'s null-punning.
  - [ ] `client.searcher` and `client.indexer` field types narrow from `Searcher | null` / `Indexer | null` to `Searcher` / `Indexer`. The `client.searcher!` non-null assertion in JSDoc lifecycle examples + the public-API harness becomes plain `client.searcher`. (The harness change is mechanical doc/test follow-up; the type narrowing is the load-bearing change.)
  - [ ] `tests/client.test.ts` `describe('createLite()')` block removed entirely (3 tests). Per the user-locked "tests don't change" constraint, the explicit allowed exception is "tests for a redundant function that no longer exists" — these 3 tests qualify.
  - [ ] Story 1's `@AC-Story6-1` outer-loop test (the `Pristine.createLite` absence runtime + `PristineLiteConfig` static-grep) goes GREEN.
  - [ ] No regression in remaining unit / integration / e2e suites.
- **Testing approach:** Story 1's outer-loop absence test verifies the public-API removal. The 3 `createLite`-specific unit tests in `tests/client.test.ts` are removed — they tested a redundant capability that no longer exists. Existing `Pristine.create()` tests cover the surviving entry point.
- **QA:**
  - Manual: N/A (backend SDK refactor).
  - Automated: `npm run test:unit` + `npm run test:integration` + `npm run test:e2e` all green.
- **Planned commits:**
  1. `refactor(client): remove createLite factory + lite-throw guards + null-punning fields`
  2. `chore(test): remove createLite test block (testing a redundant entry point)`
- **Technical notes:**
  - **Why not just demote createLite in JSDoc.** Considered as alternative ("keep, mark advanced"), rejected: maintaining an entry point with no real consumers carries permanent cost (test surface, null-punning footgun, lite-throw guards on every new write method). Removal is cleaner now than half-measure.
  - **If consumer signal surfaces post-merge.** If someone files a "I want a lighter boot path that skips RSA keygen" issue post-sprint-020, the right response is a properly-designed `createReadOnly()` factory aimed at the actual use case — not the speculative one this story removes. Out of scope for now.
  - **Sequencing relative to Stories 2-5.** Independent of the LLM-removal track. Slot here (after Story 5, before Story 7's JSDoc cleanup) so Story 7 captures the post-createLite state in one final pass.
- **Priority:** Must-have

#### Story 7: Spec + JSDoc cleanup

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **As a** new Pristine SDK consumer reading the docs, **I want** the post-sprint-020 surface accurately reflected in `src/index.ts`'s top-of-file JSDoc and `docs/specs/implementation-spec-005.md` §15, **so that** the documentation matches the code reality.
- **Dependencies:** Stories 2-6 (the doc reflects the post-sprint surface, not pre-sprint).
- **Acceptance criteria:**
  - [ ] Top-of-file JSDoc on `src/index.ts` updated — drop the "DI interfaces (`Embedder`, `LlmClient`)" section's `LlmClient` reference; the section becomes "DI interface (`Embedder`)" or relocates the embedder note inline.
  - [ ] Top-of-file JSDoc "Primary entry points" section collapses from two bullets (full + lite) to one bullet — `Pristine.create({...})` is the sole canonical entry point. Lite-throw mentions on `storeAsync` / `drainEmbedQueue` / `buildSessionVector` JSDoc are removed (the methods no longer have a lite path to throw on).
  - [ ] `client.searcher!` non-null assertions in the lifecycle code example become plain `client.searcher` (post-Story-6, the field is non-nullable).
  - [ ] `docs/specs/implementation-spec-005.md` §15 Flow 1 + Flow 2 prose updated — remove references to `LlmClients`, the privacy LLM classifier, and the legacy retriever path.
  - [ ] CHANGELOG entry (or sprint-020 PR body migration note) summarizes BOTH public-API breaking changes:
    1. `Pristine.create({...})` no longer accepts `llmClients` (Story 2).
    2. `Pristine.createLite({...})` is removed; consumers must switch to `Pristine.create({...})` (Story 6).
  - [ ] `npm run typecheck` + `npm run lint` clean. (No test changes — pure docs.)
- **Priority:** Must-have

### Sprint completion

After the last feature story merges into `sprint-020`, run the **sprint-completion workflow** (`workflow-prompts/handle-sprint-completion.md`) — 6-section chat message + sprint-doc mutation commit. Then open the `sprint-020 → main` integration PR.

### Rules

- **Sprint-branch setup (before Story 1):** create `sprint-020` off `main` and push. Commit this sprint doc as the first commit on the branch. Story PRs target `sprint-020`. After the last story merges + the sprint-completion workflow runs, open `sprint-020 → main` integration PR.
- **Cross-track coordination.** Privacy track must signal `LlmClient` removal complete before Story 2 can ship. Daily check-in on the privacy PR's status during sprint-020 execution.
- We sequentially do the stories. We do not do parallel work.
- For everything else — commits, PR process, code quality, testing — follow the system instructions (the conventions loaded at session start).

### Definition of Done

- All must-have stories pass acceptance criteria.
- Privacy track's `LlmClient` removal has merged before sprint-020 starts.
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings).
- **Sprint completion run** per `workflow-prompts/handle-sprint-completion.md` — sprint doc mutated, 6-section chat message emitted.
- **Sprint-integration PR merged** (`sprint-020 → main`); `sprint-020` deleted from origin; local `main` fast-forwarded.
- **Implementation spec touchup** in §15 Flow 1 + Flow 2 (Story 7) — required since the legacy LLM-driven memory pipeline is documented there.
- **Two migration notes** (both surfaced in Story 7's CHANGELOG entry / PR body):
  1. Consumers passing `llmClients` to `Pristine.create({...})` must drop the arg — the field is removed.
  2. Consumers calling `Pristine.createLite({...})` must switch to `Pristine.create({...})` — the lightweight factory is removed; read-only access (`searchConversations`, `getConversation`) is preserved on the full client.
