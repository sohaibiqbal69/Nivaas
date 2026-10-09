import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Society, societySchema } from '../src/modules/society/models/Society.js';
import { SocietyRuleVersion, societyRuleVersionSchema } from '../src/modules/society/models/SocietyRuleVersion.js';
import { User, USER_ROLES, userSchema } from '../src/modules/users/models/User.js';
import { Building, buildingSchema } from '../src/modules/property/models/Building.js';
import { Flat, flatSchema } from '../src/modules/property/models/Flat.js';
import { Ownership, ownershipSchema } from '../src/modules/property/models/Ownership.js';
import { Residence, residenceSchema } from '../src/modules/property/models/Residence.js';
import { Membership, MEMBERSHIP_STATUSES, MEMBERSHIP_TYPES, membershipSchema } from '../src/modules/membership/models/Membership.js';
import { Committee, committeeSchema } from '../src/modules/committee/models/Committee.js';
import { CommitteeMember, committeeMemberSchema } from '../src/modules/committee/models/CommitteeMember.js';
import { Budget, budgetSchema } from '../src/modules/budget/models/Budget.js';
import { BudgetCategory, budgetCategorySchema } from '../src/modules/budget/models/BudgetCategory.js';
import { Project, projectSchema, PROJECT_STATUSES } from '../src/modules/project/models/Project.js';

describe('Nivaas society data models', () => {
  it('requires the documented society identity and timestamps its records', async () => {
    const missingName = new Society({ status: 'ACTIVE' });
    await expect(missingName.validate()).rejects.toMatchObject({ errors: { name: expect.anything() } });

    const society = new Society({ name: 'Society name', status: 'ACTIVE' });
    await society.validate();
    expect(societySchema.options.timestamps).toBe(true);
  });

  it('uses only documented finite values for user roles and membership types', async () => {
    const societyId = new Types.ObjectId();
    const validUser = new User({ societyId, name: 'Member', email: 'member@example.test', passwordHash: 'hash', role: 'RESIDENT', status: 'ACTIVE' });
    await expect(validUser.validate()).resolves.toBeUndefined();
    expect(USER_ROLES).toEqual(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT']);

    const invalidUser = new User({ societyId, name: 'Member', email: 'member@example.test', passwordHash: 'hash', role: 'OWNER', status: 'ACTIVE' });
    await expect(invalidUser.validate()).rejects.toMatchObject({ errors: { role: expect.anything() } });

    const validMembership = new Membership({
      societyId,
      userId: new Types.ObjectId(),
      unitId: new Types.ObjectId(),
      membershipType: 'JOINT',
      membershipStatus: 'ACTIVE',
    });
    await expect(validMembership.validate()).resolves.toBeUndefined();
    expect(MEMBERSHIP_TYPES).toEqual(['PRIMARY', 'JOINT', 'ASSOCIATE', 'PROVISIONAL']);
    expect(MEMBERSHIP_STATUSES).toEqual(['ACTIVE', 'INACTIVE']);
  });

  it('allows a nullable society only for SYSTEM_ADMIN and validates the role/society invariant', async () => {
    const societyId = new Types.ObjectId();
    const createUser = (role: string, assignedSocietyId: Types.ObjectId | null) => new User({
      societyId: assignedSocietyId,
      name: 'Account',
      email: `${role.toLowerCase()}@example.test`,
      passwordHash: 'hash',
      role,
      status: 'ACTIVE',
    });

    await expect(createUser('SYSTEM_ADMIN', null).validate()).resolves.toBeUndefined();
    await expect(createUser('SYSTEM_ADMIN', societyId).validate()).resolves.toBeUndefined();

    for (const role of ['SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT']) {
      await expect(createUser(role, societyId).validate()).resolves.toBeUndefined();
      await expect(createUser(role, null).validate()).rejects.toMatchObject({
        errors: { societyId: expect.anything() },
      });
    }

    const admin = createUser('SYSTEM_ADMIN', null);
    await admin.validate();
    admin.role = 'RESIDENT';
    await expect(admin.validate()).rejects.toMatchObject({
      errors: { societyId: expect.anything() },
    });
  });

  it('declares ObjectId references for the documented entity relationships', () => {
    expect(societySchema.path('activeRuleVersionId').options.ref).toBe('SocietyRuleVersion');
    expect(societyRuleVersionSchema.path('societyId').options.ref).toBe('Society');
    expect(societyRuleVersionSchema.path('createdBy').options.ref).toBe('User');
    expect(userSchema.path('societyId').options.ref).toBe('Society');
    expect(buildingSchema.path('societyId').options.ref).toBe('Society');
    expect(flatSchema.path('societyId').options.ref).toBe('Society');
    expect(flatSchema.path('buildingId').options.ref).toBe('Building');
    expect(ownershipSchema.path('flatId').options.ref).toBe('Flat');
    expect(ownershipSchema.path('userId').options.ref).toBe('User');
    expect(residenceSchema.path('flatId').options.ref).toBe('Flat');
    expect(residenceSchema.path('userId').options.ref).toBe('User');
    expect(membershipSchema.path('userId').options.ref).toBe('User');
    expect(committeeSchema.path('societyId').options.ref).toBe('Society');
    expect(committeeMemberSchema.path('committeeId').options.ref).toBe('Committee');
    expect(committeeMemberSchema.path('userId').options.ref).toBe('User');
  });

  it('timestamps major entity models', () => {
    for (const schema of [
      societySchema,
      societyRuleVersionSchema,
      userSchema,
      buildingSchema,
      flatSchema,
      ownershipSchema,
      residenceSchema,
      membershipSchema,
      committeeSchema,
      committeeMemberSchema,
    ]) {
      expect(schema.options.timestamps).toBe(true);
    }
  });

  it('keeps rule configuration opaque and enforces only documented version uniqueness', () => {
    const version = new SocietyRuleVersion({
      societyId: new Types.ObjectId(),
      versionNumber: 1,
      status: 'DRAFT',
      effectiveFrom: new Date(),
      createdBy: new Types.ObjectId(),
      approvalPolicy: { configuredPolicy: true },
      majorityRules: {},
      quorumRules: {},
      noticeRules: {},
      votingRules: {},
      procurementRules: {},
      financialVisibilityRules: {},
      complaintRules: {},
      completionRules: {},
    });

    expect(version.approvalPolicy).toEqual({ configuredPolicy: true });
    expect(societyRuleVersionSchema.path('majorityRules').instance).toBe('Mixed');
    const indexes = societyRuleVersionSchema.indexes();
    const versionNumberIndex = indexes.find(([keys]) => 'versionNumber' in keys);
    const statusIndex = indexes.find(([keys]) => 'status' in keys);
    expect(versionNumberIndex?.[0]).toEqual({ societyId: 1, versionNumber: 1 });
    expect(versionNumberIndex?.[1].unique).toBe(true);
    expect(statusIndex?.[0]).toEqual({ societyId: 1, status: 1 });
  });

  it('does not duplicate ownership or residence arrays on Flat', () => {
    expect(flatSchema.path('ownerIds')).toBeUndefined();
    expect(flatSchema.path('residentIds')).toBeUndefined();
    expect(flatSchema.path('buildingId')).toBeDefined();
    expect(flatSchema.path('societyId')).toBeDefined();
  });

  it('defines documented budget fields, statuses, references, and Decimal128 amounts', async () => {
    const budget = new Budget({
      societyId: new Types.ObjectId(),
      financialYear: '2026-2027',
      title: 'Annual Budget',
      status: 'DRAFT',
      totalAllocated: '100.25',
      totalSpent: '20.10',
      totalRemaining: '80.15',
    });

    await expect(budget.validate()).resolves.toBeUndefined();
    expect(budgetSchema.path('societyId').options.ref).toBe('Society');
    expect(budgetSchema.path('totalAllocated').instance).toBe('Decimal128');
    expect(budgetSchema.path('status').enumValues).toEqual(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED']);

    const category = new BudgetCategory({
      budgetId: budget._id,
      name: 'Security',
      allocatedAmount: '100.25',
      spentAmount: '20.10',
      remainingAmount: '80.15',
    });
    await expect(category.validate()).resolves.toBeUndefined();
    expect(budgetCategorySchema.path('budgetId').options.ref).toBe('Budget');
    expect(budgetCategorySchema.path('allocatedAmount').instance).toBe('Decimal128');
  });

  it('defines documented project fields, statuses, references, and Decimal128 cost', async () => {
    const project = new Project({
      societyId: new Types.ObjectId(),
      title: 'Repair',
      description: 'Description',
      category: 'Maintenance',
      estimatedCost: '100.25',
      proposedBy: new Types.ObjectId(),
    });
    await expect(project.validate()).resolves.toBeUndefined();
    expect(projectSchema.path('societyId').options.ref).toBe('Society');
    expect(projectSchema.path('proposedBy').options.ref).toBe('User');
    expect(projectSchema.path('budgetId').options.ref).toBe('Budget');
    expect(projectSchema.path('estimatedCost').instance).toBe('Decimal128');
    expect(project.status).toBe('DRAFT');
    expect(PROJECT_STATUSES).toContain('APPROVED');
    expect(PROJECT_STATUSES).toContain('CANCELLED');
  });

  it('allows multiple ownership and residence records for the same flat', async () => {
    const societyId = new Types.ObjectId();
    const flatId = new Types.ObjectId();
    const firstUserId = new Types.ObjectId();
    const secondUserId = new Types.ObjectId();

    const ownerships = [firstUserId, secondUserId].map((userId, index) => new Ownership({
      societyId, flatId, userId, ownershipType: 'documented-type', ownershipOrder: index + 1, status: 'ACTIVE',
    }));
    const residences = [firstUserId, secondUserId].map((userId) => new Residence({
      societyId, flatId, userId, occupancyType: 'documented-type', status: 'ACTIVE',
    }));

    await Promise.all([...ownerships, ...residences].map((record) => record.validate()));
    expect(new Set(ownerships.map((record) => record.flatId.toString())).size).toBe(1);
    expect(new Set(residences.map((record) => record.flatId.toString())).size).toBe(1);
    expect(ownerships).toHaveLength(2);
    expect(residences).toHaveLength(2);
  });
});
