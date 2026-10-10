import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, normalizeApiBaseUrl, resolveApiUrl, setUnauthorizedHandler } from './api';

describe('api client', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('normalizes relative and absolute API configurations to one /api prefix', () => {
    expect(normalizeApiBaseUrl()).toBe('/api');
    expect(normalizeApiBaseUrl('/api/')).toBe('/api');
    expect(normalizeApiBaseUrl('http://localhost:4000')).toBe('http://localhost:4000/api');
    expect(normalizeApiBaseUrl('http://localhost:4000/api/')).toBe('http://localhost:4000/api');
    expect(resolveApiUrl('http://localhost:4000', '/api/auth/login')).toBe('http://localhost:4000/api/auth/login');
  });

  it('serializes bearer requests and unwraps the API data envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }),
    );

    await expect(apiRequest<{ ok: boolean }>('/auth/check', {
      method: 'POST',
      token: 'short-lived-token',
      body: JSON.stringify({ value: 'safe' }),
    })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/check', expect.objectContaining({
      body: JSON.stringify({ value: 'safe' }),
      headers: expect.any(Headers),
    }));
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer short-lived-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('normalizes API and network failures without logging credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } }), { status: 401 }),
    );
    await expect(apiRequest('/private')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await expect(apiRequest('/private')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect(new ApiError({ code: 'X', message: 'x', status: 400 })).toBeInstanceOf(Error);
  });

  it('notifies the active session only for unauthorized responses', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Expired.' } }), { status: 401 }),
    );

    await expect(apiRequest('/private', { token: 'expired-token' })).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledWith('expired-token');

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Denied.' } }), { status: 403 }),
    );
    await expect(apiRequest('/private', { token: 'active-token' })).rejects.toMatchObject({ status: 403 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
