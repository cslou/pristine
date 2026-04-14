# Pristine Local — Sprint 009
**Date:** TBD
**Goal:** Add a conversation store so agents can search past conversations by keyword and date, and retrieve full conversation context from extracted facts
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 007 complete. SDK shippable — `PristineLocal.create()` wires all modules. 558 tests passing. The ingest pipeline stores raw conversations as a `user_raw` memory record with a zero-vector embedding (unsearchable hack). Agent frameworks (Claude Code, Pi) store conversations as JSONL files with no cross-session search capability. Extracted facts carry `sourceConversationId` but it points to the unsearchable `user_raw` record — agents cannot retrieve the source conversation.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phases 1 + 2
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint adds a new module: `src/conversations/store.ts` — the `ConversationStore`. It has its own tables, own responsibility (store and search raw conversations), and no dependencies on other Pristine modules. It follows the same modular pattern as the memory store, vault store, etc.
- The ConversationStore replaces the `user_raw` zero-vector hack. Every `store()` call writes the conversation here first, before extraction begins.
- The conversation store enables two workflows: (1) keyword/date search across all past conversations, (2) retrieve the full conversation that produced a given fact via `sourceConversationId`.
- **Coupling is minimal and one-directional:** the ingest pipeline writes to ConversationStore and receives a `conversationId` string back. That string is passed through the memory pipeline as `sourceConversationId` on each extracted fact. The downstream memory processing steps (extract, embed, consolidate, store) do not call ConversationStore — they only carry the ID string forward. Agents later follow the ID back to ConversationStore to get the full conversation.
- **Interface changes:** `IngestDependencies` and `OrchestratorConfig` gain a `conversationStore` field (dependency injection, same pattern as Store/Embedder/Extractor). `PristineLocal` creates the ConversationStore and passes it through. Two new public methods: `searchConversations()` and `getConversation()`.
- **Removals:** `USER_RAW_MEMORY_ORIGIN`, `USER_RAW_VECTOR_DIMENSION`, `toConversationMemoryInput()` from ingest.ts. The storeUser step no longer creates a zero-vector memory record.
- FTS5 triggers keep the full-text index in sync with the messages table automatically.
- The conversation store uses the same SQLite database file (`~/.pristine/data/pristine.db`) — tables are created on init alongside the existing memory and vault tables.

### Parallelization
Stories are sequential: Story 1 (conversation store module) → Story 2 (ingest pipeline changes) → Story 3 (client API + search) → Story 4 (tests + verification).

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Implement ConversationStore module
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** a ConversationStore that persists full conversations in SQLite with FTS5, **so that** past conversations are searchable by keyword and date.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/conversations/store.ts` exports `ConversationStore` class
  - [ ] DDL creates `conversations`, `messages`, `messages_fts` tables with FTS5 triggers on init
  - [ ] `addConversation(messages, userId)` stores conversation + messages, returns `conversationId`
  - [ ] `getConversation(conversationId)` returns full conversation with ordered messages
  - [ ] `searchConversations({ userId, keyword?, dateFrom?, dateTo?, limit? })` returns matching conversations with FTS5 snippets
  - [ ] Tables created in the same database as memory/vault tables (shared SQLite file)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests with in-memory SQLite: CRUD operations, FTS5 keyword search, date filtering, combined filters, snippet generation, empty results.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement ConversationStore with SQLite schema and FTS5` — src/conversations/store.ts with DDL, addConversation, getConversation, searchConversations
  2. `test: add ConversationStore unit tests` — tests/conversations/store.test.ts
- **Technical notes:**
  - Schema from spec: `conversations` (id, user_id, created_at, message_count), `messages` (id, conversation_id, role, content, timestamp, sort_order), `messages_fts` (FTS5 on content with sync triggers)
  - Schema must include `content_hash TEXT NOT NULL` on the conversations table with `CREATE UNIQUE INDEX idx_conversations_user_content_hash ON conversations(user_id, content_hash)`. `addConversation()` computes SHA-256 from concatenated message content (same pattern as memory store). This enables dedup in Story 2 via the same `isDuplicateKeyError` pattern.
  - Use `randomUUID()` for conversation IDs (same pattern as memory store)
  - FTS5 `snippet()` function for keyword-highlighted search results
  - `searchConversations` builds a dynamic WHERE clause: keyword → FTS5 MATCH, dateFrom/dateTo → created_at range, userId → exact match
  - Messages ordered by `sort_order` (not by ID, in case of insertion order differences)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Replace user_raw with ConversationStore in ingest pipeline
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** the ingest pipeline to write conversations to the ConversationStore instead of creating zero-vector memory records, **so that** conversations are properly stored and searchable.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `storeUser` step writes to `ConversationStore.addConversation()` instead of `store.addMemory()` with zero-vector
  - [ ] `sourceConversationId` on the pipeline context is set to the conversation store's `conversationId`
  - [ ] `USER_RAW_MEMORY_ORIGIN`, `USER_RAW_VECTOR_DIMENSION`, `toConversationMemoryInput()` removed from ingest.ts
  - [ ] Content hash dedup: `addConversation()` with duplicate content_hash returns existing conversation (same `isDuplicateKeyError` pattern), `duplicateDetected` flag still skips downstream steps
  - [ ] Extracted facts still carry `sourceConversationId` pointing to the conversations table
  - [ ] `ConversationStore` injected via `IngestDependencies` and wired through `createOrchestrator()` and `PristineLocal.create()`
  - [ ] Existing ingest tests updated: mock ConversationStore injected, `addMemory` call counts adjusted (-1 for removed user_raw), dedup test uses ConversationStore content_hash constraint
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Update existing ingest.test.ts: storeUser no longer calls store.addMemory for user_raw, instead calls ConversationStore. Verify sourceConversationId flows through to facts. Verify dedup still works.
- **QA:** N/A
- **Planned commits:**
  1. `refactor: replace user_raw with ConversationStore in storeUser step` — modify ingest.ts, inject ConversationStore dependency
  2. `test: update ingest pipeline tests for ConversationStore` — update tests/memory/orchestrator/ingest.test.ts
- **Technical notes:**
  - The `createIngestPipeline()` function needs a new dependency: `conversationStore: ConversationStore`. Pass it through `IngestDependencies`.
  - The `storeUser` step changes from: `store.addMemory(toConversationMemoryInput(...))` → `conversationStore.addConversation(messages, userId)`
  - The dedup uses the same `isDuplicateKeyError` pattern: `addConversation()` hits the UNIQUE constraint on `(user_id, content_hash)` in the conversations table → catch → set `duplicateDetected: true`
  - The `duplicateDetected` flag and downstream skip logic stays the same
  - The `createOrchestrator()` in `src/memory/orchestrator/index.ts` needs to accept and pass through the ConversationStore via `OrchestratorConfig`
  - The `PristineLocal.create()` needs to create a ConversationStore and pass it to the orchestrator
  - **Specific ingest.test.ts changes:** (a) add mock `ConversationStore` to `createDeps()`, (b) "stores user_raw memory" test → becomes "stores conversation in ConversationStore", (c) "uses zero-vector embedding" test → remove (no longer applies), (d) "stores memories after consolidation" → adjust addMemory call count to 1 (was 2, -1 for user_raw), (e) "tracks source conversation ID" → verify it comes from ConversationStore.addConversation return, (f) "handles NOOP action" → addMemory count drops to 0 (was 1), (g) "skips entire pipeline on duplicate" → mock ConversationStore to throw UNIQUE constraint error
  - Existing user_raw memory records in databases from before this change become orphaned zero-vector entries. They don't affect functionality (ranked last by similarity). Cleanup deferred to a future migration task.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Expose conversation search and retrieval on PristineLocal
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** `searchConversations()` and `getConversation()` on the PristineLocal client, **so that** agents can find and retrieve past conversations through the SDK.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `PristineLocal.searchConversations({ userId, keyword?, dateFrom?, dateTo?, limit? })` returns `ConversationSearchResult[]`
  - [ ] `PristineLocal.getConversation(conversationId)` returns `ConversationDetail` with full messages
  - [ ] `ConversationSearchResult` and `ConversationDetail` types added to `src/core/types.ts`
  - [ ] New types and methods exported from `src/index.ts` barrel
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests: searchConversations delegates to ConversationStore, getConversation retrieves by ID, types are exported from barrel.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add ConversationSearchResult and ConversationDetail types` — src/core/types.ts
  2. `feat: expose searchConversations and getConversation on PristineLocal` — src/client.ts, src/index.ts
  3. `test: add client conversation search tests` — tests/client.test.ts additions
- **Technical notes:**
  - `ConversationSearchResult`: `{ id, createdAt, messageCount, snippet }`
  - `ConversationDetail`: `{ id, userId, createdAt, messages: Message[] }`
  - Use `id` consistently on both types (not `conversationId` on one and `id` on the other)
  - The client delegates directly to ConversationStore — no orchestrator involvement
  - Export types via `export type` from barrel
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: End-to-end verification — ingest, search facts, follow sourceConversationId
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** an end-to-end test proving the full workflow: ingest → search facts → follow sourceConversationId → retrieve full conversation, **so that** I know the conversation store integrates correctly with the memory pipeline.
- **Dependencies:** Story 3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] E2e test: `store()` a conversation → `search()` for a fact → read `sourceConversationId` from result → `getConversation()` returns the original messages
  - [ ] E2e test: `store()` two conversations → `searchConversations({ keyword })` finds the right one
  - [ ] E2e test: `store()` same conversation twice → dedup works, no duplicate in conversation store
  - [ ] Tests skippable via `SKIP_SLOW_TESTS=1`
  - [ ] All tests pass: `npm run typecheck`, `npm test`, `npm run lint`
- **Testing approach:** E2e tests with in-memory SQLite, real embedder, mocked LlmClient (same pattern as existing orchestrator e2e tests).
- **QA:** N/A
- **Planned commits:**
  1. `test: add conversation store end-to-end integration tests` — tests/integration/conversation-store.test.ts
- **Technical notes:**
  - Follow the pattern from `tests/integration/orchestrator.test.ts` — mock LLM routed by systemPrompt, real embedder, in-memory SQLite
  - The key assertion: `result.memories[0].memory.sourceConversationId` → `getConversation(id)` → messages match what was stored
  - For keyword search test: store one conversation about Tokyo, one about Berlin, search "Tokyo" → only the first returned
- **Priority:** Must-have
- **Owner:** Coding Agent

### Rules
- Follow repo's `CLAUDE.md` for branching, rebase, and PR conventions
- Follow PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when opening PRs
- Branch off `main` after the previous story is merged. For parallelizable stories, branch off `main` simultaneously. Do NOT stack unmerged branches.
- Open a PR per story with: story reference, summary, files changed, testing done
- Run tests + linter locally before pushing
- If `main` has changed since branching: rebase onto latest `main`, re-test, force-push
- If blocked, document the blocker and move to next story
- Do not modify files outside the project directory
- Do not install new dependencies without noting them in completion report
- **Do not merge PRs.** Open PRs, get Greptile review clean, then move to the next story. Lou merges all PRs at the end of the sprint.

### Definition of Done
- All must-have stories pass acceptance criteria
- ConversationStore creates tables, stores conversations, supports FTS5 search
- Ingest pipeline writes to ConversationStore instead of user_raw zero-vector
- `sourceConversationId` on facts points to conversation store records
- `searchConversations()` and `getConversation()` work on PristineLocal
- E2e test: ingest → search fact → follow sourceConversationId → get conversation
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: ConversationStore module — PR #, status
- :white_check_mark: Story 2: Replace user_raw in ingest — PR #, status
- :white_check_mark: Story 3: Client API + search — PR #, status
- :white_check_mark: Story 4: E2e verification — PR #, status

### New Dependencies

### Blockers / Issues

### Carry-Over

### Notes for Next Sprint

---

## Retro
*(Filled by main agent during sprint review)*

- **What went well:**
- **What didn't:**

### Refactoring Opportunities
- :red_circle: **Critical** —
- :yellow_circle: **Good to have** —
- :white_circle: **Ignore** —

### Documentation Updates
- **Backlog:**
- **README / Repo Docs:**
- **Memory:**
- **Playbook Learnings:**
