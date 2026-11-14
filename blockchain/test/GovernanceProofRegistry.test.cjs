const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('GovernanceProofRegistry', function () {
  async function deploy() {
    const [owner, submitter, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('GovernanceProofRegistry');
    const registry = await Registry.deploy(submitter.address);
    await registry.waitForDeployment();
    return { registry, owner, submitter, other };
  }

  const reference = ethers.keccak256(ethers.toUtf8Bytes('audit-event-1'));
  const firstHash = ethers.keccak256(ethers.toUtf8Bytes('canonical-snapshot-v1'));
  const alteredHash = ethers.keccak256(ethers.toUtf8Bytes('altered-snapshot'));

  it('allows an authorized submitter to register a proof and stores its metadata', async function () {
    const { registry, submitter } = await deploy();

    const transaction = await registry.connect(submitter).registerProof(reference, 1, firstHash);
    const receipt = await transaction.wait();
    const registration = receipt.logs
      .map((log) => {
        try { return registry.interface.parseLog(log); } catch { return null; }
      })
      .find((event) => event?.name === 'ProofRegistered');
    expect(registration.args.recordReference).to.equal(reference);
    expect(registration.args.version).to.equal(1n);
    expect(registration.args.recordHash).to.equal(firstHash);
    expect(registration.args.registeredBy).to.equal(submitter.address);

    const proof = await registry.getProof(reference, 1);
    expect(proof.recordReference).to.equal(reference);
    expect(proof.version).to.equal(1n);
    expect(proof.recordHash).to.equal(firstHash);
    expect(proof.registeredBy).to.equal(submitter.address);
    expect(proof.registeredAt).to.be.greaterThan(0);
  });

  it('accepts the versioned AuditLog reference encoded by the backend using Solidity abi.encode', async function () {
    const { registry, submitter } = await deploy();
    const societyObjectId = '68a123456789012345678902';
    const auditLogObjectId = '68a123456789012345678901';
    const domainHash = ethers.keccak256(ethers.toUtf8Bytes('NIVAAS:AUDIT_LOG:REFERENCE'));
    const reference = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'bytes32', 'bytes32'],
      [
        domainHash,
        1n,
        ethers.zeroPadValue(`0x${societyObjectId}`, 32),
        ethers.zeroPadValue(`0x${auditLogObjectId}`, 32),
      ],
    ));
    const hash = ethers.keccak256(ethers.toUtf8Bytes('audit-log-canonical-hash'));

    await registry.connect(submitter).registerProof(reference, 1, hash);
    const proof = await registry.getProof(reference, 1);
    expect(proof.recordReference).to.equal(reference);
    expect(proof.recordHash).to.equal(hash);
    expect(await registry.verifyProof(reference, 1, hash)).to.equal(true);
  });

  it('rejects unauthorized registration', async function () {
    const { registry, other } = await deploy();

    await expectCustomError(registry.connect(other).registerProof(reference, 1, firstHash), registry, 'Unauthorized');
  });

  it('prevents duplicate registration but permits a new version', async function () {
    const { registry, submitter } = await deploy();

    await registry.connect(submitter).registerProof(reference, 1, firstHash);
    await expectCustomError(registry.connect(submitter).registerProof(reference, 1, alteredHash), registry, 'ProofAlreadyRegistered');

    await registry.connect(submitter).registerProof(reference, 2, alteredHash);
  });

  it('verifies a matching hash and rejects an altered hash', async function () {
    const { registry, submitter } = await deploy();
    await registry.connect(submitter).registerProof(reference, 1, firstHash);

    expect(await registry.verifyProof(reference, 1, firstHash)).to.equal(true);
    expect(await registry.verifyProof(reference, 1, alteredHash)).to.equal(false);
  });

  it('rejects unknown proofs', async function () {
    const { registry } = await deploy();

    await expectCustomError(registry.getProof(reference, 1), registry, 'UnknownProof');
    await expectCustomError(registry.verifyProof(reference, 1, firstHash), registry, 'UnknownProof');
  });

  it('rejects invalid inputs', async function () {
    const { registry, submitter } = await deploy();

    await expectCustomError(registry.connect(submitter).registerProof(ethers.ZeroHash, 1, firstHash), registry, 'EmptyRecordReference');
    await expectCustomError(registry.connect(submitter).registerProof(reference, 0, firstHash), registry, 'InvalidVersion');
    await expectCustomError(registry.connect(submitter).registerProof(reference, 1, ethers.ZeroHash), registry, 'EmptyRecordHash');
  });

  it('lets the owner configure submitters but rejects non-owner configuration', async function () {
    const { registry, owner, submitter, other } = await deploy();

    await expectCustomError(registry.connect(other).setAuthorizedSubmitter(other.address, true), registry, 'Unauthorized');
    await registry.connect(owner).setAuthorizedSubmitter(other.address, true);
    expect(await registry.authorizedSubmitters(other.address)).to.equal(true);
    await registry.connect(other).registerProof(reference, 1, firstHash);
    await registry.connect(owner).setAuthorizedSubmitter(submitter.address, false);
    await expectCustomError(registry.connect(submitter).registerProof(reference, 2, firstHash), registry, 'Unauthorized');
  });
});

async function expectCustomError(transaction, contract, expectedName) {
  try {
    await transaction;
    throw new Error(`Expected ${expectedName} to revert`);
  } catch (error) {
    const data = error?.data ?? error?.info?.error?.data ?? error?.info?.data;
    const parsed = data ? contract.interface.parseError(data) : null;
    expect(parsed?.name ?? String(error)).to.include(expectedName);
  }
}
