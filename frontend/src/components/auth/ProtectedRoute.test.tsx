import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

const state = vi.hoisted(() => ({ user: { role: 'SOCIETY_MANAGER' as string } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, user: state.user }) }));

function render() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/members']}><Routes><Route element={<ProtectedRoute roles={['SOCIETY_MANAGER']} />}><Route path="/members" element={<div>Members &amp; Flats screen</div>} /></Route></Routes></MemoryRouter>);
}

describe('role-protected onboarding route', () => {
  it('renders for an authorized Society Manager', () => {
    state.user = { role: 'SOCIETY_MANAGER' };
    expect(render()).toContain('Members &amp; Flats screen');
  });

  it('denies platform administrators and residents', () => {
    for (const role of ['SYSTEM_ADMIN', 'RESIDENT', 'OWNER_MEMBER']) {
      state.user = { role };
      expect(render()).toContain('Permission required');
      expect(render()).not.toContain('Members &amp; Flats screen');
    }
  });
});
