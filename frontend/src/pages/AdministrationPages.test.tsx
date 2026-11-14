import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocietyManagementPage } from './SocietyManagementPage';
import { UserAdministrationPage } from './UserAdministrationPage';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));

describe('platform administration screens', () => {
  beforeEach(() => mocks.useAuth.mockReset());

  it('shows Society management only to the platform administrator', () => {
    mocks.useAuth.mockReturnValue({ user: { role: 'SYSTEM_ADMIN' }, token: 'admin-token' });
    expect(renderToStaticMarkup(<MemoryRouter><SocietyManagementPage /></MemoryRouter>)).toContain('Create society');
    mocks.useAuth.mockReturnValue({ user: { role: 'SOCIETY_MANAGER' }, token: 'manager-token' });
    expect(renderToStaticMarkup(<MemoryRouter><SocietyManagementPage /></MemoryRouter>)).toContain('Permission required');
  });

  it('shows manager provisioning only to the platform administrator', () => {
    mocks.useAuth.mockReturnValue({ user: { role: 'SYSTEM_ADMIN' }, token: 'admin-token' });
    expect(renderToStaticMarkup(<MemoryRouter><UserAdministrationPage /></MemoryRouter>)).toContain('Create society manager');
    mocks.useAuth.mockReturnValue({ user: { role: 'OWNER_MEMBER' }, token: 'owner-token' });
    expect(renderToStaticMarkup(<MemoryRouter><UserAdministrationPage /></MemoryRouter>)).toContain('Permission required');
  });
});
