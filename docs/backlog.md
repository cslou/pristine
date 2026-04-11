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
