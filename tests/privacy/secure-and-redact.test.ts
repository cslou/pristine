import { describe, expect, it, vi } from 'vitest';
import { secureAndRedact } from '../../src/privacy/index.js';
import type { KeyManager, PrivacyPipeline, VaultStore } from '../../src/core/interfaces.js';
import type { ClassificationPipelineResult } from '../../src/core/types.js';
import type { KekManager } from '../../src/privacy/kek/kek-manager.js';

const unusedVaultStore = {
  addEntries: vi.fn(),
  getEntriesByPlaceholderIds: vi.fn(),
  deleteEntriesByMemoryId: vi.fn(),
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
  it('returns a structured blocked result for ungroundable LLM findings', async () => {
    const pipeline: PrivacyPipeline = {
      classifyAndRedact: vi.fn<PrivacyPipeline['classifyAndRedact']>().mockResolvedValue({
        report: {
          entities: [],
          hasSensitiveContent: false,
          warnings: ['Classification blocked: Ungroundable LLM finding for type "health".'],
        },
        redaction: null,
        safetyViolations: [],
        blockedReason: 'ungroundable_llm_finding',
        blockedWarnings: ['Classification blocked: Ungroundable LLM finding for type "health".'],
      } satisfies ClassificationPipelineResult),
    };

    const result = await secureAndRedact('Different text entirely.', {
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
    expect(result.reason).toBe('ungroundable_llm_finding');
    expect(result.redactedText).toBe('Different text entirely.');
    expect(result.safetyViolations).toEqual([]);
    expect(result.warnings).toEqual([
      'Classification blocked: Ungroundable LLM finding for type "health".',
    ]);
    expect(unusedVaultStore.addEntries).not.toHaveBeenCalled();
    expect(unusedKeyManager.getOrCreateKeyPair).not.toHaveBeenCalled();
  });
});
