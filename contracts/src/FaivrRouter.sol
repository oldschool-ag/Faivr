// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IFaivrRouter} from "./interfaces/IFaivrRouter.sol";
import {IFaivrIdentityRegistry} from "./interfaces/IFaivrIdentityRegistry.sol";
import {IFaivrReputationRegistry} from "./interfaces/IFaivrReputationRegistry.sol";
import {IFaivrFeeModule} from "./interfaces/IFaivrFeeModule.sol";

/// @title FaivrRouter
/// @notice Orchestrator for multi-contract flows
contract FaivrRouter is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    IFaivrRouter
{
    // ── Storage ──────────────────────────────────────────
    IFaivrIdentityRegistry public identityRegistry;
    IFaivrReputationRegistry public reputationRegistry;
    address public validationRegistry;
    IFaivrFeeModule public feeModule;

    /// @custom:storage-gap
    uint256[50] private __gap;

    // ── Initializer ──────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address identityRegistry_,
        address reputationRegistry_,
        address validationRegistry_,
        address feeModule_
    ) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        if (reputationRegistry_ == address(0)) revert ZeroAddress();
        if (validationRegistry_ == address(0)) revert ZeroAddress();
        if (feeModule_ == address(0)) revert ZeroAddress();

        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        identityRegistry = IFaivrIdentityRegistry(identityRegistry_);
        reputationRegistry = IFaivrReputationRegistry(reputationRegistry_);
        validationRegistry = validationRegistry_;
        feeModule = IFaivrFeeModule(feeModule_);
    }

    // ── Core ─────────────────────────────────────────────
    function registerAndFund(
        string calldata agentURI,
        address token,
        uint256 amount,
        uint256 deadline
    ) external payable override returns (uint256 agentId, uint256 taskId) {
        agentId = identityRegistry.registerFor(msg.sender, agentURI);

        if (token == address(0)) {
            taskId = feeModule.fundTaskFor{value: msg.value}(agentId, token, amount, deadline, msg.sender);
        } else {
            taskId = feeModule.fundTaskFor(agentId, token, amount, deadline, msg.sender);
        }
    }

    function settleAndGiveFeedback(
        uint256 taskId,
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2
    ) external override {
        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        if (task.agentId != agentId) revert InvalidTaskAgent(taskId, agentId, task.agentId);

        feeModule.settleTaskFor(taskId, msg.sender);
        reputationRegistry.giveFeedbackFor(msg.sender, agentId, value, valueDecimals, tag1, tag2, "", "", bytes32(0));
    }

    // ── Views ────────────────────────────────────────────
    function getContracts() external view override returns (
        address, address, address, address
    ) {
        return (
            address(identityRegistry),
            address(reputationRegistry),
            validationRegistry,
            address(feeModule)
        );
    }

    // ── Upgrade ──────────────────────────────────────────
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
