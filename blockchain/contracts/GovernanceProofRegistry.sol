// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title GovernanceProofRegistry
/// @notice Stores hash commitments for selected off-chain governance records.
/// @dev The contract proves only that a hash was registered. It does not prove
///      the truth, legality, approval, or voting validity of the off-chain record.
contract GovernanceProofRegistry {
    struct Proof {
        bytes32 recordReference;
        uint256 version;
        bytes32 recordHash;
        address registeredBy;
        uint64 registeredAt;
    }

    error EmptyRecordReference();
    error EmptyRecordHash();
    error InvalidVersion();
    error UnknownProof();
    error Unauthorized();
    error ZeroAddress();
    error ProofAlreadyRegistered();

    address public immutable owner;
    mapping(address => bool) public authorizedSubmitters;
    mapping(bytes32 => Proof) private proofs;

    event SubmitterAuthorizationUpdated(address indexed submitter, bool authorized);
    event ProofRegistered(
        bytes32 indexed recordReference,
        uint256 indexed version,
        bytes32 indexed recordHash,
        address registeredBy,
        uint256 registeredAt
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyAuthorizedSubmitter() {
        if (!authorizedSubmitters[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(address initialAuthorizedSubmitter) {
        if (initialAuthorizedSubmitter == address(0)) revert ZeroAddress();
        owner = msg.sender;
        authorizedSubmitters[initialAuthorizedSubmitter] = true;
        emit SubmitterAuthorizationUpdated(initialAuthorizedSubmitter, true);
    }

    /// @notice Adds or removes an account allowed to register proofs.
    /// @dev This signer configuration is an MVP deployment assumption, not a
    ///      final mapping of application roles or governance authority.
    function setAuthorizedSubmitter(address submitter, bool authorized) external onlyOwner {
        if (submitter == address(0)) revert ZeroAddress();
        authorizedSubmitters[submitter] = authorized;
        emit SubmitterAuthorizationUpdated(submitter, authorized);
    }

    /// @notice Registers one immutable record hash for a record/version pair.
    /// @param recordReference Opaque hash/reference for the off-chain record.
    /// @param version Positive application-level version identifier.
    /// @param recordHash Canonical hash recomputed from the off-chain snapshot.
    function registerProof(
        bytes32 recordReference,
        uint256 version,
        bytes32 recordHash
    ) external onlyAuthorizedSubmitter {
        if (recordReference == bytes32(0)) revert EmptyRecordReference();
        if (version == 0) revert InvalidVersion();
        if (recordHash == bytes32(0)) revert EmptyRecordHash();

        bytes32 proofKey = _proofKey(recordReference, version);
        if (proofs[proofKey].registeredBy != address(0)) revert ProofAlreadyRegistered();

        proofs[proofKey] = Proof({
            recordReference: recordReference,
            version: version,
            recordHash: recordHash,
            registeredBy: msg.sender,
            registeredAt: uint64(block.timestamp)
        });

        emit ProofRegistered(recordReference, version, recordHash, msg.sender, block.timestamp);
    }

    /// @notice Returns a registered proof or reverts when it is unknown.
    function getProof(bytes32 recordReference, uint256 version) external view returns (Proof memory) {
        Proof memory proof = proofs[_proofKey(recordReference, version)];
        if (proof.registeredBy == address(0)) revert UnknownProof();
        return proof;
    }

    /// @notice Verifies a recomputed hash against a registered record/version.
    function verifyProof(
        bytes32 recordReference,
        uint256 version,
        bytes32 recomputedRecordHash
    ) external view returns (bool) {
        Proof memory proof = proofs[_proofKey(recordReference, version)];
        if (proof.registeredBy == address(0)) revert UnknownProof();
        return proof.recordHash == recomputedRecordHash;
    }

    function _proofKey(bytes32 recordReference, uint256 version) private pure returns (bytes32) {
        return keccak256(abi.encode(recordReference, version));
    }
}
