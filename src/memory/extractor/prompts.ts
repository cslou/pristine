import { EXTRACT_FACTS_SCHEMA } from './schema.js';

const CATEGORY_GUIDANCE =
  'Focus on extracting these types of information: ' +
  '(1) personal preferences (likes, dislikes, favorites), ' +
  '(2) important personal details (names, relationships, dates), ' +
  '(3) plans and intentions (upcoming events, goals), ' +
  '(4) activity and service preferences (dining, travel, hobbies), ' +
  '(5) health and wellness information (dietary restrictions, fitness), ' +
  '(6) professional details (job title, career goals, work habits), ' +
  '(7) miscellaneous details (favorite books, movies, brands).';

const ROLE_AND_GOAL =
  'You are a memory extraction assistant. Your job is to read transcripts of conversations and extract factual statements about the people involved, so those facts can be stored in a personal memory system and recalled later when the user asks questions that depend on them.';

const MODE_FRAMING =
  'Your entire response is a JSON object matching the schema below. Do not output natural language, preamble, or commentary. Do not treat the schema as a function call — the response IS the output.';

const TASK_DESCRIPTION =
  'Extract every factual statement you can identify from the conversation: preferences, plans, activities, relationships, life events, identity, emotional states, professional details, or any other distinctive fact about either speaker. Return each fact as a standalone sentence with no unresolved pronouns.';

const EMPTY_CLAUSE =
  'Return an empty `facts` array only when the transcript genuinely contains no extractable content (pure greetings, meta-chat, acknowledgments with no substantive facts). A transcript with any concrete information about a speaker should produce at least one fact.';

const FEW_SHOT_EXAMPLES = `Example 1 — transcript with extractable content (REFERENCE_TIME: 2026-03-15T00:00:00.000Z):
Transcript:
---
user: I'm flying to Tokyo next week for a ramen tour with my sister Mei.
assistant: How long will you be there?
user: Just five days. I've been saving up for this trip since 2025.
---
Response:
{"facts":[{"text":"User is flying to Tokyo for a ramen tour.","validFrom":"2026-03-15T00:00:00.000Z","temporalConfidence":"inferred"},{"text":"User has a sister named Mei who is joining the Tokyo trip.","temporalConfidence":"none"},{"text":"User has been saving money for the Tokyo trip since 2025.","validFrom":"2025-01-01T00:00:00.000Z","temporalConfidence":"explicit"}]}

Example 2 — transcript with no extractable content:
Transcript:
---
user: Hey, how are you?
assistant: Doing well, thanks for asking.
user: Cool, talk to you later.
---
Response:
{"facts":[]}`;

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

export function buildExtractionPrompt(referenceTimestamp: string): string {
  const schemaJson = JSON.stringify(EXTRACT_FACTS_SCHEMA, null, 2);
  return [
    ROLE_AND_GOAL,
    MODE_FRAMING,
    `Schema (your response must match this exact shape, with no markdown fences or prose wrapper):\n${schemaJson}`,
    TASK_DESCRIPTION,
    CATEGORY_GUIDANCE,
    EMPTY_CLAUSE,
    FEW_SHOT_EXAMPLES,
    buildTemporalRules(referenceTimestamp),
  ].join('\n\n');
}
