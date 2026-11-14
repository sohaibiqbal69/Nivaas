import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/motion', () => ({ createMotionScope: () => null, prefersReducedMotion: () => true }));

describe('LoginPage brand and sign-in access', () => {
  beforeEach(() => {
    mocks.useAuth.mockReset();
  });

  it('uses the supplied brand assets while retaining accessible sign-in and setup paths', () => {
    mocks.useAuth.mockReturnValue({ isAuthenticated: false, login: vi.fn() });
    const html = renderToStaticMarkup(<MemoryRouter><LoginPage /></MemoryRouter>);

    expect(html).toContain('/assets/nivaas-wordmark.png');
    expect(html).toContain('/assets/nivaas-mark.png');
    expect(html).toContain('data-scene-ready="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Governance begins at home.');
    expect(html).toContain('Transparent decisions');
    expect(html).toContain('Organised records');
    expect(html).toContain('Stronger communities');
    expect(html).toContain('Society life, in good order.');
    expect(html).toContain('id="email" type="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('href="/setup"');
    expect(html).toContain('Use your society account to continue.');
  });
});
