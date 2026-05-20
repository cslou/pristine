# Pristine Pi Privacy Input Reference

Reference Pi extension for user-input privacy protection. The extension registers a Pi `input` handler and delegates behavior to a testable runtime so hosts can inject their own detector, classifier callback, redactor, policy, user ID, and notification lifecycle.

## Runtime dependencies

The runtime is intentionally host-wired. Provide:

- `detect(text)` from `@pristine/sdk` or a compatible local detector.
- `classify(text, candidates, classifierCallback)` from `@pristine/sdk`.
- `classifierCallback`, either the reference adapter from `lib/classifier-adapter.ts` with the Pi model transport from `lib/pi-model-classifier-transport.ts`, or a fake/local/manual callback.
- `redact(text, confirmed, userId)`, usually `Pristine.redact` from a configured local client.
- `userId`, policy, optional `classifierTimeoutMs`, and optional notifications.

## Classifier adapter contract

The reference classifier adapter builds tasks from `classify` callback requests: sanitized context, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata. Hosts can replace it with a fake/local/manual classifier callback by implementing the same callback interface.

For real Pi smoke, wire the adapter to `createPiModelClassifierTransport`. The transport uses Pi's model registry and `completeSimple` from `@mariozechner/pi-ai`, tries configured preferences first, falls back to the current Pi model, and calls `ctx.modelRegistry.getApiKeyAndHeaders(model)` so OAuth/header-backed providers and API-key providers both work. The default example preference is `openai-codex/gpt-5.5`; it is an example, not a hardcoded provider requirement.

```ts
import { Pristine, classify, detect } from '@pristine/sdk';
import { registerPrivacyInputExtension } from './index.js';
import { createPrivacyInputClassifierCallback } from './lib/classifier-adapter.js';
import { createPiModelClassifierTransport } from './lib/pi-model-classifier-transport.js';
import { PrivacyInputRuntime } from './lib/runtime.js';

export default function privacyInput(pi) {
  registerPrivacyInputExtension(pi, (ctx) => {
    const client = new Pristine();
    return new PrivacyInputRuntime({
      detect,
      classify,
      classifierCallback: createPrivacyInputClassifierCallback(
        createPiModelClassifierTransport({
          modelRegistry: ctx.modelRegistry,
          currentModel: ctx.model,
          preferences: [{ provider: 'openai-codex', id: 'gpt-5.5' }],
          reasoning: 'minimal',
          maxTokens: 2048,
          timeoutMs: 10_000,
        }),
      ),
      redact: (text, confirmed, userId) => client.redact(text, confirmed, userId),
      userId: 'local-pi-user',
      policy: { uncertainPolicy: 'block' },
      notifications: ctx.ui,
    });
  });
}
```

Classifier prompts must never include raw candidates, raw prefixes/suffixes, decoded JWT payload values, URL passwords, query secret values, seed phrase words, vault refs, or reveal data. Parser failures, duplicate IDs, unknown IDs, malformed JSON, empty/truncated model responses, unavailable model/auth, and timeouts are structured classifier failures.

## Policy and failure behavior

`uncertainPolicy` defaults to `block`, which stops a turn before model context when the classifier cannot decide whether a candidate is safe. `uncertainPolicy: "redact"` stores/redacts uncertain candidates using detector hints or a fallback type. `uncertainPolicy: "allow"` is an explicit unsafe opt-in: uncertain raw input can continue to model/session history, so it is excluded from the default no-raw-secret guarantee.

Classifier timeout, thrown errors, malformed responses, unknown candidate IDs, and duplicate candidate IDs return `{ action: "handled" }` with one raw-value-free notification.

## Local vault responsibilities

Raw-value slicing and vault storage happen locally in `redact`. Classifier labels are visible aliases/metadata; do not put raw secrets in labels.

## v1 limitations

This reference is input-only: it does not reveal secrets for tool calls and does not scrub tool results. Future tool-call reveal and future tool-result scrub hooks need dedicated implementation and verification.

## Smoke checks

Non-interactive fake/test classifier smoke:

```bash
pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts -t "uses real primitives to transform and reveal a confirmed secret"
```

Pass condition: a fake API key becomes a `[SENSITIVE:api_key:<id>]` placeholder, the raw key is absent from transformed/model-facing text, classifier input contains `[CANDIDATE:<id>]` markers, and `reveal` restores the original value for the same user.

The automated smoke transcript is recorded in `smoke-transcript.md`.

Manual Pi smoke after copying into `.pi/extensions/privacy-input`, installing dependencies, and wiring a configured runtime factory:

```text
My test API key is sk-proj-abcdefghijklmnopqrstuvwxyz123456. Please reply OK.
```

Pass condition: the turn is blocked or transformed before model context; transcript/session history contains a safe notification or placeholder and not the raw key.
