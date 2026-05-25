# Privacy-input fake-classifier smoke transcript

Source: automated fake/test classifier smoke (`pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts -t "uses real primitives to transform and reveal a confirmed secret"`).

Model-facing text observed by the test harness:

```text
token [SENSITIVE:api_key:<id>]
```

Classifier-facing request excerpt observed by the test harness:

```text
token [CANDIDATE:request-candidate-0001]
```

Pass evidence:

- Placeholder is present in model-facing text.
- Candidate marker is present in classifier-facing text.
- Raw fake API key is absent from model-facing text and classifier-facing text.
- `reveal` restores the original value for the same user in the local test vault.
