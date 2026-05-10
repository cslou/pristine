# Repository Secret Audit — Sprint 025

**Commit scanned:** 83b990073bc60f92698dbc841595ab18a89a315a
**Reachable commits scanned:** 912
**Current findings:** 34
**History findings:** 85
**Unresolved findings:** 0

## Commands

- `node scripts/audit-repository-secrets.mjs --output docs/security-audits/2026-05-10-sprint-025-history-audit.md`

## Current tree findings

- False positive | WORKTREE | benchmarks/memorybench/data/benchmarks/locomo/locomo10.json:13578 | "https://get.pxhere.com/photo/beach-landscape-sea-coast-water-sand-ocean-horizon-cloud-sky-sun-sunrise-sunset-shore-wave-dawn-dusk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-
- False positive | WORKTREE | docs/specs/implementation-spec-004.md:678 | "command": "curl -H 'Authorization: Bearer sk-ant-api03-real-secret-value' https://api.example.com",
- False positive | WORKTREE | tests/classifier/deterministic-classifier.test.ts:36 | 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ.',
- False positive | WORKTREE | tests/classifier/deterministic-classifier.test.ts:48 | '-----BEGIN PRIVATE KEY-----',
- False positive | WORKTREE | tests/classifier/deterministic-classifier.test.ts:364 | const text = 'Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 ok';
- False positive | WORKTREE | tests/classifier/deterministic-classifier.test.ts:369 | 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | WORKTREE | tests/client.test.ts:496 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | WORKTREE | tests/client.test.ts:500 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | WORKTREE | tests/e2e/privacy-pipeline.test.ts:42 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/e2e/privacy-pipeline.test.ts:44 | 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | WORKTREE | tests/e2e/privacy-pipeline.test.ts:75 | await secureAndRedact('API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456', {
- False positive | WORKTREE | tests/e2e/privacy-pipeline.test.ts:97 | await secureAndRedact('API key sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456', {
- False positive | WORKTREE | tests/e2e/privacy-pipeline.test.ts:120 | const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 for John.';
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:47 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:49 | 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:93 | const apiKey = 'sk-ant-api03-preabcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:133 | const beforeKey = 'sk-ant-api03-beforeabcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:134 | const afterKey = 'sk-ant-api03-afterabcdefghijklmnopqrstuvwxyz1234567';
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:184 | 'sk-ant-api03-alphaabcdefghijklmnopqrstuvwxyz123456',
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:185 | 'sk-ant-api03-bravoabcdefghijklmnopqrstuvwxyz123456',
- False positive | WORKTREE | tests/integration/kek-lifecycle.test.ts:186 | 'sk-ant-api03-charlieabcdefghijklmnopqrstuvwxyz123456',
- False positive | WORKTREE | tests/integration/privacy.test.ts:41 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/integration/privacy.test.ts:43 | 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | WORKTREE | tests/integration/privacy.test.ts:102 | const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/integration/privacy.test.ts:140 | 'Contact alice@example.com or [SENSITIVE:phone_number:def-456] and sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456.';
- False positive | WORKTREE | tests/integration/privacy.test.ts:303 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/privacy/keys/filesystem.test.ts:52 | expect(result.privateKey).toContain('BEGIN PRIVATE KEY');
- False positive | WORKTREE | tests/privacy/rotation.test.ts:44 | const apiKey = 'sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/privacy/rotation.test.ts:74 | const apiKey = 'sk-ant-api03-afterrotateabcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/privacy/rotation.test.ts:99 | const apiKey = 'sk-ant-api03-multirotateabcdefghijklmnopqrstuvwxyz123456';
- False positive | WORKTREE | tests/privacy/safety-scan.test.ts:23 | 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef and password=correct-horse-battery.';
- False positive | WORKTREE | tests/privacy/safety-scan.test.ts:35 | '-----BEGIN PRIVATE KEY-----',
- False positive | WORKTREE | tests/privacy/safety-scan.test.ts:64 | 'Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef and password=correct-horse-battery';
- False positive | WORKTREE | tests/vault/asymmetric-crypto.test.ts:39 | expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);

## Reachable history findings

- False positive | 14a602ae836f | benchmarks/memorybench/data/benchmarks/locomo/locomo10.json:13578 | "https://get.pxhere.com/photo/beach-landscape-sea-coast-water-sand-ocean-horizon-cloud-sky-sun-sunrise-sunset-shore-wave-dawn-dusk-evening-relax-paradise-tropical-peaceful-blue-colorful-body-of-water-
- False positive | 0384cd2597f4 | docs/specs/implementation-spec-004.md:678 | "command": "curl -H 'Authorization: Bearer sk-ant-api03-real-secret-value' https://api.example.com",
- False positive | 432e9c81c773 | tests/classifier/deterministic-classifier.test.ts:36 | 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ.',
- False positive | 432e9c81c773 | tests/classifier/deterministic-classifier.test.ts:48 | '-----BEGIN PRIVATE KEY-----',
- False positive | fcd92e7ae7c7 | tests/classifier/deterministic-classifier.test.ts:364 | const text = 'Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 ok';
- False positive | fcd92e7ae7c7 | tests/classifier/deterministic-classifier.test.ts:369 | 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | 4b342db1fab1 | tests/client.test.ts:496 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | 4b342db1fab1 | tests/client.test.ts:500 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | fcd92e7ae7c7 | tests/e2e/privacy-pipeline.test.ts:42 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | fcd92e7ae7c7 | tests/e2e/privacy-pipeline.test.ts:44 | 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | fcd92e7ae7c7 | tests/e2e/privacy-pipeline.test.ts:75 | await secureAndRedact('API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456', {
- False positive | fcd92e7ae7c7 | tests/e2e/privacy-pipeline.test.ts:97 | await secureAndRedact('API key sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456', {
- False positive | fcd92e7ae7c7 | tests/e2e/privacy-pipeline.test.ts:120 | const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 for John.';
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:47 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:49 | 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:93 | const apiKey = 'sk-ant-api03-preabcdefghijklmnopqrstuvwxyz123456';
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:133 | const beforeKey = 'sk-ant-api03-beforeabcdefghijklmnopqrstuvwxyz123456';
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:134 | const afterKey = 'sk-ant-api03-afterabcdefghijklmnopqrstuvwxyz1234567';
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:184 | 'sk-ant-api03-alphaabcdefghijklmnopqrstuvwxyz123456',
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:185 | 'sk-ant-api03-bravoabcdefghijklmnopqrstuvwxyz123456',
- False positive | 0384cd2597f4 | tests/integration/kek-lifecycle.test.ts:186 | 'sk-ant-api03-charlieabcdefghijklmnopqrstuvwxyz123456',
- False positive | 0384cd2597f4 | tests/integration/privacy.test.ts:41 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | 0384cd2597f4 | tests/integration/privacy.test.ts:43 | 'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | 0384cd2597f4 | tests/integration/privacy.test.ts:102 | const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | 0384cd2597f4 | tests/integration/privacy.test.ts:140 | 'Contact alice@example.com or [SENSITIVE:phone_number:def-456] and sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456.';
- False positive | fcd92e7ae7c7 | tests/integration/privacy.test.ts:303 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | d2cdef9a4513 | tests/privacy/keys/filesystem.test.ts:52 | expect(result.privateKey).toContain('BEGIN PRIVATE KEY');
- False positive | fcd92e7ae7c7 | tests/privacy/rotation.test.ts:44 | const apiKey = 'sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456';
- False positive | fcd92e7ae7c7 | tests/privacy/rotation.test.ts:74 | const apiKey = 'sk-ant-api03-afterrotateabcdefghijklmnopqrstuvwxyz123456';
- False positive | fcd92e7ae7c7 | tests/privacy/rotation.test.ts:99 | const apiKey = 'sk-ant-api03-multirotateabcdefghijklmnopqrstuvwxyz123456';
- False positive | fcd92e7ae7c7 | tests/privacy/safety-scan.test.ts:23 | 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef and password=correct-horse-battery.';
- False positive | fcd92e7ae7c7 | tests/privacy/safety-scan.test.ts:35 | '-----BEGIN PRIVATE KEY-----',
- False positive | fcd92e7ae7c7 | tests/privacy/safety-scan.test.ts:64 | 'Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef and password=correct-horse-battery';
- False positive | 8753a5d15ba7 | tests/vault/asymmetric-crypto.test.ts:39 | expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
- False positive | 0f3e8b0360b0 | README.md:103 | 'Deploy with token sk-ant-example-secret-token-value',
- False positive | 3a3e2b349b5d | README.md:101 | 'Deploy with token sk-ant-example-secret-token-value',
- False positive | a442e33f01b9 | tests/client.test.ts:463 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | a442e33f01b9 | tests/client.test.ts:467 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | c5c5697e35cd | tests/client.test.ts:431 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | c5c5697e35cd | tests/client.test.ts:435 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | bf70a4ece727 | tests/client.test.ts:280 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | bf70a4ece727 | tests/client.test.ts:284 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | 7a871a966a6c | tests/client.test.ts:254 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | 7a871a966a6c | tests/client.test.ts:258 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | 1085833a0cbf | tests/client.test.ts:253 | 'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | 1085833a0cbf | tests/client.test.ts:257 | expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
- False positive | 4f866c2d265c | tests/client.test.ts:398 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | 4f866c2d265c | tests/client.test.ts:412 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | eba312b27236 | tests/client.test.ts:376 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | eba312b27236 | tests/client.test.ts:390 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | 6175793e8861 | tests/client.test.ts:282 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | 6175793e8861 | tests/client.test.ts:296 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | 570d379081cd | tests/client.test.ts:248 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | 570d379081cd | tests/client.test.ts:262 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | b60e9ba76806 | tests/client.test.ts:219 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | b60e9ba76806 | tests/client.test.ts:233 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | 623a94098b32 | tests/client.test.ts:127 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | 623a94098b32 | tests/client.test.ts:141 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | f901fd9be096 | tests/client.test.ts:161 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | f901fd9be096 | tests/client.test.ts:175 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | 4f5b27829251 | tests/client.test.ts:126 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | 4f5b27829251 | tests/client.test.ts:140 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | aa8b8fd2a4f6 | tests/client.test.ts:162 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | aa8b8fd2a4f6 | tests/client.test.ts:176 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | a727d966ce3a | tests/client.test.ts:149 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | a727d966ce3a | tests/client.test.ts:163 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | eef1b7f6fa76 | tests/client.test.ts:164 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | eef1b7f6fa76 | tests/client.test.ts:178 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | 19e51413cf96 | docs/specs/implementation-spec-004.md:613 | "command": "curl -H 'Authorization: Bearer sk-ant-api03-real-secret-value' https://api.example.com",
- False positive | 432e9c81c773 | tests/classifier/deterministic-classifier.test.ts:232 | const text = 'Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 ok';
- False positive | 432e9c81c773 | tests/classifier/deterministic-classifier.test.ts:237 | 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
- False positive | 432e9c81c773 | tests/e2e/privacy-pipeline.test.ts:128 | const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 for John.';
- False positive | 0384cd2597f4 | tests/integration/privacy.test.ts:232 | const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
- False positive | 432e9c81c773 | tests/privacy/safety-scan.test.ts:22 | 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.';
- False positive | 432e9c81c773 | tests/privacy/safety-scan.test.ts:30 | '-----BEGIN PRIVATE KEY-----',
- False positive | 432e9c81c773 | tests/privacy/safety-scan.test.ts:59 | 'Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
- False positive | 432e9c81c773 | docs/specs/implementation-spec-004.md:675 | "command": "curl -H 'Authorization: Bearer sk-ant-api03-real-secret-value' https://api.example.com",
- False positive | 432e9c81c773 | tests/classifier/combined-classifier.test.ts:152 | const report = await classifier.classify('Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | 432e9c81c773 | tests/classifier/combined-classifier.test.ts:169 | classifier.classify('Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456'),
- False positive | 432e9c81c773 | tests/integration/privacy.test.ts:170 | 'Contact alice@example.com or [SENSITIVE:phone_number:def-456] and sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456.';
- False positive | fcd92e7ae7c7 | tests/e2e/sdk.test.ts:124 | const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
- False positive | fcd92e7ae7c7 | tests/e2e/sdk.test.ts:140 | expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
- False positive | b062f63cd453 | tests/privacy/keys/filesystem.test.ts:51 | expect(result.privateKey).toContain('BEGIN PRIVATE KEY');
- False positive | 6fe7a9c0fc18 | docs/specs/implementation-spec-004.md:612 | "command": "curl -H 'Authorization: Bearer sk-ant-api03-real-secret-value' https://api.example.com",
- False positive | 951581c68110 | tests/privacy/keys/filesystem.test.ts:41 | expect(result.privateKey).toContain('BEGIN PRIVATE KEY');

## Remediation status

- No unresolved secret findings. Findings above, if any, are documented placeholders or synthetic examples, not credentials.
