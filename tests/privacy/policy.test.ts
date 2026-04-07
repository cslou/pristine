import { describe, expect, it } from 'vitest';
import { applyPrivacyPolicy } from '../../src/privacy/policy.js';
import type { SensitivityReport } from '../../src/core/types.js';

const makeReport = (type: string, text: string, start: number, end: number): SensitivityReport => ({
  entities: [{ type, text, start, end, source: 'llm', confidence: 0.9 }],
  hasSensitiveContent: true,
});

describe('privacy policy', () => {
  it('suppresses non-sensitive travel scheduling text', () => {
    const text = 'Itinerary update: next Tuesday departure is at 9am from Terminal 2.';
    const report = makeReport('travel_date', 'next Tuesday departure is at 9am', 18, 51);

    const filtered = applyPrivacyPolicy(text, report);

    expect(filtered.entities).toHaveLength(0);
    expect(filtered.hasSensitiveContent).toBe(false);
  });

  it('keeps health-related findings even when they mention dates', () => {
    const text = 'Medical update: diagnosed with diabetes on March 10 after lab work.';
    const report = makeReport('health', 'diagnosed with diabetes on March 10', 16, 51);

    const filtered = applyPrivacyPolicy(text, report);

    expect(filtered.entities).toHaveLength(1);
    expect(filtered.hasSensitiveContent).toBe(true);
  });

  it('suppresses vague physical addresses without address context', () => {
    const text = 'Meet me near Main Street later.';
    const report = makeReport('physical_address', 'Main Street', 13, 24);

    const filtered = applyPrivacyPolicy(text, report);

    expect(filtered.entities).toHaveLength(0);
  });

  it('keeps DOB-related findings based on wider context windows', () => {
    const prefix = 'Notes: '.padEnd(170, 'x');
    const text = `${prefix}date of birth: 1990-01-01 was entered yesterday.`;
    const start = text.indexOf('1990-01-01');
    const end = start + '1990-01-01'.length;
    const report = makeReport('other', '1990-01-01', start, end);

    const filtered = applyPrivacyPolicy(text, report);

    expect(filtered.entities).toHaveLength(1);
  });
});
