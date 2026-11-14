import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api-error.js';
import { addMoney, compareMoney, parseMoney, subtractMoney, validateExpenseLimits } from '../src/modules/expense/expense-calculations.js';

describe('project expense calculations', () => {
  it('uses decimal-safe addition, subtraction and comparison', () => {
    expect(addMoney('1200.10', '0.20')).toBe('1200.3');
    expect(subtractMoney('1200', '1199.99')).toBe('0.01');
    expect(compareMoney('25.10', '25.1')).toBe(0);
  });

  it('validates positive currency amounts with at most two decimal places', () => {
    expect(parseMoney('15.20')).toBe('15.2');
    expect(() => parseMoney('0')).toThrow(ApiError);
    expect(() => parseMoney('1.001')).toThrow(ApiError);
  });

  it('accepts an expense within both approved limits and rejects either overrun', () => {
    expect(validateExpenseLimits('40', '30', '10', '100', '80')).toEqual({ nextProjectSpent: '50', nextCategorySpent: '40' });
    for (const input of [
      ['90', '0', '10.01', '100', '500'],
      ['0', '90', '10.01', '500', '100'],
    ]) {
      try { validateExpenseLimits(...input); throw new Error('Expected limit validation to reject the expense.'); }
      catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).code).toBe('EXPENSE_LIMIT_EXCEEDED'); expect((error as ApiError).status).toBe(409); }
    }
  });
});
