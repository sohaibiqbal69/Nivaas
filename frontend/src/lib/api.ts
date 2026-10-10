export type ApiErrorShape = {
  code: string;
  message: string;
  status: number;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(error: ApiErrorShape) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.status = error.status;
  }
}

export type ApiClientOptions = RequestInit & {
  token?: string;
};

type UnauthorizedHandler = (failedToken?: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export function normalizeApiBaseUrl(configuredBaseUrl?: string): string {
  // VITE_API_BASE_URL accepts a backend origin or an origin already ending in /api.
  const configured = configuredBaseUrl?.trim() || '/api';
  const withoutTrailingSlashes = configured.replace(/\/+$/, '');
  const withoutApiSuffix = withoutTrailingSlashes.replace(/(?:\/api)+$/i, '');
  return `${withoutApiSuffix || ''}/api`;
}

export function resolveApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.replace(/^\/api(?=\/|$)/i, '') || '/';
  return `${normalizeApiBaseUrl(baseUrl)}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export async function apiRequest<T>(path: string, options: ApiClientOptions = {}): Promise<T> {
  const { token, headers: suppliedHeaders, body, ...requestInit } = options;
  const headers = new Headers(suppliedHeaders);
  headers.set('Accept', 'application/json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(apiBaseUrl, path), { ...requestInit, body, headers });
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Nivaas could not reach the application service.',
      status: 0,
    });
  }

  if (response.status === 401) unauthorizedHandler?.(token);
  const payload = await readJson(response);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? payload.error
      : undefined;
    throw new ApiError({
      code: isRecord(error) && typeof error.code === 'string' ? error.code : 'API_ERROR',
      message: isRecord(error) && typeof error.message === 'string' ? error.message : 'The request could not be completed.',
      status: response.status,
    });
  }

  if (!isRecord(payload) || !('data' in payload)) {
    throw new ApiError({ code: 'INVALID_RESPONSE', message: 'The application service returned an invalid response.', status: response.status });
  }
  return payload.data as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError({ code: 'INVALID_RESPONSE', message: 'The application service returned invalid JSON.', status: response.status });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type AuthUser = {
  _id: string;
  societyId: string | null;
  name: string;
  email: string;
  role: string;
  status?: string;
};

export type LoginResult = { user: AuthUser; token: string };

export function login(email: string, password: string) {
  return apiRequest<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function completeAccountSetup(credential: string, newPassword: string) {
  return apiRequest<Record<string, never>>('/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ credential, newPassword }),
  });
}

export function getCurrentUser(userId: string, token: string) {
  return apiRequest<AuthUser>(`/users/${encodeURIComponent(userId)}`, { token });
}
