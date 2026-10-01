import canonicalize from 'canonicalize';
import { keccak256, toUtf8Bytes } from 'ethers';
import { mongo, Types } from 'mongoose';

export const AUDIT_LOG_HASH_VERSION = 1 as const;

export const AUDIT_LOG_HASH_FIELDS = [
  'hashVersion',
  '_id',
  'societyId',
  'actorId',
  'action',
  'entityType',
  'entityId',
  'correctsAuditLogId',
  'previousState',
  'newState',
  'metadata',
  'ruleVersionId',
  'createdAt',
] as const;

type HashField = (typeof AUDIT_LOG_HASH_FIELDS)[number];
type AuditLogSource = Record<string, unknown> | { toObject(options?: object): Record<string, unknown> };

const supportedBsonNumericTypes = [
  mongo.BSON.Int32,
  mongo.BSON.Long,
  mongo.BSON.Double,
  mongo.BSON.Decimal128,
];

function toPlainRecord(source: AuditLogSource): Record<string, unknown> {
  if (source === null || typeof source !== 'object') {
    throw new TypeError('An AuditLog event object is required.');
  }

  if ('toObject' in source && typeof source.toObject === 'function') {
    return source.toObject({
      depopulate: true,
      getters: false,
      virtuals: false,
      transform: false,
      minimize: false,
      versionKey: false,
    });
  }

  return source;
}

function isPlainDocument(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSupportedNumeric(value: object): boolean {
  return supportedBsonNumericTypes.some((type) => value instanceof type);
}

function validateHashableValue(value: unknown, path: string, nested = false): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite numbers are not allowed in AuditLog hash data (${path}).`);
    }
    return;
  }

  if (value === undefined) {
    if (nested) throw new TypeError(`Undefined is not a supported nested AuditLog value (${path}).`);
    return;
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError(`Invalid Date in AuditLog hash data (${path}).`);
    return;
  }

  if (value instanceof Types.ObjectId) return;

  if (value instanceof mongo.BSON.Double) {
    if (!Number.isFinite(value.value)) {
      throw new TypeError(`Non-finite numbers are not allowed in AuditLog hash data (${path}).`);
    }
    return;
  }

  if (value instanceof mongo.BSON.Decimal128) {
    if (['NaN', 'Infinity', '-Infinity'].includes(value.toString())) {
      throw new TypeError(`Non-finite numbers are not allowed in AuditLog hash data (${path}).`);
    }
    return;
  }

  if (isSupportedNumeric(value as object)) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateHashableValue(item, `${path}[${index}]`, true));
    return;
  }

  if (typeof value === 'object' && isPlainDocument(value)) {
    for (const [key, child] of Object.entries(value)) {
      validateHashableValue(child, `${path}.${key}`, true);
    }
    return;
  }

  throw new TypeError(`Unsupported BSON/JavaScript value in AuditLog hash data (${path}).`);
}

function buildOrderedPayload(source: AuditLogSource): [HashField, unknown][] {
  const event = toPlainRecord(source);
  const entries: [HashField, unknown][] = [];

  for (const field of AUDIT_LOG_HASH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(event, field) || event[field] === undefined) continue;
    validateHashableValue(event[field], field);
    entries.push([field, event[field]]);
  }

  return entries;
}

/**
 * Produces the version-1 canonical JSON text. The event's hashVersion is
 * included in the payload; unsupported versions cannot be hashed by
 * hashAuditLog.
 */
export function canonicalizeAuditLog(source: AuditLogSource): string {
  const payload = buildOrderedPayload(source);
  const extendedJson = mongo.BSON.EJSON.stringify(payload, { relaxed: false });
  const jsonValue: unknown = JSON.parse(extendedJson);
  const canonicalJson = canonicalize(jsonValue);

  if (canonicalJson === undefined) {
    throw new TypeError('AuditLog payload could not be represented as canonical JSON.');
  }

  return canonicalJson;
}

/** Calculates a version-1 Ethereum Keccak-256 AuditLog record hash. */
export function hashAuditLog(source: AuditLogSource): string {
  const event = toPlainRecord(source);
  if (event.hashVersion !== AUDIT_LOG_HASH_VERSION) {
    throw new RangeError(`Unsupported AuditLog hash version: ${String(event.hashVersion)}.`);
  }

  return keccak256(toUtf8Bytes(canonicalizeAuditLog(event))).toLowerCase();
}
