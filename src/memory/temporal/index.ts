import type { Fact, TemporalConfidence, TemporalValidationOptions } from '../../core/types.js';

const DEFAULT_MINIMUM_DATE = '1900-01-01T00:00:00.000Z';
const FUTURE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

const isValidIsoDate = (value: string): boolean => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  // Date.parse silently accepts impossible dates (e.g. Feb 29 in non-leap years)
  // by rolling forward. Round-trip through ISO string to catch these.
  // Only reliable for UTC timestamps (Z-suffix); non-UTC offsets that cross a
  // date boundary may produce false negatives. LLM extraction always emits UTC.
  const d = new Date(value);
  return d.toISOString().startsWith(value.slice(0, 10));
};

const isBeforeMinimum = (value: string, minimumDate: string): boolean => {
  return new Date(value).getTime() < new Date(minimumDate).getTime();
};

const isSuspiciousFuture = (
  value: string,
  referenceTimestamp: string,
  confidence: TemporalConfidence | undefined,
): boolean => {
  if (confidence === 'explicit' || confidence === 'inferred') {
    return false;
  }

  const refTime = new Date(referenceTimestamp).getTime();
  const valueTime = new Date(value).getTime();
  return valueTime > refTime + FUTURE_THRESHOLD_MS;
};

export function validateTemporalFields(fact: Fact, options: TemporalValidationOptions): Fact {
  const minimumDate = options.minimumDate ?? DEFAULT_MINIMUM_DATE;
  let validFrom = fact.validFrom;
  let validUntil = fact.validUntil;
  let confidence = fact.temporalConfidence;
  let needsImpliedFlag = false;
  const hadTemporalInput = fact.validFrom !== undefined || fact.validUntil !== undefined;
  let wasInvalidated = false;

  // Validate validFrom
  if (typeof validFrom === 'string') {
    if (!isValidIsoDate(validFrom)) {
      validFrom = undefined;
      confidence = 'none';
      wasInvalidated = true;
    } else if (isBeforeMinimum(validFrom, minimumDate)) {
      validFrom = undefined;
      confidence = 'none';
      wasInvalidated = true;
    } else if (isSuspiciousFuture(validFrom, options.referenceTimestamp, confidence)) {
      validFrom = undefined;
      confidence = 'none';
      wasInvalidated = true;
    }
  }

  // Validate validUntil
  if (typeof validUntil === 'string') {
    if (!isValidIsoDate(validUntil)) {
      validUntil = undefined;
      confidence = 'none';
      wasInvalidated = true;
    } else if (isBeforeMinimum(validUntil, minimumDate)) {
      validUntil = undefined;
      confidence = 'none';
      wasInvalidated = true;
    }
  }

  // Apply confidence policies
  if (confidence === 'implied') {
    needsImpliedFlag = true;
  }

  if (confidence === 'none' || confidence === undefined) {
    // Default validFrom to referenceTimestamp only when the fact had no temporal
    // input at all (not when we invalidated bad dates — those should stay nullified)
    if (
      !hadTemporalInput &&
      !wasInvalidated &&
      validFrom === undefined &&
      validUntil === undefined
    ) {
      validFrom = options.referenceTimestamp;
    }
    confidence = 'none';
  }

  const metadata = needsImpliedFlag ? { ...fact.metadata, temporal_implied: true } : fact.metadata;

  return {
    ...fact,
    validFrom,
    validUntil,
    temporalConfidence: confidence,
    metadata,
  };
}

export * from './types.js';
