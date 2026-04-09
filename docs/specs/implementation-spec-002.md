# Implementation Spec 002: Local Privacy Pipeline Hardening

## 1. Overview

This spec hardens the local-first privacy pipeline in `src/privacy/` without changing the product direction of the repo. The system remains:

- local-only
- in-process
- SQLite-backed
- LLM-assisted
- user-key controlled

The work in this spec is not a redesign of the privacy product. It is a boundary-hardening pass focused on the point where plaintext sensitive content becomes durable local state.

The key principle is:

> The classifier + redaction boundary is the only thing standing between plaintext sensitive content and durable storage. If classification is wrong or redaction silently suppresses a true positive, the plaintext is written locally and every downstream consumer inherits that mistake.

This spec addresses that boundary directly.

---

## 2. Goals

### 2.1 Primary goals

1. Make the privacy pipeline easier to reason about.
2. Close concrete security gaps before further feature work.
3. Move resolution and false-positive filtering decisions out of replacement code.
4. Add a post-redaction guardrail before vault writes.
5. Make reveal + scrub behavior strong enough for local tool/runtime usage.

### 2.2 Non-goals

This spec does **not**:

- replace SQLite
- replace RSA/KEK wrapping design
- redesign the local LLM engine abstraction
- add geography-specific recognizers
- add a full fused-candidate architecture unless later evaluation proves it is needed

---

## 3. Current Problems

### 3.1 Path traversal risk in `FileSystemKeyManager`

`src/privacy/keys/filesystem.ts` uses:

```ts
join(this.keysDir, `${userId}-public.pem`)
join(this.keysDir, `${userId}-private.pem`)
```

If `userId` is caller-controlled or insufficiently validated upstream, this allows path traversal outside `keysDir`.

### 3.2 No post-redaction safety scan

`secureAndRedact()` currently does:

```text
classify -> redact -> encrypt/store
```

There is no final deterministic guardrail on redacted output. If classification or redaction logic misses an obvious structured value, plaintext is persisted.

### 3.3 `scrubOutput()` is too weak

Current behavior strips placeholder tokens only. It does not scrub:

- revealed plaintext values
- echoed sensitive output
- obvious structured patterns reflected back from tool calls or local agents

### 3.4 Resolution heuristics are embedded in redaction

`src/privacy/vault/redaction.ts` currently mixes:

- replacement logic
- context heuristics
- suppress/keep decisions

This makes the privacy boundary harder to audit and easier to regress.

### 3.5 `secureAndRedact()` constructs a classifier on every call

Today:

```ts
const classifier = createCombinedClassifier(config.client, config.classifier);
```

This is functionally correct but wrong structurally. Pipeline ownership should sit above `secureAndRedact()`, and classifier lifecycle should live with the pipeline wrapper.

### 3.6 LLM span grounding fallback is unsafe

The local LLM classifier currently resolves spans by `indexOf(finding.text)`. If grounding fails, it falls back to the full input span.

That is too blunt:

- it can redact and vault unrelated text
- it hides bad grounding instead of surfacing it

The correct short-term fix is:

- if span grounding fails, skip the entity
- emit a warning
- let post-redaction safety scan catch obvious survivors

### 3.7 Combined-classifier context windows are too narrow

Current heuristics in redaction look only around ~24 characters of context. That is too short for many medical, legal, and relationship cases.

---

## 4. Target Architecture

### 4.1 Target pipeline

```text
input text
  |
  v
classifier
  |- deterministic classifier
  |- llm classifier
  \- combined classifier resolves final entities
  |
  v
redaction
  |
  v
safety scan
  |
  v
vault write
```

### 4.2 Ownership boundaries

#### Classifier

Owns:

- deterministic detection
- LLM detection
- merging classifier outputs
- final conflict resolution between detector outputs
- bounded heuristic filtering for obvious false positives
- type normalization decisions that affect the final entity set
- failure-mode handling (`block` vs `degrade`)

Returns `SensitivityReport`.

#### Redaction

Owns:

- deterministic text replacement
- placeholder generation
- placeholder metadata generation

It should not contain replacement-time branching.

#### Safety scan

Owns:

- post-redaction structured-pattern checks
- placeholder stripping prior to scan

It is a guardrail, not a primary classifier.

#### Privacy pipeline wrapper

Owns:

- classifier lifecycle
- redaction invocation
- safety scan invocation
- returning a combined pipeline result

#### `secureAndRedact()`

Owns:

- vault encryption
- KEK/public-key lookup
- persistence of placeholders
- public API return shape

---

## 5. Public API Changes

This spec includes breaking API changes. Backward compatibility is **not** required.

### 5.1 `reveal()` return shape

Current:

```ts
reveal(redactedText, config): Promise<string>
```

New:

```ts
reveal(redactedText, config): Promise<RevealResult>
```

Where:

```ts
interface RevealResult {
  readonly text: string;
  readonly revealedValues: readonly string[];
}
```

Why:

- callers need the resolved plaintext values in order to scrub later output safely
- returning only `string` prevents strong `scrubOutput()` behavior

### 5.2 `scrubOutput()` signature

Current:

```ts
scrubOutput(text: string): string
```

New:

```ts
scrubOutput(text: string, revealedValues: readonly string[]): string
```

Required behavior:

1. Remove any exact occurrences of `revealedValues`
2. Strip any remaining `[SENSITIVE:...]` placeholders
3. Apply pattern-based scrubbing for obvious structured sensitive values

Why:

- placeholder stripping alone is insufficient after `reveal()`

### 5.3 `secureAndRedact()` result shape

Current:

```ts
secureAndRedact(text, config): Promise<{
  redactedText: string;
  placeholderIds: readonly string[];
}>
```

New:

```ts
type SecureAndRedactResult =
  | {
      readonly ok: true;
      readonly redactedText: string;
      readonly placeholderIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly redactedText: string;
      readonly safetyViolations: readonly DetectedEntity[];
    };
```

Why:

- callers must branch on `ok` before using `placeholderIds`
- the blocked branch cannot be mistaken for a clean success
- no generic error is required for post-redaction safety-scan failures
- the caller still gets `redactedText` for debugging or inspection

---

## 6. New Shared Types and Interfaces

All shared types live in `src/core/types.ts`.
All shared interfaces live in `src/core/interfaces.ts`.

### 6.1 New shared types

Add:

```ts
interface RedactionPlaceholder {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
  readonly originalText: string;
  readonly start: number;
  readonly end: number;
}

interface RedactionResult {
  readonly redactedText: string;
  readonly placeholders: readonly RedactionPlaceholder[];
}

interface RevealResult {
  readonly text: string;
  readonly revealedValues: readonly string[];
}

interface ClassificationPipelineResult {
  readonly report: SensitivityReport;
  readonly redaction: RedactionResult | null;
  readonly safetyViolations: readonly DetectedEntity[];
}

type SecureAndRedactResult =
  | {
      readonly ok: true;
      readonly redactedText: string;
      readonly placeholderIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly redactedText: string;
      readonly safetyViolations: readonly DetectedEntity[];
    };
```

`RedactionResult` and `RedactionPlaceholder` must move from `src/privacy/vault/redaction.ts` into `src/core/types.ts` as part of step 3. This keeps dependency direction clean: core types must not import from `src/privacy/vault/`.

### 6.2 New shared interface

Add:

```ts
interface PrivacyPipeline {
  classifyAndRedact(text: string): Promise<ClassificationPipelineResult>;
}
```

### 6.3 Report warnings

Extend `SensitivityReport` with:

```ts
readonly warnings?: readonly string[];
```

This is needed for:

- skipped LLM span-grounding failures
- degraded LLM mode notifications
- future debug/eval visibility

---

## 7. Module Changes

### 7.1 `src/privacy/keys/filesystem.ts`

#### Change

Harden `userId` before using it in filesystem paths.

#### Required behavior

- Only allow a safe filename subset directly
- For anything else, encode it into a safe deterministic filename component
- Ensure the final resolved path remains inside `keysDir`

#### Why

Prevents path traversal and arbitrary file write/read outside the configured key directory.

---

### 7.2 `src/privacy/safety-scan.ts` (new)

#### Change

Add a post-redaction safety scan module under `src/privacy/`.

#### Scope

This module is **not** part of classifier ownership. It is owned by the privacy pipeline wrapper.

#### Required behavior

- Strip placeholders before scanning:

```ts
const PLACEHOLDER_RE = /\[SENSITIVE:[^\]]+\]/g;
```

- Replace placeholder tokens with same-length whitespace before scanning
- Detect obvious survivors such as:
  - email
  - phone
  - SSN / identity-like formats already in deterministic classifier scope
  - credit-card-like values with Luhn validation
  - secret keyword/value patterns

#### Why

This is a cheap defense-in-depth layer that protects against classifier or redaction misses.

---

### 7.3 `src/privacy/pipeline.ts` (new)

#### Change

Add a standalone pipeline wrapper that composes:

- classifier
- redactor
- safety scan

#### Factory

```ts
createPrivacyPipeline(...)
```

#### Required behavior

`classifyAndRedact(text)` should:

1. call classifier
2. call redactor if final report has entities
3. call safety scan on redacted output
4. return `ClassificationPipelineResult`

#### Why

This is the single home for privacy pipeline orchestration and classifier lifecycle.

---

### 7.4 `src/privacy/index.ts`

#### Change

Refactor `secureAndRedact()`, `reveal()`, and `scrubOutput()` to use the new shared contracts.

#### `secureAndRedact()`

- stop constructing the classifier directly
- accept an injected `PrivacyPipeline` or construct one once through a wrapper-level factory path
- use `ClassificationPipelineResult`
- if `safetyViolations.length > 0`, do not vault anything and return the `ok: false` branch of `SecureAndRedactResult`
- if `safetyViolations.length === 0`, continue to vault write and return the `ok: true` branch of `SecureAndRedactResult`

#### `reveal()`

- return `RevealResult`
- keep no-LLM-reentry marking behavior

#### `scrubOutput()`

- require `revealedValues`
- perform exact-value scrubbing + placeholder stripping + pattern scrubbing

---

### 7.5 `src/privacy/classifier/combined/index.ts`

#### Change

Keep the current combined-classifier role, but tighten it.

#### Required changes

- expose explicit failure-mode config:

```ts
onLlmFailure: 'block' | 'degrade'
```

- keep default behavior `block`
- if degrade mode is enabled, emit report warnings
- absorb the current keep/drop heuristics that must live upstream of redaction
- keep all conflict resolution between deterministic and LLM outputs here

#### Non-goal

Do **not** add a full fused-candidate architecture yet. Current work should stay proportional to the repo.

---

### 7.6 `src/privacy/classifier/llm/index.ts`

#### Change

Fix the span-grounding fallback.

#### Current bad behavior

If text matching fails, the entity expands to full input span.

#### Required new behavior

- try exact match
- try case-insensitive match
- if still not found:
  - skip the finding
  - emit a warning
  - do not create an entity for the whole input

#### Why

This avoids incorrect full-text vaulting/redaction while preserving visibility that the model returned an ungroundable span.

---

### 7.7 `src/privacy/vault/redaction.ts`

#### Change

Remove resolution logic from redaction.

#### Required behavior

Redaction should only:

- sort final entities
- replace spans with placeholders
- generate placeholder metadata

#### Move out

The following kind of logic should move into the combined classifier:

- travel-date suppression
- vague-address suppression
- DOB special-casing
- context-based keep/drop rules

#### Why

Replacement code should be deterministic and boring.

---

### 7.8 Combined-classifier resolution heuristics

#### Change

Keep the heuristic resolution logic in the combined classifier instead of introducing a separate policy module at this stage.

#### Required behavior

The combined classifier must:

- widen context windows to approximately:
  - 200 chars leading
  - 80 chars trailing
- keep health cases from falling through into unrelated branches

#### Why

This repo does not need a separate policy layer yet. The current scope is better served by a single resolver inside the combined classifier, while keeping redaction purely mechanical.

---

## 8. Implementation Order

### Step 1: Key-path hardening

Files:

- `src/privacy/keys/filesystem.ts`
- `tests/privacy/keys/filesystem.test.ts`

### Step 2: Safety scan

Files:

- `src/privacy/safety-scan.ts`
- `tests/privacy/safety-scan.test.ts` (new)

### Step 3: Shared contracts + pipeline wrapper + reveal/scrub breaking change

Files:

- `src/core/types.ts`
- `src/core/interfaces.ts`
- `src/core/errors.ts`
- `src/privacy/pipeline.ts` (new)
- `src/privacy/index.ts`
- integration tests

### Step 4: Combined-classifier resolution cleanup

Files:

- `src/privacy/classifier/combined/index.ts`
- `src/privacy/vault/redaction.ts`
- combined-classifier tests (new or ported)

### Step 5: Widen combined-classifier context windows

Can be done as part of step 4, but should be explicitly verified by tests.

### Step 6: LLM span-grounding fallback fix

Files:

- `src/privacy/classifier/llm/index.ts`
- `tests/classifier/llm-classifier.test.ts`

### Step 7: Explicit LLM failure-mode config

Files:

- `src/core/types.ts`
- `src/privacy/classifier/combined/index.ts`
- `tests/classifier/combined-classifier.test.ts`

### Step 8: Normalization

Files:

- `src/privacy/classifier/normalize.ts` (new)
- classifier wiring
- tests

### Step 9: Evaluation coverage

Add focused regression tests covering:

- placeholder stripping in safety scan
- revealed plaintext scrubbing
- health context handling
- span-grounding skip + warn behavior
- key-path traversal attempts

---

## 9. Testing Requirements

### 9.1 Unit tests

Must add or update tests for:

- filesystem key path hardening
- safety scan ignoring placeholder tokens
- `reveal()` returning `{ text, revealedValues }`
- `scrubOutput(text, revealedValues)` removing echoed plaintext
- combined-classifier suppress vs redact decisions
- LLM grounding skip + warning behavior

### 9.2 Integration tests

Must update integration coverage for:

- `secureAndRedact()` failing closed when safety scan finds survivors
- `secureAndRedact() -> reveal() -> scrubOutput()` round-trip
- rotation compatibility with new `RevealResult`

### 9.3 No generic errors

All newly introduced failure paths must use domain errors from `src/core/errors.ts`.

Post-redaction safety-scan failures are not an exception path by default. They are surfaced through the `ok: false` branch of `SecureAndRedactResult`.

---

## 10. Acceptance Criteria

### Must-have

- [ ] File-system key paths are hardened against path traversal
- [ ] Post-redaction safety scan exists and strips placeholders before scanning
- [ ] `reveal()` returns `{ text, revealedValues }`
- [ ] `scrubOutput(text, revealedValues)` scrubs revealed plaintext and placeholders
- [ ] `secureAndRedact()` uses a privacy pipeline wrapper instead of constructing a classifier inline
- [ ] Resolution/filtering logic no longer lives inside `redaction.ts`
- [ ] LLM span-grounding fallback skips + warns instead of redacting full input
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes

### Nice-to-have in the same pass if low-risk

- [ ] explicit LLM degrade mode config
- [ ] normalization layer

---

## 11. Notes

- Keep this repo local-first. Do not introduce server/API abstractions.
- Keep module ownership aligned to `CLAUDE.md`.
- Avoid porting heavier `memory` repo architecture unless evaluation proves the need.
- The strongest near-term improvements are boundary fixes, not architectural maximalism.
