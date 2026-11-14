import { AbiCoder, keccak256, toUtf8Bytes, zeroPadValue } from 'ethers';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_PROOF_VERSION,
  AUDIT_LOG_REFERENCE_DERIVATION_VERSION,
  AUDIT_LOG_REFERENCE_DOMAIN,
  deriveAuditLogReference,
} from '../src/modules/blockchain/audit-log-reference.js';

describe('AuditLog blockchain reference', () => {
  const societyId = new Types.ObjectId('68a123456789012345678902');
  const auditLogId = new Types.ObjectId('68a123456789012345678901');

  it('matches Solidity abi.encode bytes32,uint256,bytes32,bytes32 using ethers', () => {
    const encoded = AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'bytes32', 'bytes32'],
      [
        keccak256(toUtf8Bytes('NIVAAS:AUDIT_LOG:REFERENCE')),
        1n,
        zeroPadValue(`0x${societyId.toHexString()}`, 32),
        zeroPadValue(`0x${auditLogId.toHexString()}`, 32),
      ],
    );
    expect(AUDIT_LOG_REFERENCE_DOMAIN).toBe(keccak256(toUtf8Bytes('NIVAAS:AUDIT_LOG:REFERENCE')));
    expect(deriveAuditLogReference(societyId, auditLogId)).toBe(keccak256(encoded));
    expect(deriveAuditLogReference(societyId, auditLogId)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is stable and separates societies, records, and version domains', () => {
    expect(deriveAuditLogReference(societyId, auditLogId)).toBe(deriveAuditLogReference(societyId.toHexString(), auditLogId.toHexString()));
    expect(deriveAuditLogReference(societyId, auditLogId)).not.toBe(deriveAuditLogReference(new Types.ObjectId(), auditLogId));
    expect(deriveAuditLogReference(societyId, auditLogId)).not.toBe(deriveAuditLogReference(societyId, new Types.ObjectId()));
    expect(AUDIT_LOG_REFERENCE_DERIVATION_VERSION).toBe(1);
    expect(AUDIT_LOG_PROOF_VERSION).toBe(1);
  });

  it('rejects non-ObjectId references', () => {
    expect(() => deriveAuditLogReference('not-an-id', auditLogId)).toThrow(/ObjectIds/);
  });
});
