# Pristine — Implementation Spec 004: Secret Redaction for Agent Harnesses

## 1. Product Overview

Pristine's privacy module currently detects general PII (credit cards, SSNs, emails, phone numbers) using a combined LLM + regex classifier. This spec refocuses the privacy pipeline on the highest-risk category for AI agent users: **secrets** (API keys, private keys, auth tokens). Developers using agent harnesses should have the comfort of pasting API keys or private keys into the agent interface knowing that secrets will never be stored in session memory or sent to the 3rd-party LLM — and that when the agent needs to use a redacted secret, it is automatically swapped to the real value (hidden from the agent).

**Target harnesses:** Pi.dev (full transparent redaction — first priority), Claude Code (partial — blocked on `updatedPrompt` feature request). Codex is deprioritized due to its hooks system not supporting content modification.

### Key References

- Current privacy architecture: `src/privacy/` (classifier, vault, sanitizer, KEK, keys)
- Deterministic classifier: `src/privacy/classifier/deterministic/index.ts`
- Combined classifier: `src/privacy/classifier/combined/index.ts`
- LLM classifier: `src/privacy/classifier/llm/`
- Privacy pipeline: `src/privacy/index.ts` (secureAndRedact, reveal, scrubOutput)
- Claude Code hooks: `~/.claude/settings.json` (27 hook events)
- Pi extensions: `~/projects/harness-config/extensions/` (safety-guard pattern)
- Codex config: `~/.codex/config.toml`

---

## 2. Goals

- Developers can paste API keys and private keys into agent conversations without them leaking to the LLM provider or being stored in memory
- Secret detection is deterministic (regex), fast (<1ms), and runs without an LLM
- Secrets are automatically redacted before reaching the LLM and restored when the agent executes tool calls
- Users can add custom regex patterns for secrets specific to their stack
- Works across Claude Code, Pi.dev, and Codex agent harnesses via their respective hook/extension mechanisms

## 3. Non-Goals (Deferred)

- General PII detection (addresses, health info, financial records) — out of scope for this iteration
- LLM-based contextual classification — being removed, not enhanced
- **Codex support** — Codex hooks cannot modify content (`updatedInput` exists in schema but is not wired up in the engine). Block-only protection is not aligned with the transparent redaction goal. Revisit if Codex hooks mature.
- Browser or web-based agent support
- Multi-user/team secret sharing
- Secret rotation or expiration management
- Integration with external secret managers (Vault, AWS Secrets Manager, etc.)

---

## 4. Architecture

### Stack

- **Runtime:** Node.js (TypeScript, ESM)
- **Storage:** SQLite (better-sqlite3) — existing vault tables for encrypted secret storage
- **Crypto:** AES-256-GCM + AES-256-KW (KEK wrapping) — existing vault encryption pipeline
- **Agent hooks:** Shell scripts (Claude Code), TypeScript extensions (Pi), TBD (Codex)

### System Diagram

```
Agent Harness (Claude Code / Pi / Codex)
    |
    v
[Hook / Extension] ──intercept──> User input / tool output
    |
    v
[Pristine Secret Detector] ──regex──> Detect API keys, private keys, tokens
    |
    v
[secureAndRedact] ──encrypt──> Replace secrets with [SENSITIVE:api_key:uuid]
    |                           Store encrypted originals in vault
    v
[LLM sees only placeholders] ──agent works with redacted text──>
    |
    v
[Tool execution] ──reveal──> Swap placeholders back to real secrets
    |                         (hidden from agent/LLM)
    v
[Real API call with real secrets]
```

### Module Overview

- **Secret Detector** (`src/privacy/classifier/deterministic/`) — Regex-based pattern matching for API keys, private keys, and auth tokens. Replaces existing PII patterns. Loads user-configurable custom patterns from `~/.pristine/redaction.json`.
- **Privacy Pipeline** (`src/privacy/index.ts`) — Existing secureAndRedact / reveal / scrubOutput. No longer requires an LLM client for classification.
- **Vault** (`src/privacy/vault/`) — Unchanged. Encrypts and persists secret values with AES-256-GCM + KEK wrapping.
- **Agent Hooks** (new, per-harness) — Intercept user input and tool output to trigger redaction/reveal automatically.

### Repo Structure (changes only)

```
src/privacy/
├── classifier/
│   ├── deterministic/
│   │   └── index.ts          # MODIFY — replace PII patterns with secret patterns
│   ├── combined/              # Phase 5: REMOVE
│   │   └── index.ts
│   └── llm/                   # Phase 5: REMOVE
│       ├── index.ts
│       ├── schema.ts
│       └── prompts.ts
├── index.ts                   # MODIFY — use deterministic classifier directly
├── redaction.json.example     # NEW — example custom patterns config
└── ...                        # vault, sanitizer, kek, keys — unchanged

hooks/                          # NEW — agent harness hooks (or in harness-config repo)
├── claude-code/
│   └── secret-redaction.sh    # Claude Code hook script
├── pi/
│   └── secret-redaction.ts    # Pi extension
└── codex/
    └── TBD
```

### Key Concepts & Data Flow

**Secret lifecycle:**
1. User pastes text containing `sk-ant-abc123...` into agent prompt
2. Agent harness hook intercepts the prompt before it reaches the LLM
3. Hook calls Pristine's `secureAndRedact(text, userId)`
4. Deterministic classifier detects `sk-ant-*` pattern → `DetectedEntity { type: 'api_key', ... }`
5. Redaction replaces with `[SENSITIVE:api_key:550e8400-...]`
6. Encrypted original stored in vault (AES-256-GCM + KEK)
7. LLM receives the redacted text — never sees the real secret
8. When agent executes a tool call containing the placeholder, hook calls `reveal()`
9. Placeholder is swapped back to the real secret for execution
10. Tool output flows back through the hook — any secrets in output are re-redacted

**Threat model:**
- Secrets not stored in conversation memory (redacted before ingest)
- Secrets not sent to LLM provider API (redacted before prompt)
- Secrets encrypted at rest in vault (AES-256-GCM)
- Secrets only exist in plaintext during tool execution (in-process, not logged)

### Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Classification engine | Deterministic regex only | Secrets have known prefixes/formats; LLM adds latency and cost with no accuracy gain |
| SensitivityType values | `api_key`, `private_key`, `auth_token` | Maps to the three categories of secrets we detect |
| Custom patterns | JSON config file (`~/.pristine/redaction.json`) | Extensible without code changes; familiar pattern for dev tools |
| Vault encryption | Keep existing AES-256-GCM + KEK | Already battle-tested; no reason to change crypto layer |
| LLM classifier | Toggle off in Phase 2, remove in Phase 6 | Progressive removal reduces risk; cleanup happens after hook integration is proven |

---

## 5. External Integrations

### Claude Code Hooks

- **Purpose:** Intercept user prompts and tool calls for secret redaction
- **API docs:** https://code.claude.com/docs/en/hooks
- **Key events:**
  - `UserPromptSubmit` — detect secrets in user input; **block only** (cannot modify prompt)
  - `PreToolUse` — intercept tool inputs; **can modify** via `updatedInput` (full replacement)
  - `PostToolUse` — detect secrets in output; **block or warn** via `additionalContext` (cannot modify built-in tool output)
- **Config:** `~/.claude/settings.json` → `hooks` section
- **Hook type:** `command` — shell/Node.js scripts receiving JSON on stdin, returning JSON on stdout
- **Exit codes:** 0 = success (parse stdout), 2 = block (stderr shown to user), 1 = non-blocking error
- **Limitations:** `updatedPrompt` not implemented ([#27365](https://github.com/anthropics/claude-code/issues/27365)), `updatedBuiltinToolOutput` not implemented ([#36843](https://github.com/anthropics/claude-code/issues/36843))
- **Reference implementation:** [`l-mb/claude-code-redaction-hooks`](https://github.com/l-mb/claude-code-redaction-hooks) (Python, Apache-2.0)

### Pi.dev Extensions

- **Purpose:** Full transparent secret redaction (best harness support of the three)
- **API:** `ExtensionAPI` from `@mariozechner/pi-coding-agent`
- **API docs:** `badlogic/pi-mono` → `packages/coding-agent/src/core/extensions/types.ts`
- **Key events:**
  - `input` — intercept user text; **can transform** via `{ action: "transform", text: newText }`
  - `tool_call` — intercept tool input; **can mutate** `event.input` in place
  - `tool_result` — intercept tool output; **can replace** via `{ content: newContent }` partial patch
- **Pattern:** TypeScript extension loaded via jiti (no build step), default export async factory
- **Config:** `~/.pi/agent/settings.json` under extension key
- **Installation:** Drop `.ts` file in `~/.pi/agent/extensions/` or symlink from `harness-config/extensions/`
- **Reference:** `safety-guard.ts` (tool_call blocking), `session-notifier.ts` (multi-event lifecycle)

### Codex (deferred)

- **Status:** Not supported in this spec. Codex hooks cannot modify content — `updatedInput` is defined in the Rust schema (`codex-rs/hooks/src/schema.rs`) but the core engine never reads it. Only block-only protection is possible, which does not meet the transparent redaction goal.
- **API docs:** https://developers.openai.com/codex/hooks
- **Revisit when:** Codex wires up `updatedInput` in its core engine, or adds an extension/plugin system comparable to Pi's.

---

## 6. Data Model

### Existing Tables (unchanged)

#### vault_entries
```
id              TEXT PRIMARY KEY
memory_id       TEXT
user_id         TEXT
placeholder_id  TEXT
sensitive_type  TEXT NOT NULL        -- 'api_key', 'private_key', 'auth_token'
encrypted_value BLOB NOT NULL        -- AES-256-GCM ciphertext
iv              BLOB NOT NULL        -- 12-byte IV
auth_tag        BLOB NOT NULL        -- GCM auth tag
encryption_mode TEXT DEFAULT 'client_v2'
encryption_metadata TEXT             -- JSON: wrappedDek, keyId, etc.
created_at      TEXT
```

### New Config File

#### ~/.pristine/redaction.json
```json
{
  "patterns": [
    {
      "type": "api_key",
      "name": "Internal API Token",
      "pattern": "mycompany_[A-Za-z0-9]{32}",
      "confidence": 0.95
    }
  ]
}
```

---

## 7. Environment Setup

### Required Env Vars

None new. Pristine remains local-first with no external service dependencies.

### Local Dev

```bash
git clone ...
npm install
# No new setup needed — patterns are built-in
# Custom patterns: create ~/.pristine/redaction.json (optional)
npm test
```

### Deployment

Agent harness hooks are installed per-harness:
- Pi: symlink extension into `~/.pi/agent/extensions/` (full transparent redaction)
- Claude Code: add hook entries to `~/.claude/settings.json` (partial — PreToolUse modification + prompt/output blocking)

---

## 8. User & Data Flows

### Flow 1: Developer Pastes API Key in Claude Code

1. Developer types: `Use this API key: sk-ant-api03-abc123...xyz`
2. `UserPromptSubmit` hook fires → detects `sk-ant-*` pattern
3. Hook **blocks** the prompt (exit code 2) — Claude Code shows: "Remove the API key and set it as an environment variable (e.g., `export ANTHROPIC_API_KEY=sk-ant-...`)"
4. Developer sets env var and retypes: `Use the API key from $ANTHROPIC_API_KEY`
5. Prompt goes through (no secret detected)
6. Claude generates: `Bash({ command: "curl -H 'Authorization: Bearer $ANTHROPIC_API_KEY' ..." })`
7. `PreToolUse` hook fires → no secrets in command (env var reference, not literal) → passes through
8. Bash executes, shell expands `$ANTHROPIC_API_KEY` to real value
9. `PostToolUse` hook fires → checks output for leaked secrets → adds `additionalContext` warning if found

**Note:** Claude Code cannot modify prompts (no `updatedPrompt` support). The block-and-guide pattern is the only option. This is a platform limitation, not a Pristine limitation.

### Flow 1b: Developer Pastes API Key in Pi.dev (full redaction)

1. Developer types: `Use this API key: sk-ant-api03-abc123...xyz`
2. `input` event fires → extension detects `sk-ant-*` pattern
3. Extension returns `{ action: "transform", text: "Use this API key: [SENSITIVE:api_key:uuid]" }`
4. LLM sees only the placeholder — never sees the real key
5. Claude generates: `bash({ command: "curl -H 'Authorization: Bearer [SENSITIVE:api_key:uuid]' ..." })`
6. `tool_call` event fires → extension mutates `event.input.command`, replacing placeholder with real key
7. Bash executes with real key
8. `tool_result` event fires → extension scans output, re-redacts any leaked secrets
9. LLM sees sanitized output

### Flow 2: Developer Adds Custom Pattern

1. Developer creates `~/.pristine/redaction.json`:
   ```json
   { "patterns": [{ "type": "api_key", "name": "Acme Token", "pattern": "acme_tk_[A-Za-z0-9]{24}", "confidence": 0.95 }] }
   ```
2. Next agent session loads custom patterns alongside built-in patterns
3. `acme_tk_abc123...` is now detected and redacted automatically

### Flow 3: Agent Uses Redacted Secret in Tool Call

1. Claude generates: `Bash({ command: "curl -H 'Authorization: Bearer [SENSITIVE:api_key:uuid]' https://api.example.com" })`
2. `PreToolUse` hook intercepts → calls `pristine reveal` with the tool input
3. Placeholder replaced with real secret → `curl -H 'Authorization: Bearer sk-ant-abc123...'`
4. Bash tool executes with the real secret
5. `PostToolUse` hook intercepts the output → re-redacts if any secrets appear in response
6. Claude sees sanitized output

---

## 9. Success Criteria

- [ ] All built-in secret patterns detect real-world API key formats with zero false negatives on known prefixes
- [ ] False positive rate < 1% on normal code/prose
- [ ] Classification runs in <1ms (no LLM dependency)
- [ ] Round-trip works: redact → LLM sees placeholder → reveal → tool uses real secret
- [ ] Custom patterns from `redaction.json` are loaded and applied alongside built-in patterns
- [ ] Pi.dev extension provides full transparent redaction (input → tool_call → tool_result)
- [ ] Claude Code hook provides PreToolUse redaction + prompt/output blocking (partial, pending `updatedPrompt`)
- [ ] Existing vault encryption/decryption pipeline works with new secret types
- [ ] All existing privacy tests pass or are updated (no regressions in vault, KEK, key management)

---

## 10. Phases

### Phase 1: Secret Detection Patterns

Replace PII-focused patterns in the deterministic classifier with secret-focused patterns. The existing `PatternRule` architecture (`{ type, pattern, confidence, validate? }`) stays — only the pattern entries change.

#### Modules

- `src/privacy/classifier/deterministic/index.ts` — replace PATTERNS array
- `src/privacy/sanitizer/index.ts` — update TYPE_DESCRIPTIONS map
- `src/privacy/vault/redaction.ts` — update buildPlaceholderLabel for new types
- `src/core/types.ts` — no change needed (`SensitivityType = string` already supports any value)

#### Patterns to Add

| Name | Type | Pattern | Confidence | Validate? |
|------|------|---------|------------|-----------|
| AWS Access Key ID | `api_key` | `AKIA[0-9A-Z]{16}` | 0.99 | length check |
| GitHub Personal Access Token | `api_key` | `ghp_[A-Za-z0-9]{36}` | 0.99 | |
| GitHub OAuth Token | `api_key` | `gho_[A-Za-z0-9]{36}` | 0.99 | |
| GitHub App Token | `api_key` | `ghs_[A-Za-z0-9]{36}` | 0.99 | |
| GitHub Fine-grained PAT | `api_key` | `github_pat_[A-Za-z0-9_]{22,}` | 0.99 | |
| OpenAI API Key (legacy) | `api_key` | `sk-(?!ant-\|proj-)[A-Za-z0-9]{20,}` | 0.95 | negative lookahead excludes `sk-ant-` and `sk-proj-` prefixes (handled by their own patterns); min length 32 to avoid collisions |
| OpenAI Project Key | `api_key` | `sk-proj-[A-Za-z0-9\-_]{20,}` | 0.99 | |
| Anthropic API Key | `api_key` | `sk-ant-[A-Za-z0-9\-_]{20,}` | 0.99 | |
| Stripe Secret Key | `api_key` | `sk_(live\|test)_[A-Za-z0-9]{24,}` | 0.99 | |
| Stripe Restricted Key | `api_key` | `rk_(live\|test)_[A-Za-z0-9]{24,}` | 0.99 | |
| Slack Bot Token | `api_key` | `xoxb-[A-Za-z0-9\-]{20,}` | 0.99 | |
| Slack User Token | `api_key` | `xoxp-[A-Za-z0-9\-]{20,}` | 0.99 | |
| Slack App Token | `api_key` | `xapp-[A-Za-z0-9\-]{20,}` | 0.99 | |
| Twilio API Key | `api_key` | `SK[0-9a-fA-F]{32}` | 0.90 | prefix + hex only |
| SendGrid API Key | `api_key` | `SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}` | 0.99 | |
| PEM Private Key | `private_key` | `-----BEGIN (RSA \|EC \|ED25519 \|OPENSSH \|DSA )?PRIVATE KEY-----` | 0.99 | multi-line match to `-----END` |
| PGP Private Key | `private_key` | `-----BEGIN PGP PRIVATE KEY BLOCK-----` | 0.99 | multi-line match to `-----END` |
| JWT Token | `auth_token` | `eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*` | 0.90 | 3-part dot-separated, first two parts base64url-decode to valid JSON |

#### Patterns to Remove

| Name | Type | Reason |
|------|------|--------|
| Credit card (Luhn) | `credit_card` | Not a secret — out of scope for agent harness use case |
| Email address | `email_address` | Not a secret — out of scope |
| US SSN | `identity_number` | Not a secret — out of scope |
| Phone number | `phone_number` | Not a secret — out of scope |

#### Stories

##### P1-S1: Replace deterministic classifier patterns with secret patterns

- **What:** Swap the PATTERNS array in `src/privacy/classifier/deterministic/index.ts`. Remove credit_card, email, SSN, phone patterns. Add all secret patterns from the table above. Update TYPE_DESCRIPTIONS in sanitizer and buildPlaceholderLabel in redaction.ts.
- **Acceptance criteria:**
  - [ ] PATTERNS array contains only secret-detection rules
  - [ ] PII patterns (credit_card, email_address, identity_number, phone_number) removed
  - [ ] All new patterns detect their target format correctly
  - [ ] TYPE_DESCRIPTIONS updated for `api_key`, `private_key`, `auth_token`
  - [ ] buildPlaceholderLabel handles new types with sensible labels (e.g., `key-****last4`)
  - [ ] PEM private key detection works across multi-line input
  - [ ] JWT validation confirms base64url-decodable header/payload
  - [ ] Unit tests for each pattern (true positives + false positive resistance)
- **Commits:** ≤5

##### P1-S2: Add user-configurable custom patterns

- **What:** Load additional patterns from `~/.pristine/redaction.json` at classifier construction time. Merge with built-in patterns. Invalid entries are skipped with a warning (not fatal).
- **Acceptance criteria:**
  - [ ] `DeterministicClassifier` constructor accepts optional `customPatternsPath`
  - [ ] Custom patterns merged with built-in patterns (custom patterns checked after built-in)
  - [ ] Invalid regex in custom file is skipped (logged, not thrown)
  - [ ] Missing file is silently ignored (not an error)
  - [ ] Example file at `src/privacy/redaction.json.example`
  - [ ] Unit tests: custom patterns loaded, invalid patterns skipped, missing file ok
- **Commits:** ≤3

#### Open Questions

- Should the OpenAI legacy `sk-` pattern require a minimum length to avoid matching unrelated strings starting with `sk-`? (Proposed: min 32 chars total)
- Should we detect AWS Secret Access Keys? They're 40-char base64 strings with no prefix — high false positive risk. Proposed: defer, rely on the AWS Access Key ID pattern to catch the pair.
- Should PEM key detection capture the full key block (multi-line) or just flag the BEGIN marker? Multi-line capture is more thorough but requires multiline regex mode.

#### References

- [GitHub secret scanning patterns](https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns)
- [TruffleHog detector patterns](https://github.com/trufflesecurity/trufflehog)
- Existing `PatternRule` interface: `src/privacy/classifier/deterministic/index.ts:11-17`

#### Done When

- [ ] All stories complete
- [ ] Deterministic classifier detects secrets, not PII
- [ ] Custom patterns loadable from config file
- [ ] Unit tests pass for every pattern (true positives, false positive resistance)
- [ ] Existing vault/encryption tests unaffected

---

### Phase 2: Disable LLM Classifier

Toggle off the LLM classifier so the privacy pipeline uses deterministic-only classification. The `secureAndRedact` function no longer requires an LLM client for classification.

#### Modules

- `src/privacy/index.ts` — use `DeterministicClassifier` directly instead of `CombinedClassifier`
- `src/privacy/classifier/combined/index.ts` — bypass (not removed yet)
- `src/client.ts` — `secureAndRedact` config no longer requires `LlmClient` for classification
- `tests/` — update tests that assert LLM classifier behavior

#### Stories

##### P2-S1: Switch secureAndRedact to deterministic-only classification

- **What:** Replace `createCombinedClassifier(config.client, ...)` with `createDeterministicClassifier(...)` in the privacy pipeline. Make `config.client` optional in `SecureAndRedactConfig` (still needed for other features, but not for classification). Update the existing LLM classifier tests to reflect the bypass.
- **Acceptance criteria:**
  - [ ] `secureAndRedact()` uses `DeterministicClassifier` directly
  - [ ] `SecureAndRedactConfig.client` is no longer required for classification
  - [ ] Existing `secureAndRedact` round-trip tests pass with deterministic-only
  - [ ] LLM classifier code still exists (not removed) but is not called
  - [ ] No performance regression (should be faster — no LLM call)
- **Commits:** ≤3

#### Open Questions

- Should we add a config flag to re-enable LLM classification for users who want it? Proposed: no — keep it simple, remove the option entirely in Phase 6.

#### Done When

- [ ] secureAndRedact works without LLM client for classification
- [ ] All privacy integration tests pass
- [ ] E2E privacy pipeline tests updated

---

### Phase 3: Pi.dev Extension

Integrate Pristine secret redaction into Pi via the extensions system. Pi is the first harness integration because it has the most complete hook support — all three interception points support content modification, enabling fully transparent redaction.

#### Platform Capabilities (researched)

| Event | Can Detect? | Can Modify? | Mechanism |
|-------|-------------|-------------|-----------|
| `input` | Yes (`event.text`) | **Yes** — return `{ action: "transform", text: newText }` | Transforms chain across extensions |
| `tool_call` | Yes (`event.input`) | **Yes** — mutate `event.input` in place | No re-validation after mutation |
| `tool_result` | Yes (`event.content`) | **Yes** — return `{ content: newContent }` partial patch | Patches merge across extensions |

**Implication:** Pi supports the full redact-reveal lifecycle transparently. User input is redacted before the LLM sees it, tool inputs are revealed for execution, and tool outputs are re-redacted before the LLM sees results. No blocking workarounds needed.

#### Key Types (from `badlogic/pi-mono`)

```typescript
// Input event — user prompt interception
interface InputEvent { type: "input"; text: string; images?: ImageContent[]; source?: InputSource }
type InputEventResult =
  | { action: "continue" }                    // pass through
  | { action: "transform"; text: string }     // rewrite text
  | { action: "handled" };                    // swallow entirely

// Tool call event — mutate input in place, optionally block
interface ToolCallEvent { type: "tool_call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
interface ToolCallEventResult { block?: boolean; reason?: string }

// Tool result event — patch output content
interface ToolResultEvent { type: "tool_result"; toolCallId: string; toolName: string; content: (TextContent | ImageContent)[]; isError: boolean }
interface ToolResultEventResult { content?: (TextContent | ImageContent)[]; isError?: boolean }
```

#### Modules

- New: `secret-redactor.ts` in `~/projects/harness-config/extensions/` (symlinked to `~/.pi/agent/extensions/`)
- Follows `safety-guard.ts` pattern: default export async factory, `loadConfig()` from settings.json

#### Stories

##### P3-S1: Implement Pi secret redaction extension — input handler

- **What:** Create the extension file and implement the `input` event handler. On user input, call Pristine's `secureAndRedact()` to detect secrets, encrypt originals in the vault, and replace with placeholders. A session-local `Map<string, string>` caches placeholder→ID mappings for fast `reveal()` lookups in `tool_call`, but the vault is the source of truth for encrypted secrets (matching the threat model: "secrets encrypted at rest").
- **Acceptance criteria:**
  - [ ] Extension file at `~/projects/harness-config/extensions/secret-redactor.ts`
  - [ ] `input` handler calls `secureAndRedact()` — secrets encrypted in vault, text returned with placeholders
  - [ ] Session-local Map caches placeholderId→secretType for fast lookup in `tool_call` handler
  - [ ] `tool_call` handler calls `reveal()` to swap placeholders back to real secrets from vault
  - [ ] Configurable via `~/.pi/agent/settings.json` under `"secret-redactor"` key
  - [ ] `enabled: false` disables the extension
  - [ ] Unit tests: input with secrets → transformed via secureAndRedact, input without secrets → continue
- **Commits:** ≤2

##### P3-S2: Implement Pi secret redaction extension — tool_call and tool_result handlers

- **What:** Add `tool_call` handler to reveal placeholders (mutate `event.input` in place) and `tool_result` handler to re-redact secrets in output (return `{ content: redactedContent }`).
- **Acceptance criteria:**
  - [ ] `tool_call` handler reveals placeholders in `bash` (command), `write` (content), `edit` (old_string, new_string)
  - [ ] `tool_result` handler scans text content parts for secrets and re-redacts
  - [ ] Extension ordering: safety-guard runs before secret-redactor (alphabetical — `safety-guard.ts` < `secret-redactor.ts`), so safety checks see redacted input
  - [ ] Unit tests: tool_call with placeholder → revealed, tool_result with secret → redacted
- **Commits:** ≤3

#### Extension Configuration Shape

```json
{
  "secret-redactor": {
    "enabled": true,
    "customPatternsPath": "~/.pristine/redaction.json"
  }
}
```

#### Open Questions

- **Resolved: Vault vs session Map.** The extension uses the vault (via `secureAndRedact`/`reveal`) as the source of truth — secrets are encrypted at rest per the threat model. The session-local Map is a lookup cache only (placeholder IDs for fast reveal), not a replacement for vault storage.
- **Resolved: Extension load order.** `safety-guard.ts` runs before `secret-redactor.ts` alphabetically. This is the correct order: safety-guard validates the redacted (placeholder) form of commands, which prevents it from being influenced by the actual secret value. The secret is only revealed in `tool_call` after safety checks pass. If safety-guard needs to reason about the real command structure (not the secret value itself), the placeholder preserves that structure — e.g., `curl -H 'Authorization: Bearer [SENSITIVE:api_key:uuid]'` still looks like a curl command to safety-guard.

#### References

- Pi extension types: `badlogic/pi-mono` → `packages/coding-agent/src/core/extensions/types.ts`
- Pi extension runner: `badlogic/pi-mono` → `packages/coding-agent/src/core/extensions/runner.ts`
- Safety-guard pattern: `~/projects/harness-config/extensions/safety-guard.ts`
- Session-notifier pattern: `~/projects/harness-config/extensions/session-notifier.ts`
- Pi architecture map: `~/projects/harness-config/docs/research/pi-architecture.md`

#### Done When

- [ ] Full lifecycle: paste API key in Pi → input redacted → LLM sees placeholder → tool call revealed → execution uses real secret → tool output re-redacted
- [ ] Extension installable via symlink to `~/.pi/agent/extensions/`
- [ ] Tests pass

---

### Phase 4: Claude Code Hook (Partial — Pending `updatedPrompt`)

Integrate Pristine secret redaction into Claude Code via the hooks system. Claude Code's hook support is partial — only `PreToolUse` supports content modification. Full transparent redaction is blocked on the `updatedPrompt` feature request ([#27365](https://github.com/anthropics/claude-code/issues/27365)).

**Track:** [anthropics/claude-code#27365](https://github.com/anthropics/claude-code/issues/27365) (`updatedPrompt`), [#36843](https://github.com/anthropics/claude-code/issues/36843) (`updatedBuiltinToolOutput`). When these land, Claude Code reaches full parity with Pi.

#### Platform Capabilities (researched)

| Event | Can Detect? | Can Modify? | Mechanism |
|-------|-------------|-------------|-----------|
| `UserPromptSubmit` | Yes (`prompt` field) | **No** — can only block (exit 2) or add `additionalContext` | `updatedPrompt` does not exist |
| `PreToolUse` | Yes (`tool_input`) | **Yes** — via `updatedInput` in response JSON | Full replacement (must spread all original fields) |
| `PostToolUse` | Yes (`tool_response`) | **No** for built-in tools — can only block or add `additionalContext` | `updatedBuiltinToolOutput` not implemented |

#### Modules

- New: hook script(s) in `hooks/claude-code/` (Node.js recommended — avoids cold-start overhead of spawning a new process)
- Integration with existing `secureAndRedact` / `reveal` pipeline

#### Stories

##### P4-S1: Implement Claude Code PreToolUse redaction hook

- **What:** Create a hook that intercepts `PreToolUse` events. For tool calls containing placeholders (from a prior redaction), reveal them back to real secrets via `updatedInput`. For tool calls containing raw secrets (user typed directly into a tool argument), redact them and store in vault, then pass the redacted version via `updatedInput`. This is the primary integration point since it's the only one supporting modification.
- **Acceptance criteria:**
  - [ ] `PreToolUse` hook receives JSON on stdin, parses `tool_name` and `tool_input`
  - [ ] Detects secrets in tool input fields (`command` for Bash, `content`/`new_string` for Write/Edit)
  - [ ] Returns `updatedInput` with secrets replaced by placeholders (or placeholders replaced by real values for reveal)
  - [ ] `updatedInput` includes ALL original fields (full replacement, not merge)
  - [ ] Hook script works for Bash, Write, Edit, and MultiEdit tools
  - [ ] Overhead <50ms per hook invocation
  - [ ] Unit tests for hook logic (mock stdin/stdout)
- **Commits:** ≤3

##### P4-S2: Implement UserPromptSubmit and PostToolUse guard hooks

- **What:** Create hooks for the two events that cannot modify content. `UserPromptSubmit` blocks prompts containing raw secrets (exit 2 with guidance). `PostToolUse` adds `additionalContext` warning Claude not to repeat detected secrets.
- **Acceptance criteria:**
  - [ ] `UserPromptSubmit` hook blocks prompts containing secrets (exit code 2, stderr message)
  - [ ] Block message includes guidance: "Remove the API key and use an environment variable instead"
  - [ ] `PostToolUse` hook detects secrets in `tool_response` and returns `additionalContext` warning
  - [ ] Neither hook attempts to modify content (respects platform limitation)
  - [ ] Unit tests for both hooks
- **Commits:** ≤2

##### P4-S3: Claude Code hook installation and documentation

- **What:** Create installation script and docs. Hook entries added to `~/.claude/settings.json` under the `hooks` key.
- **Acceptance criteria:**
  - [ ] Install script adds hook entries to `~/.claude/settings.json`
  - [ ] Uninstall script removes hook entries cleanly
  - [ ] Documentation: install, verify, add custom patterns, known limitations (prompt/output modification pending)
- **Commits:** ≤2

#### Hook Configuration Shape

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node /path/to/pristine/hooks/claude-code/prompt-guard.js" }]
    }],
    "PreToolUse": [{
      "matcher": "Bash|Write|Edit|MultiEdit",
      "hooks": [{ "type": "command", "command": "node /path/to/pristine/hooks/claude-code/tool-redact.js" }]
    }],
    "PostToolUse": [{
      "matcher": "Bash|Read|Grep",
      "hooks": [{ "type": "command", "command": "node /path/to/pristine/hooks/claude-code/output-guard.js" }]
    }]
  }
}
```

#### PreToolUse Response Shapes

**Reveal (primary path):** Tool input contains a placeholder from a prior redaction. The hook swaps it to the real secret so the command executes correctly. The LLM never sees the real value — only the tool runtime does.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Placeholder revealed for execution",
    "updatedInput": {
      "command": "curl -H 'Authorization: Bearer sk-ant-api03-real-secret-value' https://api.example.com",
      "description": "original description preserved",
      "timeout": 120000
    }
  }
}
```

**Redact guard (edge case):** Tool input contains a raw secret (user typed it directly into a tool argument, not via prompt). The hook blocks execution — since Claude Code has no post-execution reveal, allowing a placeholder through would silently break the command.

```json
// stderr: "Command contains a raw API key. Use an environment variable instead."
// exit code 2 (block)
```

#### Open Questions

- Node.js hook vs shell script? Node.js avoids process spawn overhead and can import Pristine directly. Shell is simpler but slower.
- How to handle userId for vault? Use `session_id` from hook input, or a fixed user ID from `~/.pristine/config.json`?
- Reference implementation exists: [`l-mb/claude-code-redaction-hooks`](https://github.com/l-mb/claude-code-redaction-hooks) (Python, Apache-2.0) — should we port their persistent mapping approach?

#### References

- Claude Code hooks docs: https://code.claude.com/docs/en/hooks
- Reference implementation: https://github.com/l-mb/claude-code-redaction-hooks
- Watchtower hooks (`~/projects/watchtower/hooks/`) as shell script pattern reference
- Exit code semantics: 0 = success (parse stdout), 2 = block (stderr shown), 1 = non-blocking error

#### Done When

- [ ] PreToolUse hook redacts/reveals secrets in tool input via `updatedInput`
- [ ] UserPromptSubmit hook blocks prompts containing raw secrets
- [ ] PostToolUse hook warns about secrets in output via `additionalContext`
- [ ] Hook installable with one command
- [ ] Tests pass

---

### Phase 5: Cleanup and Integration Tests

Remove the LLM classifier code, remove unused PII infrastructure, and add integration tests that verify the full hook-to-reveal lifecycle.

#### Modules

- `src/privacy/classifier/llm/` — REMOVE entirely
- `src/privacy/classifier/combined/` — REMOVE entirely
- `src/privacy/classifier/llm/prompts.ts`, `schema.ts` — REMOVE
- `tests/classifier/llm-classifier.test.ts` — REMOVE
- `tests/classifier/combined-classifier.test.ts` — REMOVE
- LLM classifier imports from `src/privacy/index.ts`, `src/core/interfaces.ts` — REMOVE

#### Stories

##### P5-S1: Remove LLM classifier and combined classifier

- **What:** Delete `src/privacy/classifier/llm/`, `src/privacy/classifier/combined/`, and all associated tests. Remove the `SensitivityClassifier` interface if it is only used by the LLM classifier (or keep if the deterministic classifier still implements it). Clean up imports.
- **Acceptance criteria:**
  - [ ] `src/privacy/classifier/llm/` directory deleted
  - [ ] `src/privacy/classifier/combined/` directory deleted
  - [ ] LLM classifier tests deleted
  - [ ] Combined classifier tests deleted
  - [ ] No dead imports remaining
  - [ ] `secureAndRedact` no longer accepts `CombinedClassifierConfig`
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Commits:** ≤3

##### P5-S2: Integration tests for hook-to-reveal lifecycle

- **What:** End-to-end tests that simulate the full lifecycle: text with secret → hook intercepts → redact → LLM sees placeholder → tool call with placeholder → reveal → real secret used → tool output re-redacted. Test at the extension/hook function level (no need to spin up full agent processes).
- **Acceptance criteria:**
  - [ ] Integration test: simulate Claude Code hook stdin/stdout with secret-containing prompt
  - [ ] Integration test: simulate Pi extension tool_call event with secret in arguments
  - [ ] Integration test: verify vault round-trip (redact → persist → reveal → matches original)
  - [ ] Integration test: verify custom patterns from redaction.json work in hook context
  - [ ] All tests skippable via env var if agent harness not installed
- **Commits:** ≤3

#### Open Questions

- Should we keep the `SensitivityClassifier` interface for future extensibility, or simplify to just the concrete `DeterministicClassifier`?
- How many of the existing 103 privacy tests will need deletion vs update?

#### Done When

- [ ] LLM classifier code fully removed
- [ ] No dead code remaining
- [ ] Integration tests prove the full redact-reveal lifecycle works through hooks
- [ ] All tests pass
- [ ] `npm run typecheck`, `npm test`, `npm run lint` clean

---

*Created: 2026-04-14*
