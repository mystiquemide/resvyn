// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WarrantyReserve
/// @notice Merchant-funded warranty reserves with buyer-bound coverage and
///         evaluator-authorized claim settlement.
/// @dev Every issued coverage reserves its full maximum payout up front.
///      Claims commit to one evidence hash, and terminal decisions are bound
///      to the chain, this verifier, the claim, coverage, claimant and amount
///      through EIP-712.
contract WarrantyReserve is EIP712, ReentrancyGuard {
    enum CoverageStatus {
        None,
        Active,
        Expired
    }

    enum ClaimStatus {
        None,
        Open,
        Approved,
        Rejected
    }

    enum DecisionResult {
        None,
        Approve,
        Reject
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

    struct Claim {
        uint256 coverageId;
        address claimant;
        bytes32 evidenceHash;
        uint256 paidAmount;
        ClaimStatus status;
        uint64 openedAt;
    }

    /// @notice EIP-712 payload. Field order is part of the signed type and must
    ///         remain stable for this contract version.
    struct ClaimDecision {
        uint256 chainId;
        address verifier;
        uint256 claimId;
        uint256 coverageId;
        address claimant;
        bytes32 evidenceHash;
        uint256 amount;
        uint8 result;
        bytes32 modelVersion;
        uint64 expiry;
        uint256 nonce;
    }

    bytes32 private constant CLAIM_DECISION_TYPEHASH =
        keccak256(
            "ClaimDecision(uint256 chainId,address verifier,uint256 claimId,uint256 coverageId,"
            "address claimant,bytes32 evidenceHash,uint256 amount,uint8 result,"
            "bytes32 modelVersion,uint64 expiry,uint256 nonce)"
        );

    mapping(address => uint256) private _reserveBalance;
    mapping(address => uint256) private _lockedExposure;
    mapping(uint256 => Coverage) private _coverage;
    uint256 private _coverageCount;

    mapping(uint256 => Claim) private _claim;
    uint256 private _claimCount;
    mapping(uint256 => uint256) private _claimOfCoverage;
    mapping(uint256 => bool) private _usedNonce;

    address public immutable evaluatorSigner;

    error ZeroDeposit();
    error ZeroWithdrawal();
    error ZeroMaxPayout();
    error ZeroProductHash();
    error ZeroReceiptHash();
    error InvalidClaimant();
    error InvalidExpiry();
    error CoverageAlreadyExpired();
    error CoverageNotExpired();
    error InsufficientFreeReserve(uint256 freeReserve, uint256 requested);
    error WithdrawalExceedsFreeReserve(uint256 freeReserve, uint256 requested);
    error WithdrawalTransferFailed();
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

    /// @notice Credit native BOT to the caller's merchant reserve.
    function depositReserve() external payable {
        if (msg.value == 0) revert ZeroDeposit();
        _reserveBalance[msg.sender] += msg.value;
        emit ReserveDeposited(msg.sender, msg.value, _reserveBalance[msg.sender]);
    }

    /// @notice Issue buyer-bound coverage and reserve its full maximum payout.
    function issueCoverage(
        address claimant,
        bytes32 productHash,
        bytes32 receiptHash,
        uint256 maxPayout,
        uint64 expiry
    ) external returns (uint256 coverageId) {
        if (claimant == address(0)) revert InvalidClaimant();
        if (productHash == bytes32(0)) revert ZeroProductHash();
        if (receiptHash == bytes32(0)) revert ZeroReceiptHash();
        if (maxPayout == 0) revert ZeroMaxPayout();
        if (expiry <= block.timestamp) revert InvalidExpiry();

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

    /// @notice Release an unused coverage lock after its expiry.
    /// @dev Coverage with an already-open claim is intentionally not expirable;
    ///      a claim opened while coverage was active remains settleable.
    function expireCoverage(uint256 coverageId) external {
        Coverage storage cov = _coverage[coverageId];
        if (cov.status != CoverageStatus.Active) revert CoverageNotActive();
        if (block.timestamp < cov.expiry) revert CoverageNotExpired();
        if (_claimOfCoverage[coverageId] != 0) revert ClaimAlreadyExists();

        cov.status = CoverageStatus.Expired;
        _lockedExposure[cov.merchant] -= cov.maxPayout;
        emit CoverageExpired(coverageId, cov.merchant, cov.maxPayout, cov.expiry);
    }

    /// @notice Withdraw only the caller's uncommitted reserve.
    /// @dev State is reduced before transferring, so a re-entrant caller sees
    ///      the already-updated balance and remains bounded by free reserve.
    function withdrawReserve(uint256 amount) external {
        if (amount == 0) revert ZeroWithdrawal();
        uint256 free = _reserveBalance[msg.sender] - _lockedExposure[msg.sender];
        if (amount > free) revert WithdrawalExceedsFreeReserve(free, amount);

        _reserveBalance[msg.sender] -= amount;
        emit ReserveWithdrawn(msg.sender, amount, _reserveBalance[msg.sender]);

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawalTransferFailed();
    }

    /// @notice Open the single claim allowed for a coverage.
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

    /// @notice Settle an open claim using an evaluator-signed bounded decision.
    /// @dev Anyone may relay the signed decision. Payout always goes to the
    ///      claimant captured when coverage was issued.
    function resolveClaim(ClaimDecision calldata d, bytes calldata signature)
        external
        nonReentrant
        returns (bool approved)
    {
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

        if (d.chainId != block.chainid) revert WrongChain();
        if (d.verifier != address(this)) revert WrongVerifier();
        if (d.expiry < block.timestamp) revert DecisionExpired();
        if (_usedNonce[d.nonce]) revert NonceAlreadyUsed();

        Claim storage c = _claim[d.claimId];
        if (c.status == ClaimStatus.None) revert ClaimNotOpen();
        if (c.status != ClaimStatus.Open) revert ClaimAlreadyFinalized();
        if (c.coverageId != d.coverageId) revert CoverageMismatch();
        if (c.claimant != d.claimant) revert ClaimantMismatch();
        if (c.evidenceHash != d.evidenceHash) revert EvidenceMismatch();

        Coverage storage cov = _coverage[d.coverageId];
        DecisionResult r = DecisionResult(d.result);

        if (r == DecisionResult.Approve) {
            if (d.amount == 0 || d.amount > cov.maxPayout) revert AmountOutOfRange();

            _usedNonce[d.nonce] = true;
            c.status = ClaimStatus.Approved;
            c.paidAmount = d.amount;
            _reserveBalance[cov.merchant] -= d.amount;
            _lockedExposure[cov.merchant] -= cov.maxPayout;

            (bool ok, ) = payable(c.claimant).call{value: d.amount}("");
            if (!ok) revert PayoutTransferFailed();

            emit ClaimPaid(
                d.claimId,
                d.coverageId,
                c.claimant,
                d.amount,
                d.modelVersion,
                d.nonce
            );
            approved = true;
        } else if (r == DecisionResult.Reject) {
            if (d.amount != 0) revert AmountOutOfRange();

            _usedNonce[d.nonce] = true;
            c.status = ClaimStatus.Rejected;
            _lockedExposure[cov.merchant] -= cov.maxPayout;

            emit ClaimRejected(
                d.claimId,
                d.coverageId,
                c.claimant,
                d.modelVersion,
                d.nonce
            );
            approved = false;
        } else {
            revert InvalidResult();
        }
    }

    /// @notice Reserve accounting for a merchant.
    function reserveOf(address merchant)
        external
        view
        returns (uint256 balance, uint256 locked, uint256 free)
    {
        balance = _reserveBalance[merchant];
        locked = _lockedExposure[merchant];
        free = balance >= locked ? balance - locked : 0;
    }

    function coverageOf(uint256 coverageId) external view returns (Coverage memory) {
        return _coverage[coverageId];
    }

    function coverageCount() external view returns (uint256) {
        return _coverageCount;
    }

    function claimOf(uint256 claimId) external view returns (Claim memory) {
        return _claim[claimId];
    }

    function claimIdOfCoverage(uint256 coverageId) external view returns (uint256) {
        return _claimOfCoverage[coverageId];
    }

    function isNonceUsed(uint256 nonce) external view returns (bool) {
        return _usedNonce[nonce];
    }

    function claimCount() external view returns (uint256) {
        return _claimCount;
    }
}
