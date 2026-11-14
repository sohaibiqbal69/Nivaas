import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveNotice, createNotice, listNotices, publishNotice, updateNoticeDraft } from './notices';

describe('notice API helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads society-scoped and filtered records with the authenticated session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [], page: 1, limit: 20, total: 0 } }), { status: 200 }));
    await listNotices('manager-session', { societyId: 'society/1', status: 'DRAFT', category: 'GENERAL' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/notices?societyId=society%2F1&category=GENERAL&status=DRAFT');
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer manager-session');
  });

  it('uses only the documented create, draft-edit, publish, and archive actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { _id: 'notice-1' } }), { status: 201 }));
    const input = { title: 'Water maintenance', description: 'Supply is paused tomorrow morning.', category: 'WATER' as const, priority: 'High' };
    await createNotice('session', input);
    await updateNoticeDraft('session', 'notice/1', input);
    await publishNotice('session', 'notice-1');
    await archiveNotice('session', 'notice-1');
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), (init as RequestInit).method])).toEqual([
      ['/api/notices', 'POST'], ['/api/notices/notice%2F1', 'PATCH'], ['/api/notices/notice-1/publish', 'POST'], ['/api/notices/notice-1/archive', 'POST'],
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(input);
  });
});
