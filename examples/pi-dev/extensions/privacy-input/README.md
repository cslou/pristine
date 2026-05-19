# Pristine Pi Privacy Input Reference

Reference Pi extension for user-input privacy protection. The extension registers a Pi `input` handler and delegates behavior to a testable runtime so hosts can inject their own detector, classifier callback, redactor, policy, user ID, and notification lifecycle.

## Runtime dependencies

The runtime is intentionally host-wired. Provide:

- `detect(text)` from `@pristine/sdk` or a compatible local detector.
- `classify(text, candidates, classifierCallback)` from `@pristine/sdk`.
- `classifierCallback`, either the reference adapter from `lib/classifier-adapter.ts` or a fake/local/manual callback.
- `redact(text, confirmed, userId)`, usually `Pristine.redact` from a configured local client.
- `userId`, policy, optional `classifierTimeoutMs`, and optional notifications.

## Classifier adapter contract

The reference classifier adapter builds tasks from `classify` callback requests: sanitized context, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata. Hosts can replace it with a fake/local/manual classifier callback by implementing the same callback interface; no Anthropic, OpenAI, or hosted classifier dependency is required.

Classifier prompts must never include raw candidates, raw prefixes/suffixes, decoded JWT payload values, URL passwords, query secret values, or seed phrase words. Parser failures, duplicate IDs, unknown IDs, malformed JSON, and unsafe labels are structured classifier failures.

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
