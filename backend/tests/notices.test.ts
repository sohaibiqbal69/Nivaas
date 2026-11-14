import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { ApiError } from '../src/lib/api-error.js';
import { assertNoticeManager, validateNoticeInput } from '../src/modules/notice/notice-routes.js';
import { Notice } from '../src/modules/notice/models/Notice.js';

describe('society notice validation and permissions', () => {
  const societyId = new Types.ObjectId().toString();
  const manager = { userId: new Types.ObjectId().toString(), societyId, role: 'SOCIETY_MANAGER' as const };

  it('accepts the documented daily notice categories and society-defined priority labels', () => {
    const input = validateNoticeInput({ title: 'Festival gathering', description: 'Community event in the courtyard.', category: 'GENERAL', priority: 'Community event' });
    expect(input).toMatchObject({ title: 'Festival gathering', category: 'GENERAL', priority: 'Community event' });
    const document = new Notice({ ...input, societyId: new Types.ObjectId(societyId), createdBy: new Types.ObjectId(manager.userId) });
    expect(document.validateSync()).toBeUndefined();
  });

  it('allows a manager to remove an optional expiry from a draft', () => {
    expect(validateNoticeInput({ expiresAt: null }, true)).toEqual({ expiresAt: null });
  });

  it('rejects unknown categories, empty content, unsupported fields, and invalid linked IDs', () => {
    expect(() => validateNoticeInput({ title: 'x', description: 'y', category: 'FESTIVAL', priority: 'High' })).toThrow(ApiError);
    expect(() => validateNoticeInput({ title: ' ', description: 'y', category: 'GENERAL', priority: 'High' })).toThrow(ApiError);
    expect(() => validateNoticeInput({ title: 'x', description: 'y', category: 'GENERAL', priority: 'High', status: 'PUBLISHED' })).toThrow(ApiError);
    expect(() => validateNoticeInput({ title: 'x', description: 'y', category: 'GENERAL', priority: 'High', projectId: 'bad-id' })).toThrow(ApiError);
  });

  it('allows only the society manager to create, edit, publish, or archive notices', () => {
    expect(() => assertNoticeManager(manager, societyId)).not.toThrow();
    expect(() => assertNoticeManager({ ...manager, role: 'OWNER_MEMBER' }, societyId)).toThrow(ApiError);
    expect(() => assertNoticeManager({ ...manager, societyId: new Types.ObjectId().toString() }, societyId)).toThrow(ApiError);
    expect(() => assertNoticeManager({ ...manager, role: 'COMMITTEE_MEMBER' }, societyId)).toThrow(ApiError);
  });
});
