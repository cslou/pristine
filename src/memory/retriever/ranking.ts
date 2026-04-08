import type { Memory, TemporalMode } from '../../core/types.js';

/** Boost for facts that are currently valid (validUntil is undefined) in full mode */
export const CURRENT_FACT_BOOST = 0.05;

/** Max boost for recency (scales linearly, newer = higher) */
export const RECENCY_MAX_BOOST = 0.02;

/** Max age for recency normalization (2 years in milliseconds) */
export const RECENCY_MAX_AGE_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

/** Confidence boost for validFrom present without temporal_implied flag */
export const CONFIDENCE_BOOST_INFERRED = 0.007;

/** Confidence boost for implied confidence (temporal_implied metadata flag) */
export const CONFIDENCE_BOOST_IMPLIED = 0.003;

export function currentFactBoost(memory: Memory, temporalMode: TemporalMode): number {
  if (temporalMode !== 'full') return 0;
  return memory.validUntil === undefined ? CURRENT_FACT_BOOST : 0;
}

export function recencyBoost(memory: Memory, now: number): number {
  if (!memory.validFrom) return 0;
  const validFromMs = Date.parse(memory.validFrom);
  if (Number.isNaN(validFromMs)) return 0;
  const age = Math.max(0, now - validFromMs);
  const normalized = 1 - Math.min(age / RECENCY_MAX_AGE_MS, 1);
  return normalized * RECENCY_MAX_BOOST;
}

export function confidenceBoost(memory: Memory): number {
  if (!memory.metadata) return 0;
  if (memory.metadata.temporal_implied === true) return CONFIDENCE_BOOST_IMPLIED;
  if (memory.validFrom !== undefined) return CONFIDENCE_BOOST_INFERRED;
  return 0;
}

export function applyTemporalBoosts(
  memory: Memory,
  baseScore: number,
  temporalMode: TemporalMode,
  now: number,
): number {
  return (
    baseScore +
    currentFactBoost(memory, temporalMode) +
    recencyBoost(memory, now) +
    confidenceBoost(memory)
  );
}
