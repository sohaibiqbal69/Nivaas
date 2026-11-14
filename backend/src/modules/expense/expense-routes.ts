import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Budget } from '../budget/models/Budget.js';
import { BudgetCategory } from '../budget/models/BudgetCategory.js';
import { Project } from '../project/models/Project.js';
import { Vendor } from '../vendor/models/Vendor.js';
import { assertOwnerSocietyAccess } from '../property/owner-society-access.js';
import { Expense } from './models/Expense.js';
import { addMoney, compareMoney, parseMoney, subtractMoney, validateExpenseLimits } from './expense-calculations.js';

const readable = ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'] as const;
const fullFields = '_id societyId projectId budgetId budgetCategoryId vendorId title description amount invoiceReference status expenseDate createdBy createdAt';
type ProjectRecord = { _id: Types.ObjectId; societyId: Types.ObjectId; status: string; approvedCost?: Types.Decimal128; budgetId?: Types.ObjectId; __v: number };
type CategoryRecord = { _id: Types.ObjectId; budgetId: Types.ObjectId; allocatedAmount: Types.Decimal128; spentAmount: Types.Decimal128; __v: number };

export function createExpensesRouter(authenticateRequest = authenticate, loadAuthenticatedUser = loadCurrentUser): Router {
  const router = Router();
  const read = [authenticateRequest, loadAuthenticatedUser, requireRoles(...readable)] as const;
  const write = [authenticateRequest, loadAuthenticatedUser, requireRoles('SOCIETY_MANAGER')] as const;

  router.get('/expenses', ...read, async (request, response, next) => {
    try {
      rejectUnknownQuery(request, ['projectId', 'societyId']);
      const user = currentUser(request); const projectId = request.query.projectId ? objectId(request.query.projectId, 'projectId') : undefined;
      const scope: Record<string, unknown> = {};
      if (user.role === 'SYSTEM_ADMIN') {
        if (request.query.societyId) scope.societyId = objectId(request.query.societyId, 'societyId');
        else if (!projectId) throw validation('Provide projectId or societyId for platform-admin expense reads.');
      } else scope.societyId = user.societyId;
      if (projectId) scope.projectId = projectId;
      const projects = await Project.find(scope).select('_id societyId status approvedCost budgetId').lean().exec() as unknown as ProjectRecord[];
      const visibleProjects = [] as ProjectRecord[];
      for (const project of projects) {
        if (user.role === 'OWNER_MEMBER') {
          await assertOwnerSocietyAccess(user, project.societyId.toString());
          if (!['APPROVED', 'VENDOR_SELECTED', 'IN_PROGRESS', 'COMPLETED', 'FINAL_INVOICE', 'CLOSED'].includes(project.status)) continue;
        }
        visibleProjects.push(project);
      }
      const ids = visibleProjects.map(item => item._id);
      const expenses = ids.length ? await Expense.find({ societyId: { $in: [...new Set(visibleProjects.map(project => project.societyId.toString()))] }, projectId: { $in: ids } }).select(fullFields).sort({ expenseDate: -1, createdAt: -1 }).lean().exec() : [];
      const visible = (expenses as unknown as Array<Record<string, any>>).map(record => serialize(record, user.role === 'OWNER_MEMBER'));
      const summaries = await Promise.all(visibleProjects.map(async project => {
        const projectExpenses = await Expense.find({ projectId: project._id, societyId: project.societyId }).select('amount').lean().exec() as unknown as Array<{ amount: Types.Decimal128 }>;
        const totalSpent = projectExpenses.reduce((sum, expense) => addMoney(sum, expense.amount.toString()), '0');
        const approved = project.approvedCost?.toString();
        return { projectId: project._id.toString(), approvedCost: approved ?? null, totalSpent, remainingBudget: approved ? subtractMoney(approved, totalSpent) : null, overrun: approved ? compareMoney(totalSpent, approved) > 0 : false };
      }));
      response.json({ success: true, data: { items: visible, projects: summaries } });
    } catch (error) { next(error); }
  });

  router.get('/expenses/:id', ...read, async (request, response, next) => {
    try {
      const user = currentUser(request); const record = await Expense.findById(objectId(request.params.id, 'expenseId')).select(fullFields).lean().exec() as Record<string, any> | null;
      if (!record) throw notFound();
      const project = await findProject(record.projectId, user);
      if (!project) throw notFound();
      if (user.role === 'OWNER_MEMBER') {
        await assertOwnerSocietyAccess(user, project.societyId.toString());
        if (!['APPROVED', 'VENDOR_SELECTED', 'IN_PROGRESS', 'COMPLETED', 'FINAL_INVOICE', 'CLOSED'].includes(project.status)) throw notFound();
      }
      response.json({ success: true, data: serialize(record, user.role === 'OWNER_MEMBER') });
    } catch (error) { next(error); }
  });

  router.post('/expenses', ...write, async (request, response, next) => {
    try {
      const user = currentUser(request); const body = objectBody(request.body);
      const allowed = ['projectId', 'budgetCategoryId', 'vendorId', 'title', 'description', 'amount', 'invoiceReference', 'expenseDate'];
      if (Object.keys(body).some(key => !allowed.includes(key))) throw validation('The expense contains unsupported fields.');
      const projectId = objectId(body.projectId, 'projectId'); const categoryId = objectId(body.budgetCategoryId, 'budgetCategoryId');
      const amount = parseMoney(body.amount); const title = text(body.title, 'title', 160);
      const description = optionalText(body.description, 'description', 2000); const invoiceReference = optionalText(body.invoiceReference, 'invoiceReference', 240);
      const date = body.expenseDate === undefined ? new Date() : new Date(String(body.expenseDate));
      if (Number.isNaN(date.getTime()) || date > new Date()) throw validation('expenseDate must be a valid date no later than today.');
      const session = await mongoose.startSession();
      try {
        let created: Record<string, unknown> | null = null;
        await session.withTransaction(async () => {
          const project = await findProject(projectId, user, session); if (!project) return;
          if (!['APPROVED', 'IN_PROGRESS'].includes(project.status)) throw new ApiError(409, 'PROJECT_NOT_APPROVED', 'Expenses can be recorded only against an approved or in-progress project.');
          if (!project.approvedCost) throw new ApiError(409, 'APPROVED_COST_REQUIRED', 'The project has no persisted approved cost; no expense was recorded.');
          if (!project.budgetId) throw new ApiError(409, 'PROJECT_BUDGET_REQUIRED', 'Link this project to an approved society budget before recording expenses.');
          const budget = await Budget.findOne({ _id: project.budgetId, societyId: project.societyId, status: 'APPROVED' }).session(session).lean().exec();
          if (!budget) throw new ApiError(409, 'APPROVED_BUDGET_REQUIRED', 'A matching approved society budget is required before recording project expenses.');
          const category = await BudgetCategory.findOne({ _id: categoryId, budgetId: project.budgetId }).session(session).lean().exec() as unknown as CategoryRecord | null;
          if (!category) throw new ApiError(409, 'BUDGET_CATEGORY_MISMATCH', 'Select a category belonging to this project’s approved budget.');
          if (body.vendorId !== undefined && !await Vendor.exists({ _id: objectId(body.vendorId, 'vendorId'), societyId: project.societyId })) throw new ApiError(404, 'NOT_FOUND', 'Vendor not found in this society.');
          const projectRows = await Expense.find({ projectId: project._id, societyId: project.societyId }).select('amount').session(session).lean().exec() as unknown as Array<{ amount: Types.Decimal128 }>;
          const categoryRows = await Expense.find({ budgetCategoryId: category._id, budgetId: project.budgetId }).select('amount').session(session).lean().exec() as unknown as Array<{ amount: Types.Decimal128 }>;
          const projectSpent = projectRows.reduce((sum, row) => addMoney(sum, row.amount.toString()), '0');
          const categorySpent = categoryRows.reduce((sum, row) => addMoney(sum, row.amount.toString()), '0');
          const { nextProjectSpent } = validateExpenseLimits(projectSpent, categorySpent, amount, project.approvedCost.toString(), category.allocatedAmount.toString());
          const projectLock = await Project.updateOne({ _id: project._id, societyId: project.societyId, __v: project.__v, status: { $in: ['APPROVED', 'IN_PROGRESS'] } }, { $inc: { __v: 1 } }, { session });
          if (projectLock.modifiedCount !== 1) throw new ApiError(409, 'PROJECT_CHANGED', 'Project state changed during expense recording. Refresh and retry.');
          const categoryLock = await BudgetCategory.updateOne({ _id: category._id, budgetId: project.budgetId, __v: category.__v }, { $inc: { __v: 1 } }, { session });
          if (categoryLock.modifiedCount !== 1) throw new ApiError(409, 'BUDGET_CHANGED', 'Budget category changed during expense recording. Refresh and retry.');
          const expenseId = new Types.ObjectId();
          const [expense] = await Expense.create([{ _id: expenseId, societyId: project.societyId, projectId: project._id, budgetId: project.budgetId, budgetCategoryId: category._id, ...(body.vendorId ? { vendorId: objectId(body.vendorId, 'vendorId') } : {}), title, ...(description ? { description } : {}), amount: Types.Decimal128.fromString(amount), ...(invoiceReference ? { invoiceReference } : {}), expenseDate: date, createdBy: user.userId }], { session });
          const totalCategorySpent = addMoney(categorySpent, amount);
          await BudgetCategory.updateOne({ _id: category._id, budgetId: project.budgetId }, { $set: { spentAmount: Types.Decimal128.fromString(totalCategorySpent), remainingAmount: Types.Decimal128.fromString(subtractMoney(category.allocatedAmount.toString(), totalCategorySpent)) } }, { session });
          const allCategories = await BudgetCategory.find({ budgetId: project.budgetId }).select('allocatedAmount spentAmount').session(session).lean().exec() as unknown as Array<{ allocatedAmount: Types.Decimal128; spentAmount: Types.Decimal128 }>;
          const allocated = allCategories.reduce((sum, item) => addMoney(sum, item.allocatedAmount.toString()), '0');
          const spent = allCategories.reduce((sum, item) => addMoney(sum, item.spentAmount.toString()), '0');
          await Budget.updateOne({ _id: project.budgetId, societyId: project.societyId, status: 'APPROVED' }, { $set: { totalAllocated: Types.Decimal128.fromString(allocated), totalSpent: Types.Decimal128.fromString(spent), totalRemaining: Types.Decimal128.fromString(subtractMoney(allocated, spent)) } }, { session });
          await new AuditLog({ societyId: project.societyId, actorId: user.userId, action: 'PROJECT_EXPENSE_RECORDED', entityType: 'Expense', entityId: expense._id, previousState: { projectSpent, categorySpent }, newState: { projectId: project._id, amount, projectSpent: nextProjectSpent, projectApprovedCost: project.approvedCost.toString(), categorySpent: totalCategorySpent, categoryAllocatedAmount: category.allocatedAmount.toString(), status: 'RECORDED' } }).save({ session });
          created = serialize(expense.toObject() as Record<string, any>, false);
        });
        if (!created) throw notFound();
        response.status(201).json({ success: true, data: created });
      } finally { await session.endSession(); }
    } catch (error) { next(error); }
  });
  return router;
}

async function findProject(id: Types.ObjectId, user: CurrentUserContext, session?: mongoose.ClientSession): Promise<ProjectRecord | null> {
  const query: Record<string, unknown> = { _id: id }; if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
  return await Project.findOne(query).select('_id societyId status approvedCost budgetId __v').session(session ?? null).lean().exec() as unknown as ProjectRecord | null;
}
function serialize(record: Record<string, any>, owner: boolean) {
  const result: Record<string, unknown> = { _id: String(record._id), societyId: String(record.societyId), projectId: String(record.projectId), budgetId: String(record.budgetId), budgetCategoryId: String(record.budgetCategoryId), ...(record.vendorId ? { vendorId: String(record.vendorId) } : {}), title: record.title, amount: record.amount.toString(), status: record.status, expenseDate: record.expenseDate, createdAt: record.createdAt };
  if (!owner) { if (record.description) result.description = record.description; if (record.invoiceReference) result.invoiceReference = record.invoiceReference; result.createdBy = String(record.createdBy); }
  return result;
}
function currentUser(request: Request): CurrentUserContext { if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'); return request.currentUser; }
function objectBody(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('The request body must be a JSON object.'); return value as Record<string, unknown>; }
function objectId(value: unknown, field: string): Types.ObjectId { if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation(`${field} must be a valid ObjectId.`); return new Types.ObjectId(value); }
function text(value: unknown, field: string, max: number): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw validation(`${field} is required and must not exceed ${max} characters.`); return value.trim(); }
function optionalText(value: unknown, field: string, max: number): string | undefined { if (value === undefined || value === '') return undefined; return text(value, field, max); }
function rejectUnknownQuery(request: Request, allowed: string[]) { if (Object.keys(request.query).some(key => !allowed.includes(key))) throw validation('Unsupported expense filter.'); }
function validation(message: string) { return new ApiError(400, 'VALIDATION_ERROR', message); }
function notFound() { return new ApiError(404, 'NOT_FOUND', 'Expense or project not found.'); }
