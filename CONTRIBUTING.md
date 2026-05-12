# Contributing

Thanks for helping improve Pristine. This repository is a local-first TypeScript SDK; changes should keep user data on device by default and preserve the public API boundary documented in the README and `docs/pages/api.mdx`.

## Setup

```bash
git clone https://github.com/getlou-gh/pristine.git
cd pristine
npm ci
npm run build
```

Requirements:

- Node.js 22 or newer.
- Native install support for `better-sqlite3` and `sqlite-vec` on your platform.
- No hosted API credentials are required for the default test suite.

## Local verification

Run the smallest relevant checks while developing, then run the broader gate before opening or updating a PR:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:smoke
SKIP_SLOW_TESTS=1 npm run test:integration
npm run test:e2e
npm run verify:docs
npm run verify:package
```

Maintainers use the local regression wrapper when preparing merges/releases:

```bash
.checks/pre-merge.sh
```

## Slow and real-model tests

- `SKIP_SLOW_TESTS=1 npm run test:integration` runs deterministic integration coverage and skips real-model checks.
- `npm run test:integration` may run local model integration tests when the model cache is available.
- `.checks/regression.sh --tier=full` is the maintainer full regression path and may load local models.

## Coding conventions

- TypeScript strict mode and ESM only.
- No secrets, tokens, credentials, private keys, or sensitive user data in source, fixtures, docs, or examples.
- Prefer domain-specific errors from `src/core/errors.ts` over generic `Error` throws in production code.
- Keep modules small and independently testable; public contracts live in `src/core/interfaces.ts`, shared types in `src/core/types.ts`, and errors in `src/core/errors.ts`.
- Do not add hosted API SDKs or server dependencies to the local SDK.
- Pin dependency versions exactly.

## Pull request expectations

A PR should include:

- A clear description of the story/change.
- Acceptance criteria and verification evidence.
- Automated tests or explicit rationale when a change is docs-only.
- Notes for public API changes, including updates to README, Vocs docs under `docs/pages/`, smoke tests, and CHANGELOG when applicable.

Before requesting review, confirm:

```bash
npm run verify:docs
npm run verify:package
.checks/pre-merge.sh
```

`verify:package` builds the package and checks the clean package artifact contents. Do not publish from feature branches.
