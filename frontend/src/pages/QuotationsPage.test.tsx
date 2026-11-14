import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QuotationsPage } from './QuotationsPage';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));

describe('QuotationsPage access and project context', () => {
  beforeEach(() => {
    mocks.useAuth.mockReset();
  });

  it('shows the permission state for roles outside the quotation API read policy', () => {
    mocks.useAuth.mockReturnValue({ user: { role: 'VENDOR' }, token: 'token' });
    const html = renderToStaticMarkup(<MemoryRouter><QuotationsPage /></MemoryRouter>);
    expect(html).toContain('Permission required');
    expect(html).not.toContain('New quotation');
  });

  it('provides project selection to read-only society roles without exposing write actions', () => {
    mocks.useAuth.mockReturnValue({ user: { role: 'OWNER_MEMBER' }, token: 'token' });
    const html = renderToStaticMarkup(<MemoryRouter><QuotationsPage /></MemoryRouter>);
    expect(html).toContain('Select a project');
    expect(html).not.toContain('Project ID');
    expect(html).not.toContain('New quotation');
  });
});
