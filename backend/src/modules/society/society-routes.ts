import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { Society } from './models/Society.js';
import { SocietyRuleVersion, DEFAULT_APPROVAL_THRESHOLD } from './models/SocietyRuleVersion.js';

const SOCIETY_RESPONSE_FIELDS = [
  '_id',
  'name',
  'registrationNumber',
  'address',
  'contactEmail',
  'contactPhone',
  'financialYearStart',
  'financialYearEnd',
  'status',
  'createdAt',
  'updatedAt',
] as const;

const EDITABLE_FIELDS = [
  'name',
  'registrationNumber',
  'address',
  'contactEmail',
  'contactPhone',
  'financialYearStart',
  'financialYearEnd',
] as const;

type EditableSocietyField = typeof EDITABLE_FIELDS[number];

export type SocietyRecord = {
  _id: { toString(): string };
  name: string;
  registrationNumber?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  financialYearStart?: Date;
  financialYearEnd?: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
};

export type SocietyWriteData = Partial<Record<EditableSocietyField, string | Date>> & { status: 'ACTIVE' };

export type SocietyRepository = {
  findAll(): Promise<SocietyRecord[]>;
  findById(societyId: string): Promise<SocietyRecord | null>;
  create(data: SocietyWriteData): Promise<SocietyRecord>;
  update(societyId: string, data: Partial<Record<EditableSocietyField, string | Date>>): Promise<SocietyRecord | null>;
  updateStatus(societyId: string, status: 'ACTIVE' | 'DISABLED'): Promise<SocietyRecord | null>;
  createWithInitialRule?(data: SocietyWriteData, createdBy: string): Promise<SocietyRecord>;
};

const societyRepository: SocietyRepository = {
  async findAll() {
    return Society.find()
      .select(SOCIETY_RESPONSE_FIELDS.join(' '))
      .lean()
      .exec() as unknown as Promise<SocietyRecord[]>;
  },
  async findById(societyId) {
    return Society.findById(societyId)
      .select(SOCIETY_RESPONSE_FIELDS.join(' '))
      .lean()
      .exec() as unknown as Promise<SocietyRecord | null>;
  },
  async create(data) {
    return Society.create(data) as unknown as Promise<SocietyRecord>;
  },
  async update(societyId, data) {
    return Society.findByIdAndUpdate(societyId, data, { new: true, runValidators: true })
      .select(SOCIETY_RESPONSE_FIELDS.join(' '))
      .lean()
      .exec() as unknown as Promise<SocietyRecord | null>;
  },
  async updateStatus(societyId, status) {
    return Society.findByIdAndUpdate(societyId, { status }, { new: true, runValidators: true })
      .select(SOCIETY_RESPONSE_FIELDS.join(' '))
      .lean()
      .exec() as unknown as Promise<SocietyRecord | null>;
  },
  async createWithInitialRule(data, createdBy) {
    const session = await mongoose.startSession();
    try {
      let created: SocietyRecord | null = null;
      await session.withTransaction(async () => {
        const [society] = await Society.create([{ ...data, activeRuleVersionId: new Types.ObjectId(), configurationVersion: 1 }], { session });
        await SocietyRuleVersion.create([{
          _id: society.activeRuleVersionId,
          societyId: society._id,
          versionNumber: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date(),
          createdBy,
          approvalPolicy: { threshold: DEFAULT_APPROVAL_THRESHOLD, committeeApproval: { quorumNumerator: 2, quorumDenominator: 3, majorityNumerator: 1, majorityDenominator: 2, majorityComparison: 'STRICTLY_GREATER' } },
        }], { session });
        created = await Society.findById(society._id)
          .select(SOCIETY_RESPONSE_FIELDS.join(' ')).session(session).lean().exec() as unknown as SocietyRecord;
      });
      if (!created) throw new Error('Society creation did not return a persisted record.');
      return created;
    } finally {
      await session.endSession();
    }
  },
};

export function serializeSociety(society: SocietyRecord): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    _id: society._id.toString(),
    name: society.name,
    status: society.status,
    createdAt: society.createdAt,
    updatedAt: society.updatedAt,
  };

  for (const field of ['registrationNumber', 'address', 'contactEmail', 'contactPhone', 'financialYearStart', 'financialYearEnd'] as const) {
    if (society[field] !== undefined) serialized[field] = society[field];
  }

  return serialized;
}

export function createSocietiesRouter(
  repository: SocietyRepository = societyRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const adminOnly = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN')] as const;

  router.post('/', ...adminOnly, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const data = validateSocietyRequest(request.body, false);
      const user = request.currentUser;
      if (repository.createWithInitialRule && user) {
        const society = await repository.createWithInitialRule({ ...data, status: 'ACTIVE' }, user.userId);
        response.status(201).json({ success: true, data: serializeSociety(society) });
        return;
      }
      const society = await repository.create({ ...data, status: 'ACTIVE' });
      response.status(201).json({ success: true, data: serializeSociety(society) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', ...adminOnly, async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const societies = await repository.findAll();
      response.status(200).json({ success: true, data: societies.map(serializeSociety) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', ...adminOnly, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const society = await repository.findById(parseSocietyId(request.params.id));
      if (!society) throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
      response.status(200).json({ success: true, data: serializeSociety(society) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', ...adminOnly, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const society = await repository.update(
        parseSocietyId(request.params.id),
        validateSocietyRequest(request.body, true),
      );
      if (!society) throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
      response.status(200).json({ success: true, data: serializeSociety(society) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/status', ...adminOnly, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const status = validateStatusRequest(request.body);
      const society = await repository.updateStatus(parseSocietyId(request.params.id), status);
      if (!society) throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
      response.status(200).json({ success: true, data: serializeSociety(society) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseSocietyId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
  }
  return new Types.ObjectId(value).toString();
}

function validateSocietyRequest(value: unknown, requireField: boolean): Partial<Record<EditableSocietyField, string | Date>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must be a JSON object.');
  }

  const body = value as Record<string, unknown>;
  const allowedFields = new Set<string>(EDITABLE_FIELDS);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported society fields.');
  }
  if (requireField && Object.keys(body).length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'At least one editable society field is required.');
  }
  if (!requireField && typeof body.name !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Society name is required.');
  }

  const result: Partial<Record<EditableSocietyField, string | Date>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const fieldValue = body[field];
    if (['name', 'registrationNumber', 'address', 'contactPhone'].includes(field)) {
      if (typeof fieldValue !== 'string' || (field === 'name' && fieldValue.trim().length === 0)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid string.`);
      }
      result[field] = fieldValue.trim();
      continue;
    }
    if (field === 'contactEmail') {
      if (typeof fieldValue !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fieldValue.trim())) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'contactEmail must be a valid email address.');
      }
      result[field] = fieldValue.trim();
      continue;
    }
    if (typeof fieldValue !== 'string' || Number.isNaN(Date.parse(fieldValue))) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid date.`);
    }
    result[field] = new Date(fieldValue);
  }
  return result;
}

function validateStatusRequest(value: unknown): 'ACTIVE' | 'DISABLED' {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.keys(value).some((field) => field !== 'status')
    || !('status' in value)
    || (value as { status?: unknown }).status !== 'ACTIVE' && (value as { status?: unknown }).status !== 'DISABLED'
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Status must be ACTIVE or DISABLED.');
  }
  return (value as { status: 'ACTIVE' | 'DISABLED' }).status;
}
