import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NoticeBoardPage } from './NoticeBoardPage';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), listNotices: vi.fn(), listGovernanceMeetings: vi.fn(), createNotice: vi.fn(), updateNoticeDraft: vi.fn(), publishNotice: vi.fn(), archiveNotice: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/notices', () => ({
  NOTICE_CATEGORIES: ['AGM', 'SGM', 'MAINTENANCE', 'EMERGENCY', 'WATER', 'SECURITY', 'REPAIRS', 'GENERAL', 'OTHER'],
  listNotices: mocks.listNotices, createNotice: mocks.createNotice, updateNoticeDraft: mocks.updateNoticeDraft,
  publishNotice: mocks.publishNotice, archiveNotice: mocks.archiveNotice,
}));
vi.mock('@/lib/governance', () => ({ listGovernanceMeetings: mocks.listGovernanceMeetings }));

describe('NoticeBoardPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let draft: Record<string, unknown> | null;
  let published: Record<string, unknown> | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { _id: 'manager-1', societyId: 'society-1', role: 'SOCIETY_MANAGER' }, token: 'manager-token' });
    draft = { _id: 'notice-1', societyId: 'society-1', title: 'Lift maintenance', description: 'The lift is unavailable tomorrow.', category: 'MAINTENANCE', priority: 'High', status: 'DRAFT', createdBy: 'manager-1', createdAt: '2026-10-19T10:00:00.000Z', updatedAt: '2026-10-19T10:00:00.000Z', attachmentIds: [] };
    published = null;
    mocks.listNotices.mockImplementation(async (_token: string, filters: { status?: string }) => ({ items: filters.status === 'DRAFT' ? draft ? [draft] : [] : filters.status === 'PUBLISHED' ? published ? [published] : [] : [], page: 1, limit: 20, total: 1 }));
    mocks.createNotice.mockImplementation(async (_token: string, input: Record<string, unknown>) => { const created = { ...(draft ?? {}), ...input }; draft = created; return created; });
    mocks.publishNotice.mockImplementation(async () => { const result = { ...(draft ?? {}), status: 'PUBLISHED', publishedAt: '2026-10-20T10:00:00.000Z' }; published = result; draft = null; return result; });
    mocks.updateNoticeDraft.mockResolvedValue(draft);
    mocks.archiveNotice.mockResolvedValue({ ...(published ?? {}), status: 'ARCHIVED' });
    mocks.listGovernanceMeetings.mockResolvedValue([{ _id: 'meeting-1', societyId: 'society-1', type: 'AGM', title: 'Annual general meeting', scheduledAt: '2026-11-01T10:00:00.000Z', status: 'PUBLISHED', noticeReference: 'NOTICE-1', noticeIssuedAt: '2026-10-01T10:00:00.000Z', noticePeriodDays: 14 }]);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.clearAllMocks();
  });

  it('shows real manager drafts and publishes only after the authenticated action succeeds', async () => {
    await act(async () => root.render(<MemoryRouter><NoticeBoardPage /></MemoryRouter>));
    expect(container.textContent).toContain('Lift maintenance');
    expect(container.textContent).toContain('Annual general meeting');
    expect(container.textContent).toContain('Schedule an AGM/SGM and prepare its governance record');
    expect(container.textContent).toContain('Publishing an ordinary notice below does not publish a governance meeting');
    expect(container.textContent).toContain('DRAFT');
    const publish = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Publish notice'));
    expect(publish).toBeDefined();
    await act(async () => publish?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mocks.publishNotice).toHaveBeenCalledWith('manager-token', 'notice-1');
    expect(container.textContent).toContain('PUBLISHED');
    expect(container.textContent).toContain('Notice published to this society’s Notice Board.');
  });

  it('keeps notice management unavailable to residents and explains a real empty state', async () => {
    mocks.useAuth.mockReturnValue({ user: { _id: 'resident-1', societyId: 'society-1', role: 'RESIDENT' }, token: 'resident-token' });
    draft = null; published = null;
    await act(async () => root.render(<MemoryRouter><NoticeBoardPage /></MemoryRouter>));
    expect(container.textContent).toContain('No published society notices match this category yet.');
    expect(container.textContent).not.toContain('Create a notice');
    expect(container.querySelector('textarea')).toBeNull();
  });
});
