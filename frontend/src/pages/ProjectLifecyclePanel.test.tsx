import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectLifecyclePanel } from './ProjectsPage';

const mocks = vi.hoisted(() => ({
  listProjectUpdates: vi.fn(), listProjectExpenses: vi.fn(), apiRequest: vi.fn(),
  startProject: vi.fn(), createProjectUpdate: vi.fn(), uploadProjectEvidence: vi.fn(),
  completeProject: vi.fn(), createProjectExpense: vi.fn(), downloadProjectEvidence: vi.fn(),
}));
vi.mock('@/lib/project-lifecycle', () => ({
  listProjectUpdates: mocks.listProjectUpdates, listProjectExpenses: mocks.listProjectExpenses,
  startProject: mocks.startProject, createProjectUpdate: mocks.createProjectUpdate,
  uploadProjectEvidence: mocks.uploadProjectEvidence, completeProject: mocks.completeProject,
  createProjectExpense: mocks.createProjectExpense, downloadProjectEvidence: mocks.downloadProjectEvidence,
}));
vi.mock('@/lib/api', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));

describe('ProjectLifecyclePanel', () => {
  let container: HTMLDivElement; let root: Root;
  const project = { _id: 'project-1', societyId: 'society-1', title: 'Lift repair', description: 'Repair lift', category: 'Maintenance', estimatedCost: '1000', approvedCost: '900', status: 'IN_PROGRESS', proposedBy: 'owner-1', budgetId: 'budget-1', createdAt: '', updatedAt: '' };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.listProjectUpdates.mockResolvedValue([]);
    mocks.listProjectExpenses.mockResolvedValue({ items: [{ _id: 'expense-1', projectId: 'project-1', budgetId: 'budget-1', budgetCategoryId: 'category-1', title: 'Parts', amount: '80', expenseDate: '2026-10-24', createdAt: '2026-10-24T10:00:00.000Z' }], projects: [{ projectId: 'project-1', approvedCost: '900', totalSpent: '80', remainingBudget: '820', overrun: false }] });
    mocks.apiRequest.mockResolvedValue([{ _id: 'category-1', name: 'Maintenance', allocatedAmount: '500', remainingAmount: '420' }]);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); vi.clearAllMocks(); });

  it('shows progress and financial controls to the manager with backend totals', async () => {
    await act(async () => root.render(<ProjectLifecyclePanel project={project} role="SOCIETY_MANAGER" token="manager-token" onProjectChanged={vi.fn()} />));
    const open = [...container.querySelectorAll('button')].find(button => button.textContent === 'Open lifecycle');
    await act(async () => open?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('Approved project amount');
    expect(container.textContent).toContain('₹820');
    expect(container.textContent).toContain('Record project expense');
    expect(container.textContent).toContain('Add immutable project update');
  });

  it('keeps the panel hidden for residents and does not give owners write controls', async () => {
    await act(async () => root.render(<ProjectLifecyclePanel project={project} role="RESIDENT" token="resident-token" onProjectChanged={vi.fn()} />));
    expect(container.textContent).toBe('');
    await act(async () => root.render(<ProjectLifecyclePanel project={project} role="OWNER_MEMBER" token="owner-token" onProjectChanged={vi.fn()} />));
    const open = [...container.querySelectorAll('button')].find(button => button.textContent === 'Open lifecycle');
    await act(async () => open?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('Parts');
    expect(container.textContent).not.toContain('Record project expense');
    expect(container.textContent).not.toContain('Add immutable project update');
  });
});
