import { mongo, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_HASH_FIELDS,
  canonicalizeAuditLog,
  hashAuditLog,
} from '../src/modules/audit/audit-log-hashing.js';
import { AuditLog, auditLogSchema } from '../src/modules/audit/models/AuditLog.js';

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hashVersion: 1,
    _id: new Types.ObjectId('68a123456789012345678901'),
    societyId: new Types.ObjectId('68a123456789012345678902'),
    actorId: new Types.ObjectId('68a123456789012345678903'),
    action: 'USER_STATUS_CHANGED',
    entityType: 'User',
    entityId: new Types.ObjectId('68a123456789012345678904'),
    correctsAuditLogId: new Types.ObjectId('68a123456789012345678905'),
    previousState: { status: 'ACTIVE' },
    newState: { status: 'DISABLED' },
    metadata: { reason: 'account disabled' },
    ruleVersionId: new Types.ObjectId('68a123456789012345678906'),
    createdAt: new Date('2026-01-02T03:04:05.006Z'),
    recordHash: `0x${'a'.repeat(64)}`,
    blockchainTransactionHash: '0xprevious-proof-reference',
    ...overrides,
  };
}

describe('AuditLog canonical hashing', () => {
  it('is deterministic and independent of ordinary property order', () => {
    const event = makeEvent();
    const reversed = Object.fromEntries(Object.entries(event).reverse());

    expect(hashAuditLog(event)).toBe(hashAuditLog(event));
    expect(canonicalizeAuditLog(event)).toBe(canonicalizeAuditLog(reversed));
    expect(hashAuditLog(event)).toBe(hashAuditLog(reversed));
  });

  it('preserves omitted, null, empty, false, and zero values distinctly', () => {
    const withoutActor = makeEvent();
    delete withoutActor.actorId;
    const withNullActor = makeEvent({ actorId: null });

    expect(canonicalizeAuditLog(withoutActor)).not.toBe(canonicalizeAuditLog(withNullActor));
    expect(canonicalizeAuditLog(makeEvent({ metadata: {} }))).not.toBe(canonicalizeAuditLog(makeEvent({ metadata: [] })));
    expect(canonicalizeAuditLog(makeEvent({ metadata: { value: '' } }))).not.toBe(canonicalizeAuditLog(makeEvent({ metadata: { value: false } })));
    expect(canonicalizeAuditLog(makeEvent({ metadata: { value: false } }))).not.toBe(canonicalizeAuditLog(makeEvent({ metadata: { value: 0 } })));
    expect(canonicalizeAuditLog(makeEvent({ metadata: { value: '' } }))).not.toBe(canonicalizeAuditLog(makeEvent({ metadata: {} })));
    expect(canonicalizeAuditLog(makeEvent({ metadata: [] }))).toContain('[]');
  });

  it('uses canonical ObjectId and UTC Date representations', () => {
    const idText = '68a123456789012345678901';
    const first = makeEvent({ _id: new Types.ObjectId(idText) });
    const second = makeEvent({ _id: new Types.ObjectId(idText.toUpperCase()) });
    const utcDate = makeEvent({ createdAt: new Date('2026-01-02T03:04:05.006Z') });
    const offsetDate = makeEvent({ createdAt: new Date('2026-01-02T08:34:05.006+05:30') });

    expect(canonicalizeAuditLog(first)).toContain(`{"$oid":"${idText}"}`);
    expect(hashAuditLog(first)).toBe(hashAuditLog(second));
    expect(hashAuditLog(utcDate)).toBe(hashAuditLog(offsetDate));
    expect(canonicalizeAuditLog(utcDate)).toContain('1767323045006');
  });

  it('preserves stored string content without trimming or case folding', () => {
    expect(hashAuditLog(makeEvent({ action: 'Event' }))).not.toBe(hashAuditLog(makeEvent({ action: 'event' })));
    expect(hashAuditLog(makeEvent({ metadata: { text: 'value' } }))).not.toBe(hashAuditLog(makeEvent({ metadata: { text: ' value ' } })));
  });

  it('canonicalizes nested object key order and preserves array order', () => {
    const first = makeEvent({ metadata: { nested: { alpha: 1, beta: 2 }, items: ['a', 'b'] } });
    const reordered = makeEvent({ metadata: { items: ['a', 'b'], nested: { beta: 2, alpha: 1 } } });
    const arrayReordered = makeEvent({ metadata: { nested: { alpha: 1, beta: 2 }, items: ['b', 'a'] } });

    expect(hashAuditLog(first)).toBe(hashAuditLog(reordered));
    expect(hashAuditLog(first)).not.toBe(hashAuditLog(arrayReordered));
  });

  it('preserves BSON numeric type distinctions and rejects non-finite values', () => {
    const bson = mongo.BSON;
    const int32 = makeEvent({ metadata: { value: new bson.Int32(1) } });
    const double = makeEvent({ metadata: { value: new bson.Double(1) } });
    const int64 = makeEvent({ metadata: { value: bson.Long.fromNumber(1) } });
    const decimal = makeEvent({ metadata: { value: bson.Decimal128.fromString('1.00') } });
    const negativeZero = canonicalizeAuditLog(makeEvent({ metadata: { value: -0 } }));

    expect(new Set([hashAuditLog(int32), hashAuditLog(double), hashAuditLog(int64), hashAuditLog(decimal)]).size).toBe(4);
    expect(canonicalizeAuditLog(int32)).toContain('$numberInt');
    expect(canonicalizeAuditLog(double)).toContain('$numberDouble');
    expect(canonicalizeAuditLog(int64)).toContain('$numberLong');
    expect(canonicalizeAuditLog(decimal)).toContain('$numberDecimal');
    expect(negativeZero).toContain('"-0.0"');
    expect(() => hashAuditLog(makeEvent({ metadata: { value: Number.NaN } }))).toThrow(/Non-finite/);
    expect(() => hashAuditLog(makeEvent({ metadata: { value: new bson.Double(Number.POSITIVE_INFINITY) } }))).toThrow(/Non-finite/);
  });

  it('recomputes the same hash after BSON persistence and reconstruction of numeric subtypes', () => {
    const bson = mongo.BSON;
    const event = new AuditLog({
      societyId: null,
      action: 'NUMERIC_STATE_RECORDED',
      metadata: {
        int32: new bson.Int32(1),
        double: new bson.Double(1),
        long: bson.Long.fromNumber(1),
        decimal: bson.Decimal128.fromString('1.00'),
        negativeZero: new bson.Double(-0),
      },
    });

    return event.validate().then(() => {
      const expectedHash = event.recordHash;
      const storedBytes = bson.serialize(event.toObject({ minimize: false }));
      const reloadedBson = bson.deserialize(storedBytes, { promoteValues: false, promoteLongs: false });
      const reloaded = AuditLog.hydrate(reloadedBson);

      expect(reloaded.metadata).toMatchObject({
        int32: expect.any(bson.Int32),
        double: expect.any(bson.Double),
        long: expect.any(bson.Long),
        decimal: expect.any(bson.Decimal128),
        negativeZero: expect.any(bson.Double),
      });
      expect(hashAuditLog(reloaded as unknown as Record<string, unknown>)).toBe(expectedHash);
    });
  });

  it('excludes recordHash, blockchainTransactionHash, and unmodeled proof fields', () => {
    const baseline = makeEvent();
    const changedExcluded = makeEvent({
      recordHash: `0x${'b'.repeat(64)}`,
      blockchainTransactionHash: '0xdifferent',
      proofStatus: 'CONFIRMED',
      transactionAttempts: [{ hash: '0xattempt' }],
    });

    expect(hashAuditLog(baseline)).toBe(hashAuditLog(changedExcluded));
  });

  it('commits to every included field and correction reference', () => {
    const baseline = makeEvent();
    const changes: Record<string, unknown>[] = [
      { _id: new Types.ObjectId('68a123456789012345678911') },
      { societyId: new Types.ObjectId('68a123456789012345678912') },
      { actorId: new Types.ObjectId('68a123456789012345678913') },
      { action: 'ANOTHER_ACTION' },
      { entityType: 'Society' },
      { entityId: new Types.ObjectId('68a123456789012345678914') },
      { correctsAuditLogId: new Types.ObjectId('68a123456789012345678915') },
      { previousState: { status: 'PENDING_SETUP' } },
      { newState: { status: 'ACTIVE' } },
      { metadata: { reason: 'another reason' } },
      { ruleVersionId: new Types.ObjectId('68a123456789012345678916') },
      { createdAt: new Date('2026-01-02T03:04:05.007Z') },
    ];

    for (const change of changes) {
      expect(hashAuditLog({ ...baseline, ...change })).not.toBe(hashAuditLog(baseline));
    }

    const correctedEvent = makeEvent({ correctsAuditLogId: new Types.ObjectId('68a123456789012345678917') });
    expect(hashAuditLog(correctedEvent)).not.toBe(hashAuditLog(baseline));
    expect(AUDIT_LOG_HASH_FIELDS).toEqual([
      'hashVersion', '_id', 'societyId', 'actorId', 'action', 'entityType', 'entityId',
      'correctsAuditLogId', 'previousState', 'newState', 'metadata', 'ruleVersionId', 'createdAt',
    ]);
  });

  it('includes hashVersion in the canonical payload and rejects unsupported hash versions', () => {
    const initial = makeEvent({ hashVersion: 1 });
    const other = makeEvent({ hashVersion: 2 });

    expect(canonicalizeAuditLog(initial)).not.toBe(canonicalizeAuditLog(other));
    expect(() => hashAuditLog(other)).toThrow(/Unsupported AuditLog hash version/);
  });
});

describe('AuditLog Mongoose model', () => {
  it('defines only the specified fields, references, timestamps, and indexes', () => {
    expect(auditLogSchema.options.collection).toBe('auditLogs');
    expect(auditLogSchema.options.timestamps).toBe(false);
    expect(auditLogSchema.options.versionKey).toBe(false);
    expect(auditLogSchema.path('updatedAt')).toBeUndefined();
    expect(auditLogSchema.path('societyId').options.ref).toBe('Society');
    expect(auditLogSchema.path('actorId').options.ref).toBe('User');
    expect(auditLogSchema.path('correctsAuditLogId').options.ref).toBe('AuditLog');
    expect(auditLogSchema.path('ruleVersionId').options.ref).toBe('SocietyRuleVersion');
    expect(auditLogSchema.path('entityId').options.ref).toBeUndefined();
    const indexes = auditLogSchema.indexes();
    expect(indexes.map(([fields]) => fields)).toEqual([
      { societyId: 1 },
      { entityType: 1, entityId: 1 },
    ]);
    expect(indexes.every(([, options]) => options.unique !== true)).toBe(true);
  });

  it('requires a platform/society scope value, action, hash fields, and a generated creation date', async () => {
    const missing = new AuditLog({});
    await expect(missing.validate()).rejects.toMatchObject({
      errors: {
        societyId: expect.anything(),
        action: expect.anything(),
      },
    });

    const platformEvent = new AuditLog({ societyId: null, action: 'PLATFORM_EVENT' });
    await platformEvent.validate();
    expect(platformEvent.hashVersion).toBe(1);
    expect(platformEvent._id).toBeInstanceOf(Types.ObjectId);
    expect(platformEvent.createdAt).toBeInstanceOf(Date);
    expect(platformEvent.recordHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(platformEvent.toObject()).not.toHaveProperty('updatedAt');
  });

  it('generates createdAt instead of accepting a caller-supplied event timestamp', async () => {
    const beforeConstruction = Date.now();
    const event = new AuditLog({
      societyId: null,
      action: 'PLATFORM_EVENT',
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    await event.validate();

    expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(beforeConstruction);
    expect(event.createdAt.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
    expect(event.recordHash).toBe(hashAuditLog(event as unknown as Record<string, unknown>));

    const generatedAt = event.createdAt.getTime();
    const originalHash = event.recordHash;
    await event.validate();
    expect(event.createdAt.getTime()).toBe(generatedAt);
    expect(event.recordHash).toBe(originalHash);
  });

  it('validates ObjectId references and the recordHash format', async () => {
    const invalidReference = new AuditLog({ societyId: 'not-an-object-id', action: 'EVENT' });
    await expect(invalidReference.validate()).rejects.toMatchObject({ errors: { societyId: expect.anything() } });

    const invalidHash = new AuditLog({
      societyId: new Types.ObjectId(), action: 'EVENT', recordHash: '0xABC',
    });
    await expect(invalidHash.validate()).rejects.toMatchObject({ errors: { recordHash: expect.anything() } });
  });

  it('generates a correct hash before the initial stored state and preserves empty BSON documents', async () => {
    const event = new AuditLog({ societyId: null, action: 'PLATFORM_EVENT', metadata: {} });
    await event.validate();

    expect(event.recordHash).toBe(hashAuditLog(event as unknown as Record<string, unknown>));
    expect(event.metadata).toEqual({});
    expect(event.isNew).toBe(true);
  });

  it('rejects unsupported fields and prevents ordinary updates and deletions', async () => {
    expect(() => new AuditLog({ societyId: null, action: 'EVENT', outcome: 'SUCCESS' })).toThrow(/strict mode/);

    const event = new AuditLog({ societyId: null, action: 'PLATFORM_EVENT' });
    await event.validate();
    event.isNew = false;
    event.set('action', 'CHANGED');
    expect(event.action).toBe('PLATFORM_EVENT');
    const persisted = new AuditLog({ societyId: null, action: 'PLATFORM_EVENT' });
    await persisted.validate();
    persisted.isNew = false;
    await expect(persisted.save()).rejects.toThrow(/append-only/);
    await expect(AuditLog.updateOne({}, { action: 'CHANGED' }).exec()).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndUpdate({}, { action: 'CHANGED' }).exec()).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndDelete({}).exec()).rejects.toThrow(/append-only/);
    await expect(event.deleteOne()).rejects.toThrow(/append-only/);
  });

  it('blocks replacement and bulk mutation/deletion operations before database access', async () => {
    const id = new Types.ObjectId();
    await expect(AuditLog.replaceOne({ _id: id }, { action: 'REPLACED' }).exec()).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndReplace({ _id: id }, { action: 'REPLACED' }).exec()).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ updateOne: { filter: { _id: id }, update: { $set: { action: 'CHANGED' } } } }])).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ replaceOne: { filter: { _id: id }, replacement: { action: 'REPLACED' } } }])).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ deleteOne: { filter: { _id: id } } }])).rejects.toThrow(/append-only/);
  });

  it('blocks bulkSave when it would update an existing AuditLog', async () => {
    const event = new AuditLog({ societyId: null, action: 'PLATFORM_EVENT' });
    await event.validate();
    event.isNew = false;

    await expect(AuditLog.bulkSave([event])).rejects.toThrow(/append-only/);
  });

  it('disables BSON numeric promotion on AuditLog find queries', async () => {
    const query = AuditLog.find();
    const executableQuery = query as unknown as {
      _queryMiddleware: {
        execPre(
          operation: string,
          context: unknown,
          args: unknown[],
          callback: (error?: Error | null) => void,
        ): void;
      };
    };

    await new Promise<void>((resolve, reject) => {
      executableQuery._queryMiddleware.execPre('find', query, [], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    expect(query.getOptions()).toMatchObject({ promoteValues: false, promoteLongs: false });
  });
});
