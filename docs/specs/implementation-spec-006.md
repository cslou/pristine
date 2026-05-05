# Pristine — Implementation Spec 006: Secure Tool-Call Wrapper + pi Adapter

**Status:** Draft — proposed architecture
**Last updated:** 2026-05-05
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

Raw-secret handling is stricter than placeholder handling. Existing placeholders may pass through model-visible content because they are already redacted. Newly detected raw secrets must be redacted before provider send, and if redaction fails the provider request must be blocked rather than sent with a marker that still contains unclassified text nearby.

### 5.2 Tool-call flow

1. Model emits tool call containing placeholders
2. Adapter intercepts tool call
3. Core policy decides whether reveal is allowed / denied / confirmation-required
4. If allowed, core recursively reveals placeholders into a new tool input object
5. Tool executes locally with plaintext
6. Adapter intercepts tool result
7. Core recursively sanitizes the result
8. Only sanitized output re-enters model-visible context

Tool inputs are not a second prompt-redaction path. If the model emits a tool call that contains a newly detected raw secret, core returns a structured block result. Existing placeholders may be revealed only under policy. This avoids the ambiguous Claude-style behavior where raw tool-input secrets are silently redacted into placeholders that would break execution.

### 5.3 Explicit reveal flow

If the user asks to reveal plaintext in the UI/editor:

- this remains an explicit, opt-in UI flow
- core may provide the reveal primitive, but the adapter must not inject the result back into model-visible context automatically

### 5.4 Setup and operator flows

Implementation stories must cover these actor-trigger-state-result flows, not only prompt/tool-call execution.

| Actor | Trigger | Starting state | Result |
|---|---|---|---|
| Developer | installs `@pristine/pi-privacy` | pi is installed; Pristine privacy core package is available | package registers the `pristine-privacy` extension and documents required settings |
| Developer | starts pi with extension enabled for the first time | `~/.pristine/` may not exist | adapter creates/opens the local SQLite DB, key directory, vault store, key manager, and KEK manager without initializing memory/search/indexing deps |
| Developer | starts pi after creating `~/.pristine/tool-privacy.json` | config file exists | adapter loads, validates, and merges policy config before tool hooks run |
| Developer | starts pi with malformed policy config | config file is invalid | adapter fails closed with a clear local error; provider-bound prompts and tool execution are not allowed to proceed through an unconfigured privacy adapter |
| Developer | runs project-local `.pi/extensions/pristine-privacy/` during migration | local extension contains incubated logic | local extension becomes a thin shim over core wrapper APIs; duplicated recursion/policy/sanitization logic is removed |
| Developer | upgrades from local extension to package | both local and packaged extensions may exist | docs describe disabling one path to avoid double redaction/reveal hooks |
| Adapter | shuts down session | DB/key/vault dependencies are open | adapter disposes local resources it owns and does not persist plaintext reveal context |

### 5.5 Installation flow

Reference pi package installation should document:

```bash
pi package add @pristine/pi-privacy
```

If pi package installation uses a different command by implementation time, the adapter README must use the command from the pinned pi package docs. This spec's requirement is the flow, not that exact command spelling.

### 5.6 First-run dependency wiring

On first run, the adapter must resolve:

- `userId`
- SQLite DB path
- keys directory
- vault store
- key manager
- KEK manager
- deterministic classifier config
- `~/.pristine/redaction.json`
- `~/.pristine/tool-privacy.json`

It must not construct:

- embedder clients
- `sqlite-vec` memory tables
- memory orchestrator
- local LLM clients
- Ollama / llama runtime clients

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
  readonly blockRawSecrets?: boolean;
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
export interface ToolSanitizationContext {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly policy: ToolPrivacyPolicy;
  readonly revealedPaths: readonly string[];
  readonly revealedValues: readonly string[];
  readonly inputDigest: string;
}
```

`ToolSanitizationContext` is process-local security state. Adapters must not log it, serialize it into model-visible context, persist it to disk, or expose it through debug commands without redacting `revealedValues`.

```ts
export interface ToolConfirmationToken {
  readonly toolName: string;
  readonly inputDigest: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly approvedBy: 'user' | 'policy';
}
```

```ts
export type PrepareToolInputResult =
  | {
      readonly ok: true;
      readonly input: unknown;
      readonly revealedPaths: readonly string[];
      readonly sanitizationContext: ToolSanitizationContext;
      readonly policy: ToolPrivacyPolicy;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'policy_denied'
        | 'policy_confirmation_required'
        | 'raw_secret_detected'
        | 'unresolved_placeholders';
      readonly confirmation?: {
        readonly toolName: string;
        readonly inputDigest: string;
        readonly placeholderPaths: readonly string[];
        readonly message: string;
      };
      readonly rawSecretPaths: readonly string[];
      readonly unresolvedPlaceholders: readonly string[];
      readonly policy: ToolPrivacyPolicy;
    };
```

```ts
export interface SanitizeToolResultResult {
  readonly result: unknown;
  readonly redactedPaths: readonly string[];
  readonly sanitizeApplied: boolean;
  readonly warnings: readonly string[];
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
  options?: {
    readonly confirmation?: ToolConfirmationToken;
  },
): Promise<PrepareToolInputResult>;
```

```ts
export function sanitizeToolResult(
  toolName: string,
  result: unknown,
  options: {
    readonly context?: ToolSanitizationContext;
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
- strings containing existing placeholders preserve those placeholder spans, but the remaining text is still scanned for newly pasted raw secrets
- strings that exceed configured max length return a structured blocked marker only if the adapter can replace the whole provider-bound field; otherwise the adapter must block the provider request
- successful redaction replaces only matched sensitive substrings, not whole messages
- failure falls back to a blocked marker, not plaintext

### 8.2 `prepareToolInput(...)`

Purpose:
- recursively reveal placeholders in tool arguments, but only if policy permits it

Behavior:
- resolve policy for `toolName`
- recursively scan strings in `input` for newly detected raw secrets before reveal
- if raw secrets are detected and `blockRawSecrets !== false` → return `{ ok: false, reason: 'raw_secret_detected' }`
- if `mode === 'deny'` → return `{ ok: false, reason: 'policy_denied' }`
- if `mode === 'confirm'` and no valid confirmation token matches the input digest → return `{ ok: false, reason: 'policy_confirmation_required' }`
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
- successful reveal returns a `ToolSanitizationContext` that must be passed to `sanitizeToolResult(...)` for the matching tool result
- a valid confirmation token is bound to `toolName`, `inputDigest`, and a short expiry; it cannot be reused for a changed tool input

### 8.3 `sanitizeToolResult(...)`

Purpose:
- recursively scrub plaintext secrets from structured tool outputs before model-visible re-entry

Behavior:
- resolve policy
- if a `ToolSanitizationContext` exists, sanitization is mandatory even if a policy attempts to set `sanitizeResult === false`
- if no context exists and `sanitizeResult === false`, return original result unchanged only after checking that the result contains no placeholders and no deterministic raw-secret matches
- otherwise recursively traverse strings and scrub using:
  - exact-match removal of `context.revealedValues` and explicit `revealedValues`
  - placeholder cleanup
  - deterministic structured sensitive-pattern scan
- unresolved placeholders in tool results are redacted, not preserved, because they should not be reintroduced into future model-visible context as executable-looking secret handles

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

Built-in fallback policy (v1):

| Tool class | Examples | Default mode | Reveal | Result sanitization |
|---|---|---|---|---|
| observe-only local tools | `read`, `grep`, `find`, `ls` | `allow` | disabled | enabled |
| local mutation tools | `write`, `edit`, `multi_edit` | `confirm` | enabled after confirmation | enabled |
| shell/process tools | `bash`, `shell`, `process`, `terminal` | `confirm` | enabled after confirmation and adapter allowlist | enabled |
| network/external tools | `http`, `fetch`, `curl`, `browser`, MCP tools | `confirm` | enabled after confirmation and adapter allowlist | enabled |
| display/clipboard/chat tools | `copy_to_clipboard`, `show_message`, `send_message` | `deny` | disabled | enabled |
| unknown tools | any unmatched tool name | `confirm` | disabled until explicitly enabled by config | enabled |

The core fallback must never allow unknown tools to receive revealed plaintext by default. Adapters may ship runtime-specific presets, but those presets must be explicit configuration layered above the core fallback and covered by tests.

### 8.6 Confirmation semantics

Core does not prompt. It returns a structured result that says confirmation is required.

Adapters decide whether to:
- ask the user and re-run with a `ToolConfirmationToken`
- block and explain
- pre-approve via policy

Confirmation token requirements:

- bound to `toolName`
- bound to a digest of the original input object after stable JSON serialization
- includes `approvedAt` and `expiresAt`
- expires quickly by default (recommended: 60 seconds)
- authorizes only the specific policy transition that requested confirmation
- cannot override `mode: 'deny'`
- cannot override unresolved placeholders or raw-secret blocks

This makes confirmation a narrow user decision, not a general "allow this tool forever" bypass.

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
    "mode": "confirm",
    "reveal": { "enabled": false },
    "sanitizeResult": true
  },
  "tools": {
    "write": {
      "mode": "confirm",
      "reveal": { "enabled": true },
      "sanitizeResult": true
    },
    "read": {
      "mode": "allow",
      "reveal": { "enabled": false },
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
- reject `sanitizeResult: false` for any policy with `reveal.enabled: true`
- reject policies that set unknown tools to `allow` through wildcard/default config unless `reveal.enabled` is false
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

This section is an implementation contract for the adapter. Before implementation, pin the exact pi package version/docs used for hook signatures. If pi changes event names or mutability semantics, update this section before writing code.

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
- replace every changed provider-bound field before the request is sent
- if any model-visible field cannot be safely replaced after redaction, block the provider request
- never pass raw `secureAndRedact` diagnostics into provider-bound content
- record only redacted diagnostics for local status/debug output

Rationale:
- this is the final runtime boundary before provider send
- earlier hooks may be bypassed by runtime-specific behaviors or internal prompt serialization differences

### 11.4 `tool_call`

Adapter responsibilities:
- call `prepareToolInput(toolName, event.input, ...)`
- if result `ok: true`, replace `event.input` with the returned input before the tool executes
- store the returned `ToolSanitizationContext` in process-local state keyed by pi tool-call id or a generated id
- if `policy_confirmation_required`, prompt user via pi UI and, if approved, rerun with a `ToolConfirmationToken`
- if denied, raw-secret-detected, or unresolved, block the tool call
- never log the prepared plaintext input

Minimum block reasons the adapter must map into user-visible local messages:

- `policy_denied`
- `policy_confirmation_required`
- `raw_secret_detected`
- `unresolved_placeholders`

If pi does not provide a stable tool-call id, the adapter must derive one from tool name + input digest and clear it after the matching result or session shutdown.

### 11.5 `tool_result`

Adapter responsibilities:
- load the matching `ToolSanitizationContext` from process-local state when one exists
- call `sanitizeToolResult(toolName, result, { context, ... })`
- return patched content/details/isError fields as needed
- clear the matching context after sanitization
- if no matching context exists, still run deterministic result sanitization with policy defaults
- if the result shape cannot be patched safely, block or replace it with a local redacted error object rather than returning unsanitized content

### 11.6 `session_start` / `session_shutdown`

Adapter responsibilities:
- status line setup/cleanup
- create/close local DB/key/vault dependencies if managed by adapter
- restore any lightweight runtime state
- clear all in-memory `ToolSanitizationContext` values on shutdown

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
8. **New raw secrets in tool inputs must block, not become best-effort placeholders.**
9. **`sanitizeResult: false` must never bypass scrubbing after a reveal occurred.**
10. **Oversize or unpatchable provider-bound fields must block rather than pass through partially redacted content.**

---

## 15. Implementation plan

Each phase below is sprint-generation ready: stories are independently reviewable, list dependencies, and include acceptance/verification. Package/dependency feasibility comes before adapter packaging depends on it.

### Phase 1 — package and dependency feasibility

Goal: prove the privacy wrapper can run without memory/search/indexing dependencies.

#### P1-S1: Dependency graph audit

- **Depends on:** none
- **Work:** document which current privacy imports pull in full-SDK dependencies, especially `sqlite-vec`, embedders, memory orchestration, and LLM clients.
- **Acceptance criteria:** a short note in the PR or docs identifies whether an internal privacy-only export is enough or whether a package split is required.
- **Verification:** `npm run typecheck`; dependency/import check script or `rg` evidence showing no forbidden imports from `src/privacy/tool-wrapper`.

#### P1-S2: Privacy-only dependency factory

- **Depends on:** P1-S1
- **Work:** add a factory that wires SQLite DB, vault store, key manager, KEK manager, deterministic classifier, `~/.pristine/redaction.json`, and `~/.pristine/tool-privacy.json`.
- **Acceptance criteria:** factory exposes only privacy primitives and wrapper dependencies; it does not construct LLM, embedder, memory, queue, or search modules.
- **Verification:** unit test with mocked constructors/import boundaries; `npm run test:unit -- tests/privacy`.

### Phase 2 — core wrapper primitives

Goal: move runtime-agnostic security semantics into core.

#### P2-S1: Structured traversal helper

- **Depends on:** none
- **Work:** add immutable traversal over strings in plain objects/arrays with stable path notation.
- **Acceptance criteria:** paths match examples in §8.4; unsupported values are preserved without throwing.
- **Verification:** unit tests for nested objects, arrays, content arrays, nulls, dates, buffers/blobs as unsupported values.

#### P2-S2: Policy resolution and validation

- **Depends on:** P2-S1
- **Work:** implement `ToolPrivacyPolicy`, `ToolWrapperConfig`, fallback policy, config validation, and `loadToolPrivacyConfig`.
- **Acceptance criteria:** unknown tools default to confirm/no reveal; shell/network tools do not receive plaintext without explicit policy or confirmation; invalid configs fail closed.
- **Verification:** unit tests for precedence, invalid config, fallback categories, and rejection of unsafe `sanitizeResult: false` policies.

#### P2-S3: Strict tool-input preparation

- **Depends on:** P1-S2, P2-S1, P2-S2
- **Work:** implement `prepareToolInput` with raw-secret blocking, policy checks, placeholder reveal, unresolved-placeholder detection, and `ToolSanitizationContext`.
- **Acceptance criteria:** raw secrets block; unresolved placeholders block; successful reveal returns a new input object plus process-local sanitization context.
- **Verification:** unit tests for allow/deny/confirm, nested reveal, raw secret block, unresolved block, and no mutation of original input.

#### P2-S4: Tool-result sanitization

- **Depends on:** P2-S3
- **Work:** implement `sanitizeToolResult` with mandatory context-based scrubbing and deterministic fallback scans.
- **Acceptance criteria:** exact revealed values, placeholders, and built-in/custom secret patterns are removed from nested result structures.
- **Verification:** unit tests where a tool echoes a revealed API key, a private key, an EVM key, and a custom regex secret.

#### P2-S5: Provider-bound input redaction

- **Depends on:** P1-S2, P2-S1
- **Work:** implement `redactModelInput` for recursive provider payload redaction with oversize and failure behavior.
- **Acceptance criteria:** existing placeholders are preserved while new raw secrets in the same string are redacted; oversize fields fail closed.
- **Verification:** unit tests for mixed placeholder/raw-secret strings, oversize strings, nested payloads, and redaction failure fallback.

### Phase 3 — confirmation and context lifecycle

Goal: make confirm mode deterministic and hard to bypass.

#### P3-S1: Confirmation token contract

- **Depends on:** P2-S2, P2-S3
- **Work:** add input digesting, token validation, expiry handling, and a helper to create adapter-confirmable requests.
- **Acceptance criteria:** token authorizes only matching tool name + input digest; expired or mismatched tokens fail; deny/raw-secret/unresolved blocks cannot be overridden.
- **Verification:** unit tests for accepted, expired, mismatched, replayed, and denied-policy attempts.

#### P3-S2: Sanitization context lifecycle tests

- **Depends on:** P2-S3, P2-S4
- **Work:** add integration-level tests that prepare input, execute a fake tool, sanitize output, and clear context.
- **Acceptance criteria:** raw revealed values never appear in sanitized result; context is not serializable into model-visible output.
- **Verification:** `npm run test:integration -- tests/integration/privacy.test.ts` plus dedicated wrapper integration tests.

### Phase 4 — local pi extension migration

Goal: prove the existing project-local extension can become a thin adapter.

#### P4-S1: pi hook contract pinning

- **Depends on:** P2-S5
- **Work:** pin the pi version/docs used for `before_agent_start`, `before_provider_request`, `tool_call`, `tool_result`, session hooks, and mutation/block semantics.
- **Acceptance criteria:** spec/doc note lists the pinned version or commit and any adapter assumptions.
- **Verification:** manual pi smoke test or fixture test proving hook mutation/block behavior.

#### P4-S2: Replace local recursive logic with core calls

- **Depends on:** P2-S3, P2-S4, P2-S5, P3-S1, P4-S1
- **Work:** update `.pi/extensions/pristine-privacy/` to call core wrapper APIs for provider redaction, tool preparation, result sanitization, and policy checks.
- **Acceptance criteria:** extension contains only dependency wiring, hook registration, commands/notifications, and pi payload mapping.
- **Verification:** adapter tests or manual pi run: prompt redaction, tool reveal, tool result sanitization, denial, confirmation.

#### P4-S3: Setup/operator flows

- **Depends on:** P1-S2, P4-S2
- **Work:** implement first-run wiring, config loading, malformed-config fail-closed behavior, and migration docs for local vs packaged extension.
- **Acceptance criteria:** flows in §5.4 are covered by tests or manual acceptance notes.
- **Verification:** manual clean-home test using temporary `HOME`; invalid config test; duplicate-extension warning/doc check.

### Phase 5 — package split or privacy-only export

Goal: make distribution feasible before publishing adapter packaging.

#### P5-S1: Privacy package/export decision

- **Depends on:** P1-S1, P1-S2, P2 completion
- **Work:** choose one: internal privacy-only export from current package, workspace package, or new `@pristine/privacy-core`.
- **Acceptance criteria:** chosen path installs/loads without memory/search/indexing deps.
- **Verification:** package install/build smoke test; import test in a minimal temp project.

#### P5-S2: Dependency regression guard

- **Depends on:** P5-S1
- **Work:** add a test or script that fails if privacy wrapper imports forbidden modules.
- **Acceptance criteria:** future changes cannot accidentally reintroduce `sqlite-vec`, embedders, memory/search, or LLM runtime imports into privacy wrapper/adapters.
- **Verification:** CI runs the guard with typecheck/lint.

### Phase 6 — first-party pi adapter package

Goal: publish a thin adapter once core/package feasibility is proven.

#### P6-S1: Package scaffold

- **Depends on:** P5-S1
- **Work:** create `@pristine/pi-privacy` package with pi metadata, extension entrypoint, README, and example policy config.
- **Acceptance criteria:** package depends on privacy core/export only and declares pi as peer/runtime dependency according to pi package conventions.
- **Verification:** package build; local install into pi; dependency audit from P5-S2 passes.

#### P6-S2: Adapter acceptance suite

- **Depends on:** P6-S1
- **Work:** add automated or documented manual suite for prompt redaction, tool reveal, confirmation, denial, result sanitization, first-run setup, and malformed config.
- **Acceptance criteria:** all seven flows pass before removing Draft status from this spec.
- **Verification:** recorded command output or checklist in PR.

---

## 16. Testing plan

### 16.1 Core unit tests

Add under `tests/privacy/tool-wrapper/`.

Coverage:
- reveal recursion in nested arrays/objects
- unresolved placeholder detection
- raw secret detection blocks tool input reveal
- policy resolution precedence
- `allow` / `deny` / `confirm` modes
- confirmation token digest/expiry validation
- structured result sanitization across nested shapes
- exact-match scrubbing of revealed values
- mandatory sanitization when `ToolSanitizationContext` exists
- custom regex support via existing deterministic classifier config
- blocked markers for oversize provider-bound strings
- malformed `~/.pristine/tool-privacy.json` fail-closed behavior

### 16.2 Core integration tests

Add under `tests/integration/`.

Coverage:
- redact prompt → placeholder stored in vault
- prepare tool input → local plaintext available only in returned tool input object
- sanitize tool result → plaintext removed from returned result
- prepare tool input → sanitization context → sanitize matching result lifecycle
- unresolved placeholder → structured failure result
- raw secret in tool input → structured failure result

### 16.3 pi adapter tests

If/when adapter package has its own test setup:
- provider payload redaction before request
- tool-call interception for built-in and custom tool names
- confirmation flow for `mode: 'confirm'`
- tool-result sanitization before context re-entry
- first-run DB/key/vault/config wiring
- malformed config blocks before provider/tool execution
- local-extension migration path remains thin
- commands/status UX smoke tests

### 16.4 Manual acceptance tests

1. Secret pasted into prompt is redacted automatically
2. Model can still use placeholder in a `write` tool call
3. `write` receives plaintext locally at execution time
4. Tool result does not echo plaintext secret back to model
5. Unknown/unresolved placeholder blocks execution cleanly
6. A policy-marked risky tool (for example `make_payment`) triggers confirmation
7. A deny-listed display/exfiltration tool is blocked from receiving plaintext
8. Unknown tool names do not receive plaintext without explicit config
9. First-run setup creates only privacy dependencies, not memory/search/indexing dependencies

---

## 17. Acceptance criteria

This spec is satisfied when all of the following are true:

1. Core exposes a first-class tool-wrapper API with strict structured results
2. The current pi extension can be rewritten to use that API without bespoke recursion/policy logic
3. The privacy wrapper can be installed without unrelated memory/indexing dependencies
4. A pi package can be published as a thin adapter over the core wrapper
5. Unknown and shell/network tools do not receive plaintext by default
6. Setup/operator flows for install, first run, config load, malformed config, and local-extension migration are documented and testable
7. The end-to-end invariant holds: **LLM sees placeholders, tools get plaintext locally only at execution, model-visible results are sanitized**

---

## 18. Open questions

1. **Field-level reveal control**
   - Is `fields` / `excludeFields` needed in v1, or can it wait until after tool-name policy ships?

2. **Structured tool-result shapes**
   - Do we need first-class helpers for common content-array formats beyond generic traversal, or is generic path-based traversal sufficient for v1?

3. **Deny-list expansion**
   - Which additional display, clipboard, browser, or external-send tool names should core deny by default beyond the initial examples in §8.5?

4. **Package split timing**
   - Can the current repo export a privacy-only package cleanly now, or should the wrapper land internally first and the package split happen in a later spec/PR?

---

## 19. Recommendation

Build the secure tool-call wrapper as a **Pristine core capability** and ship pi support as a **thin first-party adapter package**.

That keeps:
- the security model reusable
- the adapter lightweight
- distribution clean
- the current project-local extension useful as an incubator, not a permanent architecture boundary
