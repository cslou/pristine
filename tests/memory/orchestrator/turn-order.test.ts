import { describe, it, expect } from 'vitest';
import {
  CANONICAL_TURN_ORDER,
  CANONICAL_TURN_ORDER_WITHOUT_RESOLVE,
  CANONICAL_TURN_ORDER_STRING,
  validateTurnOrder,
  isValidTurnOrder,
  getTurnOrderForMode,
} from '../../../src/memory/orchestrator/turn-order.js';
import { AppError, TurnOrderViolationError } from '../../../src/core/errors.js';

describe('Turn-order contract', () => {
  describe('canonical variants', () => {
    it('has a four-step contract when resolve is controlled externally', () => {
      expect(getTurnOrderForMode(false)).toEqual(CANONICAL_TURN_ORDER_WITHOUT_RESOLVE);
    });

    it('has the full five-step contract when resolve is internal', () => {
      expect(getTurnOrderForMode(true)).toEqual(CANONICAL_TURN_ORDER);
    });
  });

  describe('canonical constants', () => {
    it('has exactly 5 steps in the canonical order', () => {
      expect(CANONICAL_TURN_ORDER).toHaveLength(5);
    });

    it('defines the exact canonical sequence', () => {
      expect(CANONICAL_TURN_ORDER).toEqual([
        'store(user)',
        'search',
        'LLM',
        'store(assistant_pre_reveal)',
        'resolve',
      ]);
    });

    it('string representation matches array join', () => {
      expect(CANONICAL_TURN_ORDER_STRING).toBe(
        'store(user) -> search -> LLM -> store(assistant_pre_reveal) -> resolve',
      );
    });

    it('array is frozen (readonly tuple)', () => {
      expect(Object.isFrozen(CANONICAL_TURN_ORDER)).toBe(true);
    });
  });

  describe('validateTurnOrder', () => {
    it('accepts the canonical order', () => {
      expect(() => validateTurnOrder(CANONICAL_TURN_ORDER)).not.toThrow();
    });

    it('rejects missing steps (too few)', () => {
      expect(() => validateTurnOrder(['store(user)', 'search', 'LLM'])).toThrow(
        TurnOrderViolationError,
      );
    });

    it('rejects extra steps (too many)', () => {
      expect(() => validateTurnOrder([...CANONICAL_TURN_ORDER, 'extra'])).toThrow(
        TurnOrderViolationError,
      );
    });

    it('rejects reordered steps', () => {
      expect(() =>
        validateTurnOrder([
          'search',
          'store(user)',
          'LLM',
          'store(assistant_pre_reveal)',
          'resolve',
        ]),
      ).toThrow(TurnOrderViolationError);
    });

    it('rejects duplicated steps', () => {
      expect(() =>
        validateTurnOrder([
          'store(user)',
          'search',
          'search',
          'store(assistant_pre_reveal)',
          'resolve',
        ]),
      ).toThrow(TurnOrderViolationError);
    });

    it('rejects empty array', () => {
      expect(() => validateTurnOrder([])).toThrow(TurnOrderViolationError);
    });

    it('rejects unknown step names', () => {
      expect(() =>
        validateTurnOrder([
          'store(user)',
          'search',
          'LLM',
          'store(assistant_pre_reveal)',
          'unknown_step',
        ]),
      ).toThrow(TurnOrderViolationError);
    });

    it('error message includes canonical order string', () => {
      try {
        validateTurnOrder(['wrong']);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TurnOrderViolationError);
        expect((error as TurnOrderViolationError).message).toContain(CANONICAL_TURN_ORDER_STRING);
      }
    });
  });

  describe('isValidTurnOrder', () => {
    it('returns true for canonical order', () => {
      expect(isValidTurnOrder(CANONICAL_TURN_ORDER)).toBe(true);
    });

    it('returns false for reordered steps', () => {
      expect(
        isValidTurnOrder([
          'resolve',
          'search',
          'LLM',
          'store(assistant_pre_reveal)',
          'store(user)',
        ]),
      ).toBe(false);
    });

    it('returns false for missing steps', () => {
      expect(isValidTurnOrder(['store(user)', 'search'])).toBe(false);
    });
  });

  describe('fail-closed semantics', () => {
    it('violation prevents resolve step — no resolve on missing step', () => {
      const stepsWithoutResolve = ['store(user)', 'search', 'LLM', 'store(assistant_pre_reveal)'];
      let resolveExecuted = false;

      try {
        validateTurnOrder(stepsWithoutResolve);
        resolveExecuted = true;
      } catch {
        resolveExecuted = false;
      }

      expect(resolveExecuted).toBe(false);
    });

    it('violation prevents resolve step — no resolve on reorder', () => {
      const reordered = ['search', 'store(user)', 'LLM', 'store(assistant_pre_reveal)', 'resolve'];
      let resolveExecuted = false;

      try {
        validateTurnOrder(reordered);
        resolveExecuted = true;
      } catch {
        resolveExecuted = false;
      }

      expect(resolveExecuted).toBe(false);
    });

    it('violation prevents resolve step — no resolve on duplicate', () => {
      const duplicated = [
        'store(user)',
        'store(user)',
        'LLM',
        'store(assistant_pre_reveal)',
        'resolve',
      ];
      let resolveExecuted = false;

      try {
        validateTurnOrder(duplicated);
        resolveExecuted = true;
      } catch {
        resolveExecuted = false;
      }

      expect(resolveExecuted).toBe(false);
    });

    it('TurnOrderViolationError has correct name and extends AppError', () => {
      const error = new TurnOrderViolationError('test');
      expect(error.name).toBe('TurnOrderViolationError');
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
