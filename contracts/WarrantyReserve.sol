// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title WarrantyReserve
/// @notice Merchant-funded warranty reserve for Resvyn. A merchant funds a
///         native-token reserve, and issuing coverage locks the declared
///         maximum payout against that reserve.
/// @dev Milestone 1 implementation. This checkpoint implements reserve
///      accounting, coverage issuance, and merchant withdrawal, with both
///      winning-invariant guards enforced:
///        - issuance rejects `maxPayout > freeReserve` (BR-001, FR-003);
///        - withdrawal rejects amounts above `freeReserve` (BR-003, FR-005).
///      Claims, AI decisions, and EIP-712 verification are out of Milestone 1
///      scope and land in later milestones.
contract WarrantyReserve {
    enum CoverageStatus {
        None,
        Active
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
}
