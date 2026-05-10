# Release Checklist

This checklist prepares a public alpha package. It does not publish the package by itself.

## Owner commands

1. Install from a clean lockfile:

   ```bash
   npm ci
   ```

2. Build and type-check:

   ```bash
   npm run build
   npm run typecheck
   ```

3. Run deterministic quality gates:

   ```bash
   npm run lint
   npm run test:unit
   npm run test:smoke
   SKIP_SLOW_TESTS=1 npm run test:integration
   npm run test:e2e
   npm run verify:docs
   npm run verify:package
   ```

4. Run full maintainer regression when local model checks are required:

   ```bash
   .checks/regression.sh --tier=full
   ```

5. Re-run dependency and repository disclosure checks:

   ```bash
   npm audit --omit=dev
   node scripts/audit-repository-secrets.mjs --output docs/security-audits/2026-05-10-sprint-025-history-audit.md
   ```

6. Confirm the package artifact is clean:

   ```bash
   npm run verify:package
   npm pack --dry-run
   ```

## Manual release gates

- Review `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, and `docs/public-api.md` for public accuracy.
- Confirm GitHub's deterministic public gate passed on the release candidate branch.
- Confirm repository secret/history audit reports `0` unresolved findings or explicitly blocks release until Lou records an accepted resolution.
- Confirm no new dependency or native package was added without an explicit rationale.
- Confirm npm provenance/trusted publishing is configured before any real publish. Prefer npm trusted publishing from GitHub Actions over local token publishing.
- Confirm npm account/package permissions, 2FA policy, and provenance expectations with Lou before publishing.

## Out of scope for Sprint 025

- Running `npm publish`.
- Creating production credentials or npm automation tokens.
- Making the repository public before Lou explicitly approves the final sprint-integration PR and release step.
