import mongoose, { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../src/modules/audit/models/AuditLog.js';
import { Complaint } from '../src/modules/complaint/models/Complaint.js';
import { ComplaintUpdate } from '../src/modules/complaint/models/ComplaintUpdate.js';
import { Evidence } from '../src/modules/evidence/models/Evidence.js';
import { EvidenceService } from '../src/modules/evidence/evidence-service.js';
import type { EvidenceStorage, NewEvidenceStorageReference } from '../src/modules/evidence/evidence-storage.js';
import { photo } from './evidence-fixture.js';

const user = { userId: new Types.ObjectId().toString(), societyId: new Types.ObjectId().toString(), role: 'RESIDENT' as const };
const complaintId = new Types.ObjectId().toString();
const storageReference: NewEvidenceStorageReference = { provider: 'cloudinary', storagePath: 'nivaas-evidence/7c5b66e0-0d45-4317-9a5a-c684f704a8de', assetId: 'abcdefghijklmno1234567890', resourceType: 'image', deliveryType: 'authenticated', format: 'png', version: 123 };

function fakeStorage(): EvidenceStorage {
  return { write: vi.fn().mockResolvedValue(storageReference), read: vi.fn().mockResolvedValue(photo), remove: vi.fn().mockResolvedValue(undefined) };
}

function prepareUploadTransaction(options: { auditFailure?: Error; ambiguousCommit?: boolean } = {}) {
  const complaint = { _id: new Types.ObjectId(complaintId), societyId: new Types.ObjectId(user.societyId!), createdBy: new Types.ObjectId(user.userId), status: 'OPEN', __v: 0 };
  vi.spyOn(Complaint, 'findOne')
    .mockReturnValueOnce(Promise.resolve(complaint) as never)
    .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(complaint) } as never);
  vi.spyOn(Complaint, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(Evidence, 'create').mockResolvedValue([{ _id: new Types.ObjectId() }] as never);
  vi.spyOn(ComplaintUpdate, 'create').mockResolvedValue([{ _id: new Types.ObjectId() }] as never);
  vi.spyOn(AuditLog, 'create').mockImplementation(() => options.auditFailure ? Promise.reject(options.auditFailure) as never : Promise.resolve([]) as never);
  const withTransaction = vi.fn(async (callback: () => Promise<unknown>) => {
    const result = await callback();
    if (options.ambiguousCommit) throw { hasErrorLabel: (label: string) => label === 'UnknownTransactionCommitResult' };
    return result;
  });
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({ withTransaction, endSession: vi.fn().mockResolvedValue(undefined) } as never);
  return { withTransaction };
}

describe('evidence service storage boundary', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps provider references and Cloudinary asset metadata excluded from normal Mongoose queries', () => {
    for (const path of ['storageProvider', 'storagePath', 'storageAssetId', 'storageResourceType', 'storageDeliveryType', 'storageFormat', 'storageVersion']) {
      expect(Evidence.schema.path(path)?.options.select).toBe(false);
    }
  });

  it('stores a private provider reference as internal fields while returning public metadata only', async () => {
    prepareUploadTransaction(); const storage = fakeStorage(); const service = new EvidenceService(storage);
    const result = await service.upload(user, complaintId, 'COMPLAINT_PHOTO', photo);
    expect(Evidence.create).toHaveBeenCalledWith([expect.objectContaining({ storageProvider: 'cloudinary', storagePath: storageReference.storagePath, storageAssetId: storageReference.assetId, storageDeliveryType: 'authenticated' })], expect.objectContaining({ session: expect.anything() }));
    expect(result).not.toHaveProperty('storagePath');
    expect(result).not.toHaveProperty('storageAssetId');
  });

  it('authorizes before reading storage and validates downloaded size and SHA-256', async () => {
    const storage = fakeStorage(); const service = new EvidenceService(storage);
    const evidence = { _id: new Types.ObjectId(), societyId: new Types.ObjectId(user.societyId!), relatedEntityType: 'Complaint', relatedEntityId: new Types.ObjectId(), fileSize: photo.length, fileHash: '0'.repeat(64), fileType: 'image/png', storageProvider: 'cloudinary', storagePath: storageReference.storagePath, storageAssetId: storageReference.assetId, storageResourceType: 'image', storageDeliveryType: 'authenticated', storageFormat: 'png', storageVersion: 123 };
    vi.spyOn(Evidence, 'findById').mockReturnValue({ select: vi.fn().mockResolvedValue(evidence) } as never);
    const exists = vi.spyOn(Complaint, 'exists').mockResolvedValue(null as never);
    await expect(service.download(user, evidence._id.toString())).rejects.toMatchObject({ status: 404 });
    expect(exists).toHaveBeenCalledOnce();
    expect(storage.read).not.toHaveBeenCalled();

    exists.mockResolvedValue({ _id: evidence.relatedEntityId } as never);
    await expect(service.download(user, evidence._id.toString())).rejects.toMatchObject({ status: 409, code: 'EVIDENCE_INTEGRITY_FAILED' });
    expect(exists.mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(storage.read).mock.invocationCallOrder.at(-1)!);
    expect(storage.read).toHaveBeenCalledWith(expect.objectContaining({ provider: 'cloudinary', storagePath: storageReference.storagePath }));
    vi.mocked(storage.read).mockResolvedValueOnce(Buffer.from('wrong-size'));
    await expect(service.download(user, evidence._id.toString())).rejects.toMatchObject({ status: 409, code: 'EVIDENCE_INTEGRITY_FAILED' });
  });

  it('removes the staged asset after a known transaction failure', async () => {
    prepareUploadTransaction({ auditFailure: new Error('known write failure') }); const storage = fakeStorage(); const service = new EvidenceService(storage);
    await expect(service.upload(user, complaintId, 'COMPLAINT_PHOTO', photo)).rejects.toMatchObject({ status: 503, code: 'EVIDENCE_PERSISTENCE_FAILED' });
    expect(storage.remove).toHaveBeenCalledExactlyOnceWith(storageReference);
  });

  it('retains the staged asset after an ambiguous transaction commit', async () => {
    prepareUploadTransaction({ ambiguousCommit: true }); const storage = fakeStorage(); const service = new EvidenceService(storage);
    await expect(service.upload(user, complaintId, 'COMPLAINT_PHOTO', photo)).rejects.toMatchObject({ status: 503, code: 'EVIDENCE_PERSISTENCE_FAILED' });
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
