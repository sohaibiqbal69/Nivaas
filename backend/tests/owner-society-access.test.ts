import { describe, expect, it, vi } from 'vitest';
import { assertOwnerSocietyAccess } from '../src/modules/property/owner-society-access.js';

const owner = { userId: '68a123456789012345678901', societyId: '68a123456789012345678902', role: 'OWNER_MEMBER' };

describe('owner society transparency access', () => {
  it('authorizes from an active ownership check without requiring residence or membership', async () => {
    const checker = vi.fn(async () => true);
    await expect(assertOwnerSocietyAccess(owner, owner.societyId, checker)).resolves.toBeUndefined();
    expect(checker).toHaveBeenCalledWith(owner.userId, owner.societyId, expect.any(Date));
  });

  it('rejects missing, ended, and cross-society owner relationships', async () => {
    const noOwnership = vi.fn(async () => false);
    await expect(assertOwnerSocietyAccess(owner, owner.societyId, noOwnership)).rejects.toMatchObject({ status: 404 });
    await expect(assertOwnerSocietyAccess(owner, '68a123456789012345678903', noOwnership)).rejects.toMatchObject({ status: 404 });
    await expect(assertOwnerSocietyAccess({ ...owner, societyId: null }, owner.societyId, noOwnership)).rejects.toMatchObject({ status: 404 });
    expect(noOwnership).toHaveBeenCalledTimes(1);
  });

  it('does not apply ownership checks to unrelated roles; tenant permissions stay separate', async () => {
    const checker = vi.fn(async () => false);
    await expect(assertOwnerSocietyAccess({ ...owner, role: 'SOCIETY_MANAGER' }, owner.societyId, checker)).resolves.toBeUndefined();
    await expect(assertOwnerSocietyAccess({ ...owner, role: 'RESIDENT' }, owner.societyId, checker)).resolves.toBeUndefined();
    expect(checker).not.toHaveBeenCalled();
  });
});
