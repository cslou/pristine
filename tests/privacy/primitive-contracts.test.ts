import { describe, expect, it } from 'vitest';
import type {
  ClassifierRequest,
  ClassifierRequestCandidate,
  DetectCandidate,
  RedactResult,
  SourceSpan,
} from '../../src/core/types.js';

type Expect<T extends true> = T;
type HasNoKeys<T, K extends PropertyKey> = Extract<keyof T, K> extends never ? true : false;

const detectCandidateHasNoRawFields: Expect<
  HasNoKeys<DetectCandidate, 'rawValue' | 'text' | 'matchedText' | 'value'>
> = true;
const classifierCandidateHasNoRawFields: Expect<
  HasNoKeys<ClassifierRequestCandidate, 'rawValue' | 'text' | 'matchedText' | 'value'>
> = true;
const classifierRequestHasNoRawSecretFields: Expect<
  HasNoKeys<ClassifierRequest, 'rawValue' | 'rawText' | 'text' | 'matchedText'>
> = true;

describe('privacy primitive contracts', () => {
  it('defines detector candidates with sourceSpan and safe hint metadata only', () => {
    const sourceSpan: SourceSpan = { start: 12, end: 46 };
    const candidate: DetectCandidate = {
      candidateId: 'candidate-1',
      kind: 'known_provider_prefix',
      ruleId: 'provider.openai.project-key',
      sourceSpan,
      valueLength: 34,
      location: { line: 1, column: 13 },
      hint: {
        suggestedType: 'api_key',
        provider: 'openai',
        prefixFamily: 'sk-proj',
        nearbyName: 'OPENAI_API_KEY',
        signals: ['known_provider_prefix'],
        positiveSignals: ['known_provider_prefix', 'sensitive_key_name'],
        negativeSignals: [],
        features: { hasAssignmentContext: true, entropyBucket: 'high' },
      },
    };

    expect(candidate.sourceSpan).toEqual(sourceSpan);
    expect(candidate.hint?.prefixFamily).toBe('sk-proj');
    expect(candidate.hint?.features).toMatchObject({ hasAssignmentContext: true });
    expect(candidate).not.toHaveProperty('rawValue');
    expect(candidate).not.toHaveProperty('text');
  });

  it('defines classifier requests around sanitized context and candidate markers', () => {
    const requestCandidate: ClassifierRequestCandidate = {
      candidateId: 'candidate-1',
      marker: '[CANDIDATE:candidate-1]',
      kind: 'auth_header',
      ruleId: 'header.authorization.bearer',
      sourceSpan: { start: 22, end: 58 },
      valueLength: 36,
      location: { line: 3, column: 23 },
      hint: {
        suggestedType: 'auth_token',
        provider: 'github',
        prefixFamily: 'ghp_',
        positiveSignals: ['auth_header_context'],
        negativeSignals: ['looks_like_example'],
        features: { headerName: 'authorization' },
      },
    };
    const request: ClassifierRequest = {
      requestId: 'request-1',
      sourceSurface: { kind: 'user_message', uri: 'session://local' },
      sanitizedContext: 'Authorization: Bearer [CANDIDATE:candidate-1]',
      candidates: [requestCandidate],
    };

    expect(request.sanitizedContext).toContain('[CANDIDATE:candidate-1]');
    expect(request.candidates[0]?.sourceSpan).toEqual({ start: 22, end: 58 });
    expect(request.candidates[0]?.hint?.positiveSignals).toContain('auth_header_context');
    expect(request).not.toHaveProperty('rawValue');
    expect(request).not.toHaveProperty('text');
    expect(request.candidates[0]).not.toHaveProperty('rawValue');
    expect(request.candidates[0]).not.toHaveProperty('text');
  });

  it('defines redaction results with sensitiveRef, sourceSpan, and redactedSpan names', () => {
    const result: RedactResult = {
      text: 'Token [SENSITIVE:api_key:ref-1]',
      redactions: [
        {
          candidateId: 'candidate-1',
          sensitiveRef: 'ref-1',
          placeholder: '[SENSITIVE:api_key:ref-1]',
          type: 'api_key',
          label: 'primary API key',
          alias: 'primary API key',
          sourceSpan: { start: 6, end: 40 },
          redactedSpan: { start: 6, end: 31 },
        },
      ],
    };

    expect(result.redactions[0]?.sensitiveRef).toBe('ref-1');
    expect(result.redactions[0]?.sourceSpan).toEqual({ start: 6, end: 40 });
    expect(result.redactions[0]?.redactedSpan).toEqual({ start: 6, end: 31 });
    expect(result.redactions[0]).not.toHaveProperty('rawValue');
    expect(result.redactions[0]).not.toHaveProperty('text');
  });

  it('keeps compile-time raw-field guards live', () => {
    expect(detectCandidateHasNoRawFields).toBe(true);
    expect(classifierCandidateHasNoRawFields).toBe(true);
    expect(classifierRequestHasNoRawSecretFields).toBe(true);
  });
});
