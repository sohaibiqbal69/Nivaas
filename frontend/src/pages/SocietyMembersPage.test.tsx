import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SocietyMembersPage } from './SocietyMembersPage';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  createSocietyUser: vi.fn(),
  createSocietyFlat: vi.fn(),
  createSocietyMembership: vi.fn(),
  createOwnership: vi.fn(),
  createResidence: vi.fn(),
  listFlatOwnerships: vi.fn(),
  listFlatResidents: vi.fn(),
  listSocietyFlats: vi.fn(),
  listSocietyBuildings: vi.fn(),
  listSocietyMemberships: vi.fn(),
  listSocietyUsers: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/members', () => ({
  createSocietyUser: mocks.createSocietyUser,
  createSocietyFlat: mocks.createSocietyFlat,
  createSocietyMembership: mocks.createSocietyMembership,
  createOwnership: mocks.createOwnership,
  createResidence: mocks.createResidence,
  listFlatOwnerships: mocks.listFlatOwnerships,
  listFlatResidents: mocks.listFlatResidents,
  listSocietyFlats: mocks.listSocietyFlats,
  listSocietyBuildings: mocks.listSocietyBuildings,
  listSocietyMemberships: mocks.listSocietyMemberships,
  listSocietyUsers: mocks.listSocietyUsers,
}));

describe('SocietyMembersPage onboarding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { _id: 'manager-1', societyId: 'society-1', role: 'SOCIETY_MANAGER' }, token: 'manager-token' });
    mocks.listSocietyMemberships.mockResolvedValue([]);
    mocks.listSocietyBuildings.mockResolvedValue([{ _id: 'building-1', societyId: 'society-1', name: 'East Wing' }]);
    mocks.listSocietyFlats.mockResolvedValue([{ _id: 'flat-1', societyId: 'society-1', buildingId: 'building-1', flatNumber: 'A-1', status: 'ACTIVE' }]);
    mocks.listSocietyUsers.mockResolvedValue([]);
    mocks.listFlatOwnerships.mockResolvedValue([]);
    mocks.listFlatResidents.mockResolvedValue([]);
    mocks.createSocietyFlat.mockImplementation(async (input: { buildingId: string; flatNumber: string; status: 'ACTIVE' | 'INACTIVE' }) => {
      const created = { _id: 'flat-created', societyId: 'society-1', buildingId: input.buildingId, flatNumber: input.flatNumber, status: 'ACTIVE' };
      mocks.listSocietyFlats.mockResolvedValue([created, { _id: 'flat-1', societyId: 'society-1', buildingId: 'building-1', flatNumber: 'A-1', status: 'ACTIVE' }]);
      return created;
    });
    mocks.createOwnership.mockResolvedValue({ _id: 'ownership-1', userId: 'user-1', ownershipType: 'JOINT', status: 'ACTIVE' });
    mocks.createResidence.mockResolvedValue({ _id: 'residence-1', userId: 'user-1', occupancyType: 'TENANT', status: 'ACTIVE' });
    mocks.createSocietyUser.mockResolvedValue({
      _id: 'user-1', societyId: 'society-1', name: 'New Resident', email: 'resident@example.test',
      role: 'RESIDENT', status: 'PENDING_SETUP', setupCredential: 'one-time-secret',
      setupCredentialExpiresAt: '2026-10-24T00:00:00.000Z',
    });
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

  it('creates a pending member account for the manager society and presents only the returned one-time credential', async () => {
    await act(async () => {
      root.render(<MemoryRouter><SocietyMembersPage /></MemoryRouter>);
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Create society account"]');
    const name = form?.querySelector<HTMLInputElement>('[name="account-name"]');
    const email = form?.querySelector<HTMLInputElement>('[name="account-email"]');
    const role = form?.querySelector<HTMLSelectElement>('[name="account-role"]');
    expect(form && name && email && role).toBeTruthy();

    const setValue = (field: HTMLInputElement | HTMLSelectElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set?.call(field, value);
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    await act(async () => {
      setValue(name!, 'New Resident');
      setValue(email!, 'resident@example.test');
      setValue(role!, 'RESIDENT');
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.createSocietyUser).toHaveBeenCalledWith({ name: 'New Resident', email: 'resident@example.test', role: 'RESIDENT' }, 'manager-token');
    expect(container.textContent).toContain('PENDING_SETUP');
    expect(container.textContent).toContain('one-time-secret');
    expect(container.textContent).toContain('governance rules and verified membership evidence determine eligibility.');
  });

  it('keeps the page unavailable to non-managers', () => {
    mocks.useAuth.mockReturnValue({ user: { _id: 'owner-1', societyId: 'society-1', role: 'OWNER_MEMBER' }, token: 'owner-token' });
    expect(renderToStaticMarkup(<MemoryRouter><SocietyMembersPage /></MemoryRouter>)).toContain('Permission required');
  });
  it('searches persisted flats and explains how to request a missing flat without inventing a relationship', async () => {
    mocks.listSocietyUsers.mockResolvedValue([{ _id: 'user-1', name: 'Resident', email: 'resident@example.test', role: 'RESIDENT', status: 'ACTIVE', societyId: 'society-1' }]);
    await act(async () => root.render(<MemoryRouter><SocietyMembersPage /></MemoryRouter>));
    expect(container.textContent).toContain('System Admin');
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).toBeDefined();
    expect(container.textContent).toContain('A-1');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'missing-flat');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...container.querySelectorAll('option')].some(option => option.value === 'flat-1')).toBe(false);
    expect(mocks.createSocietyMembership).not.toHaveBeenCalled();
    expect(mocks.createOwnership).not.toHaveBeenCalled();
  });

  it('creates a missing leading-zero flat explicitly and then records an owner against its persisted ID', async () => {
    mocks.listSocietyUsers.mockResolvedValue([{ _id: 'user-1', name: 'Joint owner', email: 'owner@example.test', role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: 'society-1' }]);
    await act(async () => root.render(<MemoryRouter><SocietyMembersPage /></MemoryRouter>));
    const addFlatForm = container.querySelector<HTMLFormElement>('form[aria-label="Add society flat"]')!;
    const building = addFlatForm.querySelector<HTMLSelectElement>('select')!;
    const flatNumber = addFlatForm.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(building, 'building-1');
      building.dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(flatNumber, '002');
      flatNumber.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      addFlatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(mocks.createSocietyFlat).toHaveBeenCalledWith({ buildingId: 'building-1', flatNumber: '002', status: 'ACTIVE' }, 'manager-token');
    expect(container.textContent).toContain('Flat 002 was created');

    const relationshipForm = container.querySelector<HTMLFormElement>('form[aria-label="Record a flat relationship"]')!;
    const selects = relationshipForm.querySelectorAll('select');
    const inputs = relationshipForm.querySelectorAll('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[0], 'ownership');
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[1], 'building-1');
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[0], '002');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[2], 'user-1');
      selects[2].dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[1], 'JOINT');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[2], 'ACTIVE');
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = [...relationshipForm.querySelectorAll('button')].find(button => button.textContent?.includes('Save ownership record'));
    await act(async () => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      relationshipForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(mocks.createOwnership).toHaveBeenCalledWith('flat-created', expect.objectContaining({ userId: 'user-1', ownershipType: 'JOINT', status: 'ACTIVE' }), 'manager-token');
  });

  it('selects an existing flat by exact number before recording an additional ownership record', async () => {
    mocks.listSocietyUsers.mockResolvedValue([{ _id: 'user-1', name: 'Joint owner', email: 'owner@example.test', role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: 'society-1' }]);
    await act(async () => root.render(<MemoryRouter><SocietyMembersPage /></MemoryRouter>));
    const relationshipForm = container.querySelector<HTMLFormElement>('form[aria-label="Record a flat relationship"]')!;
    const selects = relationshipForm.querySelectorAll('select');
    const inputs = relationshipForm.querySelectorAll('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[0], 'ownership');
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[1], 'building-1');
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[0], 'A-1');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[2], 'user-1');
      selects[2].dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[1], 'JOINT');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[2], 'ACTIVE');
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      relationshipForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(mocks.createOwnership).toHaveBeenCalledWith('flat-1', expect.objectContaining({ userId: 'user-1', ownershipType: 'JOINT', status: 'ACTIVE' }), 'manager-token');
  });
});
