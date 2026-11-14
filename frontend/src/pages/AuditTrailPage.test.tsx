import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuditTrailPage } from './AuditTrailPage';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), listAuditLogs: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/blockchain', () => ({ listAuditLogs: mocks.listAuditLogs }));

describe('AuditTrailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { _id: 'manager-1', societyId: 'society-1', role: 'SOCIETY_MANAGER' }, token: 'session-token' });
    mocks.listAuditLogs.mockResolvedValue([{ _id: 'audit-1', societyId: 'society-1', action: 'NOTICE_PUBLISHED', entityType: 'NOTICE', recordHash: `0x${'a'.repeat(64)}`, integrity: { status: 'valid' }, createdAt: '2026-10-20T10:00:00.000Z' }]);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.clearAllMocks();
  });

  it('shows verified application-record integrity, links to proof inspection, and submits backend-supported filters', async () => {
    await act(async () => root.render(<MemoryRouter><AuditTrailPage /></MemoryRouter>));
    expect(container.textContent).toContain('NOTICE PUBLISHED');
    expect(container.textContent).toContain('Record integrity: valid');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/blockchain?auditLogId=audit-1');
    expect(container.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
    const action = container.querySelector('input[type="search"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => { setValue?.call(action, 'NOTICE_PUBLISHED'); action.dispatchEvent(new Event('input', { bubbles: true })); });
    const form = container.querySelector('form');
    await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.listAuditLogs).toHaveBeenLastCalledWith('session-token', { page: 1, pageSize: 25, search: 'NOTICE_PUBLISHED' });
  });
});
