# Solidity contracts

`GovernanceProofRegistry.sol` is the first minimal proof-layer contract for
Nivaas. It stores opaque record references, positive version identifiers,
record hashes, the registering account, and the registration timestamp. It
does not store personal information, ballots, documents, or complete
governance records.

The contract uses an owner-configured allowlist of authorized submitter
accounts. This is an MVP deployment assumption because the final mapping
between application roles and on-chain submitters remains unresolved in the
controlled specifications. The owner can add or remove submitters, but this
contract does not define legal approval, quorum, majority, or governance
authority.

Each `(recordReference, version)` pair can be registered only once. A new
version is a separate proof. Verification compares a caller-provided
recomputed hash with the immutable registered hash; it establishes integrity
of the commitment only, not the truth or legal validity of the underlying
record.

## Local deployment

Start the local Hardhat JSON-RPC node in one terminal:

```powershell
npm run node --workspace=@nivaas/blockchain
```

Deploy the registry from another terminal:

```powershell
npm run deploy:local --workspace=@nivaas/blockchain
```

The deployment uses the first local Hardhat account as the initial
authorized submitter. This is a local-development assumption only; it does
not define production signer custody or application-role authorization.
The script writes a local-only deployment record to
`blockchain/deployments/localhost.json`; deployment records are ignored by
Git. The record includes the local chain ID, contract address, deployment
transaction hash and block, plus the artifact path used for the ABI.

This deploy step does not submit application records. AuditLog transaction
tracking persistence and proof-status API behavior remain governed by the
unresolved decisions in `docs/IMPLEMENTATION_DECISIONS.md`.
