// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IWarrantyReserve {
    function depositReserve() external payable;
    function withdrawReserve(uint256 amount) external;
}

/// @title RevertingMerchant
/// @notice Test-only merchant that refuses incoming native token. Used to drive
///         the WithdrawalTransferFailed branch of WarrantyReserve.withdrawReserve:
///         the reserve's push transfer back to this contract hits a reverting
///         receive(), so the withdrawal must revert and roll back its balance.
/// @dev Not part of the production surface. Lives under contracts/mocks and is
///      never deployed outside tests.
contract RevertingMerchant {
    IWarrantyReserve private immutable _reserve;

    constructor(address reserve) {
        _reserve = IWarrantyReserve(reserve);
    }

    /// @notice Fund this contract's merchant reserve, forwarding the sent value.
    function deposit() external payable {
        _reserve.depositReserve{value: msg.value}();
    }

    /// @notice Attempt to withdraw; the reserve's transfer back will fail here.
    function withdraw(uint256 amount) external {
        _reserve.withdrawReserve(amount);
    }

    receive() external payable {
        revert("RevertingMerchant: rejects native token");
    }
}
