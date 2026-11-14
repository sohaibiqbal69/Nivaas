import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import type { CurrentUserContext } from '../../middleware/load-current-user.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Complaint } from './models/Complaint.js';
import { ComplaintUpdate } from './models/ComplaintUpdate.js';

export type ComplaintAction = 'acknowledge' | 'update' | 'resolve';
export function complaintScope(user: CurrentUserContext): Record<string, unknown> {
  if (!user.societyId || !['SOCIETY_MANAGER', 'OWNER_MEMBER', 'RESIDENT'].includes(user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'A society manager, owner or resident account is required.');
  }
  return { societyId: new Types.ObjectId(user.societyId), ...(user.role === 'SOCIETY_MANAGER' ? {} : { createdBy: new Types.ObjectId(user.userId) }) };
}
export function complaintTransition(status: string, action: ComplaintAction): string {
  if (action === 'acknowledge' && status === 'OPEN') return 'ACKNOWLEDGED';
  if (action === 'update' && ['ACKNOWLEDGED', 'IN_PROGRESS'].includes(status)) return 'IN_PROGRESS';
  if (action === 'resolve' && status === 'IN_PROGRESS') return 'RESOLVED';
  throw new ApiError(409, 'CONFLICT', 'This action is not available in the current complaint state. Refresh the complaint.');
}
export function complaintText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required and must not exceed ${max} characters.`);
  return value.trim();
}
export function complaintBody(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported complaint fields.');
  return value as Record<string, unknown>;
}
export function complaintId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'A valid complaint ID is required.');
  return new Types.ObjectId(value);
}
export class ComplaintService {
  async create(user: CurrentUserContext, value: unknown) {
    complaintScope(user);
    if (!['OWNER_MEMBER', 'RESIDENT'].includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'Only owners and residents may raise complaints.');
    const body = complaintBody(value, ['title', 'description', 'category', 'priority']);
    const optional = (value: unknown, field: string, max: number) => value === undefined || value === '' || (typeof value === 'string' && !value.trim()) ? '' : complaintText(value, field, max);
    const input = { title: complaintText(body.title, 'Title', 160), description: optional(body.description, 'Description', 10000), category: optional(body.category, 'Category', 80), priority: optional(body.priority, 'Priority', 40) };
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const [record] = await Complaint.create([{ ...input, societyId: user.societyId, createdBy: user.userId, status: 'OPEN' }], { session });
        await ComplaintUpdate.create([{ complaintId: record._id, createdBy: user.userId, description: input.description || `Complaint submitted: ${input.title}`, status: 'OPEN' }], { session });
        await AuditLog.create([{ societyId: user.societyId, actorId: user.userId, entityType: 'Complaint', entityId: record._id, action: 'COMPLAINT_CREATED', newState: record.toObject() }], { session });
        return record.toObject();
      });
    } finally { await session.endSession(); }
  }
  async transition(user: CurrentUserContext, id: unknown, action: ComplaintAction, value: unknown) {
    const scope = complaintScope(user);
    if (user.role !== 'SOCIETY_MANAGER') throw new ApiError(403, 'FORBIDDEN', 'Only the assigned society manager can manage complaints.');
    const _id = complaintId(id);
    const body = complaintBody(value, ['description']);
    const description = complaintText(body.description, 'Progress or resolution note', 10000);
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const previous = await Complaint.findOne({ ...scope, _id }).session(session);
        if (!previous) throw new ApiError(404, 'NOT_FOUND', 'Complaint not found.');
        const status = complaintTransition(previous.status, action);
        const updated = await Complaint.findOneAndUpdate({ ...scope, _id, status: previous.status, __v: previous.__v }, {
          $set: { status, ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}) }, $inc: { __v: 1 },
        }, { session, new: true, runValidators: true });
        if (!updated) throw new ApiError(409, 'CONFLICT', 'The complaint changed. Refresh before trying again.');
        const [update] = await ComplaintUpdate.create([{ complaintId: _id, createdBy: user.userId, status, description }], { session });
        await AuditLog.create([{ societyId: user.societyId, actorId: user.userId, entityType: 'Complaint', entityId: _id, action: action === 'resolve' ? 'COMPLAINT_RESOLVED' : action === 'acknowledge' ? 'COMPLAINT_ACKNOWLEDGED' : 'COMPLAINT_PROGRESS_UPDATED', previousState: { status: previous.status }, newState: { status, updateId: update._id, description } }], { session });
        return updated.toObject();
      });
    } finally { await session.endSession(); }
  }
}
