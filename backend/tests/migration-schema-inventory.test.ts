import { describe, expect, it } from 'vitest';
import { schemaModels } from '../src/migrations/schema-models.js';

describe('production migration model inventory', () => {
  it('covers the persisted application models and current declared index set', () => {
    expect(schemaModels).toHaveLength(36);
    expect(schemaModels.map((model) => model.collection.collectionName)).toContain('authSessions');
    expect(schemaModels.map((model) => model.collection.collectionName)).toContain('buildings');
    expect(schemaModels.reduce((count, model) => count + model.schema.indexes().length, 0)).toBe(66);
    expect(schemaModels.reduce((count, model) => count + model.schema.indexes().filter(([, options]) => options.unique).length, 0)).toBe(18);
    expect(schemaModels.reduce((count, model) => count + model.schema.indexes().filter(([, options]) => typeof options.expireAfterSeconds === 'number').length, 0)).toBe(1);
  });
});
