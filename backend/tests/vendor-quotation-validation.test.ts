import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api-error.js';
import { validateQuotationBody } from '../src/modules/quotation/quotation-routes.js';
import { validateVendorInput } from '../src/modules/vendor/vendor-routes.js';
import { vendorSchema } from '../src/modules/vendor/models/Vendor.js';

describe('vendor-backed quotation creation', () => {
  it('accepts a persisted Mongo ObjectId and keeps the quotation contract field named vendorId', () => {
    const vendorId = '507f1f77bcf86cd799439011';
    expect(validateQuotationBody({ vendorId, amount: '2500', description: 'Lift repair' }, false)).toMatchObject({
      vendorId, amount: expect.objectContaining({ toString: expect.any(Function) }), description: 'Lift repair',
    });
  });

  it.each(['', 'vendor name', 'vendor-1', undefined, null])('rejects missing or non-ObjectId vendor input: %s', (vendorId) => {
    expect(() => validateQuotationBody({ vendorId, amount: '2500', description: 'Lift repair' }, false)).toThrowError(ApiError);
    try {
      validateQuotationBody({ vendorId, amount: '2500', description: 'Lift repair' }, false);
    } catch (error) {
      expect((error as ApiError).message).toBe('vendorId must be a valid ObjectId.');
    }
  });

  it('rejects a missing vendor field with the required-field validation message', () => {
    expect(() => validateQuotationBody({ amount: '2500', description: 'Lift repair' }, false))
      .toThrow('vendorId, amount, and description are required.');
  });

  it('persists vendor records in the society-scoped documented collection and requires a name', () => {
    expect(vendorSchema.get('collection')).toBe('vendors');
    expect(vendorSchema.path('societyId').options.required).toBe(true);
    expect(vendorSchema.path('status').options.default).toBe('ACTIVE');
    expect(vendorSchema.path('status').options.enum).toEqual(['ACTIVE', 'INACTIVE']);
    expect(vendorSchema.path('name').options.required).toBe(true);
    expect(validateVendorInput({ name: '  Lift Services  ' })).toEqual({ name: 'Lift Services' });
    expect(() => validateVendorInput({ name: '  ' })).toThrow('name must be a non-empty string.');
  });
});
