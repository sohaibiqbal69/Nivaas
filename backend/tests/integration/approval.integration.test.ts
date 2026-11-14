import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createApprovalRouter } from '../../src/modules/approval/approval-routes.js';
import { ApprovalDecision } from '../../src/modules/approval/models/ApprovalDecision.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { SocietyRuleVersion } from '../../src/modules/society/models/SocietyRuleVersion.js';
import { createSocietiesRouter } from '../../src/modules/society/society-routes.js';
import { User } from '../../src/modules/users/models/User.js';
import { Committee } from '../../src/modules/committee/models/Committee.js';
import { CommitteeMember } from '../../src/modules/committee/models/CommitteeMember.js';
import { CommitteeApprovalElectorate } from '../../src/modules/approval/models/CommitteeApprovalElectorate.js';
import { CommitteeApprovalVote } from '../../src/modules/approval/models/CommitteeApprovalVote.js';
import { CommitteeApprovalResult } from '../../src/modules/approval/models/CommitteeApprovalResult.js';
import { Ownership } from '../../src/modules/property/models/Ownership.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'approval-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const projectA = new Types.ObjectId();
const projectB = new Types.ObjectId();
const projectC = new Types.ObjectId();
const platformAdmin = new Types.ObjectId();
const ownerA = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createApprovalRouter(createAuthenticationMiddleware(() => secret)));
  application.use('/api/societies', createSocietiesRouter(undefined, createAuthenticationMiddleware(() => secret)));
  application.use(errorHandler);
  return application;
}

async function request(application: express.Express, path: string, userId: Types.ObjectId, init?: RequestInit) {
  const token = await issueAccessToken(userId.toString(), { secret, accessTokenTtlSeconds: 300 });
  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Integration server did not bind.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return response;
}

describe('Approval Engine MongoDB integration', () => {
  beforeAll(async () => connectIntegrationTestDatabase());
  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    const ruleA = new Types.ObjectId();
    const ruleB = new Types.ObjectId();
    await Society.create([
      { _id: societyA, name: 'Society A', status: 'ACTIVE', activeRuleVersionId: ruleA },
      { _id: societyB, name: 'Society B', status: 'ACTIVE', activeRuleVersionId: ruleB },
    ]);
    await User.create([
      { _id: platformAdmin, name: 'Platform Admin', email: `${platformAdmin}@test`, role: 'SYSTEM_ADMIN', status: 'ACTIVE' },
      { _id: managerA, name: 'Manager A', email: `${managerA}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyA },
      { _id: managerB, name: 'Manager B', email: `${managerB}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyB },
      { _id: ownerA, name: 'Owner A', email: `${ownerA}@test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyA },
    ]);
    await Ownership.create({ societyId: societyA, flatId: new Types.ObjectId(), userId: ownerA, ownershipType: 'PRIMARY', status: 'ACTIVE' });
    await SocietyRuleVersion.create([
      {
        _id: ruleA, societyId: societyA, versionNumber: 1, status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 1000), createdBy: managerA,
        approvalPolicy: { threshold: '100000' },
      },
      {
        _id: ruleB, societyId: societyB, versionNumber: 1, status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 1000), createdBy: managerB,
        approvalPolicy: { threshold: '200000' },
      },
    ]);
    await Project.create([
      {
        _id: projectA, societyId: societyA, title: 'A', description: 'A',
        category: 'Repairs', estimatedCost: '100000', proposedBy: managerA, status: 'SUBMITTED',
      },
      {
        _id: projectB, societyId: societyB, title: 'B', description: 'B',
        category: 'Repairs', estimatedCost: '200000.01', proposedBy: managerB, status: 'SUBMITTED',
      },
      {
        _id: projectC, societyId: societyA, title: 'C', description: 'C',
        category: 'Repairs', estimatedCost: '99999.99', proposedBy: managerA, status: 'SUBMITTED',
      },
    ]);
  });
  afterAll(async () => disconnectIntegrationTestDatabase());

  it('uses each society threshold and preserves decision snapshots', async () => {
    const application = app();
    const equal = await request(application, `/api/projects/${projectA}/submit-for-approval`, managerA, { method: 'POST' });
    expect(equal.status).toBe(201);
    expect((await equal.json()).data).toMatchObject({ approvalType: 'COMMITTEE_APPROVAL', threshold: '100000' });

    const above = await request(application, `/api/projects/${projectB}/submit-for-approval`, managerB, { method: 'POST' });
    expect(above.status).toBe(201);
    expect((await above.json()).data).toMatchObject({ approvalType: 'SGM_REQUIRED', threshold: '200000' });

    const below = await request(application, `/api/projects/${projectC}/submit-for-approval`, managerA, { method: 'POST' });
    expect(below.status).toBe(201);
    expect((await below.json()).data).toMatchObject({ approvalType: 'COMMITTEE_APPROVAL', threshold: '100000' });

    const decision = await ApprovalDecision.findOne({ projectId: projectA }).lean();
    expect(decision?.ruleSnapshot).toMatchObject({ threshold: '100000', versionNumber: 1 });
    expect(await AuditLog.countDocuments({ entityType: 'ApprovalDecision' })).toBe(3);

    const history = await request(application, `/api/projects/${projectA}/approval-history`, managerA);
    expect(history.status).toBe(200);
    const historyData = (await history.json()).data;
    expect(historyData).toMatchObject([{
      projectId: projectA.toString(), approvalType: 'COMMITTEE_APPROVAL', status: 'REQUIRED',
    }]);
    expect(historyData[0].ruleVersionId).toBe(decision?.ruleVersionId.toString());
    expect((await request(application, `/api/projects/${projectA}/approval-history`, managerB)).status).toBe(404);
    const ownerDecision = await request(application, `/api/projects/${projectA}/approval`, ownerA);
    expect(ownerDecision.status).toBe(200);
    expect((await ownerDecision.json()).data).toMatchObject({ projectId: projectA.toString(), approvalType: 'COMMITTEE_APPROVAL', evaluatedAmount: '100000' });
    expect((await request(application, `/api/projects/${projectB}/approval`, ownerA)).status).toBe(404);
  });

  it('records one current committee member decision and finalizes only after quorum and majority', async () => {
    const application = app();
    const committeeUser = new Types.ObjectId();
    const committeeId = new Types.ObjectId();
    await User.create({ _id: committeeUser, name: 'Committee Member', email: `${committeeUser}@test`, role: 'COMMITTEE_MEMBER', status: 'ACTIVE', societyId: societyA });
    await Committee.create({ _id: committeeId, societyId: societyA, name: 'Active Committee', status: 'ACTIVE' });
    await CommitteeMember.create({ committeeId, userId: committeeUser, position: 'Member', status: 'ACTIVE' });
    const evaluation = await request(application, `/api/projects/${projectA}/submit-for-approval`, managerA, { method: 'POST' });
    expect(evaluation.status).toBe(201);
    const pendingForMember = await request(application, '/api/committee-approvals/pending-for-me', committeeUser);
    expect(pendingForMember.status).toBe(200);
    expect((await pendingForMember.json()).data).toMatchObject([{ projectId: projectA.toString(), title: 'A', status: 'COMMITTEE_APPROVAL' }]);
    expect((await request(application, '/api/committee-approvals/pending-for-me', ownerA)).status).toBe(403);
    expect((await request(application, '/api/committee-approvals/pending-for-me', managerA)).status).toBe(403);
    const recorded = await request(application, `/api/projects/${projectA}/committee-approval/decisions`, committeeUser, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'APPROVE', rationale: 'Within approved budget.' }),
    });
    const recordedBody = await recorded.json();
    expect(recorded.status, JSON.stringify(recordedBody)).toBe(201);
    expect(recordedBody.data).toMatchObject({ totalCommitteeMembers: 1, participatingMembers: 1, approveCount: 1, quorumRequired: 1, quorumMet: true, outcome: 'APPROVED' });
    expect((await request(application, '/api/committee-approvals/pending-for-me', committeeUser).then((response) => response.json())).data).toEqual([]);
    const memberDecision = await CommitteeApprovalVote.findOne({ projectId: projectA }).lean().exec() as Record<string, any> | null;
    expect(memberDecision).toMatchObject({ voterId: committeeUser, decision: 'APPROVE', rationale: 'Within approved budget.' });
    expect(memberDecision?.decidedAt).toBeInstanceOf(Date);
    expect(String(memberDecision?.proposalVersionId)).toBe(String(memberDecision?.approvalDecisionId));
    expect(await CommitteeApprovalElectorate.countDocuments({ projectId: projectA })).toBe(1);
    expect(await CommitteeApprovalVote.countDocuments({ projectId: projectA })).toBe(1);
    expect((await request(application, `/api/projects/${projectA}/committee-approval/decisions`, ownerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'APPROVE' }),
    })).status).toBe(403);
    expect((await request(application, `/api/projects/${projectA}/committee-approval/finalize`, managerB, { method: 'POST' })).status).toBe(404);
    const duplicate = await request(application, `/api/projects/${projectA}/committee-approval/decisions`, committeeUser, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'REJECT' }),
    });
    expect(duplicate.status).toBe(409);
    const finalized = await request(application, `/api/projects/${projectA}/committee-approval/finalize`, managerA, { method: 'POST' });
    const finalizedBody = await finalized.json();
    expect(finalized.status, JSON.stringify(finalizedBody)).toBe(200);
    expect(finalizedBody.data).toMatchObject({ status: 'APPROVED', outcome: 'APPROVED', quorumMet: true });
    expect(await Project.findById(projectA).select('status approvalStatus approvedCost').lean()).toMatchObject({ status: 'APPROVED', approvalStatus: 'APPROVED', approvedCost: Types.Decimal128.fromString('100000') });
    expect(await CommitteeApprovalResult.countDocuments({ projectId: projectA, outcome: 'APPROVED' })).toBe(1);
    expect(await AuditLog.countDocuments({
      entityType: 'ApprovalDecision', entityId: memberDecision?.approvalDecisionId,
      action: { $in: ['COMMITTEE_APPROVAL_ELECTORATE_SNAPSHOTTED', 'COMMITTEE_PROJECT_DECISION_RECORDED', 'COMMITTEE_PROJECT_DECISION_FINALIZED'] },
    })).toBe(3);
  });

  it('does not finalize below quorum and keeps a tied majority pending', async () => {
    const application = app();
    const committeeId = new Types.ObjectId();
    const members = Array.from({ length: 6 }, () => new Types.ObjectId());
    await Committee.create({ _id: committeeId, societyId: societyA, name: 'Quorum Committee', status: 'ACTIVE' });
    await User.create(members.map((id) => ({ _id: id, name: 'Committee Member', email: `${id}@test`, role: 'COMMITTEE_MEMBER', status: 'ACTIVE', societyId: societyA })));
    await CommitteeMember.create(members.map((userId) => ({ committeeId, userId, position: 'Member', status: 'ACTIVE' })));
    expect((await request(application, `/api/projects/${projectA}/submit-for-approval`, managerA, { method: 'POST' })).status).toBe(201);
    const cast = async (userId: Types.ObjectId, decision: 'APPROVE' | 'REJECT') => request(application, `/api/projects/${projectA}/committee-approval/decisions`, userId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    expect((await cast(members[0]!, 'APPROVE')).status).toBe(201);
    expect((await cast(members[1]!, 'APPROVE')).status).toBe(201);
    const belowQuorum = await request(application, `/api/projects/${projectA}/committee-approval/finalize`, managerA, { method: 'POST' });
    expect(belowQuorum.status).toBe(409);
    expect((await belowQuorum.json()).error.code).toBe('COMMITTEE_QUORUM_NOT_MET');
    expect((await Project.findById(projectA).select('status').lean())?.status).toBe('COMMITTEE_APPROVAL');

    expect((await cast(members[2]!, 'REJECT')).status).toBe(201);
    expect((await cast(members[3]!, 'REJECT')).status).toBe(201);
    const tied = await request(application, `/api/projects/${projectA}/committee-approval/finalize`, managerA, { method: 'POST' });
    expect(tied.status).toBe(409);
    expect((await tied.json()).error.code).toBe('COMMITTEE_MAJORITY_NOT_MET');
    expect((await Project.findById(projectA).select('status').lean())?.status).toBe('COMMITTEE_APPROVAL');
    expect((await cast(members[4]!, 'REJECT')).status).toBe(201);
    expect((await cast(members[5]!, 'REJECT')).status).toBe(201);
    const rejected = await request(application, `/api/projects/${projectA}/committee-approval/finalize`, managerA, { method: 'POST' });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).data).toMatchObject({ status: 'REJECTED', outcome: 'REJECTED', rejectCount: 4, quorumMet: true });
    expect((await Project.findById(projectA).select('status approvalStatus').lean())).toMatchObject({ status: 'REJECTED', approvalStatus: 'REJECTED' });
  });

  it('provisions one active default rule atomically when a society is created', async () => {
    const application = app();
    const response = await request(application, '/api/societies', platformAdmin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Provisioned Society' }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    const society = await Society.findOne({ name: 'Provisioned Society' }).lean();
    expect(society?._id.toString()).toBe(body.data._id);
    const rule = await SocietyRuleVersion.findOne({ societyId: society?._id }).lean();
    expect(rule).toMatchObject({ versionNumber: 1, status: 'ACTIVE', approvalPolicy: { threshold: '100000' } });
    expect(society?.activeRuleVersionId?.toString()).toBe(rule?._id.toString());
    expect(await SocietyRuleVersion.countDocuments({ societyId: society?._id, status: 'ACTIVE' })).toBe(1);
  });

  it('enforces society isolation and blocks evaluation without active configuration', async () => {
    const application = app();
    expect((await request(application, `/api/projects/${projectA}/approval`, managerB)).status).toBe(404);
    await Society.updateOne({ _id: societyA }, { $unset: { activeRuleVersionId: 1 } });
    const response = await request(application, `/api/projects/${projectA}/submit-for-approval`, managerA, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await ApprovalDecision.countDocuments({ projectId: projectA })).toBe(0);
    expect(await AuditLog.countDocuments({ entityType: 'ApprovalDecision' })).toBe(0);
  });
});
