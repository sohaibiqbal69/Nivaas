import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Society } from '../society/models/Society.js';
import { Budget } from './models/Budget.js';
import { BudgetCategory } from './models/BudgetCategory.js';

const budgetFields = '_id societyId financialYear title description status totalAllocated totalSpent totalRemaining approvedAt approvedBy createdAt updatedAt';
const categoryFields = '_id budgetId name description allocatedAmount spentAmount remainingAmount createdAt updatedAt';
const EDITABLE_BUDGET_STATUSES = ['DRAFT', 'REJECTED'] as const;

type BudgetRecord = {
  _id: { toString(): string };
  societyId: { toString(): string };
  financialYear: string;
  title: string;
  description?: string;
  status: string;
  totalAllocated: { toString(): string };
  totalSpent: { toString(): string };
  totalRemaining: { toString(): string };
  approvedAt?: Date;
  approvedBy?: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
};

type CategoryRecord = {
  _id: { toString(): string };
  budgetId: { toString(): string };
  name: string;
  description?: string;
  allocatedAmount: { toString(): string };
  spentAmount: { toString(): string };
  remainingAmount: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
};

export function createBudgetsRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const authorized = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER'),
  ] as const;

  router.get('/budgets', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const query: Record<string, unknown> = {};
      if (user.role === 'SYSTEM_ADMIN') {
        if (request.query.societyId !== undefined) query.societyId = parseObjectId(request.query.societyId, 'societyId');
      } else {
        query.societyId = user.societyId;
      }
      if (request.query.financialYear !== undefined) query.financialYear = parseFinancialYear(request.query.financialYear);
      const records = await Budget.find(query).select(budgetFields).sort({ financialYear: -1, createdAt: -1 }).lean().exec();
      response.json({ success: true, data: (records as unknown as BudgetRecord[]).map(serializeBudget) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/budgets/:id', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const budget = await findBudgetForUser(request.params.id, user);
      if (!budget) throw notFound();
      const categories = await BudgetCategory.find({ budgetId: budget._id }).select(categoryFields).sort({ name: 1 }).lean().exec();
      response.json({
        success: true,
        data: { ...serializeBudget(budget), categories: (categories as unknown as CategoryRecord[]).map(serializeCategory) },
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/budgets', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const data = validateBudgetBody(request.body, false);
      if (user.role === 'SOCIETY_MANAGER' && data.societyId !== user.societyId) throw forbidden();
      if (!(await Society.exists({ _id: data.societyId }))) throw new ApiError(400, 'VALIDATION_ERROR', 'The society does not exist.');
      const session = await mongoose.startSession();
      try {
        let created: BudgetRecord | null = null;
        await session.withTransaction(async () => {
          const [budget] = await Budget.create([{
            ...data,
            status: 'DRAFT',
            totalAllocated: decimal('0'),
            totalSpent: decimal('0'),
            totalRemaining: decimal('0'),
          }], { session });
          await writeAudit('BUDGET_CREATED', budget, user.userId, {}, budgetState(budget), session);
          created = budget.toObject() as unknown as BudgetRecord;
        });
        if (!created) throw new Error('Budget creation did not return a persisted record.');
        response.status(201).json({ success: true, data: serializeBudget(created) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.patch('/budgets/:id', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const update = validateBudgetBody(request.body, true);
      const session = await mongoose.startSession();
      try {
        let updated: BudgetRecord | null = null;
        await session.withTransaction(async () => {
          const existing = await findBudgetForUser(request.params.id, user, session);
          if (!existing) return;
          if (!EDITABLE_BUDGET_STATUSES.includes(existing.status as typeof EDITABLE_BUDGET_STATUSES[number])) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Only editable budgets can be updated.');
          }
          if (update.societyId !== undefined || update.financialYear !== undefined) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Budget society and financial year cannot be changed.');
          }
          const result = await Budget.findByIdAndUpdate(existing._id, update, {
            new: true, runValidators: true, session,
          }).select(budgetFields).lean().exec();
          if (!result) return;
          updated = result as unknown as BudgetRecord;
          await writeAudit('BUDGET_UPDATED', existing, user.userId, budgetState(existing), budgetState(updated), session);
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeBudget(updated) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/budgets/:budgetId/categories', ...authorized, async (request, response, next) => {
    try {
      const budget = await findBudgetForUser(request.params.budgetId, currentUser(request));
      if (!budget) throw notFound();
      const categories = await BudgetCategory.find({ budgetId: budget._id }).select(categoryFields).sort({ name: 1 }).lean().exec();
      response.json({ success: true, data: (categories as unknown as CategoryRecord[]).map(serializeCategory) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/budgets/:budgetId/categories', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const data = validateCategoryBody(request.body, false);
      const session = await mongoose.startSession();
      try {
        let created: CategoryRecord | null = null;
        await session.withTransaction(async () => {
          const budget = await findBudgetForUser(request.params.budgetId, user, session);
          if (!budget) return;
          ensureEditable(budget);
          const [category] = await BudgetCategory.create([{
            budgetId: budget._id,
            ...data,
            remainingAmount: subtract(data.allocatedAmount!, data.spentAmount ?? '0'),
          }], { session });
          const totals = await recalculateBudget(budget._id.toString(), session);
          await writeAudit('BUDGET_CATEGORY_CREATED', budget, user.userId, budgetState(budget), { ...budgetState(budget), ...totals }, session, category._id.toString());
          created = category.toObject() as unknown as CategoryRecord;
        });
        if (!created) throw notFound();
        response.status(201).json({ success: true, data: serializeCategory(created) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.patch('/budget-categories/:id', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const update = validateCategoryBody(request.body, true);
      const session = await mongoose.startSession();
      try {
        let updated: CategoryRecord | null = null;
        await session.withTransaction(async () => {
          const existing = await BudgetCategory.findById(request.params.id).session(session).lean().exec() as unknown as CategoryRecord | null;
          if (!existing) return;
          const budget = await findBudgetForUser(existing.budgetId.toString(), user, session);
          if (!budget) return;
          ensureEditable(budget);
          const nextAllocated = update.allocatedAmount ?? existing.allocatedAmount.toString();
          const nextSpent = update.spentAmount ?? existing.spentAmount.toString();
          const result = await BudgetCategory.findByIdAndUpdate(existing._id, {
            ...update,
            ...(update.allocatedAmount !== undefined || update.spentAmount !== undefined
              ? { remainingAmount: subtract(nextAllocated, nextSpent) } : {}),
          }, { new: true, runValidators: true, session }).select(categoryFields).lean().exec();
          if (!result) return;
          updated = result as unknown as CategoryRecord;
          const totals = await recalculateBudget(budget._id.toString(), session);
          await writeAudit('BUDGET_CATEGORY_UPDATED', budget, user.userId, categoryState(existing), { ...categoryState(updated), ...totals }, session, existing._id.toString());
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeCategory(updated) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  return router;
}

async function findBudgetForUser(id: unknown, user: CurrentUserContext, session?: mongoose.ClientSession): Promise<BudgetRecord | null> {
  const objectId = parseObjectId(id, 'budgetId');
  const query: Record<string, unknown> = { _id: objectId };
  if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
  return Budget.findOne(query).select(budgetFields).session(session ?? null).lean().exec() as unknown as Promise<BudgetRecord | null>;
}

async function recalculateBudget(budgetId: string, session: mongoose.ClientSession): Promise<Record<string, string>> {
  const items = await BudgetCategory.find({ budgetId }).session(session).lean().exec() as unknown as CategoryRecord[];
  const totals = items.reduce((result, item) => ({
    allocated: add(result.allocated, item.allocatedAmount.toString()),
    spent: add(result.spent, item.spentAmount.toString()),
  }), { allocated: '0', spent: '0' });
  const remaining = subtract(totals.allocated, totals.spent);
  await Budget.updateOne({ _id: budgetId }, {
    $set: { totalAllocated: decimal(totals.allocated), totalSpent: decimal(totals.spent), totalRemaining: decimal(remaining) },
  }, { session });
  return { totalAllocated: totals.allocated, totalSpent: totals.spent, totalRemaining: remaining };
}

async function writeAudit(action: string, budget: { _id: { toString(): string }; societyId: { toString(): string } }, actorId: string, previousState: Record<string, unknown>, newState: Record<string, unknown>, session: mongoose.ClientSession, entityId = budget._id.toString()) {
  await new AuditLog({
    societyId: budget.societyId,
    actorId,
    action,
    entityType: action.startsWith('BUDGET_CATEGORY') ? 'BudgetCategory' : 'Budget',
    entityId,
    previousState,
    newState,
  }).save({ session });
}

function serializeBudget(budget: BudgetRecord): Record<string, unknown> {
  return {
    _id: budget._id.toString(),
    societyId: budget.societyId.toString(),
    financialYear: budget.financialYear,
    title: budget.title,
    ...(budget.description === undefined ? {} : { description: budget.description }),
    status: budget.status,
    totalAllocated: budget.totalAllocated.toString(),
    totalSpent: budget.totalSpent.toString(),
    totalRemaining: budget.totalRemaining.toString(),
    ...(budget.approvedAt === undefined ? {} : { approvedAt: budget.approvedAt }),
    ...(budget.approvedBy === undefined ? {} : { approvedBy: budget.approvedBy.toString() }),
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
  };
}

function serializeCategory(category: CategoryRecord): Record<string, unknown> {
  return {
    _id: category._id.toString(),
    budgetId: category.budgetId.toString(),
    name: category.name,
    ...(category.description === undefined ? {} : { description: category.description }),
    allocatedAmount: category.allocatedAmount.toString(),
    spentAmount: category.spentAmount.toString(),
    remainingAmount: category.remainingAmount.toString(),
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

function currentUser(request: Request): CurrentUserContext {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function validateBudgetBody(value: unknown, partial: boolean): Record<string, unknown> {
  const body = objectBody(value);
  const allowed = new Set(['societyId', 'financialYear', 'title', 'description']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw validation('Unsupported budget fields.');
  if (partial && Object.keys(body).length === 0) throw validation('At least one budget field is required.');
  const result: Record<string, unknown> = {};
  if ('societyId' in body) result.societyId = parseObjectId(body.societyId, 'societyId');
  if ('financialYear' in body) result.financialYear = parseFinancialYear(body.financialYear);
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) throw validation('title must be a non-empty string.');
    result.title = body.title.trim();
  }
  if ('description' in body) {
    if (typeof body.description !== 'string') throw validation('description must be a string.');
    result.description = body.description.trim();
  }
  if (!partial && (result.societyId === undefined || result.financialYear === undefined || result.title === undefined)) {
    throw validation('societyId, financialYear, and title are required.');
  }
  return result;
}

function validateCategoryBody(value: unknown, partial: boolean): { name?: string; description?: string; allocatedAmount?: string; spentAmount?: string } {
  const body = objectBody(value);
  const allowed = new Set(['name', 'description', 'allocatedAmount', 'spentAmount']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw validation('Unsupported budget item fields.');
  if (partial && Object.keys(body).length === 0) throw validation('At least one budget item field is required.');
  const result: { name?: string; description?: string; allocatedAmount?: string; spentAmount?: string } = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw validation('name must be a non-empty string.');
    result.name = body.name.trim();
  }
  if ('description' in body) {
    if (typeof body.description !== 'string') throw validation('description must be a string.');
    result.description = body.description.trim();
  }
  for (const field of ['allocatedAmount', 'spentAmount'] as const) {
    if (!(field in body)) continue;
    result[field] = monetary(body[field], field);
  }
  if (!partial && result.name === undefined) throw validation('name is required.');
  if (!partial && result.allocatedAmount === undefined) throw validation('allocatedAmount is required.');
  return result;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('The request body must be a JSON object.');
  return value as Record<string, unknown>;
}

function parseObjectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation(`${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}

function parseFinancialYear(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{4}$/.test(value) || Number(value.slice(5)) !== Number(value.slice(0, 4)) + 1) {
    throw validation('financialYear must use YYYY-YYYY format with consecutive years.');
  }
  return value;
}

function monetary(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw validation(`${field} must be a non-negative decimal amount.`);
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw validation(`${field} must be a non-negative decimal amount.`);
  const significantDigits = text.replace('.', '').replace(/^0+/, '').length;
  if (significantDigits > 34) throw validation(`${field} exceeds the supported decimal precision.`);
  return normalizeDecimal(text);
}

function normalizeDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function add(left: string, right: string): string {
  const [a, b] = align(left, right);
  return integerToDecimal(BigInt(a) + BigInt(b), Math.max(decimalPlaces(left), decimalPlaces(right)));
}

function subtract(left: string, right: string): string {
  const [a, b] = align(left, right);
  return integerToDecimal(BigInt(a) - BigInt(b), Math.max(decimalPlaces(left), decimalPlaces(right)));
}

function align(left: string, right: string): [string, string] {
  const places = Math.max(decimalPlaces(left), decimalPlaces(right));
  return [toInteger(left, places), toInteger(right, places)];
}

function decimalPlaces(value: string): number { return value.split('.')[1]?.length ?? 0; }
function toInteger(value: string, places: number): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}${fraction.padEnd(places, '0') || ''}`.replace(/^0+(?=\d)/, '');
}
function integerToDecimal(value: bigint, places: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(places + 1, '0');
  const split = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return normalizeDecimal(`${negative ? '-' : ''}${split}`);
}
function decimal(value: string): mongoose.Types.Decimal128 { return mongoose.Types.Decimal128.fromString(value); }

function budgetState(budget: BudgetRecord | { title: string; status: string; financialYear: string; totalAllocated?: { toString(): string }; totalSpent?: { toString(): string }; totalRemaining?: { toString(): string } }): Record<string, unknown> {
  return {
    title: budget.title,
    status: budget.status,
    financialYear: budget.financialYear,
    ...(budget.totalAllocated ? { totalAllocated: budget.totalAllocated.toString() } : {}),
    ...(budget.totalSpent ? { totalSpent: budget.totalSpent.toString() } : {}),
    ...(budget.totalRemaining ? { totalRemaining: budget.totalRemaining.toString() } : {}),
  };
}
function categoryState(category: CategoryRecord): Record<string, unknown> {
  return { name: category.name, allocatedAmount: category.allocatedAmount.toString(), spentAmount: category.spentAmount.toString(), remainingAmount: category.remainingAmount.toString() };
}
function ensureEditable(budget: BudgetRecord): void {
  if (!EDITABLE_BUDGET_STATUSES.includes(budget.status as typeof EDITABLE_BUDGET_STATUSES[number])) throw new ApiError(400, 'VALIDATION_ERROR', 'Only editable budgets can be updated.');
}
function validation(message: string): ApiError { return new ApiError(400, 'VALIDATION_ERROR', message); }
function forbidden(): ApiError { return new ApiError(403, 'FORBIDDEN', 'You do not have permission to administer this budget.'); }
function notFound(): ApiError { return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.'); }
function normalizeError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000) {
    return validation('A budget already exists for this society and financial year.');
  }
  return error;
}
