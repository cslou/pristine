const SENSITIVE_PLACEHOLDER_RULES =
  'CRITICAL: If the text contains [SENSITIVE:type:id] placeholders, you MUST preserve them EXACTLY as-is in your extracted facts. ' +
  'Do NOT summarize, paraphrase, or remove these placeholders. They are redacted sensitive values that must pass through unchanged. ' +
  "Example input: \"User's NRIC is [SENSITIVE:identity_number:abc-123]\" -> Output fact: \"The user's NRIC is [SENSITIVE:identity_number:abc-123].\"";

const CATEGORY_GUIDANCE =
  'Focus on extracting these types of information: ' +
  '(1) personal preferences (likes, dislikes, favorites), ' +
  '(2) important personal details (names, relationships, dates), ' +
  '(3) plans and intentions (upcoming events, goals), ' +
  '(4) activity and service preferences (dining, travel, hobbies), ' +
  '(5) health and wellness information (dietary restrictions, fitness), ' +
  '(6) professional details (job title, career goals, work habits), ' +
  '(7) miscellaneous details (favorite books, movies, brands).';

const buildTemporalRules = (referenceTimestamp: string): string =>
  `TEMPORAL EXTRACTION RULES:
For each fact, detect temporal signals and set validFrom, validUntil, and temporalConfidence accordingly.

REFERENCE_TIME: ${referenceTimestamp}

DATETIME RULES:
- Use ISO 8601 with UTC (Z suffix): 2026-01-15T00:00:00.000Z
- If only a date is mentioned, assume 00:00:00 UTC
- If only a year is mentioned, use January 1st at 00:00:00 UTC
- Ongoing/present-tense facts: set validFrom = REFERENCE_TIME
- Leave both validFrom and validUntil null if no temporal signal is detectable

TEMPORAL SIGNAL TYPES:
1. Absolute dates: "started in January 2026", "born on April 5, 1990"
   -> Set validFrom to the stated date. temporalConfidence = "explicit"
2. Relative dates: "last month", "two weeks ago", "recently"
   -> Resolve relative to REFERENCE_TIME. temporalConfidence = "inferred"
3. State changes: "just got promoted", "moved to London", "switched to tea"
   -> Set validFrom ~ REFERENCE_TIME. temporalConfidence = "implied"
4. Duration: "for three years", "since college"
   -> Calculate validFrom = REFERENCE_TIME minus duration. temporalConfidence = "inferred"
5. Implicit past: "used to", "no longer", "before the merger"
   -> Set validUntil ~ REFERENCE_TIME (fact is no longer true). temporalConfidence = "implied"

CONFIDENCE LEVELS:
- "explicit": date/time stated directly in the text
- "inferred": resolved from a relative expression + REFERENCE_TIME
- "implied": deduced from language patterns (less precise)
- "none": no temporal signal detected (omit validFrom/validUntil)

If temporal extraction is ambiguous or contradictory, set temporalConfidence = "none" and omit dates. Do not guess.`;

export function buildExtractionPrompt(referenceTimestamp?: string): string {
  const effectiveTimestamp = referenceTimestamp ?? new Date().toISOString();

  return (
    'Extract factual statements from the conversation. Return each fact as a standalone sentence with no unresolved pronouns. ' +
    SENSITIVE_PLACEHOLDER_RULES +
    ' ' +
    CATEGORY_GUIDANCE +
    '\n\n' +
    buildTemporalRules(effectiveTimestamp)
  );
}
