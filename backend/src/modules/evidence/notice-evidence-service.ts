import mongoose, { Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';
import type { CurrentUserContext } from '../../middleware/load-current-user.js';
import { complaintId } from '../complaint/complaint-service.js';
import { Notice } from '../notice/models/Notice.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Evidence } from './models/Evidence.js';
import { getEvidenceStorage } from './configured-evidence-storage.js';
import { evidenceStorageFields, type EvidenceStorage, type NewEvidenceStorageReference } from './evidence-storage.js';
import { validatePhoto } from './photo-validation.js';

export async function assertNoticeUpload(user: CurrentUserContext, id: unknown) {
  if (user.role !== 'SOCIETY_MANAGER' || !user.societyId) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned society manager can attach a notice document.');
  const notice = await Notice.findOne({ _id: complaintId(id), societyId: user.societyId });
  if (!notice) throw new ApiError(404, 'NOT_FOUND', 'Notice not found.');
  if (notice.status !== 'DRAFT') throw new ApiError(409, 'INVALID_STATE', 'Attach scans to a draft before publishing. Published attachments cannot be changed.');
}
export async function canReadNoticeEvidence(user: CurrentUserContext, noticeId: unknown, societyId: string, evidenceId: unknown) {
  if (!['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'OWNER_MEMBER', 'RESIDENT', 'COMMITTEE_MEMBER'].includes(user.role)) return false;
  if (user.role !== 'SYSTEM_ADMIN' && user.societyId !== societyId) return false;
  const notice = await Notice.findOne({ _id: noticeId, societyId, attachmentIds: evidenceId });
  if (!notice) return false;
  if (notice.status === 'PUBLISHED' && notice.expiresAt && notice.expiresAt <= new Date()) return false;
  return user.role === 'SOCIETY_MANAGER' || notice.status === 'PUBLISHED';
}
export class NoticeEvidenceService {
  constructor(private readonly storage: EvidenceStorage = getEvidenceStorage()) {}
  async upload(user: CurrentUserContext, id: unknown, bytes: Buffer) {
    await assertNoticeUpload(user, id);
    const type = validatePhoto(bytes); const noticeId = complaintId(id); const evidenceId = new Types.ObjectId();
    const session = await mongoose.startSession();
    let storageReference: NewEvidenceStorageReference;
    try { storageReference = await this.storage.write(bytes); }
    catch { await session.endSession(); throw new ApiError(503, 'EVIDENCE_PERSISTENCE_FAILED', 'Attachment could not be confirmed. Refresh the notice before retrying.'); }
    try {
      return await session.withTransaction(async () => {
        const locked = await Notice.updateOne({ _id: noticeId, societyId: user.societyId, status: 'DRAFT' }, { $push: { attachmentIds: evidenceId }, $inc: { __v: 1 } }, { session });
        if (locked.modifiedCount !== 1) throw new ApiError(409, 'INVALID_STATE', 'The notice is no longer an editable draft. Refresh before retrying.');
        const metadata = { _id: evidenceId, societyId: user.societyId, fileName: `${evidenceId}.${type.extension}`, fileType: type.fileType, fileSize: bytes.length, fileHash: createHash('sha256').update(bytes).digest('hex'), uploadedBy: user.userId, relatedEntityType: 'Notice', relatedEntityId: noticeId, category: 'NOTICE_ATTACHMENT' };
        await Evidence.create([{ ...metadata, ...evidenceStorageFields(storageReference) }], { session });
        await AuditLog.create([{ societyId: user.societyId, actorId: user.userId, action: 'NOTICE_ATTACHMENT_UPLOADED', entityType: 'NOTICE', entityId: noticeId, newState: metadata }], { session });
        return metadata;
      });
    } catch (error) {
      const ambiguous = error && typeof error === 'object' && 'hasErrorLabel' in error && typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult');
      if (!ambiguous) await this.storage.remove(storageReference).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'EVIDENCE_PERSISTENCE_FAILED', 'Attachment could not be confirmed. Refresh the notice before retrying.');
    } finally { await session.endSession(); }
  }
}
