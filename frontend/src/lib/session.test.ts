import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, readSession, writeSession } from './session';

const session = {
  token: 'short-lived',
  refreshToken: 'A'.repeat(43),
  refreshSessionId: 'session-one',
  refreshTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  user: {
    _id: '507f1f77bcf86cd799439011',
    societyId: '507f1f77bcf86cd799439012',
    name: 'Asha',
    email: 'asha@example.test',
    role: 'RESIDENT',
  },
};

describe('frontend session storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores only the current tab session and restores its server-shaped profile', () => {
    writeSession(session);
    expect(readSession()).toEqual(session);
    expect(localStorage.getItem('nivaas.auth.session')).toBeNull();
    clearSession();
    expect(readSession()).toBeNull();
  });

  it('rejects malformed stored sessions', () => {
    sessionStorage.setItem('nivaas.auth.session', JSON.stringify({ token: 'x', user: { role: 'RESIDENT' } }));
    expect(readSession()).toBeNull();
  });

  it('does not share distinct tab identities through local storage', () => {
    writeSession(session);
    const otherTabSession = { ...session, token: 'other-access', refreshToken: 'B'.repeat(43), refreshSessionId: 'session-two' };
    expect(readSession()?.refreshSessionId).toBe('session-one');
    writeSession(otherTabSession);
    expect(readSession()?.refreshSessionId).toBe('session-two');
    expect(localStorage.length).toBe(0);
  });
});
