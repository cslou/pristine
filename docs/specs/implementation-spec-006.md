# Pristine — Implementation Spec 006: Secure Tool-Call Wrapper + pi Adapter

**Status:** Draft — proposed architecture
**Last updated:** 2026-05-01
**Author:** 0xWolfDev

---

## Product Overview

Pristine already supports three strong privacy primitives:

- `secureAndRedact(text, ...)` — detect supported secrets, replace them with `[SENSITIVE:...]` placeholders, and persist encrypted originals in the local vault
- `reveal(redactedText, ...)` — resolve placeholders back to plaintext from the local vault
- `scrubOutput(text, ...)` — remove plaintext secrets / placeholders from text before it re-enters model-visible context

Those primitives are sufficient for secret-safe text handling, but they are not yet a first-class **tool-call privacy middleware**. The current project-local pi extension proves the concept, but it mixes core privacy semantics, vault orchestration, pi event glue, and runtime-specific policy decisions in one place.

This spec defines the long-term shape:

1. **A runtime-agnostic secure tool-call wrapper in Pristine core**
2. **A thin official pi adapter package** that wires the core wrapper into pi's extension hooks
3. **A migration path for the existing project-local `.pi/extensions/pristine-privacy/` extension** so it becomes a development harness / thin adapter, not the canonical home of privacy logic

The intended invariant is simple:

- **LLM sees placeholders only**
- **Tools receive plaintext only at local execution time**
- **Tool outputs are sanitized before they return to model-visible context**

---

## Key References

- `docs/specs/implementation-spec-001.md` — original local-first architecture
- `docs/specs/implementation-spec-004.md` — deterministic secret redaction + custom regex support
- `src/privacy/index.ts` — current `secureAndRedact`, `reveal`, `scrubOutput`
- `src/privacy/classifier/deterministic/` — deterministic classifier + `~/.pristine/redaction.json`
- `src/privacy/vault/` — encrypted vault storage and placeholder resolution
- `.pi/extensions/pristine-privacy/index.ts` — current project-local pi extension incubator
- pi docs: `docs/extensions.md`, `docs/packages.md`

---

## 1. Why this spec exists

The current project-local pi extension proved that Pristine can protect secrets end-to-end inside an agent harness:

- prompt redaction before provider request
- JIT placeholder reveal before tool execution
- tool-result sanitization before future turns

However, the implementation surfaced structural issues:

1. **The extension currently owns too much logic**
   - recursive input traversal
   - reveal strictness
   - provider-payload rewriting
   - tool-result sanitization behavior
   - model guidance semantics

2. **The extension imported broader SDK surfaces than it needed**
   - this pulled in unrelated dependencies (for example `sqlite-vec`) during extension startup
   - that is a packaging smell: privacy wrapper logic must be installable without memory/indexing/search dependencies

3. **The runtime policy layer is missing from core**
   - core can redact text and reveal placeholders
   - core cannot yet express: “allow reveal for `write`, confirm for `make_payment`, deny for `copy_to_clipboard`”

4. **The reveal path is too text-oriented**
   - generic tool inputs/results are nested object graphs, not just strings

5. **The pi integration should be distributable independently**
   - pi users should install a first-party package
   - but the actual privacy engine should remain in Pristine core, not be rewritten inside the pi package

This spec resolves those issues by making the secure tool-call wrapper a first-class Pristine core module and treating the pi extension as a thin adapter.

---

## 2. Goals

### 2.1 Core goals

- Add a runtime-agnostic **secure tool-call wrapper** to Pristine core
- Support recursive placeholder reveal for tool inputs
- Support recursive tool-result sanitization for structured outputs
- Add policy-driven decisions for tool secret handling
- Fail closed when placeholders cannot be resolved
- Reuse existing deterministic classifier, custom regex config, vault, KEK, and key management

### 2.2 pi goals

- Ship a first-party pi integration as a **thin adapter package**
- Enforce prompt redaction before provider request
- Reveal placeholders only locally at tool execution time
- Sanitize tool results before they become future LLM context
- Teach the model that placeholders are tool-usable and should not trigger refusal for normal write/edit/configure flows

### 2.3 Distribution goals

- Make the privacy wrapper installable without memory/search/indexing deps
- Keep the canonical security logic in Pristine core
- Publish the pi integration separately as a pi package

---

## 3. Non-goals

- Rewriting Pristine vault encryption or key-management internals
- Reintroducing LLM-based classification for tool privacy
- Supporting arbitrary binary or streamed non-JSON tool payloads in v1
- Making the pi package the canonical home of privacy logic
- Solving every harness at once (pi is the first adapter; others may follow)
- Exposing plaintext secrets back into chat or model-visible context

---

## 4. Architectural decisions

### 4.1 Core owns the security engine

All secret/privacy semantics live in Pristine core.

Examples:
- placeholder reveal traversal
- unresolved-placeholder detection
- tool policy evaluation
- structured result sanitization

### 4.2 Adapters own runtime wiring only

The pi extension/package is a runtime adapter.

Examples:
- registering pi hooks
- mapping pi payloads into core wrapper APIs
- showing notifications / confirmations
- configuring defaults from env/files/settings

### 4.3 Prompt redaction and tool-call privacy are separate layers

Two protections are required:

1. **Provider-bound prompt redaction** — no raw secret reaches the LLM
2. **Tool-call wrapper** — the model can still use secrets indirectly by passing placeholders through tool arguments

### 4.4 Fail closed

If a placeholder cannot be resolved, or a tool is not permitted to receive revealed plaintext, core must return a structured deny/block result. Adapters may present richer UX, but must not silently continue with unresolved placeholders.

### 4.5 Core must be lightweight

The secure tool-call wrapper must not depend on:

- `sqlite-vec`
- embedder implementations
- memory/search/indexing modules
- Ollama / llama runtime clients

If the current package structure makes that impossible, the privacy wrapper must be extracted into a focused privacy package (see §15).

---

## 5. User-facing behavior

### 5.1 Prompt flow

1. User submits prompt containing a secret
2. Adapter invokes core prompt redaction
3. Secret substrings are replaced with placeholders
4. Encrypted originals are stored in local vault
5. Only redacted content reaches provider/model

### 5.2 Tool-call flow

1. Model emits tool call containing placeholders
2. Adapter intercepts tool call
3. Core policy decides whether reveal is allowed / denied / confirmation-required
4. If allowed, core recursively reveals placeholders into a new tool input object
5. Tool executes locally with plaintext
6. Adapter intercepts tool result
7. Core recursively sanitizes the result
8. Only sanitized output re-enters model-visible context

### 5.3 Explicit reveal flow

If the user asks to reveal plaintext in the UI/editor:

- this remains an explicit, opt-in UI flow
- core may provide the reveal primitive, but the adapter must not inject the result back into model-visible context automatically

---

## 6. Core module layout

Add a new module family:

```text
src/privacy/tool-wrapper/
├── index.ts
├── types.ts
├── policy.ts
├── traverse.ts
├── prepare-input.ts
├── sanitize-result.ts
└── config.ts
```

### 6.1 Responsibilities

- `types.ts` — public tool-wrapper types
- `policy.ts` — policy resolution and normalization
- `traverse.ts` — recursive structured walkers
- `prepare-input.ts` — strict reveal of tool inputs
- `sanitize-result.ts` — structured output sanitization
- `config.ts` — external policy config loading / validation
- `index.ts` — public API barrel

---

## 7. Core public API

The exact names may change, but the surface should look like this.

### 7.1 Types

```ts
export interface ToolPrivacyPolicy {
  readonly mode: 'allow' | 'deny' | 'confirm';
  readonly reveal?: {
    readonly enabled: boolean;
    readonly fields?: readonly string[];
    readonly excludeFields?: readonly string[];
  };
  readonly sanitizeResult?: boolean;
}
```

```ts
export interface ToolWrapperConfig {
  readonly userId: string;
  readonly classifier?: DeterministicClassifierConfig;
  readonly defaultPolicy?: ToolPrivacyPolicy;
  readonly tools?: Record<string, ToolPrivacyPolicy>;
}
```

```ts
export type PrepareToolInputResult =
  | {
      readonly ok: true;
      readonly input: unknown;
      readonly revealedPaths: readonly string[];
      readonly unresolvedPlaceholders: readonly string[];
      readonly policy: ToolPrivacyPolicy;
    }
  | {
      readonly ok: false;
      readonly reason: 'policy_denied' | 'policy_confirmation_required' | 'unresolved_placeholders';
      readonly unresolvedPlaceholders: readonly string[];
      readonly policy: ToolPrivacyPolicy;
    };
```

```ts
export interface SanitizeToolResultResult {
  readonly result: unknown;
  readonly redactedPaths: readonly string[];
  readonly sanitizeApplied: boolean;
}
```

### 7.2 Functions

```ts
export function getToolPolicy(toolName: string, config: ToolWrapperConfig): ToolPrivacyPolicy;
```

```ts
export async function prepareToolInput(
  toolName: string,
  input: unknown,
  deps: ToolWrapperDependencies,
  config: ToolWrapperConfig,
): Promise<PrepareToolInputResult>;
```

```ts
export function sanitizeToolResult(
  toolName: string,
  result: unknown,
  options: {
    readonly revealedValues?: readonly string[];
    readonly policy?: ToolPrivacyPolicy;
    readonly classifier?: DeterministicClassifierConfig;
  },
): SanitizeToolResultResult;
```

```ts
export async function redactModelInput(
  value: unknown,
  deps: ToolWrapperDependencies,
  options: {
    readonly userId: string;
    readonly classifier?: DeterministicClassifierConfig;
    readonly maxTextChars?: number;
  },
): Promise<unknown>;
```

### 7.3 Dependencies

```ts
export interface ToolWrapperDependencies {
  readonly vaultStore: VaultStore;
  readonly keyManager: KeyManager;
  readonly kekManager: KekManager;
}
```

Adapters may source these dependencies however they want. Core must not depend on pi.

---

## 8. Core behavior details

### 8.1 `redactModelInput(...)`

Purpose:
- recursively redact user-bound strings before provider request

Rules:
- strings containing existing placeholders are left untouched
- strings that exceed configured max length produce a blocked marker
- successful redaction replaces only matched sensitive substrings, not whole messages
- failure falls back to a blocked marker, not plaintext

### 8.2 `prepareToolInput(...)`

Purpose:
- recursively reveal placeholders in tool arguments, but only if policy permits it

Behavior:
- resolve policy for `toolName`
- if `mode === 'deny'` → return `{ ok: false, reason: 'policy_denied' }`
- if `mode === 'confirm'` → return `{ ok: false, reason: 'policy_confirmation_required' }`
- if reveal disabled → return original input unchanged with empty `revealedPaths`
- if reveal enabled:
  - recursively walk strings in `input`
  - reveal any placeholder-bearing strings from local vault
  - collect path list for replaced fields
  - detect unresolved placeholders after reveal
  - if unresolved remain → return `{ ok: false, reason: 'unresolved_placeholders' }`

Important:
- this function returns a **new input object**; adapters decide how to apply it
- unresolved placeholders are a wrapper concern even though plain `reveal(...)` today is best-effort

### 8.3 `sanitizeToolResult(...)`

Purpose:
- recursively scrub plaintext secrets from structured tool outputs before model-visible re-entry

Behavior:
- resolve policy
- if `sanitizeResult === false`, return original result unchanged
- otherwise recursively traverse strings and scrub using:
  - exact-match removal of `revealedValues`
  - placeholder cleanup
  - deterministic structured sensitive-pattern scan

Supported v1 shapes:
- string
- array
- plain object
- nested tool content arrays (for example `{ type: 'text', text: '...' }`)

Non-goal for v1:
- arbitrary binary/blob/result streams

### 8.4 Traversal semantics

Path notation should be stable and testable.

Example:
- `input.headers.authorization`
- `input.body.secrets[0]`
- `result.content[2].text`

The traversal helper should provide:
- path-aware transforms
- immutable replacement
- detection of placeholder-bearing leaf strings

### 8.5 Policy semantics

Policies are resolved per tool name.

Resolution order:
1. exact tool override from config
2. default policy
3. built-in fallback policy

Built-in fallback policy (proposed v1):
- `read`, `grep`, `find`, `ls`, `bash`, `write`, `edit` → allow
- everything else → allow, sanitize result true
- optional explicit deny list for clearly exfiltration-oriented tools can be added later, but v1 should not guess too aggressively without config

### 8.6 Confirmation semantics

Core does not prompt. It returns a structured result that says confirmation is required.

Adapters decide whether to:
- ask the user and re-run with an override
- block and explain
- pre-approve via policy

### 8.7 Error model

Policy decisions should prefer **structured result types** over exceptions.

Exceptions remain appropriate for:
- corrupt vault state
- crypto failures
- DB failures
- invalid config parsing in explicit config-load functions

---

## 9. External config for tool-wrapper policy

Add a new optional config file:

```text
~/.pristine/tool-privacy.json
```

### 9.1 Proposed shape

```json
{
  "defaultPolicy": {
    "mode": "allow",
    "reveal": { "enabled": true },
    "sanitizeResult": true
  },
  "tools": {
    "write": {
      "mode": "allow",
      "reveal": { "enabled": true },
      "sanitizeResult": true
    },
    "make_payment": {
      "mode": "confirm",
      "reveal": { "enabled": true },
      "sanitizeResult": true
    },
    "copy_to_clipboard": {
      "mode": "deny",
      "reveal": { "enabled": false },
      "sanitizeResult": true
    }
  }
}
```

### 9.2 Loading

Core should expose config-loading helpers but should not hardcode adapter UX assumptions.

Suggested API:

```ts
loadToolPrivacyConfig(path?: string): ToolWrapperConfigFile
```

Adapters may merge:
- file config
- env config
- runtime override config

### 9.3 Validation

- reject unknown `mode`
- reject empty tool names
- reject conflicting `fields` / `excludeFields` shape if unsupported in v1
- keep validation deterministic and strict

---

## 10. pi adapter package

### 10.1 Package identity

Ship a separate pi package, for example:

```text
@pristine/pi-privacy
```

This package is an **adapter**, not a second privacy implementation.

### 10.2 Package contents

```text
package root/
├── package.json
├── extensions/
│   └── pristine-privacy/
│       └── index.ts
├── README.md
└── examples/
    └── tool-privacy.json.example
```

### 10.3 `package.json`

```json
{
  "name": "@pristine/pi-privacy",
  "keywords": ["pi-package"],
  "dependencies": {
    "@pristine/privacy-core": "<version>"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*"
  },
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

Notes:
- if the privacy engine remains inside the current monorepo/package layout for a while, the adapter may depend on a local path/workspace package during development
- long term, the adapter must depend on a focused privacy package, not the full SDK with memory/search/indexing deps

### 10.4 pi adapter responsibilities

The adapter should contain only:
- pi hook registration
- mapping pi payloads to core wrapper API calls
- notifications / status text
- slash commands (`/pristine-status`, `/pristine-reveal`, `/pristine-scrub`, optional `/pristine-debug`)
- user confirmation UX for `mode: 'confirm'`
- system-prompt guidance explaining placeholder semantics to the model

It should **not** contain:
- bespoke recursive reveal logic
- bespoke recursive result scrubbing logic
- bespoke policy engine semantics
- duplicated vault orchestration beyond adapter dependency wiring

---

## 11. pi adapter runtime flow

### 11.1 `before_agent_start`

Append system guidance such as:

- `[SENSITIVE:...]` placeholders are expected and usable
- placeholders passed to supported tools are revealed locally only at execution time
- do not refuse normal write/edit/configure requests just because placeholders are present
- never print plaintext secrets into chat unless the user explicitly requests reveal in chat and the adapter policy permits it

### 11.2 `input`

Use for UX only:
- optional “Pristine redacted sensitive data in your prompt” notification
- optional local debug info

Do not rely on this as the only enforcement point.

### 11.3 `before_provider_request`

Hard enforcement point.

Adapter responsibilities:
- identify provider payload strings that represent model-visible user content
- call `redactModelInput(...)`
- replace payload only if changed

Rationale:
- this is the final runtime boundary before provider send
- earlier hooks may be bypassed by runtime-specific behaviors or internal prompt serialization differences

### 11.4 `tool_call`

Adapter responsibilities:
- call `prepareToolInput(toolName, event.input, ...)`
- if result `ok: true`, replace `event.input`
- if `policy_confirmation_required`, prompt user via pi UI and, if approved, rerun using an override path
- if denied or unresolved, block the tool call

### 11.5 `tool_result`

Adapter responsibilities:
- call `sanitizeToolResult(toolName, result, ...)`
- return patched content/details/isError fields as needed

### 11.6 `session_start` / `session_shutdown`

Adapter responsibilities:
- status line setup/cleanup
- create/close local DB/key/vault dependencies if managed by adapter
- restore any lightweight runtime state

---

## 12. Existing project-local extension: role and migration

### 12.1 Near-term role

Keep `.pi/extensions/pristine-privacy/` as:
- a project-local development harness
- an integration-test target
- a place to validate pi runtime behavior while the official package matures

### 12.2 Long-term role

It should become one of:
- a thin shim around the published adapter package
- a development-only override extension for this repo
- an example implementation used in docs/tests

It should **not** remain the canonical home of tool-wrapper logic.

### 12.3 Refactor target

Current extension logic should be reduced to:
- dependency wiring
- hook registration
- commands/notifications
- minimal provider-payload shape mapping

Everything else moves into core.

---

## 13. Core packaging and distribution

### 13.1 Long-term package split

The privacy wrapper should be publishable as a normal npm library.

Recommended shape:

- `@pristine/privacy-core` — focused privacy engine
- `@pristine/pi-privacy` — pi adapter package
- optional/full SDK remains separate (`@pristine/shield-local` or future successor)

### 13.2 `@pristine/privacy-core` contents

Include only:
- deterministic classifier
- custom regex config support
- `secureAndRedact`, `reveal`, `scrubOutput`
- tool-wrapper module from this spec
- vault/key/KEK plumbing required by the above

Do not include:
- embedder
- search/indexing/memory orchestration
- `sqlite-vec`
- broader full-SDK APIs unrelated to privacy wrapper

### 13.3 Why

This prevents the pi adapter from pulling in native or unrelated runtime deps just to perform local secret redaction and tool wrapping.

---

## 14. Security invariants

These must hold across core + adapter implementations.

1. **Plaintext secrets must never enter model-visible context** except in an explicit reveal-to-chat flow that is separately approved and intentionally user-triggered.
2. **Placeholder reveal must happen locally only at tool execution time.**
3. **Unresolved placeholders must fail closed.**
4. **Tool results must be sanitized before they become future context.**
5. **Adapters must not silently write unresolved placeholders to disk when the user requested plaintext tool execution.**
6. **System guidance must not instruct the model to print secrets into chat.**
7. **Policy decisions must be deterministic and testable.**

---

## 15. Implementation plan

### Phase 1 — extract core wrapper

- add `src/privacy/tool-wrapper/`
- implement traversal helpers
- implement strict tool-input prepare path
- implement structured result sanitization
- implement policy resolution
- add config loading/validation for tool policy

### Phase 2 — adapt local pi extension

- replace in-extension recursive logic with core wrapper calls
- keep existing commands/status UX
- keep provider-payload enforcement
- add explicit confirmation flow for `mode: 'confirm'`

### Phase 3 — package split

- extract privacy-only npm package if needed
- ensure no `sqlite-vec` / memory deps leak into privacy adapter install path

### Phase 4 — publish pi package

- package `@pristine/pi-privacy`
- document install and config
- keep local extension as internal dev harness/example

---

## 16. Testing plan

### 16.1 Core unit tests

Add under `tests/privacy/tool-wrapper/`.

Coverage:
- reveal recursion in nested arrays/objects
- unresolved placeholder detection
- policy resolution precedence
- `allow` / `deny` / `confirm` modes
- structured result sanitization across nested shapes
- exact-match scrubbing of revealed values
- custom regex support via existing deterministic classifier config
- blocked markers for oversize provider-bound strings

### 16.2 Core integration tests

Add under `tests/integration/`.

Coverage:
- redact prompt → placeholder stored in vault
- prepare tool input → local plaintext available only in returned tool input object
- sanitize tool result → plaintext removed from returned result
- unresolved placeholder → structured failure result

### 16.3 pi adapter tests

If/when adapter package has its own test setup:
- provider payload redaction before request
- tool-call interception for built-in and custom tool names
- confirmation flow for `mode: 'confirm'`
- tool-result sanitization before context re-entry
- commands/status UX smoke tests

### 16.4 Manual acceptance tests

1. Secret pasted into prompt is redacted automatically
2. Model can still use placeholder in a `write` tool call
3. `write` receives plaintext locally at execution time
4. Tool result does not echo plaintext secret back to model
5. Unknown/unresolved placeholder blocks execution cleanly
6. A policy-marked risky tool (for example `make_payment`) triggers confirmation
7. A deny-listed display/exfiltration tool is blocked from receiving plaintext

---

## 17. Acceptance criteria

This spec is satisfied when all of the following are true:

1. Core exposes a first-class tool-wrapper API with strict structured results
2. The current pi extension can be rewritten to use that API without bespoke recursion/policy logic
3. The privacy wrapper can be installed without unrelated memory/indexing dependencies
4. A pi package can be published as a thin adapter over the core wrapper
5. The end-to-end invariant holds: **LLM sees placeholders, tools get plaintext locally only at execution, model-visible results are sanitized**

---

## 18. Open questions

1. **Field-level reveal control**
   - Is `fields` / `excludeFields` needed in v1, or can it wait until after tool-name policy ships?

2. **Confirmation override flow**
   - Should core expose an explicit override token/mechanism for adapters after user confirmation, or should adapters simply rerun `prepareToolInput(...)` with an `allowConfirm: true` option?

3. **Structured tool-result shapes**
   - Do we need first-class helpers for common content-array formats beyond generic traversal, or is generic path-based traversal sufficient for v1?

4. **Default deny list**
   - Should the core ship an explicit deny list for obvious exfiltration-style tools, or should that stay adapter/config-defined until real-world usage clarifies safe defaults?

5. **Package split timing**
   - Can the current repo export a privacy-only package cleanly now, or should the wrapper land internally first and the package split happen in a later spec/PR?

---

## 19. Recommendation

Build the secure tool-call wrapper as a **Pristine core capability** and ship pi support as a **thin first-party adapter package**.

That keeps:
- the security model reusable
- the adapter lightweight
- distribution clean
- the current project-local extension useful as an incubator, not a permanent architecture boundary
