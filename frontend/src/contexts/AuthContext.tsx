import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, getCurrentUser, login as loginRequest, refreshAuthentication, revokeAuthenticationSession, setUnauthorizedHandler, type AuthUser } from '@/lib/api';
import { clearSession, readSession, writeSession, type StoredSession } from '@/lib/session';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestGeneration = useRef(0);
  const sessionRef = useRef<StoredSession | null>(null);
  const renewalRef = useRef<{ token: string; promise: Promise<string | null> } | null>(null);

  const applySession = useCallback((next: StoredSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    const stored = readSession();
    if (!stored) {
      setIsLoading(false);
    } else {
      sessionRef.current = stored;
      void getCurrentUser(stored.user._id, stored.token)
        .then((user) => {
          if (!active || requestGeneration.current !== generation) return;
          const current = sessionRef.current;
          if (!current || current.refreshSessionId !== stored.refreshSessionId) return;
          const next = { ...current, user };
          writeSession(next);
          applySession(next);
        })
        .catch(() => {
          if (!active || requestGeneration.current !== generation) return;
          const current = sessionRef.current;
          if (current?.refreshSessionId === stored.refreshSessionId) applySession(current);
        })
        .finally(() => {
          if (active && requestGeneration.current === generation) setIsLoading(false);
        });
    }

    setUnauthorizedHandler((failedToken) => {
      const current = sessionRef.current;
      if (!current || current.token !== failedToken) return Promise.resolve(null);
      if (renewalRef.current?.token === failedToken) return renewalRef.current.promise;

      const promise = refreshAuthentication(current.refreshToken)
        .then((renewed) => {
          const latest = sessionRef.current;
          if (!latest || latest.refreshSessionId !== current.refreshSessionId) return null;
          const next: StoredSession = {
            token: renewed.token,
            refreshToken: renewed.refreshToken,
            refreshSessionId: renewed.refreshSessionId,
            refreshTokenExpiresAt: renewed.refreshTokenExpiresAt,
            user: renewed.user,
          };
          writeSession(next);
          applySession(next);
          return next.token;
        })
        .catch((error: unknown) => {
          // A network failure is temporary: keep the tab's session and let the
          // caller report the failed request. Only an authoritative 401 ends it.
          if (error instanceof ApiError && error.status === 401) {
            const latest = sessionRef.current;
            if (latest?.refreshSessionId === current.refreshSessionId) {
              clearSession();
              applySession(null);
            }
          }
          return null;
        })
        .finally(() => {
          if (renewalRef.current?.promise === promise) renewalRef.current = null;
        });
      renewalRef.current = { token: failedToken, promise };
      return promise;
    });

    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, [applySession]);

  // Browsers may clone sessionStorage when a tab is duplicated. Detect a live
  // tab holding the same server session and clear the clone, leaving its source
  // tab untouched. The channel contains identifiers only, never credentials.
  useEffect(() => {
    const current = session;
    if (!current || typeof BroadcastChannel === 'undefined') return;
    const instanceId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const requestId = `${instanceId}-probe`;
    const channel = new BroadcastChannel(`nivaas.auth.tab.${current.refreshSessionId}`);
    let duplicate = false;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (message.sessionId !== current.refreshSessionId) return;
      if (message.type === 'probe' && message.instanceId !== instanceId) {
        channel.postMessage({ type: 'active', sessionId: current.refreshSessionId, instanceId, requestId: message.requestId });
      } else if (message.type === 'active' && message.requestId === requestId && message.instanceId !== instanceId) {
        duplicate = true;
      }
    };
    channel.postMessage({ type: 'probe', sessionId: current.refreshSessionId, instanceId, requestId });
    const timer = window.setTimeout(() => {
      if (duplicate && sessionRef.current?.refreshSessionId === current.refreshSessionId) {
        clearSession();
        applySession(null);
      }
    }, 120);
    return () => { window.clearTimeout(timer); channel.close(); };
  }, [applySession, session]);

  const login = useCallback(async (email: string, password: string) => {
    const generation = ++requestGeneration.current;
    try {
      const result = await loginRequest(email, password);
      if (requestGeneration.current !== generation) return;
      const next: StoredSession = {
        token: result.token,
        refreshToken: result.refreshToken,
        refreshSessionId: result.refreshSessionId,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt,
        user: result.user,
      };
      writeSession(next);
      applySession(next);
    } finally {
      if (requestGeneration.current === generation) setIsLoading(false);
    }
  }, [applySession]);

  const logout = useCallback(() => {
    ++requestGeneration.current;
    const current = sessionRef.current;
    clearSession();
    applySession(null);
    if (current) void revokeAuthenticationSession(current.refreshToken).catch(() => undefined);
  }, [applySession]);

  const value = useMemo(() => ({
    user: session?.user ?? null,
    token: session?.token ?? null,
    isLoading,
    isAuthenticated: session !== null,
    login,
    logout,
  }), [isLoading, login, logout, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
