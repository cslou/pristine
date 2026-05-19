# Pristine Pi Privacy Input Reference

Reference Pi extension for user-input privacy protection. The extension registers a Pi `input` handler and delegates behavior to a testable runtime so hosts can inject their own detector, classifier callback, redactor, policy, user ID, and notification lifecycle.

The reference classifier adapter builds tasks from `classify` callback requests: sanitized context, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata. Hosts can replace it with a fake/local/manual classifier callback by implementing the same callback interface; no Anthropic, OpenAI, or hosted classifier dependency is required.

This reference is input-only: it does not reveal secrets for tool calls and does not scrub tool results.
