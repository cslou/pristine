import { describe, expect, it, vi } from 'vitest';
import { secureAndRedact } from '../../src/privacy/index.js';
import type { KeyManager, PrivacyPipeline, VaultStore } from '../../src/core/interfaces.js';
import type { ClassificationPipelineResult } from '../../src/core/types.js';
import type { KekManager } from '../../src/privacy/kek/kek-manager.js';

const unusedVaultStore = {
  addEntries: vi.fn(),
  getEntriesByPlaceholderIds: vi.fn(),
} satisfies VaultStore;

const unusedKeyManager = {
  getOrCreateKeyPair: vi.fn(),
  saveKeyPair: vi.fn(),
} satisfies KeyManager;

const unusedKekManager = {
  getOrCreate: vi.fn(),
  rotate: vi.fn(),
  clearCache: vi.fn(),
} as unknown as KekManager;

describe('secureAndRedact blocked results', () => {
  it('returns a structured blocked result for safety-scan survivors', async () => {
    const pipeline: PrivacyPipeline = {
      classifyAndRedact: vi.fn<PrivacyPipeline['classifyAndRedact']>().mockResolvedValue({
        report: {
          entities: [],
          hasSensitiveContent: false,
        },
        redaction: null,
        safetyViolations: [
          {
            type: 'email_address',
            source: 'deterministic',
            confidence: 0.99,
            start: 12,
            end: 29,
            text: 'alice@example.com',
          },
        ],
      } satisfies ClassificationPipelineResult),
    };

    const result = await secureAndRedact('Reach me at alice@example.com', {
      pipeline,
      vaultStore: unusedVaultStore,
      keyManager: unusedKeyManager,
      kekManager: unusedKekManager,
      userId: 'user-blocked-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected blocked privacy result');
    }
    expect(result.reason).toBe('safety_scan');
    expect(result.redactedText).toBe('Reach me at alice@example.com');
    expect(result.safetyViolations).toHaveLength(1);
    expect(result.safetyViolations[0]!.type).toBe('email_address');
    expect(result.warnings).toBeUndefined();
    expect(unusedVaultStore.addEntries).not.toHaveBeenCalled();
    expect(unusedKeyManager.getOrCreateKeyPair).not.toHaveBeenCalled();
  });
});
