import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getCurrentUser, login as loginRequest, setUnauthorizedHandler, type AuthUser } from '@/lib/api';
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

  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    const stored = readSession();
    if (!stored) {
      setIsLoading(false);
    } else {
      void getCurrentUser(stored.user._id, stored.token)
        .then((user) => {
          if (!active || requestGeneration.current !== generation) return;
          const next = { token: stored.token, user };
          writeSession(next);
          setSession(next);
        })
        .catch(() => {
          if (!active || requestGeneration.current !== generation) return;
          clearSession();
          setSession(null);
        })
        .finally(() => {
          if (active && requestGeneration.current === generation) setIsLoading(false);
        });
    }

    setUnauthorizedHandler((failedToken) => {
      setSession((current) => {
        if (!current || !failedToken || current.token !== failedToken) return current;
        clearSession();
        return null;
      });
    });

    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const generation = ++requestGeneration.current;
    try {
      const result = await loginRequest(email, password);
      if (requestGeneration.current !== generation) return;
      const next = { token: result.token, user: result.user };
      writeSession(next);
      setSession(next);
    } finally {
      if (requestGeneration.current === generation) setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    ++requestGeneration.current;
    clearSession();
    setSession(null);
  }, []);

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
