import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, readSession, writeSession } from './session';

const session = {
  token: 'short-lived',
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
    clearSession();
    expect(readSession()).toBeNull();
  });

  it('rejects malformed stored sessions', () => {
    sessionStorage.setItem('nivaas.auth.session', JSON.stringify({ token: 'x', user: { role: 'RESIDENT' } }));
    expect(readSession()).toBeNull();
  });
});
