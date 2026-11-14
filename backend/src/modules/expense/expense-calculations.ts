import { ApiError } from '../../lib/api-error.js';

export function parseMoney(value: unknown, field = 'amount'): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw validation(`${field} must be a positive decimal amount.`);
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text) || /^0+(?:\.0{1,2})?$/.test(text)) throw validation(`${field} must be a positive decimal amount with at most two decimal places.`);
  return normalize(text);
}

export function addMoney(left: string, right: string): string {
  const places = Math.max(decimalPlaces(left), decimalPlaces(right));
  return render(toInteger(left, places) + toInteger(right, places), places);
}

export function subtractMoney(left: string, right: string): string {
  const places = Math.max(decimalPlaces(left), decimalPlaces(right));
  return render(toInteger(left, places) - toInteger(right, places), places);
}

export function compareMoney(left: string, right: string): number {
  const places = Math.max(decimalPlaces(left), decimalPlaces(right));
  const a = toInteger(left, places); const b = toInteger(right, places);
  return a === b ? 0 : a < b ? -1 : 1;
}

export function validateExpenseLimits(projectSpent: string, categorySpent: string, amount: string, approvedCost: string, categoryAllocation: string) {
  const nextProjectSpent = addMoney(projectSpent, amount);
  const nextCategorySpent = addMoney(categorySpent, amount);
  const exceedsProjectApproval = compareMoney(nextProjectSpent, approvedCost) > 0;
  const exceedsCategoryAllocation = compareMoney(nextCategorySpent, categoryAllocation) > 0;
  if (exceedsProjectApproval || exceedsCategoryAllocation) {
    const nextSteps = [
      ...(exceedsProjectApproval ? ['For a project-amount overrun, use the existing quotation change-request workflow and obtain its required approval before retrying.'] : []),
      ...(exceedsCategoryAllocation ? ['For a budget-category overrun, no budget-revision approval route is configured in Nivaas; do not record the expense until the society’s authorized budget revision is approved and recorded.'] : []),
    ].join(' ');
    throw new ApiError(409, 'EXPENSE_LIMIT_EXCEEDED', `This expense exceeds ${[exceedsProjectApproval ? 'the approved project amount' : '', exceedsCategoryAllocation ? 'the allocated budget category' : ''].filter(Boolean).join(' and ')}. It was not recorded. ${nextSteps}`);
  }
  return { nextProjectSpent, nextCategorySpent };
}

function decimalPlaces(value: string): number { return value.split('.')[1]?.length ?? 0; }
function toInteger(value: string, places: number): bigint { const [whole, fraction = ''] = value.split('.'); return BigInt(`${whole}${fraction.padEnd(places, '0')}`); }
function render(value: bigint, places: number): string { const digits = value.toString().padStart(places + 1, '0'); return normalize(places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits); }
function normalize(value: string): string { const [whole, fraction = ''] = value.split('.'); const trimmed = fraction.replace(/0+$/, ''); return trimmed ? `${whole}.${trimmed}` : whole; }
function validation(message: string): ApiError { return new ApiError(400, 'VALIDATION_ERROR', message); }
