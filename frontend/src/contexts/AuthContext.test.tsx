import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { apiRequest } from '@/lib/api';
import { clearSession, readSession, writeSession } from '@/lib/session';

const oldSession = {
  token: 'old-token',
  user: {
    _id: '507f1f77bcf86cd799439011',
    societyId: '507f1f77bcf86cd799439012',
    name: 'Old User',
    email: 'old@example.test',
    role: 'RESIDENT',
  },
};

const newUser = {
  _id: '507f1f77bcf86cd799439013',
  societyId: '507f1f77bcf86cd799439012',
  name: 'New User',
  email: 'new@example.test',
  role: 'RESIDENT',
};

describe('AuthProvider session ordering', () => {
  let container: HTMLDivElement;
  let root: Root;
  let currentAuth: ReturnType<typeof useAuth> | null = null;

  function Probe() {
    currentAuth = useAuth();
    return <output data-authenticated={String(currentAuth.isAuthenticated)}>{currentAuth.user?.name ?? 'signed out'}</output>;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clearSession();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearSession();
    vi.restoreAllMocks();
  });

  it('keeps the newer login when stale startup revalidation succeeds later', async () => {
    writeSession(oldSession);
    let resolveStartup!: (response: Response) => void;
    const startupResponse = new Promise<Response>((resolve) => { resolveStartup = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input).includes('/users/')) return startupResponse;
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { user: newUser, token: 'new-token' } }), { status: 200 }));
    });

    await act(async () => {
      root.render(<AuthProvider><Probe /></AuthProvider>);
      await Promise.resolve();
    });
    await act(async () => {
      await currentAuth?.login('new@example.test', 'password');
    });

    resolveStartup(new Response(JSON.stringify({ success: true, data: oldSession.user }), { status: 200 }));
    await act(async () => { await startupResponse; });

    expect(readSession()).toMatchObject({ token: 'new-token', user: newUser });
    expect(container.textContent).toBe('New User');
  });

  it('does not clear the newer login when stale startup revalidation fails', async () => {
    writeSession(oldSession);
    let rejectStartup!: (error: Error) => void;
    const startupFailure = new Promise<Response>((_, reject) => { rejectStartup = reject; });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input).includes('/users/')) return startupFailure;
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { user: newUser, token: 'new-token' } }), { status: 200 }));
    });

    await act(async () => {
      root.render(<AuthProvider><Probe /></AuthProvider>);
      await Promise.resolve();
    });
    await act(async () => {
      await currentAuth?.login('new@example.test', 'password');
    });

    rejectStartup(new Error('expired'));
    await act(async () => {
      await expect(startupFailure).rejects.toThrow('expired');
    });

    expect(readSession()).toMatchObject({ token: 'new-token', user: newUser });
  });

  it('clears the active session for a matching 401 but not for a different token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { user: newUser, token: 'new-token' } }), { status: 200 }),
    );

    await act(async () => {
      root.render(<AuthProvider><Probe /></AuthProvider>);
      await Promise.resolve();
    });
    await act(async () => {
      await currentAuth?.login('new@example.test', 'password');
    });

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Expired.' },
    }), { status: 401 }));
    await act(async () => {
      await expect(apiRequest('/private', { token: 'old-token' })).rejects.toMatchObject({ status: 401 });
    });
    expect(readSession()).toMatchObject({ token: 'new-token' });

    await act(async () => {
      await expect(apiRequest('/private', { token: 'new-token' })).rejects.toMatchObject({ status: 401 });
    });
    expect(readSession()).toBeNull();
    expect(container.textContent).toBe('signed out');
  });
});
