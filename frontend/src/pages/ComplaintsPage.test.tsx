import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComplaintsPage } from './ComplaintsPage';
import { ApiError } from '@/lib/api';
const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), listComplaints: vi.fn(), getComplaint: vi.fn(), createComplaint: vi.fn(), updateComplaint: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/complaints', () => mocks);
let container: HTMLDivElement; let root: Root;
const record = { _id: 'c1', title: 'Pipe leak', description: 'Water by stairs', status: 'OPEN', category: 'Repairs', priority: 'High', createdAt: '2026-10-23T00:00:00Z', updates: [] };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.useAuth.mockReturnValue({ token: 'token', user: { societyId: 'society', role: 'RESIDENT' } });
  mocks.listComplaints.mockResolvedValue({ items: [record], page: 1, limit: 20, total: 1 });
  mocks.getComplaint.mockResolvedValue(record);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
it('submits a resident complaint and only reports success after the API responds', async () => {
  mocks.createComplaint.mockResolvedValue(record);
  await act(async () => root.render(<ComplaintsPage />));
  const form = container.querySelector('form')!;
  for (const [name, value] of Object.entries({ title: 'Pipe leak', description: 'Water by stairs', category: 'Repairs', priority: 'High' })) (form.elements.namedItem(name) as HTMLInputElement).value = value;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.createComplaint).toHaveBeenCalledWith('token', { title: 'Pipe leak', description: 'Water by stairs', category: 'Repairs', priority: 'High' });
  expect(container.textContent).toContain('Complaint submitted.');
  expect(container.textContent).not.toContain('Mark resolved');
});
it('shows manager actions and preserves the state on a failed transition', async () => {
  mocks.useAuth.mockReturnValue({ token: 'token', user: { societyId: 'society', role: 'SOCIETY_MANAGER' } });
  mocks.updateComplaint.mockRejectedValue(new ApiError({ status: 409, code: 'CONFLICT', message: 'The complaint changed. Refresh.' }));
  await act(async () => root.render(<ComplaintsPage />));
  expect(container.querySelector('form')).toBeNull();
  const open = [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('View complaint'))!;
  await act(async () => open.click());
  const note = container.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Investigating'); note.dispatchEvent(new Event('input', { bubbles: true })); });
  const acknowledge = [...container.querySelectorAll('button')].find(button => button.textContent === 'Acknowledge')!;
  await act(async () => acknowledge.click());
  expect(container.textContent).toContain('The complaint changed. Refresh.');
  expect(container.textContent).not.toContain('Complaint timeline updated.');
  expect(acknowledge.disabled).toBe(false);
});
it('requires only a title and sends optional details as empty values', async () => {
  mocks.createComplaint.mockResolvedValue(record);
  await act(async () => root.render(<ComplaintsPage />));
  const form = container.querySelector('form')!;
  expect([...form.querySelectorAll('[required]')].map(field => field.getAttribute('name'))).toEqual(['title']);
  (form.elements.namedItem('title') as HTMLInputElement).value = 'Lift is noisy';
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.createComplaint).toHaveBeenCalledWith('token', { title: 'Lift is noisy', category: '', priority: '', description: '' });
});
it('denies an unsupported role without querying complaints', async () => {
  mocks.useAuth.mockReturnValue({ token: 'token', user: { role: 'COMMITTEE_MEMBER', societyId: 'society' } });
  await act(async () => root.render(<ComplaintsPage />));
  expect(container.textContent).toContain('Permission required');
  expect(mocks.listComplaints).not.toHaveBeenCalled();
});
