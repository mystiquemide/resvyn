// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal interface for the reentrancy and failed-payout harnesses.
interface IWarrantyReserveClaims {
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

    function depositReserve() external payable;

    function issueCoverage(
        address claimant,
        bytes32 productHash,
        bytes32 receiptHash,
        uint256 maxPayout,
        uint64 expiry
    ) external returns (uint256);

    function openClaim(uint256 coverageId, bytes32 evidenceHash)
        external
        returns (uint256);

    function resolveClaim(ClaimDecision calldata d, bytes calldata signature)
        external
        returns (bool);

    function withdrawReserve(uint256 amount) external;
}

/// @title ReentrantClaimant
/// @notice Test-only claimant used to attack the claim payout. It is set as a
///         coverage's claimant, opens the claim, and on receiving the native
///         BOT payout attempts a re-entrant call chosen by `mode`:
///           0 = accept payout, do nothing (well-behaved claimant);
///           1 = re-enter resolveClaim with the stored decision (must hit the
///               nonReentrant guard);
///           2 = re-enter withdrawReserve (proves it cannot drain more than
///               free reserve during a payout);
///           3 = revert (forces the PayoutTransferFailed / BR-012 path);
///           4 = re-enter withdrawReserve for this contract's OWN free reserve
///               while it is ALSO a funded, partially-locked merchant (proves
///               a payout cannot be used to reach into the paying merchant's
///               locked funds; the re-entrant withdraw is bounded by this
///               contract's own free reserve);
///           5 = re-enter resolveClaim like mode 1 but SWALLOW the guard's
///               revert, so the outer payout commits and `reentryBlocked`
///               survives as committed proof the ReentrancyGuard fired.
/// @dev Not part of the production surface. Lives under contracts/mocks and is
///      never deployed outside tests.
contract ReentrantClaimant {
    IWarrantyReserveClaims private immutable _reserve;

    uint8 public mode;
    bool public reentered;
    // Mode-5: set true when the re-entrant resolveClaim was blocked (reverted)
    // while the outer payout still committed. Observable because mode 5, unlike
    // mode 1, swallows the guard's revert instead of letting it bubble up.
    bool public reentryBlocked;
    // Amount this contract withdrew from its own reserve during a mode-4
    // re-entry, for the test to assert the bound.
    uint256 public reentrantWithdrawn;
    // Mode-4: the amount to withdraw during the re-entry. Armed by the test to
    // this contract's own exact free reserve.
    uint256 public reentrantWithdrawTarget;

    // Stored decision + signature for the mode-1 re-entrancy attempt.
    IWarrantyReserveClaims.ClaimDecision private _decision;
    bytes private _signature;

    constructor(address reserve) {
        _reserve = IWarrantyReserveClaims(reserve);
    }

    function setMode(uint8 mode_) external {
        mode = mode_;
    }

    /// @notice Arm the mode-4 re-entrant withdraw amount (this contract's own
    ///         exact free reserve, computed by the test).
    function setReentrantWithdrawTarget(uint256 amount) external {
        reentrantWithdrawTarget = amount;
    }

    /// @notice Fund this contract's OWN merchant reserve (mode-4 setup).
    function depositReserve() external payable {
        _reserve.depositReserve{value: msg.value}();
    }

    /// @notice Issue coverage from this contract as merchant (mode-4 setup).
    function issueCoverage(
        address claimant,
        bytes32 productHash,
        bytes32 receiptHash,
        uint256 maxPayout,
        uint64 expiry
    ) external returns (uint256) {
        return
            _reserve.issueCoverage(claimant, productHash, receiptHash, maxPayout, expiry);
    }

    function openClaim(uint256 coverageId, bytes32 evidenceHash)
        external
        returns (uint256)
    {
        return _reserve.openClaim(coverageId, evidenceHash);
    }

    /// @notice Arm the mode-1 re-entrancy: store the decision this contract
    ///         will try to replay from receive().
    function arm(
        IWarrantyReserveClaims.ClaimDecision calldata d,
        bytes calldata signature
    ) external {
        _decision = d;
        _signature = signature;
    }

    receive() external payable {
        if (mode == 1) {
            reentered = true;
            _reserve.resolveClaim(_decision, _signature);
        } else if (mode == 2) {
            reentered = true;
            _reserve.withdrawReserve(1);
        } else if (mode == 3) {
            revert("ReentrantClaimant: rejects payout");
        } else if (mode == 4) {
            // Guard against recursion: this contract's own withdraw also lands
            // here (mode stays 4), so only re-enter once.
            if (!reentered) {
                reentered = true;
                // Withdraw this contract's OWN free reserve mid-payout. It
                // succeeds against our own ledger and can never reach the
                // paying merchant's locked funds, because withdrawReserve is
                // scoped to msg.sender (this contract). The amount is armed by
                // the test to equal our exact free reserve.
                _reserve.withdrawReserve(reentrantWithdrawTarget);
                reentrantWithdrawn = reentrantWithdrawTarget;
            }
        } else if (mode == 5) {
            // Like mode 1, re-enter resolveClaim during payout, but SWALLOW the
            // revert. The nonReentrant guard rejects the inner call; catching it
            // lets the outer payout commit, so `reentryBlocked` survives as
            // committed proof the guard fired (mode 1 reverts the whole tx, so
            // its flag never persists).
            reentered = true;
            try _reserve.resolveClaim(_decision, _signature) {
                // Unreachable: a successful re-entry would mean the guard failed.
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
        // mode 0: accept and hold the native token.
    }
}
