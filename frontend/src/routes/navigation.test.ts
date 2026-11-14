import { describe, expect, it } from 'vitest';
import { navigationItems } from './navigation';

describe('role-based Members & Flats navigation', () => {
  const item = navigationItems.find((entry) => entry.path === '/members');

  it('exposes the onboarding screen to Society Managers only', () => {
    expect(item?.label).toBe('Members & Flats');
    expect(item?.roles).toEqual(['SOCIETY_MANAGER']);
    expect(item?.roles).not.toContain('SYSTEM_ADMIN');
  });
  it('removes standalone Meetings navigation while retaining its routes through Notice Board', () => {
    expect(navigationItems.some(entry => entry.path === '/meetings' || entry.label === 'Meetings')).toBe(false);
    expect(navigationItems.some(entry => entry.path === '/notices' && entry.label === 'Notice Board')).toBe(true);
  });

  it('gives owners discoverable read-only transparency links without management routes', () => {
    const ownerPaths = navigationItems.filter((entry) => entry.roles?.includes('OWNER_MEMBER')).map((entry) => entry.path);
    expect(ownerPaths).toEqual(expect.arrayContaining(['/projects', '/budgets', '/quotations', '/audit', '/blockchain']));
    expect(ownerPaths).not.toContain('/members');
    expect(ownerPaths).not.toContain('/society/settings/governance');
  });

  it('does not advertise quotations, audit, or blockchain proof views to residents', () => {
    const residentPaths = navigationItems.filter((entry) => entry.roles?.includes('RESIDENT')).map((entry) => entry.path);
    expect(residentPaths).not.toContain('/quotations');
    expect(residentPaths).not.toContain('/audit');
    expect(residentPaths).not.toContain('/blockchain');
  });
});
