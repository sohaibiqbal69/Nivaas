import { Router } from 'express';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { Complaint, COMPLAINT_STATUSES } from './models/Complaint.js';
import { ComplaintUpdate } from './models/ComplaintUpdate.js';
import { Evidence } from '../evidence/models/Evidence.js';
import { evidenceFields } from '../evidence/evidence-service.js';
import { ComplaintService, complaintId, complaintScope } from './complaint-service.js';

export function createComplaintsRouter(authenticateRequest = authenticate, loadAuthenticatedUser = loadCurrentUser): Router {
  const router = Router();
  const service = new ComplaintService();
  router.use('/complaints', authenticateRequest, loadAuthenticatedUser);
  router.get('/complaints', async (request, response, next) => {
    try {
      const filter = complaintScope(request.currentUser!);
      if (Object.keys(request.query).some(key => !['page', 'status'].includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'Only page and status filters are supported. Society scope is determined by your account.');
      const page = Number(request.query.page ?? 1);
      if (!Number.isSafeInteger(page) || page < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer.');
      if (request.query.status !== undefined) {
        if (!COMPLAINT_STATUSES.includes(request.query.status as typeof COMPLAINT_STATUSES[number])) throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported complaint status.');
        filter.status = request.query.status;
      }
      const [items, total] = await Promise.all([Complaint.find(filter).select('-__v').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(), Complaint.countDocuments(filter)]);
      response.json({ success: true, data: { items, total, page, limit: 20 } });
    } catch (error) { next(error); }
  });
  router.get('/complaints/:id', async (request, response, next) => {
    try {
      const id = complaintId(request.params.id);
      const record = await Complaint.findOne({ ...complaintScope(request.currentUser!), _id: id }).select('-__v').lean();
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'Complaint not found.');
      const updates = await ComplaintUpdate.find({ complaintId: id }).sort({ createdAt: 1, _id: 1 }).lean();
      const evidence = await Evidence.find({ relatedEntityType: 'Complaint', relatedEntityId: id, societyId: request.currentUser!.societyId }).select(evidenceFields).sort({ createdAt: 1 }).lean();
      response.json({ success: true, data: { ...record, updates, evidence } });
    } catch (error) { next(error); }
  });
  router.post('/complaints', async (request, response, next) => {
    try { response.status(201).json({ success: true, data: await service.create(request.currentUser!, request.body) }); } catch (error) { next(error); }
  });
  for (const action of ['acknowledge', 'update', 'resolve'] as const) {
    router.post(`/complaints/:id/${action}`, async (request, response, next) => {
      try { response.json({ success: true, data: await service.transition(request.currentUser!, request.params.id, action, request.body) }); } catch (error) { next(error); }
    });
  }
  return router;
}
