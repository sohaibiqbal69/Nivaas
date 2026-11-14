import type { Migration } from './migration-runner.js';
import { ensureDeclaredIndexes, planDeclaredIndexes, verifyDeclaredIndexes } from './declared-indexes.js';

import { schemaModels } from './schema-models.js';

export const migrations: Migration[] = [
  {
    id: '20261026_01_declared_indexes_v1',
    description: 'Create current schema-declared indexes without dropping or rewriting data.',
    async preview(db) {
      const missing = await planDeclaredIndexes(db, schemaModels);
      return `${missing.length} schema-declared index(es) would be created; existing index conflicts fail preflight. Unique-data conflicts are detected by MongoDB during index creation.`;
    },
    async up(db) {
      await ensureDeclaredIndexes(db, schemaModels);
    },
    async verify(db) {
      await verifyDeclaredIndexes(db, schemaModels);
    },
  },
];
