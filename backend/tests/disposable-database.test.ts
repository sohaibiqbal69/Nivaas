import { describe, expect, it } from 'vitest';
import { assertDisposableDatabase, validateTestUri } from './integration/disposable-database.js';

describe('disposable database guard', () => {
  it.each(['nivaas', 'nivaas_test', 'nivaas_demo', 'NIVAAS_TEST', 'admin', 'local', 'config'])('rejects protected %s even with confirmation', (name) => {
    expect(() => assertDisposableDatabase(name, name)).toThrow();
  });
  it('requires an exact explicit confirmation', () => {
    expect(() => assertDisposableDatabase('nivaas_disposable_onboarding', undefined)).toThrow();
    expect(() => assertDisposableDatabase('nivaas_disposable_onboarding', 'different')).toThrow();
  });
  it('accepts only the confirmed local replica set target', () => {
    const name = 'nivaas_disposable_onboarding';
    expect(validateTestUri(`mongodb://127.0.0.1:27017/${name}?replicaSet=rs0`, name)).toBe(name);
    expect(() => validateTestUri(`mongodb://example.com/${name}?replicaSet=rs0`, name)).toThrow();
    expect(() => validateTestUri(`mongodb://localhost/${name}`, name)).toThrow();
  });
});
