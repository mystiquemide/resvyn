// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WarrantyReserve
/// @notice Merchant-funded warranty reserve for Resvyn. A merchant funds a
///         native-token reserve, and issuing coverage locks the declared
///         maximum payout against that reserve. An AI evaluator signs bounded
///         EIP-712 decisions that settle claims directly from the locked
///         reserve.
/// @dev Milestone 3 implementation. The Milestone 1 surface (reserve
///      accounting, coverage issuance, withdrawal) is unchanged and the two
///      winning-invariant guards remain:
///        - issuance rejects `maxPayout > freeReserve` (BR-001, FR-003);
///        - withdrawal rejects amounts above `freeReserve` (BR-003, FR-005).
///      Milestone 3 adds the claim lifecycle: a claimant opens a claim bound
///      to one coverage and one evidence hash (BR-005, BR-006, BR-013), and
///      the AI evaluator's EIP-712 decision (BR-007, BR-008) resolves it.
///      An approved decision pays the claimant bounded native BOT from the
///      locked reserve and releases the lock atomically (BR-009, BR-011);
///      a rejected decision releases the lock without payout. A finalized
///      claim is terminal and cannot be finalized or paid again (BR-010,
///      ADR-004, DEC-006). A failed payout reverts the whole call and leaves
///      accounting and claim state unchanged (BR-012).
///      Zero admin surface: the evaluator signer is immutable (ADR-007,
///      ADR-008); rotation means a new deployment.
contract WarrantyReserve is EIP712, ReentrancyGuard {
    enum CoverageStatus {
        None,
        Active,
        Expired
    }

    struct Coverage {
        address merchant;
        address claimant;
        bytes32 productHash;
        bytes32 receiptHash;
        uint256 maxPayout;
        uint64 expiry;
        CoverageStatus status;
    }

    mapping(address => uint256) private _reserveBalance;
    mapping(address => uint256) private _lockedExposure;
    mapping(uint256 => Coverage) private _coverage;
    uint256 private _coverageCount;

    error ZeroDeposit();
    error ZeroMaxPayout();
    error InvalidClaimant();
    error InvalidExpiry();
    error CoverageAlreadyExpired();
    error CoverageNotExpired();
    error InsufficientFreeReserve(uint256 freeReserve, uint256 requested);
    error WithdrawalExceedsFreeReserve(uint256 freeReserve, uint256 requested);
    error WithdrawalTransferFailed();

    event ReserveDeposited(address indexed merchant, uint256 amount, uint256 newBalance);
    event CoverageIssued(
        uint256 indexed coverageId,
        address indexed merchant,
        address indexed claimant,
        uint256 maxPayout,
        uint64 expiry
    );
    event ReserveWithdrawn(address indexed merchant, uint256 amount, uint256 newBalance);
    event CoverageExpired(
        uint256 indexed coverageId,
        address indexed merchant,
        uint256 maxPayout,
        uint64 expiry
    );

    /// @notice The evaluator signer. Set once at deployment; no setter exists.
    ///         Only decisions signed by this key settle claims (BR-007).
    address public immutable evaluatorSigner;

    /// @notice A claim's lifecycle. Approved and Rejected are both terminal.
    enum ClaimStatus {
        None,
        Open,
        Approved,
        Rejected
    }

    /// @notice The AI decision outcome. None (0) is an invalid sentinel so a
    ///         zeroed or malformed result reverts instead of settling.
    enum DecisionResult {
        None,
        Approve,
        Reject
    }

    struct Claim {
        uint256 coverageId; // the single coverage bound (BR-006)
        address claimant; // payout target, snapshot at open (BR-005)
        bytes32 evidenceHash; // the single evidence hash bound (BR-006, BR-013)
        uint256 paidAmount; // 0 until an Approve pays; audit trail
        ClaimStatus status;
        uint64 openedAt;
    }

    /// @notice EIP-712 signed payload. Field order matches BR-008 exactly and
    ///         is part of the type hash; it must not be reordered.
    struct ClaimDecision {
        uint256 chainId; // BR-008 field 1, also bound by the domain
        address verifier; // BR-008 field 2, must be this contract, also in domain
        uint256 claimId; // BR-008 field 3
        uint256 coverageId; // BR-008 field 4
        address claimant; // BR-008 field 5
        bytes32 evidenceHash; // BR-008 field 6
        uint256 amount; // BR-008 field 7, payout on Approve, 0 on Reject
        uint8 result; // BR-008 field 8, DecisionResult
        bytes32 modelVersion; // BR-008 field 9, opaque tag, bound and emitted
        uint64 expiry; // BR-008 field 10, decision freshness deadline, inclusive
        uint256 nonce; // BR-008 field 11, opaque signer-chosen, single use
    }

    bytes32 private constant CLAIM_DECISION_TYPEHASH =
        keccak256(
            "ClaimDecision(uint256 chainId,address verifier,uint256 claimId,uint256 coverageId,"
            "address claimant,bytes32 evidenceHash,uint256 amount,uint8 result,"
            "bytes32 modelVersion,uint64 expiry,uint256 nonce)"
        );

    mapping(uint256 => Claim) private _claim; // claimId => Claim
    uint256 private _claimCount; // claimId starts at 1 (0 = none)
    mapping(uint256 => uint256) private _claimOfCoverage; // coverageId => claimId (0 = none)
    mapping(uint256 => bool) private _usedNonce; // decision.nonce => consumed

    error ZeroEvaluatorSigner();
    error CoverageNotActive();
    error NotClaimant();
    error ZeroEvidenceHash();
    error ClaimAlreadyExists();
    error InvalidSigner();
    error WrongChain();
    error WrongVerifier();
    error DecisionExpired();
    error NonceAlreadyUsed();
    error ClaimNotOpen();
    error ClaimAlreadyFinalized();
    error CoverageMismatch();
    error ClaimantMismatch();
    error EvidenceMismatch();
    error AmountOutOfRange();
    error InvalidResult();
    error PayoutTransferFailed();

    event ClaimOpened(
        uint256 indexed claimId,
        uint256 indexed coverageId,
        address indexed claimant,
        bytes32 evidenceHash
    );
    event ClaimPaid(
        uint256 indexed claimId,
        uint256 indexed coverageId,
        address indexed claimant,
        uint256 amount,
        bytes32 modelVersion,
        uint256 nonce
    );
    event ClaimRejected(
        uint256 indexed claimId,
        uint256 indexed coverageId,
        address indexed claimant,
        bytes32 modelVersion,
        uint256 nonce
    );

    constructor(address evaluatorSigner_) EIP712("Resvyn Warranty Reserve", "1") {
        if (evaluatorSigner_ == address(0)) revert ZeroEvaluatorSigner();
        evaluatorSigner = evaluatorSigner_;
    }

    /// @notice Fund the caller's merchant reserve with native token.
    function depositReserve() external payable {
        if (msg.value == 0) revert ZeroDeposit();
        _reserveBalance[msg.sender] += msg.value;
        emit ReserveDeposited(msg.sender, msg.value, _reserveBalance[msg.sender]);
    }

    /// @notice Issue buyer-bound coverage and lock its maximum payout.
    /// @dev BR-001: coverage activates only when `freeReserve >= maxPayout`.
    ///      BR-002: locked exposure increases by `maxPayout` in this call.
    ///      BR-004: `maxPayout` is immutable after issuance (no setter exists).
    function issueCoverage(
        address claimant,
        bytes32 productHash,
        bytes32 receiptHash,
        uint256 maxPayout,
        uint64 expiry
    ) external returns (uint256 coverageId) {
        if (claimant == address(0)) revert InvalidClaimant();
        if (maxPayout == 0) revert ZeroMaxPayout();
        if (expiry <= block.timestamp) revert InvalidExpiry();

        // BR-001 / FR-003: no funded reserve, no valid coverage.
        uint256 free = _reserveBalance[msg.sender] - _lockedExposure[msg.sender];
        if (maxPayout > free) revert InsufficientFreeReserve(free, maxPayout);

        coverageId = ++_coverageCount;
        _coverage[coverageId] = Coverage({
            merchant: msg.sender,
            claimant: claimant,
            productHash: productHash,
            receiptHash: receiptHash,
            maxPayout: maxPayout,
            expiry: expiry,
            status: CoverageStatus.Active
        });
        _lockedExposure[msg.sender] += maxPayout;

        emit CoverageIssued(coverageId, msg.sender, claimant, maxPayout, expiry);
    }

    /// @notice Permissionlessly expire an unused, past-expiry coverage and
    ///         release its locked exposure exactly once.
    /// @dev REV-003: coverage expiry is now a lifecycle invariant, not just
    ///      metadata. A coverage whose window has passed and which never had a
    ///      claim opened can be expired by anyone, releasing the full
    ///      maxPayout lock back to the merchant's free reserve. A coverage
    ///      with an already-open claim is intentionally NOT expirable: the
    ///      claim opened while the coverage was active remains settleable by
    ///      a valid evaluator decision (documented grace rule), so the lock
    ///      is only released through settlement. The Expired status is
    ///      terminal, so the lock can never be released twice.
    /// @param coverageId The coverage to expire.
    function expireCoverage(uint256 coverageId) external {
        Coverage storage cov = _coverage[coverageId];
        if (cov.status != CoverageStatus.Active) revert CoverageNotActive();
        if (block.timestamp < cov.expiry) revert CoverageNotExpired();
        if (_claimOfCoverage[coverageId] != 0) revert ClaimAlreadyExists();

        cov.status = CoverageStatus.Expired;
        // Issuance added exactly `cov.maxPayout` to locked exposure; this is
        // the only release path for an unclaimed coverage, so it cannot
        // underflow (BR-011 accounting invariant).
        _lockedExposure[cov.merchant] -= cov.maxPayout;

        emit CoverageExpired(coverageId, cov.merchant, cov.maxPayout, cov.expiry);
    }

    /// @notice Withdraw from the caller's merchant reserve.
    /// @dev BR-003 / FR-005: withdrawal cannot reduce reserve below locked
    ///      exposure. State is updated before the external transfer.
    function withdrawReserve(uint256 amount) external {
        // BR-003 / FR-005: a merchant may withdraw only free reserve.
        uint256 free = _reserveBalance[msg.sender] - _lockedExposure[msg.sender];
        if (amount > free) revert WithdrawalExceedsFreeReserve(free, amount);

        _reserveBalance[msg.sender] -= amount;
        emit ReserveWithdrawn(msg.sender, amount, _reserveBalance[msg.sender]);

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawalTransferFailed();
    }

    /// @notice Open a claim against an active coverage.
    /// @dev BR-005: only the coverage claimant may open its claim.
    ///      BR-006: the claim binds exactly this coverage and evidence hash.
    ///      BR-013: only the evidence hash is stored, never raw evidence.
    ///      ADR-004: one terminal claim per coverage; a second open reverts.
    /// @return claimId The new claim id, from 1.
    function openClaim(uint256 coverageId, bytes32 evidenceHash)
        external
        returns (uint256 claimId)
    {
        Coverage storage cov = _coverage[coverageId];
        if (cov.status != CoverageStatus.Active) revert CoverageNotActive();
        if (block.timestamp >= cov.expiry) revert CoverageAlreadyExpired();
        if (msg.sender != cov.claimant) revert NotClaimant();
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        if (_claimOfCoverage[coverageId] != 0) revert ClaimAlreadyExists();

        claimId = ++_claimCount;
        _claim[claimId] = Claim({
            coverageId: coverageId,
            claimant: cov.claimant,
            evidenceHash: evidenceHash,
            paidAmount: 0,
            status: ClaimStatus.Open,
            openedAt: uint64(block.timestamp)
        });
        _claimOfCoverage[coverageId] = claimId;

        emit ClaimOpened(claimId, coverageId, cov.claimant, evidenceHash);
    }

    /// @notice Settle an open claim with an AI-signed EIP-712 decision.
    /// @dev Authority is the evaluator signature, not the caller, so anyone
    ///      may relay the decision; the payout always routes to the
    ///      coverage-bound claimant.
    ///      BR-007: only the active evaluator signer's signature is accepted.
    ///      BR-008: every bound field is checked against the live claim.
    ///      BR-009: an approved amount is bounded by the coverage maximum.
    ///      BR-010: a finalized claim cannot be finalized or paid again.
    ///      BR-011: payout reduces reserve balance and releases the lock
    ///      atomically. BR-012: a failed transfer reverts the whole call.
    /// @param d The signed decision.
    /// @param signature The evaluator's EIP-712 signature over `d`.
    /// @return approved True when the claim was approved and paid, false when
    ///         the claim was rejected without payout.
    function resolveClaim(ClaimDecision calldata d, bytes calldata signature)
        external
        nonReentrant
        returns (bool approved)
    {
        // A. Signature authenticity (BR-007).
        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_DECISION_TYPEHASH,
                d.chainId,
                d.verifier,
                d.claimId,
                d.coverageId,
                d.claimant,
                d.evidenceHash,
                d.amount,
                d.result,
                d.modelVersion,
                d.expiry,
                d.nonce
            )
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != evaluatorSigner) revert InvalidSigner();

        // B. Domain and freshness binding (BR-008).
        if (d.chainId != block.chainid) revert WrongChain();
        if (d.verifier != address(this)) revert WrongVerifier();
        if (d.expiry < block.timestamp) revert DecisionExpired();
        if (_usedNonce[d.nonce]) revert NonceAlreadyUsed();

        // C. Claim and coverage consistency (BR-006, BR-009).
        Claim storage c = _claim[d.claimId];
        if (c.status == ClaimStatus.None) revert ClaimNotOpen();
        if (c.status != ClaimStatus.Open) revert ClaimAlreadyFinalized();
        if (c.coverageId != d.coverageId) revert CoverageMismatch();
        if (c.claimant != d.claimant) revert ClaimantMismatch();
        if (c.evidenceHash != d.evidenceHash) revert EvidenceMismatch();

        Coverage storage cov = _coverage[d.coverageId];

        // D. Result branch. Enumerating reverts on out-of-range values.
        DecisionResult r = DecisionResult(d.result);
        if (r == DecisionResult.Approve) {
            // BR-009: approve is bounded by the coverage maximum payout.
            if (d.amount == 0 || d.amount > cov.maxPayout) revert AmountOutOfRange();

            // Effects before interaction: nonce burned, claim finalized, and
            // reserve accounting updated atomically (BR-011).
            _usedNonce[d.nonce] = true;
            c.status = ClaimStatus.Approved;
            c.paidAmount = d.amount;
            _reserveBalance[cov.merchant] -= d.amount;
            // Release the full lock: the claim is terminal, so residual
            // exposure is zero. Locked exposure cannot underflow because
            // issuance added exactly `cov.maxPayout` and this is the only
            // path that removes it.
            _lockedExposure[cov.merchant] -= cov.maxPayout;

            (bool ok, ) = payable(c.claimant).call{value: d.amount}("");
            // BR-012: a failed payout reverts the whole call, rolling back the
            // finalization, nonce, and accounting above.
            if (!ok) revert PayoutTransferFailed();

            emit ClaimPaid(
                d.claimId, d.coverageId, c.claimant, d.amount, d.modelVersion, d.nonce
            );
            approved = true;
        } else if (r == DecisionResult.Reject) {
            // A reject authorizes no transfer; the amount must be zero so a
            // signed reject can never be misread as authorizing a payout.
            if (d.amount != 0) revert AmountOutOfRange();

            _usedNonce[d.nonce] = true;
            c.status = ClaimStatus.Rejected;
            _lockedExposure[cov.merchant] -= cov.maxPayout;

            emit ClaimRejected(
                d.claimId, d.coverageId, c.claimant, d.modelVersion, d.nonce
            );
            approved = false;
        } else {
            revert InvalidResult();
        }
    }

    /// @notice Reserve accounting for a merchant.
    /// @return balance Total native token accounted to the merchant.
    /// @return locked Sum of maximum payouts committed to active coverage.
    /// @return free Withdrawable and issuable capacity: balance - locked.
    function reserveOf(address merchant)
        external
        view
        returns (uint256 balance, uint256 locked, uint256 free)
    {
        balance = _reserveBalance[merchant];
        locked = _lockedExposure[merchant];
        free = balance >= locked ? balance - locked : 0;
    }

    /// @notice Read a coverage record.
    function coverageOf(uint256 coverageId) external view returns (Coverage memory) {
        return _coverage[coverageId];
    }

    /// @notice Number of coverage records ever issued.
    function coverageCount() external view returns (uint256) {
        return _coverageCount;
    }

    /// @notice Read a claim record.
    function claimOf(uint256 claimId) external view returns (Claim memory) {
        return _claim[claimId];
    }

    /// @notice The claim id bound to a coverage, or 0 if none was ever opened.
    function claimIdOfCoverage(uint256 coverageId) external view returns (uint256) {
        return _claimOfCoverage[coverageId];
    }

    /// @notice Whether a decision nonce was already consumed.
    function isNonceUsed(uint256 nonce) external view returns (bool) {
        return _usedNonce[nonce];
    }

    /// @notice Number of claims ever opened.
    function claimCount() external view returns (uint256) {
        return _claimCount;
    }
}
