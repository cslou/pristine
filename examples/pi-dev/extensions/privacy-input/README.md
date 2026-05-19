# Pristine Pi Privacy Input Reference

Reference Pi extension for user-input privacy protection. The extension registers a Pi `input` handler and delegates behavior to a testable runtime so hosts can inject their own detector, classifier callback, redactor, policy, user ID, and notification lifecycle.

This reference is input-only: it does not reveal secrets for tool calls and does not scrub tool results.
