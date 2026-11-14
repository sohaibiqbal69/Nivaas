import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { hashAuditLog } from '../../src/modules/audit/audit-log-hashing.js';
import { Membership } from '../../src/modules/membership/models/Membership.js';
import { createGovernanceRouter } from '../../src/modules/governance/governance-routes.js';
import { GovernanceEligibilitySnapshot } from '../../src/modules/governance/models/GovernanceEligibilitySnapshot.js';
import { GovernanceResolution } from '../../src/modules/governance/models/GovernanceResolution.js';
import { ApprovalDecision } from '../../src/modules/approval/models/ApprovalDecision.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { Quotation } from '../../src/modules/quotation/models/Quotation.js';
import { AuditLogProofService } from '../../src/modules/blockchain/audit-log-proof-service.js';
import { vi } from 'vitest';
import { GovernanceVote } from '../../src/modules/governance/models/GovernanceVote.js';
import { OfflineResolutionRecordModel } from '../../src/modules/governance/models/OfflineResolutionRecord.js';
import { Meeting } from '../../src/modules/governance/models/Meeting.js';
import { SocietyRuleVersion } from '../../src/modules/society/models/SocietyRuleVersion.js';
import { hashApprovalPolicyCommitment } from '../../src/modules/society/approval-policy.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'governance-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const eligibleA = new Types.ObjectId();
const ruleA = new Types.ObjectId();

function testPolicy(confirmedBy: Types.ObjectId) {
  const configuredDecision = {
    decisionBody: 'GENERAL_BODY',
    eligibility: { membershipTypes: ['PRIMARY'], membershipStatuses: ['ACTIVE'], requiredEvidence: [] },
    quorum: { population: 'ELIGIBLE_MEMBERS', numerator: 2, denominator: 3, maximum: 20, rounding: 'CEILING' },
    majority: { numerator: 1, denominator: 2, denominatorBasis: 'YES_NO', comparison: 'STRICTLY_GREATER', abstentionTreatment: 'EXCLUDED', tieOutcome: 'NO_DECISION' },
    voting: { methods: ['SHOW_OF_HANDS'], oneMemberOneVote: true, voteChangePolicy: 'IMMUTABLE_AFTER_CAST', ballotPrivacy: 'RECORDED' },
  };
  return {
    schemaVersion: 1,
    confirmationState: 'CONFIRMED',
    confirmedDocumentReference: 'integration-fixture-only',
    confirmedAt: new Date('2026-01-01T00:00:00Z'),
    confirmedBy,
    decisionPolicies: [
      { resolutionType: 'PROJECT_APPROVAL', ...configuredDecision },
      { resolutionType: 'OTHER', ...configuredDecision },
    ],
  };
}

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createGovernanceRouter(createAuthenticationMiddleware(() => secret), undefined, async () => ({ status: 'PENDING', retryAvailable: true })));
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

describe('Governance meeting and resolution API integration', () => {
  beforeAll(async () => connectIntegrationTestDatabase());
  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    await Promise.all([GovernanceEligibilitySnapshot.createIndexes(), GovernanceVote.createIndexes()]);
    await Society.create([
      { _id: societyA, name: 'Governance Society A', status: 'ACTIVE', activeRuleVersionId: ruleA, configurationVersion: 1 },
      { _id: societyB, name: 'Governance Society B', status: 'ACTIVE' },
    ]);
    await User.create([
      { _id: managerA, name: 'Manager A', email: `${managerA}@gov-test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyA },
      { _id: managerB, name: 'Manager B', email: `${managerB}@gov-test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyB },
      { _id: eligibleA, name: 'Member A', email: `${eligibleA}@gov-test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyA },
    ]);
    await SocietyRuleVersion.create({
      _id: ruleA, societyId: societyA, versionNumber: 1, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01'),
      approvalPolicy: { threshold: '100000' }, noticeRules: { agmClearDays: 14, ordinarySgmClearDays: 5 }, governancePolicy: testPolicy(managerA), createdBy: managerA,
    });
    await Membership.create({
      societyId: societyA, userId: eligibleA, unitId: new Types.ObjectId(), membershipType: 'PRIMARY',
      membershipStatus: 'ACTIVE', validFrom: new Date('2020-01-01'),
    });
  });
  afterAll(async () => disconnectIntegrationTestDatabase());

  it('publishes a meeting, snapshots membership, and runs an authenticated resolution to finalization', async () => {
    const application = app();
    const meetingResponse = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Repair discussion', agenda: ['Repair proposal'], scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    expect(meetingResponse.status).toBe(201);
    const meeting = (await meetingResponse.json()).data;
    expect(meeting).toMatchObject({ societyId: societyA.toString(), status: 'DRAFT', type: 'SGM' });

    const crossSocietyRead = await request(application, `/api/meetings/${meeting._id}`, managerB);
    expect(crossSocietyRead.status).toBe(404);

    const publishedResponse = await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'TEST-NOTICE-001', noticeIssuedAt: '2026-11-20T10:00:00.000Z' }),
    });
    const publishedData = await publishedResponse.json();
    expect(publishedResponse.status, JSON.stringify(publishedData)).toBe(200);
    expect(publishedData.data.status).toBe('PUBLISHED');

    const now = Date.now();
    const votingStart = new Date(now - 60_000).toISOString();
    const votingEnd = new Date(now + 60_000).toISOString();

    const resolutionResponse = await request(application, '/api/resolutions', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'OTHER',
        decisionBody: 'GENERAL_BODY', votingMethod: 'SHOW_OF_HANDS', title: 'Repair proposal vote',
        votingStart, votingEnd,
      }),
    });
    expect(resolutionResponse.status).toBe(201);
    const resolution = (await resolutionResponse.json()).data;
    expect(resolution).toMatchObject({ status: 'DRAFT', societyId: societyA.toString(), meetingId: meeting._id });
    const crossSocietyResolution = await request(application, `/api/resolutions/${resolution._id}`, managerB);
    expect(crossSocietyResolution.status).toBe(404);
    const crossSocietyVote = await request(application, `/api/resolutions/${resolution._id}/votes`, managerB, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: 'YES' }),
    });
    expect(crossSocietyVote.status).toBe(404);

    const snapshotResponses = await Promise.all([
      request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' }),
      request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' }),
    ]);
    expect(snapshotResponses.map((result) => result.status).sort()).toEqual([201, 409]);
    const snapshotResponse = snapshotResponses.find((result) => result.status === 201)!;
    const snapshotData = (await snapshotResponse.json()).data;
    expect(snapshotData).toMatchObject({ eligibleCount: 1, societyId: societyA.toString() });
    expect(JSON.stringify(snapshotData)).not.toContain(eligibleA.toString());
    expect(await GovernanceEligibilitySnapshot.countDocuments({ resolutionId: resolution._id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: { $in: ['GOVERNANCE_MEETING_DRAFT_CREATED', 'GOVERNANCE_RESOLUTION_DRAFT_CREATED', 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_CREATED'] } })).toBe(3);

    const openResponse = await request(application, `/api/resolutions/${resolution._id}/open`, managerA, { method: 'POST' });
    expect(openResponse.status).toBe(200);
    const cast = await request(application, `/api/resolutions/${resolution._id}/votes`, eligibleA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: 'YES' }) });
    expect(cast.status).toBe(201);
    const ownVote = await request(application, `/api/resolutions/${resolution._id}/my-vote`, eligibleA);
    expect((await ownVote.json()).data.vote).toBe('YES');
    const duplicate = await request(application, `/api/resolutions/${resolution._id}/votes`, eligibleA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: 'NO' }) });
    expect(duplicate.status).toBe(409);
    await GovernanceResolution.collection.updateOne({ _id: new Types.ObjectId(resolution._id) }, { $set: { votingEnd: new Date(Date.now() - 1000) } });
    const close = await request(application, `/api/resolutions/${resolution._id}/close`, managerA, { method: 'POST' });
    const closedData = await close.json();
    expect(close.status, JSON.stringify(closedData)).toBe(200);
    expect(closedData.data.result).toMatchObject({ outcome: 'APPROVED', quorumMet: true, totalVotes: 1, quorumRequired: 1 });
    const closedRecord = await GovernanceResolution.findById(resolution._id).exec();
    closedRecord!.result!.yesCount = 0;
    await expect(closedRecord!.save()).rejects.toThrow('A calculated governance result is immutable after voting closes.');
    await expect(GovernanceResolution.updateOne({ _id: resolution._id }, { $set: { 'result.yesCount': 0 } })).rejects.toThrow('Calculated governance results are immutable historical evidence.');
    const finalize = await request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' });
    expect(finalize.status).toBe(200);
    expect((await finalize.json()).data.status).toBe('APPROVED');
    const retryFinalize = await request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' });
    expect(retryFinalize.status).toBe(200);
    expect((await retryFinalize.json()).data.status).toBe('APPROVED');
    expect(await AuditLog.countDocuments({ action: { $in: ['GOVERNANCE_MEETING_DRAFT_CREATED', 'GOVERNANCE_MEETING_PUBLISHED', 'GOVERNANCE_RESOLUTION_DRAFT_CREATED', 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_CREATED', 'GOVERNANCE_RESOLUTION_OPENED', 'GOVERNANCE_VOTE_ACCEPTED', 'GOVERNANCE_RESOLUTION_CLOSED', 'GOVERNANCE_RESOLUTION_FINALIZED'] } })).toBe(8);
  });

  it('returns an actionable 409 when a general-body meeting lacks the configured clear notice days', async () => {
    const application = app();
    const created = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Notice-period conflict', agenda: ['Repair proposal'], scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    expect(created.status).toBe(201);
    const meeting = (await created.json()).data;
    const conflict = await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'SHORT-NOTICE-001', noticeIssuedAt: '2026-11-28T10:00:00.000Z' }),
    });
    const payload = await conflict.json();
    expect(conflict.status).toBe(409);
    expect(payload.error.code).toBe('NOTICE_PERIOD_INSUFFICIENT');
    expect(payload.error.message).toContain('2 clear notice days');
    expect(payload.error.message).toContain('active society rule requires 5');
    expect(payload.error.message).toContain('Issue the notice earlier or choose a later meeting date');
    expect((await Meeting.findById(meeting._id).lean())?.status).toBe('DRAFT');
  });

  it('records an offline general-body decision with attendance, counts, evidence and manager confirmation', async () => {
    const application = app();
    const eligibleB = new Types.ObjectId();
    const ineligible = new Types.ObjectId();
    await User.create([
      { _id: eligibleB, name: 'Member B', email: `${eligibleB}@gov-test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyA },
      { _id: ineligible, name: 'Not Eligible', email: `${ineligible}@gov-test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyA },
    ]);
    await Membership.create({ societyId: societyA, userId: eligibleB, unitId: new Types.ObjectId(), membershipType: 'PRIMARY', membershipStatus: 'ACTIVE', validFrom: new Date('2020-01-01') });
    const created = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Offline decision', agenda: ['Repair decision'], scheduledAt: '2026-10-20T10:00:00.000Z', documentReferences: [{ kind: 'PROPOSAL', reference: 'proposal-copy-1' }] }),
    });
    expect(created.status).toBe(201);
    const meeting = (await created.json()).data;
    expect(meeting.documentReferences).toEqual([{ kind: 'PROPOSAL', reference: 'proposal-copy-1' }]);
    const published = await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'offline-notice-1', noticeIssuedAt: '2026-10-14T10:00:00.000Z' }),
    });
    expect(published.status).toBe(200);
    const resolutionResponse = await request(application, '/api/resolutions', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'OTHER', decisionBody: 'GENERAL_BODY', votingMethod: 'SHOW_OF_HANDS', title: 'Offline repair decision', votingStart: '2026-10-20T10:00:00.000Z', votingEnd: '2026-10-20T10:01:00.000Z' }),
    });
    expect(resolutionResponse.status).toBe(201);
    const resolution = (await resolutionResponse.json()).data;
    const snapshot = await request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' });
    expect(snapshot.status).toBe(201);
    const eligibleAttendees = await request(application, `/api/resolutions/${resolution._id}/eligible-attendees`, managerA);
    expect(eligibleAttendees.status).toBe(200);
    expect((await eligibleAttendees.json()).data).toEqual(expect.arrayContaining([
      { memberId: eligibleA.toString(), displayName: 'Member A' },
      { memberId: eligibleB.toString(), displayName: 'Member B' },
    ]));
    const crossSociety = await request(application, `/api/resolutions/${resolution._id}/eligible-attendees`, managerB);
    expect(crossSociety.status).toBe(404);
    const ineligibleAttendance = await request(application, `/api/resolutions/${resolution._id}/record-offline`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, method: 'SHOW_OF_HANDS', attendanceMemberIds: [ineligible.toString()], yesCount: 1, noCount: 0, abstainCount: 0, minutesReference: 'minutes-reference-1', supportingEvidenceReferences: ['signed-minutes-1'] }),
    });
    expect(ineligibleAttendance.status).toBe(409);
    expect((await ineligibleAttendance.json()).error.code).toBe('INELIGIBLE_ATTENDEE');
    const unauthorized = await request(application, `/api/resolutions/${resolution._id}/record-offline`, managerB, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, method: 'SHOW_OF_HANDS', attendanceMemberIds: [], yesCount: 0, noCount: 0, abstainCount: 0, minutesReference: 'minutes-reference-1', supportingEvidenceReferences: ['signed-minutes-1'] }),
    });
    expect(unauthorized.status).toBe(404);
    const confirmed = await request(application, `/api/resolutions/${resolution._id}/record-offline`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, method: 'SHOW_OF_HANDS', attendanceMemberIds: [eligibleA.toString(), eligibleB.toString()], yesCount: 2, noCount: 0, abstainCount: 0, minutesReference: 'minutes-reference-1', supportingEvidenceReferences: ['signed-minutes-1'] }),
    });
    const response = await confirmed.json();
    expect(confirmed.status, JSON.stringify(response)).toBe(201);
    expect(response.data).toMatchObject({ status: 'APPROVED', result: { attendanceCount: 2, totalVotes: 2, yesCount: 2, noCount: 0, abstainCount: 0, quorumMet: true, outcome: 'APPROVED' }, confirmedBy: managerA.toString() });
    expect(await OfflineResolutionRecordModel.countDocuments({ resolutionId: resolution._id, confirmedBy: managerA })).toBe(1);
    expect(await Meeting.findById(meeting._id).select('attendanceCount quorumStatus status').lean()).toMatchObject({ attendanceCount: 2, quorumStatus: 'MET', status: 'HELD' });
    expect(await AuditLog.countDocuments({ action: 'OFFLINE_GOVERNANCE_DECISION_CONFIRMED', entityId: resolution._id })).toBe(1);
    const duplicate = await request(application, `/api/resolutions/${resolution._id}/record-offline`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, method: 'SHOW_OF_HANDS', attendanceMemberIds: [eligibleA.toString(), eligibleB.toString()], yesCount: 2, noCount: 0, abstainCount: 0, minutesReference: 'minutes-reference-1', supportingEvidenceReferences: ['signed-minutes-1'] }),
    });
    expect(duplicate.status).toBe(404);
  });

  it('records quorum failure without turning it into an approval', async () => {
    const application = app();
    const meetingResponse = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'No attendance SGM', agenda: ['Test quorum'], scheduledAt: '2026-10-20T10:00:00.000Z' }),
    });
    const meeting = (await meetingResponse.json()).data;
    expect(meetingResponse.status).toBe(201);
    expect((await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'no-attendance-notice', noticeIssuedAt: '2026-10-14T10:00:00.000Z' }),
    })).status).toBe(200);
    const created = await request(application, '/api/resolutions', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'OTHER', decisionBody: 'GENERAL_BODY', votingMethod: 'SHOW_OF_HANDS', title: 'No attendance decision', votingStart: '2026-10-20T10:00:00.000Z', votingEnd: '2026-10-20T10:01:00.000Z' }),
    });
    const resolution = (await created.json()).data;
    expect(created.status).toBe(201);
    expect((await request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' })).status).toBe(201);
    const confirmed = await request(application, `/api/resolutions/${resolution._id}/record-offline`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, method: 'SHOW_OF_HANDS', attendanceMemberIds: [], yesCount: 0, noCount: 0, abstainCount: 0, minutesReference: 'no-attendance-minutes', supportingEvidenceReferences: ['signed-no-attendance-minutes'] }),
    });
    const body = await confirmed.json();
    expect(confirmed.status, JSON.stringify(body)).toBe(201);
    expect(body.data).toMatchObject({ status: 'NO_DECISION', result: { attendanceCount: 0, quorumMet: false, outcome: 'NO_DECISION' } });
    expect(await AuditLog.countDocuments({ action: 'OFFLINE_GOVERNANCE_DECISION_CONFIRMED', entityId: resolution._id })).toBe(1);
  });

  it('activates a threshold as a new version, records an audit commitment, and rejects cross-society policy writes', async () => {
    const application = app();
    const historicalDecisionId = new Types.ObjectId();
    await ApprovalDecision.create({
      _id: historicalDecisionId, societyId: societyA, projectId: new Types.ObjectId(), ruleVersionId: ruleA,
      evaluatedAmount: '100000', requiredThreshold: '100000', approvalType: 'COMMITTEE_APPROVAL',
      requiredDecisionBody: 'COMMITTEE', status: 'REQUIRED', reason: 'Historical threshold snapshot',
      evaluatedBy: managerA, ruleSnapshot: { versionNumber: 1, threshold: '100000' },
    });
    const response = await request(application, '/api/society/rules/approval-threshold', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: '125000', supportingDocumentReference: 'MINUTES-2026-04' }),
    });
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(201);
    expect(payload.data).toMatchObject({
      societyId: societyA.toString(), versionNumber: 2, approvalPolicy: { threshold: '125000' },
      supportingDocumentReference: 'MINUTES-2026-04', policyProof: { status: 'PENDING' },
    });
    const oldVersion = await SocietyRuleVersion.findById(ruleA).lean();
    const active = await SocietyRuleVersion.findOne({ societyId: societyA, status: 'ACTIVE' }).lean();
    const society = await Society.findById(societyA).lean();
    expect(oldVersion).toMatchObject({ status: 'SUPERSEDED', approvalPolicy: { threshold: '100000' } });
    expect(active).toMatchObject({ versionNumber: 2, status: 'ACTIVE', approvalPolicy: { threshold: '125000' }, governancePolicy: { schemaVersion: 1, confirmationState: 'CONFIRMED' } });
    expect(society?.activeRuleVersionId?.toString()).toBe(active?._id.toString());
    const historicalDecision = await ApprovalDecision.findById(historicalDecisionId).lean();
    expect(historicalDecision?.ruleVersionId.toString()).toBe(ruleA.toString());
    expect(historicalDecision?.requiredThreshold.toString()).toBe('100000');
    expect(historicalDecision?.evaluatedAmount.toString()).toBe('100000');
    expect(historicalDecision?.ruleSnapshot).toMatchObject({ versionNumber: 1, threshold: '100000' });
    const audit = await AuditLog.findById(payload.data.policyChangeAuditLogId).lean();
    expect(audit).toMatchObject({
      action: 'SOCIETY_APPROVAL_THRESHOLD_CHANGED', societyId: societyA,
      previousState: { approvalPolicy: { threshold: '100000' } },
      newState: { approvalPolicy: { threshold: '125000' }, versionNumber: 2 },
      metadata: { policyType: 'PROJECT_SPENDING_APPROVAL_THRESHOLD', canonicalConfigurationHash: hashApprovalPolicyCommitment({ societyId: societyA.toString(), versionNumber: 2, threshold: '125000' }) },
    });
    expect(hashAuditLog(audit as unknown as Record<string, unknown>)).toBe(audit?.recordHash);

    const unauthorized = await request(application, '/api/society/rules/approval-threshold', eligibleA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: '200000', reason: 'member attempt' }),
    });
    expect(unauthorized.status).toBe(403);
    const crossSociety = await request(application, '/api/society/rules/approval-threshold', managerB, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyA.toString(), threshold: '200000', reason: 'cross-society attempt' }),
    });
    expect(crossSociety.status).toBe(403);
    expect(await SocietyRuleVersion.countDocuments({ societyId: societyA, status: 'ACTIVE' })).toBe(1);
  });

  it('rejects unauthorized writes and creates the database uniqueness indexes', async () => {
    const application = app();
    const memberWrite = await request(application, '/api/meetings', eligibleA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'AGM', title: 'Unauthorized', scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    expect(memberWrite.status).toBe(403);
    const snapshotIndexes = await GovernanceEligibilitySnapshot.collection.indexes();
    const voteIndexes = await GovernanceVote.collection.indexes();
    expect(snapshotIndexes.some((index) => index.unique && index.key.resolutionId === 1)).toBe(true);
    expect(voteIndexes.some((index) => index.unique && index.key.societyId === 1 && index.key.resolutionId === 1 && index.key.voterId === 1)).toBe(true);
  });

  it('activates an immutable starter policy version with explicit product defaults and per-society identity', async () => {
    const application = app();
    const response = await request(application, '/api/society/rules/governance', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starterPolicy: true, confirmedDocumentReference: 'society-registered-bye-law-reference' }),
    });
    expect(response.status).toBe(201);
    const data = (await response.json()).data;
    expect(data).toMatchObject({ societyId: societyA.toString(), versionNumber: 2, status: 'ACTIVE' });
    const projectPolicy = data.governancePolicy.decisionPolicies.find((policy: { resolutionType: string }) => policy.resolutionType === 'PROJECT_APPROVAL');
    expect(projectPolicy).toMatchObject({
      decisionBody: 'GENERAL_BODY',
      eligibility: { membershipTypes: ['PRIMARY'], membershipStatuses: ['ACTIVE'] },
      quorum: { population: 'ELIGIBLE_MEMBERS', numerator: 2, denominator: 3, maximum: 20, rounding: 'CEILING' },
      majority: { numerator: 1, denominator: 2, denominatorBasis: 'YES_NO', comparison: 'STRICTLY_GREATER', abstentionTreatment: 'EXCLUDED', tieOutcome: 'NO_DECISION' },
      voting: { methods: ['SHOW_OF_HANDS'], oneMemberOneVote: true, voteChangePolicy: 'IMMUTABLE_AFTER_CAST', ballotPrivacy: 'RECORDED' },
    });
    expect(await SocietyRuleVersion.countDocuments({ societyId: societyA, status: 'ACTIVE' })).toBe(1);
    expect((await SocietyRuleVersion.findById(ruleA).lean()).status).toBe('SUPERSEDED');
    expect(await SocietyRuleVersion.countDocuments({ societyId: societyB, versionNumber: 2 })).toBe(0);
  });

  it('fails closed when current joint, associate, or provisional members lack verifiable electorate evidence', async () => {
    const application = app();
    const associateId = new Types.ObjectId();
    await User.create({ _id: associateId, name: 'Associate Member', email: `${associateId}@gov-test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyA });
    await Membership.create({
      societyId: societyA, userId: associateId, unitId: new Types.ObjectId(), membershipType: 'ASSOCIATE',
      membershipStatus: 'ACTIVE', validFrom: new Date('2020-01-01'),
    });
    const meetingResponse = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Eligibility evidence check', agenda: ['Ordinary resolution'], scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    const meeting = (await meetingResponse.json()).data;
    expect(meetingResponse.status).toBe(201);
    const publish = await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'ELIGIBILITY-001', noticeIssuedAt: '2026-11-20T10:00:00.000Z' }),
    });
    expect(publish.status).toBe(200);
    const resolutionResponse = await request(application, '/api/resolutions', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'OTHER', decisionBody: 'GENERAL_BODY',
        votingMethod: 'SHOW_OF_HANDS', title: 'Ordinary resolution',
        votingStart: new Date(Date.now() - 60_000).toISOString(), votingEnd: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    expect(resolutionResponse.status).toBe(201);
    const resolution = (await resolutionResponse.json()).data;
    const snapshotResponse = await request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' });
    expect(snapshotResponse.status).toBe(409);
    expect((await snapshotResponse.json()).error.code).toBe('GOVERNANCE_POLICY_UNRESOLVED');
    expect(await GovernanceEligibilitySnapshot.countDocuments({ resolutionId: resolution._id })).toBe(0);
  });

  it('applies the configured quorum boundary, abstention treatment, majority, and tie outcome through the API', async () => {
    const application = app();
    const additionalMembers = [new Types.ObjectId(), new Types.ObjectId()];
    await User.create(additionalMembers.map((id, index) => ({
      _id: id, name: `Member ${index + 2}`, email: `${id}@gov-test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyA,
    })));
    await Membership.create(additionalMembers.map((userId) => ({
      societyId: societyA, userId, unitId: new Types.ObjectId(), membershipType: 'PRIMARY',
      membershipStatus: 'ACTIVE', validFrom: new Date('2020-01-01'),
    })));

    const meetingResponse = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Ordinary decisions', agenda: ['Maintenance decisions'], scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    const meeting = (await meetingResponse.json()).data;
    expect(meetingResponse.status).toBe(201);
    const published = await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'ORDINARY-DECISIONS-001', noticeIssuedAt: '2026-11-20T10:00:00.000Z' }),
    });
    expect(published.status).toBe(200);

    const proofSpy = vi.spyOn(AuditLogProofService.prototype, 'submit').mockResolvedValue({ status: 'PENDING' });
    const calculateOutcome = async (title: string, choices: Array<{ userId: Types.ObjectId; vote: 'YES' | 'NO' | 'ABSTAIN' }>) => {
      const now = Date.now();
      const created = await request(application, '/api/resolutions', managerA, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'OTHER', decisionBody: 'GENERAL_BODY', votingMethod: 'SHOW_OF_HANDS', title, votingStart: new Date(now - 60_000).toISOString(), votingEnd: new Date(now + 60_000).toISOString() }),
      });
      expect(created.status).toBe(201);
      const resolution = (await created.json()).data;
      const snapshot = await request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' });
      expect(snapshot.status).toBe(201);
      expect((await snapshot.json()).data.eligibleCount).toBe(3);
      expect((await request(application, `/api/resolutions/${resolution._id}/open`, managerA, { method: 'POST' })).status).toBe(200);
      for (const choice of choices) {
        const cast = await request(application, `/api/resolutions/${resolution._id}/votes`, choice.userId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: choice.vote }),
        });
        expect(cast.status).toBe(201);
      }
      await GovernanceResolution.collection.updateOne({ _id: new Types.ObjectId(resolution._id) }, { $set: { votingEnd: new Date(Date.now() - 1000) } });
      const closed = await request(application, `/api/resolutions/${resolution._id}/close`, managerA, { method: 'POST' });
      expect(closed.status).toBe(200);
      const outcome = (await closed.json()).data.result;
      const finalized = await request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' });
      expect(finalized.status).toBe(200);
      return outcome;
    };

    try {
      const [yes] = [eligibleA, ...additionalMembers];
      const [second] = additionalMembers;
      await expect(calculateOutcome('Below quorum', [{ userId: yes, vote: 'YES' }])).resolves.toMatchObject({ quorumRequired: 2, quorumMet: false, outcome: 'NO_DECISION' });
      await expect(calculateOutcome('Abstention counts for quorum', [{ userId: yes, vote: 'YES' }, { userId: second!, vote: 'ABSTAIN' }])).resolves.toMatchObject({ quorumRequired: 2, quorumMet: true, yesCount: 1, abstainCount: 1, outcome: 'APPROVED' });
      await expect(calculateOutcome('Tie', [{ userId: yes, vote: 'YES' }, { userId: second!, vote: 'NO' }])).resolves.toMatchObject({ quorumRequired: 2, quorumMet: true, outcome: 'NO_DECISION' });
      await expect(calculateOutcome('Simple majority rejection', [{ userId: yes, vote: 'NO' }, { userId: second!, vote: 'NO' }])).resolves.toMatchObject({ quorumRequired: 2, quorumMet: true, outcome: 'REJECTED' });
      expect(await AuditLog.countDocuments({ action: 'GOVERNANCE_RESOLUTION_FINALIZED' })).toBe(4);
    } finally { proofSpy.mockRestore(); }
  });

  it('approves a project only after a concurrent, idempotent finalization matches the current SGM ApprovalDecision', async () => {
    const application = app();
    const projectId = new Types.ObjectId();
    const approvalDecisionId = new Types.ObjectId();
    const quotationId = new Types.ObjectId();
    const staleQuotationId = new Types.ObjectId();
    await Quotation.create([
      { _id: quotationId, projectId, vendorId: new Types.ObjectId(), versionNumber: 1, amount: Types.Decimal128.fromString('150000'), description: 'Selected quote', status: 'SELECTED' },
      { _id: staleQuotationId, projectId, vendorId: new Types.ObjectId(), versionNumber: 2, amount: Types.Decimal128.fromString('160000'), description: 'New revision', status: 'SELECTED' },
    ]);
    await Project.create({
      _id: projectId, societyId: societyA, title: 'Lift repair', description: 'Repair lift', category: 'REPAIR',
      estimatedCost: Types.Decimal128.fromString('150000'), status: 'SGM_REQUIRED', proposedBy: managerA,
      approvalType: 'SGM_REQUIRED', approvalStatus: 'REQUIRED', activeRuleVersionId: ruleA, currentQuotationId: quotationId,
    });
    await ApprovalDecision.create({
      _id: approvalDecisionId, societyId: societyA, projectId, quotationVersionId: quotationId, ruleVersionId: ruleA,
      evaluatedAmount: Types.Decimal128.fromString('150000'), requiredThreshold: Types.Decimal128.fromString('100000'),
      approvalType: 'SGM_REQUIRED', requiredDecisionBody: 'GENERAL_BODY_OR_SGM', status: 'REQUIRED', reason: 'integration fixture',
      evaluatedBy: managerA, ruleSnapshot: { threshold: '100000' },
    });
    const meetingResponse = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Lift repair SGM', agenda: ['Approve lift repair'], projectId: projectId.toString(), scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    const meeting = (await meetingResponse.json()).data;
    expect(meetingResponse.status).toBe(201);
    const publish = await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noticeReference: 'LIFT-NOTICE-001', noticeIssuedAt: '2026-11-20T10:00:00.000Z' }),
    });
    expect(publish.status).toBe(200);
    const now = Date.now();
    const createResolution = await request(application, '/api/resolutions', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'PROJECT_APPROVAL', decisionBody: 'GENERAL_BODY', projectId: projectId.toString(), approvalDecisionId: approvalDecisionId.toString(), votingMethod: 'SHOW_OF_HANDS', title: 'Lift repair approval', votingStart: new Date(now - 60_000).toISOString(), votingEnd: new Date(now + 60_000).toISOString() }),
    });
    expect(createResolution.status).toBe(201);
    const resolution = (await createResolution.json()).data;
    expect((await Project.findById(projectId).lean()).status).toBe('SGM_REQUIRED');
    expect((await request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' })).status).toBe(201);
    expect((await request(application, `/api/resolutions/${resolution._id}/open`, managerA, { method: 'POST' })).status).toBe(200);
    expect((await request(application, `/api/resolutions/${resolution._id}/votes`, eligibleA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: 'YES' }) })).status).toBe(201);
    await GovernanceResolution.collection.updateOne({ _id: new Types.ObjectId(resolution._id) }, { $set: { votingEnd: new Date(Date.now() - 1000) } });
    expect((await request(application, `/api/resolutions/${resolution._id}/close`, managerA, { method: 'POST' })).status).toBe(200);
    expect((await Project.findById(projectId).lean()).status).toBe('SGM_REQUIRED');

    await Project.collection.updateOne({ _id: projectId }, { $set: { currentQuotationId: staleQuotationId } });
    const staleFinalize = await request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' });
    expect(staleFinalize.status).toBe(409);
    expect((await staleFinalize.json()).error.code).toBe('APPROVAL_DECISION_STALE');
    expect((await Project.findById(projectId).lean()).status).toBe('SGM_REQUIRED');
    expect((await ApprovalDecision.findById(approvalDecisionId).lean()).status).toBe('REQUIRED');
    await Project.collection.updateOne({ _id: projectId }, { $set: { currentQuotationId: quotationId } });

    const proofSpy = vi.spyOn(AuditLogProofService.prototype, 'submit').mockRejectedValue(Object.assign(new Error('mock ambiguous RPC result'), { code: 'BLOCKCHAIN_OUTCOME_AMBIGUOUS' }));
    const [first, second] = await Promise.all([
      request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' }),
      request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const responses = await Promise.all([first.json(), second.json()]);
    expect(responses.map((result) => result.data.status)).toEqual(['APPROVED', 'APPROVED']);
    expect(responses.some((result) => result.data.proof.status === 'PENDING')).toBe(true);
    const project = await Project.findById(projectId).lean();
    expect(project).toMatchObject({ status: 'APPROVED', approvalStatus: 'APPROVED', governanceResolutionId: new Types.ObjectId(resolution._id) });
    expect((await ApprovalDecision.findById(approvalDecisionId).lean()).status).toBe('COMPLETED');
    expect(await AuditLog.countDocuments({ action: 'PROJECT_APPROVED_BY_GOVERNANCE', entityId: projectId })).toBe(1);
    const finalizedAudit = await AuditLog.findOne({ action: 'GOVERNANCE_RESOLUTION_FINALIZED', entityId: new Types.ObjectId(resolution._id) }).lean();
    expect(finalizedAudit?.newState).toMatchObject({ projectApprovalContext: {
      approvalDecisionId, ruleVersionId: ruleA, approvalType: 'SGM_REQUIRED',
      requiredDecisionBody: 'GENERAL_BODY_OR_SGM', evaluatedAmount: '150000', requiredThreshold: '100000', quotationVersionId: quotationId,
    } });
    const approvalAudit = await AuditLog.findOne({ action: 'PROJECT_APPROVED_BY_GOVERNANCE', entityId: projectId }).lean();
    expect(approvalAudit?.newState).toMatchObject({ evaluatedAmount: '150000', requiredThreshold: '100000', quotationVersionId: quotationId });
    const retry = await request(application, `/api/resolutions/${resolution._id}/proof`, managerA, { method: 'POST' });
    expect(retry.status).toBe(200);
    expect((await retry.json()).data).toMatchObject({ status: 'PENDING', retryAvailable: true });
    proofSpy.mockRestore();
  });

  it('keeps a project unapproved after inconclusive and rejected project resolutions', async () => {
    const application = app();
    const projectId = new Types.ObjectId();
    const approvalDecisionId = new Types.ObjectId();
    const quotationId = new Types.ObjectId();
    await Quotation.create({ _id: quotationId, projectId, vendorId: new Types.ObjectId(), versionNumber: 1, amount: Types.Decimal128.fromString('150000'), description: 'Current quote', status: 'SELECTED' });
    await Project.create({
      _id: projectId, societyId: societyA, title: 'Water pump repair', description: 'Repair pump', category: 'REPAIR',
      estimatedCost: Types.Decimal128.fromString('150000'), status: 'SGM_REQUIRED', proposedBy: managerA,
      approvalType: 'SGM_REQUIRED', approvalStatus: 'REQUIRED', activeRuleVersionId: ruleA, currentQuotationId: quotationId,
    });
    await ApprovalDecision.create({
      _id: approvalDecisionId, societyId: societyA, projectId, quotationVersionId: quotationId, ruleVersionId: ruleA,
      evaluatedAmount: Types.Decimal128.fromString('150000'), requiredThreshold: Types.Decimal128.fromString('100000'),
      approvalType: 'SGM_REQUIRED', requiredDecisionBody: 'GENERAL_BODY_OR_SGM', status: 'REQUIRED', reason: 'integration fixture',
      evaluatedBy: managerA, ruleSnapshot: { threshold: '100000' },
    });
    const meetingResponse = await request(application, '/api/meetings', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SGM', title: 'Water pump SGM', agenda: ['Water pump repair approval'], projectId: projectId.toString(), scheduledAt: '2026-12-01T10:00:00.000Z' }),
    });
    const meeting = (await meetingResponse.json()).data;
    expect(meetingResponse.status).toBe(201);
    expect((await request(application, `/api/meetings/${meeting._id}/publish`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeReference: 'PUMP-NOTICE-001', noticeIssuedAt: '2026-11-20T10:00:00.000Z' }),
    })).status).toBe(200);

    const proofSpy = vi.spyOn(AuditLogProofService.prototype, 'submit').mockResolvedValue({ status: 'PENDING' });
    try {
      for (const scenario of [
        { title: 'Inconclusive pump decision', vote: undefined, expected: 'NO_DECISION' },
        { title: 'Rejected pump decision', vote: 'NO' as const, expected: 'REJECTED' },
      ]) {
        const now = Date.now();
        const created = await request(application, '/api/resolutions', managerA, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingId: meeting._id, ruleVersionId: ruleA.toString(), resolutionType: 'PROJECT_APPROVAL', decisionBody: 'GENERAL_BODY', projectId: projectId.toString(), approvalDecisionId: approvalDecisionId.toString(), votingMethod: 'SHOW_OF_HANDS', title: scenario.title, votingStart: new Date(now - 60_000).toISOString(), votingEnd: new Date(now + 60_000).toISOString() }),
        });
        expect(created.status).toBe(201);
        const resolution = (await created.json()).data;
        expect((await request(application, `/api/resolutions/${resolution._id}/eligibility-snapshot`, managerA, { method: 'POST' })).status).toBe(201);
        expect((await request(application, `/api/resolutions/${resolution._id}/open`, managerA, { method: 'POST' })).status).toBe(200);
        if (scenario.vote) {
          expect((await request(application, `/api/resolutions/${resolution._id}/votes`, eligibleA, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: scenario.vote }),
          })).status).toBe(201);
        }
        await GovernanceResolution.collection.updateOne({ _id: new Types.ObjectId(resolution._id) }, { $set: { votingEnd: new Date(Date.now() - 1000) } });
        const closed = await request(application, `/api/resolutions/${resolution._id}/close`, managerA, { method: 'POST' });
        expect(closed.status).toBe(200);
        expect((await closed.json()).data.result.outcome).toBe(scenario.expected);
        const finalized = await request(application, `/api/resolutions/${resolution._id}/finalize`, managerA, { method: 'POST' });
        expect(finalized.status).toBe(200);
        expect((await finalized.json()).data.status).toBe(scenario.expected);
        expect((await Project.findById(projectId).lean()).status).toBe('SGM_REQUIRED');
        expect((await ApprovalDecision.findById(approvalDecisionId).lean()).status).toBe('REQUIRED');
      }
      expect(await AuditLog.countDocuments({ action: 'PROJECT_APPROVED_BY_GOVERNANCE', entityId: projectId })).toBe(0);
    } finally { proofSpy.mockRestore(); }
  });
});
