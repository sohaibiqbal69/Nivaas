import mongoose, { Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';
import type { CurrentUserContext } from '../../middleware/load-current-user.js';
import { Complaint } from '../complaint/models/Complaint.js';
import { ComplaintUpdate } from '../complaint/models/ComplaintUpdate.js';
import { complaintId, complaintScope } from '../complaint/complaint-service.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Evidence } from './models/Evidence.js';
import { getEvidenceStorage } from './configured-evidence-storage.js';
import { evidenceStorageFields, evidenceStorageReference, type EvidenceStorage, type NewEvidenceStorageReference } from './evidence-storage.js';
import { validatePhoto } from './photo-validation.js';
import { canReadNoticeEvidence } from './notice-evidence-service.js';
import { Project } from '../project/models/Project.js';
import { ProjectUpdate } from '../project/models/ProjectUpdate.js';
import { assertOwnerSocietyAccess } from '../property/owner-society-access.js';

export const evidenceFields = '_id societyId fileName fileType fileSize fileHash uploadedBy relatedEntityType relatedEntityId category createdAt';
type ProjectUpdateLite = { _id: Types.ObjectId; societyId: Types.ObjectId; projectId: Types.ObjectId; kind: string };
const missing = () => new ApiError(404, 'NOT_FOUND', 'Evidence not found.');
export function authorizeEvidenceUpload(user: CurrentUserContext, status: string, category: unknown): string {
  if (user.role === 'SOCIETY_MANAGER' && ((category === 'PROGRESS_PHOTO' && ['ACKNOWLEDGED', 'IN_PROGRESS'].includes(status)) || (category === 'AFTER_PHOTO' && ['IN_PROGRESS', 'RESOLVED'].includes(status)))) return category;
  if (['OWNER_MEMBER', 'RESIDENT'].includes(user.role) && status === 'OPEN' && category === 'COMPLAINT_PHOTO') return category;
  throw new ApiError(409, 'EVIDENCE_NOT_ALLOWED', 'This evidence category is not available for your role and the current complaint state.');
}
export class EvidenceService {
  constructor(private readonly storage: EvidenceStorage = getEvidenceStorage()) {}
  async upload(user: CurrentUserContext, id: unknown, category: unknown, bytes: Buffer) {
    const scope = complaintScope(user); const _id = complaintId(id);
    const initial = await Complaint.findOne({ ...scope, _id });
    if (!initial) throw missing();
    const allowedCategory = authorizeEvidenceUpload(user, initial.status, category);
    const type = validatePhoto(bytes);
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const evidenceId = new Types.ObjectId();
    const session = await mongoose.startSession();
    let storageReference: NewEvidenceStorageReference;
    try { storageReference = await this.storage.write(bytes); }
    catch { await session.endSession(); throw new ApiError(503, 'EVIDENCE_STORAGE_UNAVAILABLE', 'Photo storage is unavailable. No evidence was recorded.'); }
    try {
      return await session.withTransaction(async () => {
        const complaint = await Complaint.findOne({ ...scope, _id }).session(session);
        if (!complaint) throw missing();
        authorizeEvidenceUpload(user, complaint.status, allowedCategory);
        // Serialize uploads with state transitions without changing complaint status.
        const locked = await Complaint.updateOne({ _id, ...scope, __v: complaint.__v }, { $inc: { __v: 1 } }, { session });
        if (locked.modifiedCount !== 1) throw new ApiError(409, 'CONFLICT', 'The complaint changed. Refresh before uploading again.');
        const metadata = { _id: evidenceId, societyId: user.societyId, fileName: `${evidenceId}.${type.extension}`, fileType: type.fileType, fileSize: bytes.length, fileHash, uploadedBy: user.userId, relatedEntityType: 'Complaint', relatedEntityId: _id, category: allowedCategory };
        await Evidence.create([{ ...metadata, ...evidenceStorageFields(storageReference) }], { session });
        const [update] = await ComplaintUpdate.create([{ complaintId: _id, status: complaint.status, description: `Photo evidence added: ${allowedCategory}`, createdBy: user.userId, evidenceIds: [evidenceId] }], { session });
        await AuditLog.create([{ societyId: user.societyId, actorId: user.userId, action: 'COMPLAINT_EVIDENCE_UPLOADED', entityType: 'Complaint', entityId: _id, newState: { ...metadata, updateId: update._id } }], { session });
        return metadata;
      });
    } catch (error) {
      const ambiguous = error && typeof error === 'object' && 'hasErrorLabel' in error && typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult');
      // Never remove a file after an ambiguous commit: a committed metadata record
      // may reference it. It remains private; operational reconciliation is required.
      if (!ambiguous) await this.storage.remove(storageReference).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'EVIDENCE_PERSISTENCE_FAILED', ambiguous ? 'Upload confirmation is unavailable. Refresh the timeline before retrying.' : 'Evidence could not be recorded. Refresh the timeline before retrying.');
    } finally { await session.endSession(); }
  }
  async uploadProjectPhoto(user: CurrentUserContext, id: unknown, category: unknown, bytes: Buffer) {
    if (user.role !== 'SOCIETY_MANAGER' || !user.societyId) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned society manager can add project progress evidence.');
    const updateId = complaintId(id);
    const initial = await ProjectUpdate.findOne({ _id: updateId, societyId: user.societyId }).lean().exec() as unknown as ProjectUpdateLite | null;
    if (!initial) throw missing();
    const allowedCategory = initial.kind === 'COMPLETION' ? 'AFTER_PHOTO' : 'PROGRESS_PHOTO';
    if (category !== allowedCategory) throw new ApiError(409, 'EVIDENCE_NOT_ALLOWED', `Use ${allowedCategory} for this project update.`);
    if (!await Project.exists({ _id: initial.projectId, societyId: user.societyId, status: 'IN_PROGRESS' })) throw new ApiError(409, 'EVIDENCE_NOT_ALLOWED', 'Project evidence can only be added while the project is IN_PROGRESS.');
    const type = validatePhoto(bytes); const fileHash = createHash('sha256').update(bytes).digest('hex'); const evidenceId = new Types.ObjectId();
    const session = await mongoose.startSession(); let storageReference: NewEvidenceStorageReference;
    try { storageReference = await this.storage.write(bytes); }
    catch { await session.endSession(); throw new ApiError(503, 'EVIDENCE_STORAGE_UNAVAILABLE', 'Photo storage is unavailable. No evidence was recorded.'); }
    try {
      return await session.withTransaction(async () => {
        const update = await ProjectUpdate.findOne({ _id: updateId, societyId: user.societyId }).session(session).lean().exec() as unknown as ProjectUpdateLite | null;
        if (!update || update.kind !== initial.kind) throw missing();
        const project = await Project.findOne({ _id: update.projectId, societyId: user.societyId, status: 'IN_PROGRESS' }).select('_id __v').session(session).lean().exec() as { _id: Types.ObjectId; __v: number } | null;
        if (!project) throw new ApiError(409, 'EVIDENCE_NOT_ALLOWED', 'Project evidence can only be added while the project is IN_PROGRESS.');
        const locked = await Project.updateOne({ _id: project._id, societyId: user.societyId, status: 'IN_PROGRESS', __v: project.__v }, { $inc: { __v: 1 } }, { session });
        if (locked.modifiedCount !== 1) throw new ApiError(409, 'PROJECT_CHANGED', 'Project state changed. Refresh before uploading evidence.');
        const metadata = { _id: evidenceId, societyId: user.societyId, fileName: `${evidenceId}.${type.extension}`, fileType: type.fileType, fileSize: bytes.length, fileHash, uploadedBy: user.userId, relatedEntityType: 'ProjectUpdate', relatedEntityId: updateId, category: allowedCategory };
        await Evidence.create([{ ...metadata, ...evidenceStorageFields(storageReference) }], { session });
        await AuditLog.create([{ societyId: user.societyId, actorId: user.userId, action: allowedCategory === 'AFTER_PHOTO' ? 'PROJECT_COMPLETION_PHOTO_ADDED' : 'PROJECT_PROGRESS_PHOTO_ADDED', entityType: 'ProjectUpdate', entityId: updateId, newState: { projectId: update.projectId, ...metadata } }], { session });
        return metadata;
      });
    } catch (error) {
      const ambiguous = error && typeof error === 'object' && 'hasErrorLabel' in error && typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult');
      if (!ambiguous) await this.storage.remove(storageReference).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'EVIDENCE_PERSISTENCE_FAILED', 'Project evidence could not be confirmed. Refresh before retrying.');
    } finally { await session.endSession(); }
  }
  async download(user: CurrentUserContext, id: unknown) {
    const evidence = await Evidence.findById(complaintId(id)).select('+storageProvider +storagePath +storageAssetId +storageResourceType +storageDeliveryType +storageFormat +storageVersion');
    if (!evidence) throw missing();
    if (evidence.relatedEntityType === 'Notice') {
      if (!await canReadNoticeEvidence(user, evidence.relatedEntityId, String(evidence.societyId), evidence._id)) throw missing();
    } else if (evidence.relatedEntityType === 'ProjectUpdate') {
      if (!['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'].includes(user.role)) throw missing();
      const update = await ProjectUpdate.findOne({ _id: evidence.relatedEntityId, societyId: evidence.societyId }).select('projectId societyId').lean().exec() as unknown as Pick<ProjectUpdateLite, 'projectId'> | null;
      const project = update ? await Project.findOne({ _id: update.projectId, societyId: evidence.societyId }).select('_id societyId').lean().exec() : null;
      if (!project || user.role !== 'SYSTEM_ADMIN' && String(evidence.societyId) !== user.societyId) throw missing();
      if (user.role === 'OWNER_MEMBER') await assertOwnerSocietyAccess(user, String(evidence.societyId));
    } else {
      const scope = complaintScope(user);
      if (evidence.relatedEntityType !== 'Complaint' || String(evidence.societyId) !== user.societyId || !await Complaint.exists({ ...scope, _id: evidence.relatedEntityId })) throw missing();
    }
    let bytes: Buffer;
    try {
      bytes = await this.storage.read(evidenceStorageReference(evidence));
    }
    catch { throw new ApiError(503, 'EVIDENCE_UNAVAILABLE', 'The evidence file is unavailable. Contact the society manager.'); }
    if (bytes.length !== evidence.fileSize || createHash('sha256').update(bytes).digest('hex') !== evidence.fileHash) throw new ApiError(409, 'EVIDENCE_INTEGRITY_FAILED', 'The evidence file does not match its recorded integrity hash.');
    return { bytes, fileName: `${evidence._id}.${evidence.fileType === 'image/png' ? 'png' : 'jpg'}` };
  }
}
