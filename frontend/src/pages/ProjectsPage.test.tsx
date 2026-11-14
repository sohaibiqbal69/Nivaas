import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ProjectsPage } from './ProjectsPage';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  createProject: vi.fn(),
  evaluateProjectApproval: vi.fn(),
  getProjectApprovalHistory: vi.fn(),
  listProjects: vi.fn(),
  submitProjectForReview: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/projects', () => ({
  createProject: mocks.createProject,
  evaluateProjectApproval: mocks.evaluateProjectApproval,
  getProjectApprovalHistory: mocks.getProjectApprovalHistory,
  listProjects: mocks.listProjects,
  submitProjectForReview: mocks.submitProjectForReview,
}));

describe('ProjectsPage approval history', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { _id: 'manager-1', societyId: 'society-1', role: 'SOCIETY_MANAGER' }, token: 'manager-token' });
    mocks.listProjects.mockResolvedValue([{
      _id: 'project-1', societyId: 'society-1', title: 'Lift repair', description: 'Repair the lift', category: 'Maintenance',
      estimatedCost: '125000', status: 'SGM_REQUIRED', proposedBy: 'manager-1', createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z',
    }]);
    mocks.getProjectApprovalHistory.mockResolvedValue([{
      _id: 'evaluation-1', projectId: 'project-1', approvalType: 'SGM_REQUIRED', requiredDecisionBody: 'GENERAL_BODY_OR_SGM',
      evaluatedAmount: '125000', threshold: '100000', ruleVersionId: 'rule-v2', status: 'REQUIRED',
      evaluatedAt: '2026-10-18T00:00:00.000Z',
    }]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.clearAllMocks();
  });

  it('loads the recorded evaluation history and distinguishes route evaluation from approval', async () => {
    await act(async () => root.render(<MemoryRouter><ProjectsPage /></MemoryRouter>));
    const historyButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Approval history'));
    expect(historyButton).toBeDefined();
    await act(async () => { historyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(mocks.getProjectApprovalHistory).toHaveBeenCalledWith('project-1', 'manager-token');
    expect(container.textContent).toContain('SGM REQUIRED');
    expect(container.textContent).toContain('configured threshold ₹100000');
    expect(container.textContent).toContain('It does not represent a governance resolution, vote, or project approval.');
    expect(container.textContent).not.toContain('Project approved');
  });

  it('shows owners society project and approval information without operational actions', async () => {
    mocks.useAuth.mockReturnValue({ user: { _id: 'owner-1', societyId: 'society-1', role: 'OWNER_MEMBER' }, token: 'owner-token' });
    await act(async () => root.render(<MemoryRouter><ProjectsPage /></MemoryRouter>));
    expect(mocks.listProjects).toHaveBeenCalledWith('owner-token');
    expect(container.textContent).toContain('Lift repair');
    expect(container.textContent).toContain('Approval history');
    expect(container.querySelector('a[href="/quotations?projectId=project-1"]')?.textContent).toBe('View quotations');
    expect(container.textContent).not.toContain('New proposal');
    expect(container.textContent).not.toContain('Send for review');
    expect(container.textContent).not.toContain('Evaluate approval route');
  });
});
