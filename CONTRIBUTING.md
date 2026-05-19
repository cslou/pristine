# Contributing

Thanks for helping improve Pristine. This repository is a local-first TypeScript SDK; changes should keep user data on device by default and preserve the public API boundary documented in the README and `docs/pages/api.mdx`.

## Setup

```bash
git clone https://github.com/getlou-gh/pristine.git
cd pristine
pnpm install --frozen-lockfile
pnpm run build
```

Requirements:

- Node.js 22 or newer.
- Native install support for `better-sqlite3` and `sqlite-vec` on your platform.
- No hosted API credentials are required for the default test suite.

## Local verification

Run the smallest relevant checks while developing, then run the broader gate before opening or updating a PR:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:smoke
SKIP_SLOW_TESTS=1 pnpm run test:integration
pnpm run test:e2e
pnpm run docs:build
pnpm run verify:package
```

Maintainers use the local regression wrapper when preparing merges/releases:

```bash
.checks/pre-merge.sh
```

## Slow and local-model tests

- `SKIP_SLOW_TESTS=1 pnpm run test:integration` runs deterministic integration coverage and skips local-model checks.
- `pnpm run test:integration` may run local model integration tests when the model cache is available.
- `pnpm run test:smoke:local-model` runs optional smoke coverage against the default local embedder. It may download or load model assets and is intended for maintainer/full-tier verification, not default CI.
- `.checks/regression.sh --tier=full` is the maintainer full regression path and may load local models.

## Secret audits

Secret-audit helper scripts are maintainer-local and ignored by the public repository. Before release-sensitive changes, run a local secret scanner or maintainer-local audit script against the working tree and Git history; do not commit the scanner script, generated reports, credentials, tokens, or private keys.

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
pnpm run docs:build
pnpm run verify:package
.checks/pre-merge.sh
```

`docs:build` validates the Vocs documentation site. `verify:package` builds the package and checks the clean package artifact contents. Do not publish from feature branches.
