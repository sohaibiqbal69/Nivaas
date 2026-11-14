import { describe, expect, it, vi } from 'vitest';
import {
  assertProductionBootstrapAllowed,
  bootstrapProductionFirstSystemAdmin,
  type FirstSystemAdminBootstrapRepository,
} from '../src/modules/users/first-system-admin-bootstrap.js';

const secret = 'demo-only-bootstrap-authorization-secret-32-bytes';
function fixture() {
  let claim = false;
  let administrator = false;
  let storedCredentialHash = '';
  const repository: FirstSystemAdminBootstrapRepository = {
    withTransaction: async (operation) => operation(null),
    hasClaim: async () => claim,
    hasSystemAdmin: async () => administrator,
    createPending: async (_user, credential) => {
      storedCredentialHash = credential.credentialHash;
      return 'user-1';
    },
    createClaim: async () => { claim = true; administrator = true; },
  };
  return {
    repository,
    setAdministrator: (value: boolean) => { administrator = value; },
    getClaim: () => claim,
    getStoredCredentialHash: () => storedCredentialHash,
  };
}

describe('production first System Admin bootstrap', () => {
  it('rejects unauthorized attempts before opening a transaction', async () => {
    const target = fixture();
    const transact = vi.spyOn(target.repository, 'withTransaction');
    await expect(bootstrapProductionFirstSystemAdmin(
      { name: 'Demo Admin', email: 'admin@example.test' }, 'wrong-secret', target.repository,
      { enabled: true, secret, nodeEnvironment: 'production' },
    )).rejects.toThrow(/authorization secret is invalid/);
    expect(transact).not.toHaveBeenCalled();
  });

  it('requires an explicitly enabled production configuration and a sufficiently long secret', () => {
    expect(() => assertProductionBootstrapAllowed({ enabled: false, secret, nodeEnvironment: 'production' }, secret)).toThrow(/disabled/);
    expect(() => assertProductionBootstrapAllowed({ enabled: true, secret: 'short', nodeEnvironment: 'production' }, 'short')).toThrow(/disabled/);
    expect(() => assertProductionBootstrapAllowed({ enabled: true, secret, nodeEnvironment: 'development' }, secret)).toThrow(/only in production/);
  });

  it('persists only the credential hash and atomically claims the one-time bootstrap', async () => {
    const target = fixture();
    const result = await bootstrapProductionFirstSystemAdmin(
      { name: 'Demo Admin', email: 'admin@example.test' }, secret, target.repository,
      { enabled: true, secret, nodeEnvironment: 'production' },
    );
    expect(result.userId).toBe('user-1');
    expect(result.setupCredential).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(target.getStoredCredentialHash()).not.toBe(result.setupCredential);
    expect(target.getStoredCredentialHash()).toMatch(/^[a-f0-9]{64}$/);
    expect(target.getClaim()).toBe(true);
    await expect(bootstrapProductionFirstSystemAdmin(
      { name: 'Second Admin', email: 'second@example.test' }, secret, target.repository,
      { enabled: true, secret, nodeEnvironment: 'production' },
    )).rejects.toThrow(/already been claimed/);
  });

  it('refuses to create another administrator if one already exists', async () => {
    const target = fixture();
    target.setAdministrator(true);
    const create = vi.spyOn(target.repository, 'createPending');
    await expect(bootstrapProductionFirstSystemAdmin(
      { name: 'Another Admin', email: 'another@example.test' }, secret, target.repository,
      { enabled: true, secret, nodeEnvironment: 'production' },
    )).rejects.toThrow(/SYSTEM_ADMIN already exists/);
    expect(create).not.toHaveBeenCalled();
  });

  it('normalizes a concurrent one-time claim uniqueness conflict', async () => {
    const target = fixture();
    target.repository.createClaim = async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); };
    await expect(bootstrapProductionFirstSystemAdmin(
      { name: 'Demo Admin', email: 'admin@example.test' }, secret, target.repository,
      { enabled: true, secret, nodeEnvironment: 'production' },
    )).rejects.toThrow(/already completed or is running/);
  });
});
