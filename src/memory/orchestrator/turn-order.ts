import { TurnOrderViolationError } from '../../core/errors.js';

export const CANONICAL_TURN_ORDER = Object.freeze([
  'store(user)',
  'search',
  'LLM',
  'store(assistant_pre_reveal)',
  'resolve',
] as const);

export const CANONICAL_TURN_ORDER_WITHOUT_RESOLVE = Object.freeze([
  'store(user)',
  'search',
  'LLM',
  'store(assistant_pre_reveal)',
] as const);

export type TurnStep = (typeof CANONICAL_TURN_ORDER)[number];

export const CANONICAL_TURN_ORDER_STRING =
  'store(user) -> search -> LLM -> store(assistant_pre_reveal) -> resolve';

export const getTurnOrderForMode = (includeResolve: boolean): readonly TurnStep[] =>
  includeResolve ? CANONICAL_TURN_ORDER : CANONICAL_TURN_ORDER_WITHOUT_RESOLVE;

const stringifyTurnOrder = (steps: readonly TurnStep[]): string => {
  return steps.join(' -> ');
};

export const validateTurnOrder = (
  steps: readonly string[],
  expected?: readonly TurnStep[],
): void => {
  const expectedSteps = expected ?? CANONICAL_TURN_ORDER;

  if (steps.length !== expectedSteps.length) {
    throw new TurnOrderViolationError(
      `Expected ${expectedSteps.length} steps, got ${steps.length}. ` +
        `Canonical order: ${stringifyTurnOrder(expectedSteps)}`,
    );
  }

  for (let i = 0; i < expectedSteps.length; i += 1) {
    if (steps[i] !== expectedSteps[i]) {
      throw new TurnOrderViolationError(
        `Step ${i} must be "${expectedSteps[i]}", got "${steps[i]}". ` +
          `Canonical order: ${stringifyTurnOrder(expectedSteps)}`,
      );
    }
  }
};

export const isValidTurnOrder = (
  steps: readonly string[],
  expected?: readonly TurnStep[],
): boolean => {
  try {
    validateTurnOrder(steps, expected);
    return true;
  } catch {
    return false;
  }
};
