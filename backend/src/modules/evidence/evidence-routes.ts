import { Router, raw } from 'express';
import { ApiError } from '../../lib/api-error.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { complaintId, complaintScope } from '../complaint/complaint-service.js';
import { Complaint } from '../complaint/models/Complaint.js';
import { ProjectUpdate } from '../project/models/ProjectUpdate.js';
import { authorizeEvidenceUpload, EvidenceService } from './evidence-service.js';
import { MAX_PHOTO_BYTES } from './photo-validation.js';
import { assertNoticeUpload, NoticeEvidenceService } from './notice-evidence-service.js';

export function createEvidenceRouter(authenticateRequest = authenticate, loadAuthenticatedUser = loadCurrentUser, service = new EvidenceService(), notices = new NoticeEvidenceService()): Router {
  const router = Router();
  router.post('/evidence/upload', authenticateRequest, loadAuthenticatedUser, async (request, _response, next) => {
    try {
      if (Object.keys(request.query).some(key => !['complaintId', 'noticeId', 'projectUpdateId', 'category'].includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'Select one supported evidence target and category.');
      const targets = ['complaintId', 'noticeId', 'projectUpdateId'].filter(key => request.query[key] !== undefined);
      if (targets.length !== 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Select exactly one complaint, notice, or project update.');
      if (request.query.projectUpdateId !== undefined) {
        if (request.currentUser!.role !== 'SOCIETY_MANAGER' || !request.currentUser!.societyId) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned society manager can add project photos.');
        if (request.query.category !== 'PROGRESS_PHOTO' && request.query.category !== 'AFTER_PHOTO') throw new ApiError(400, 'VALIDATION_ERROR', 'Project evidence must use PROGRESS_PHOTO or AFTER_PHOTO.');
        await ProjectUpdate.findOne({ _id: complaintId(request.query.projectUpdateId), societyId: request.currentUser!.societyId }).then(update => {
          if (!update) throw new ApiError(404, 'NOT_FOUND', 'Project update not found.');
          if (request.currentUser!.role !== 'SOCIETY_MANAGER' || update.kind === 'COMPLETION' && request.query.category !== 'AFTER_PHOTO' || update.kind === 'PROGRESS' && request.query.category !== 'PROGRESS_PHOTO') throw new ApiError(403, 'FORBIDDEN', 'Only the assigned manager may add the matching project photo category.');
        });
      } else if (request.query.noticeId !== undefined) {
        if (request.query.category !== 'NOTICE_ATTACHMENT') throw new ApiError(400, 'VALIDATION_ERROR', 'Select category NOTICE_ATTACHMENT for a notice.');
        await assertNoticeUpload(request.currentUser!, request.query.noticeId);
      } else {
      const complaint = await Complaint.findOne({ ...complaintScope(request.currentUser!), _id: complaintId(request.query.complaintId) });
      if (!complaint) throw new ApiError(404, 'NOT_FOUND', 'Complaint not found.');
      authorizeEvidenceUpload(request.currentUser!, complaint.status, request.query.category);
      }
      if (!request.is('application/octet-stream')) throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Send photo bytes as application/octet-stream.');
      next();
    } catch (error) { next(error); }
  }, (request, response, next) => {
    raw({ type: 'application/octet-stream', limit: MAX_PHOTO_BYTES, inflate: false })(request, response, error => {
      if (error) return next(new ApiError((error as { status?: number }).status === 413 ? 413 : 400, 'INVALID_UPLOAD', 'Upload one uncompressed photo no larger than 5 MiB.'));
      next();
    });
  }, async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) throw new ApiError(400, 'VALIDATION_ERROR', 'Photo bytes are required.');
      const result = request.query.projectUpdateId !== undefined
        ? await service.uploadProjectPhoto(request.currentUser!, request.query.projectUpdateId, request.query.category, request.body)
        : request.query.noticeId !== undefined
          ? await notices.upload(request.currentUser!, request.query.noticeId, request.body)
          : await service.upload(request.currentUser!, request.query.complaintId, request.query.category, request.body);
      response.status(201).set('Cache-Control', 'no-store').json({ success: true, data: result });
    } catch (error) { next(error); }
  });
  router.get('/evidence/:id', authenticateRequest, loadAuthenticatedUser, async (request, response, next) => {
    try {
      const result = await service.download(request.currentUser!, request.params.id);
      response.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${result.fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(result.bytes);
    } catch (error) { next(error); }
  });
  return router;
}
