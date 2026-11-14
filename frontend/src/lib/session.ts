import type { AuthUser } from './api';

const SESSION_KEY = 'nivaas.auth.session';

export type StoredSession = {
  token: string;
  refreshToken: string;
  refreshSessionId: string;
  refreshTokenExpiresAt: string;
  user: AuthUser;
};

export function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isStoredSession(value)) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const user = record.user as Record<string, unknown> | undefined;
  return typeof record.token === 'string'
    && typeof record.refreshToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(record.refreshToken)
    && typeof record.refreshSessionId === 'string'
    && record.refreshSessionId.length > 0
    && typeof record.refreshTokenExpiresAt === 'string'
    && Number.isFinite(Date.parse(record.refreshTokenExpiresAt))
    && Boolean(user)
    && typeof user?._id === 'string'
    && typeof user?.email === 'string'
    && typeof user?.role === 'string'
    && (typeof user?.societyId === 'string' || user?.societyId === null);
}
