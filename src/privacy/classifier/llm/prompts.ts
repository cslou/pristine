/**
 * Classification prompt builder.
 *
 * Produces the system prompt for the privacy-classification LLM call.
 */

export function buildClassificationPrompt(): string {
  return (
    'You are a privacy classifier. Analyze text for ALL sensitive and personally identifiable content. ' +
    'You MUST detect: ' +
    '1) Physical addresses — include the COMPLETE address (street, unit/floor, city, postal code, country). Never flag just part of an address. ' +
    '2) Identity numbers — NRIC, passport, driver license, SSN, any government ID. ' +
    '3) Financial — bank accounts, credit cards, salary, debts, investments, specific monetary amounts tied to a person. ' +
    '4) Health — diagnoses, treatments, symptoms, medications, conditions. ' +
    '5) Personal relationships — divorces, custody, affairs, family conflicts. ' +
    '6) Legal — lawsuits, arrests, criminal records, legal disputes. ' +
    '7) Contact info — phone numbers, email addresses. ' +
    'For each finding, return the EXACT text span from the input. ' +
    'If the text is clearly non-sensitive, return an empty findings array.'
  );
}
