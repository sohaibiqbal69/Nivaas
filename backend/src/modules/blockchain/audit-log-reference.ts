import { AbiCoder, keccak256, toUtf8Bytes, zeroPadValue } from 'ethers';
import { Types } from 'mongoose';

export const AUDIT_LOG_REFERENCE_DERIVATION_VERSION = 1 as const;
export const AUDIT_LOG_PROOF_VERSION = 1 as const;
export const AUDIT_LOG_REFERENCE_DOMAIN = keccak256(toUtf8Bytes('NIVAAS:AUDIT_LOG:REFERENCE'));

const coder = AbiCoder.defaultAbiCoder();

/** Version 1: keccak256(abi.encode(domainHash, derivationVersion, societyId, auditLogId)). */
export function deriveAuditLogReference(societyId: Types.ObjectId | string, auditLogId: Types.ObjectId | string): string {
  return keccak256(coder.encode(
    ['bytes32', 'uint256', 'bytes32', 'bytes32'],
    [AUDIT_LOG_REFERENCE_DOMAIN, AUDIT_LOG_REFERENCE_DERIVATION_VERSION, objectIdBytes32(societyId), objectIdBytes32(auditLogId)],
  )).toLowerCase();
}

function objectIdBytes32(value: Types.ObjectId | string): string {
  const text = value instanceof Types.ObjectId ? value.toHexString() : value;
  if (!/^[0-9a-f]{24}$/i.test(text)) throw new TypeError('AuditLog reference IDs must be MongoDB ObjectIds.');
  return zeroPadValue(`0x${text.toLowerCase()}`, 32);
}
