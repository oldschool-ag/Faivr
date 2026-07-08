// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IFaivrFeeModule} from "./interfaces/IFaivrFeeModule.sol";
import {IFaivrReputationRegistry} from "./interfaces/IFaivrReputationRegistry.sol";

/// @title FaivrFeeModule
/// @notice Non-custodial escrow with programmable fee splits (90% protocol / 10% dev)
contract FaivrFeeModule is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    IFaivrFeeModule
{
    using SafeERC20 for IERC20;

    // ── Roles ────────────────────────────────────────────
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    // ── Constants ────────────────────────────────────────
    uint256 public constant MAX_FEE_BPS = 1000; // 10%
    address private constant ETH = address(0);

    // ── Storage ──────────────────────────────────────────
    uint256 private _nextTaskId;
    uint256 private _feeBps;
    address private _protocolWallet;
    address private _devWallet;

    /// @dev Reference to the identity registry for agent owner lookups
    address public identityRegistry;

    mapping(uint256 taskId => Task) private _tasks;
    mapping(address token => uint256) private _totalFees;

    /// @dev Pending ETH withdrawals for addresses whose transfers failed
    mapping(address => uint256) private _pendingWithdrawals;

    /// @dev Maximum escrow amount per task (0 = unlimited)
    uint256 private _maxEscrowAmount;

    // ── Genesis Program Storage ──────────────────────────
    mapping(address => bool) private _genesisAgents;
    mapping(address => uint8) private _genesisTasksUsed;
    uint256 private _genesisAgentCount;

    /// @dev Optional reputation registry for recording settled-task feedback provenance.
    /// Appended after the legacy storage layout to preserve upgrade safety.
    address public reputationRegistry;

    /// @dev Supported ERC20 funding tokens. ETH remains implicitly supported via address(0).
    mapping(address token => bool) private _supportedTokens;

    /// @dev Pending ERC20 withdrawals keyed by original recipient and token.
    mapping(address account => mapping(address token => uint256)) private _pendingTokenWithdrawals;

    uint256 public constant GENESIS_MAX_AGENTS = 50;
    uint8 public constant GENESIS_FREE_TASKS = 10;

    /// @custom:storage-gap legacy gap reduced by 3 slots for reputationRegistry + token support append
    uint256[43] private __gap;

    // ── Initializer ──────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address protocolWallet_, address devWallet_, address identityRegistry_)
        external
        initializer
    {
        if (admin == address(0)) revert ZeroAddress();
        if (protocolWallet_ == address(0)) revert ZeroAddress();
        if (devWallet_ == address(0)) revert ZeroAddress();
        if (identityRegistry_ == address(0)) revert ZeroAddress();

        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEE_MANAGER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        _protocolWallet = protocolWallet_;
        _devWallet = devWallet_;
        identityRegistry = identityRegistry_;
        _feeBps = 250; // 2.5%
        _nextTaskId = 1;
        _maxEscrowAmount = 0.1 ether; // Safety cap until audit clears
    }

    // ── Core ─────────────────────────────────────────────
    function fundTask(uint256 agentId, address token, uint256 amount, uint256 deadline)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256 taskId)
    {
        if (amount == 0) revert ZeroAmount();
        if (deadline == 0) revert InvalidDeadline();
        if (_maxEscrowAmount > 0 && amount > _maxEscrowAmount) revert EscrowCapExceeded(amount, _maxEscrowAmount);
        _requireSupportedToken(token);

        if (token == ETH) {
            if (msg.value != amount) revert MsgValueMismatch();
        } else {
            if (msg.value != 0) revert MsgValueMismatch();
            _pullERC20(token, msg.sender, amount);
        }

        taskId = _nextTaskId;
        unchecked {
            _nextTaskId++;
        }

        _tasks[taskId] = Task({
            agentId: agentId,
            client: msg.sender,
            token: token,
            amount: amount,
            status: TaskStatus.FUNDED,
            fundedAt: block.timestamp,
            settledAt: 0,
            deadline: block.timestamp + deadline
        });

        emit TaskFunded(taskId, agentId, msg.sender, token, amount, block.timestamp + deadline);
    }

    /// @notice Fund a task on behalf of a client. Only callable by ROUTER_ROLE.
    function fundTaskFor(uint256 agentId, address token, uint256 amount, uint256 deadline, address client)
        external
        payable
        nonReentrant
        whenNotPaused
        onlyRole(ROUTER_ROLE)
        returns (uint256 taskId)
    {
        if (amount == 0) revert ZeroAmount();
        if (deadline == 0) revert InvalidDeadline();
        if (client == address(0)) revert ZeroAddress();
        if (_maxEscrowAmount > 0 && amount > _maxEscrowAmount) revert EscrowCapExceeded(amount, _maxEscrowAmount);
        _requireSupportedToken(token);

        if (token == ETH) {
            if (msg.value != amount) revert MsgValueMismatch();
        } else {
            if (msg.value != 0) revert MsgValueMismatch();
            _pullERC20(token, client, amount);
        }

        taskId = _nextTaskId;
        unchecked {
            _nextTaskId++;
        }

        _tasks[taskId] = Task({
            agentId: agentId,
            client: client,
            token: token,
            amount: amount,
            status: TaskStatus.FUNDED,
            fundedAt: block.timestamp,
            settledAt: 0,
            deadline: block.timestamp + deadline
        });

        emit TaskFunded(taskId, agentId, client, token, amount, block.timestamp + deadline);
    }

    function settleTask(uint256 taskId) external override nonReentrant whenNotPaused {
        _settleTask(taskId, msg.sender);
    }

    /// @notice Settle a task on behalf of the client. Only callable by ROUTER_ROLE.
    function settleTaskFor(uint256 taskId, address caller) external nonReentrant whenNotPaused onlyRole(ROUTER_ROLE) {
        _settleTask(taskId, caller);
    }

    function reclaimTask(uint256 taskId) external override nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.FUNDED) revert TaskNotFunded(taskId);
        if (task.client != msg.sender) revert NotTaskClient(taskId);
        if (block.timestamp < task.deadline) revert TaskNotExpired(taskId);

        task.status = TaskStatus.RECLAIMED;

        if (task.token == ETH) {
            _sendETH(msg.sender, task.amount);
        } else {
            IERC20(task.token).safeTransfer(msg.sender, task.amount);
        }

        emit TaskReclaimed(taskId, msg.sender, task.amount);
    }

    // ── Admin ────────────────────────────────────────────
    function setFeePercentage(uint256 feeBps) external override onlyRole(FEE_MANAGER_ROLE) {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh(feeBps);
        uint256 oldFee = _feeBps;
        _feeBps = feeBps;
        emit FeeUpdated(oldFee, feeBps, block.timestamp);
    }

    function setProtocolWallet(address wallet) external override onlyRole(FEE_MANAGER_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        _protocolWallet = wallet;
    }

    function setDevWallet(address wallet) external override onlyRole(FEE_MANAGER_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        _devWallet = wallet;
    }

    function setReputationRegistry(address reputationRegistry_) external override onlyRole(FEE_MANAGER_ROLE) {
        address oldRegistry = reputationRegistry;
        if (reputationRegistry_ == address(0)) revert ZeroAddress();
        reputationRegistry = reputationRegistry_;
        emit ReputationRegistryUpdated(oldRegistry, reputationRegistry_);
    }

    function setSupportedToken(address token, bool supported) external override onlyRole(FEE_MANAGER_ROLE) {
        if (token == ETH) revert ZeroAddress();
        _supportedTokens[token] = supported;
        emit SupportedTokenUpdated(token, supported);
    }

    function setMaxEscrowAmount(uint256 maxAmount) external onlyRole(FEE_MANAGER_ROLE) {
        uint256 oldMax = _maxEscrowAmount;
        _maxEscrowAmount = maxAmount;
        emit MaxEscrowUpdated(oldMax, maxAmount);
    }

    function maxEscrowAmount() external view returns (uint256) {
        return _maxEscrowAmount;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ── Views ────────────────────────────────────────────
    function getTask(uint256 taskId) external view override returns (Task memory) {
        return _tasks[taskId];
    }

    function feePercentage() external view override returns (uint256) {
        return _feeBps;
    }

    function protocolWallet() external view override returns (address) {
        return _protocolWallet;
    }

    function devWallet() external view override returns (address) {
        return _devWallet;
    }

    function totalFeesAccrued(address token) external view override returns (uint256) {
        return _totalFees[token];
    }

    function isSupportedToken(address token) public view override returns (bool) {
        return token == ETH || _supportedTokens[token];
    }

    // ── Pull Withdrawals ─────────────────────────────────
    function pendingWithdrawal(address account) external view override returns (uint256) {
        return _pendingWithdrawals[account];
    }

    function pendingTokenWithdrawal(address token, address account) external view override returns (uint256) {
        return _pendingTokenWithdrawals[account][token];
    }

    function withdrawPending() external override nonReentrant {
        _withdrawPendingETHTo(payable(msg.sender));
    }

    function withdrawPendingTo(address payable recipient) external override nonReentrant {
        _withdrawPendingETHTo(recipient);
    }

    function withdrawPendingToken(address token) external override nonReentrant {
        _withdrawPendingTokenTo(token, msg.sender);
    }

    function withdrawPendingTokenTo(address token, address recipient) external override nonReentrant {
        _withdrawPendingTokenTo(token, recipient);
    }

    // ── Internal ─────────────────────────────────────────
    function _settleTask(uint256 taskId, address caller) private {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.FUNDED) revert TaskNotFunded(taskId);
        if (task.client != caller) revert NotTaskClient(taskId);

        task.status = TaskStatus.SETTLED;
        task.settledAt = block.timestamp;

        bool genesisExempt = _genesisAgents[task.client] && _genesisTasksUsed[task.client] < GENESIS_FREE_TASKS;
        if (genesisExempt) {
            _genesisTasksUsed[task.client]++;
        }

        uint256 totalFee = genesisExempt ? 0 : (task.amount * _feeBps) / 10_000;
        uint256 protocolFee = (totalFee * 90) / 100;
        uint256 devFee = totalFee - protocolFee;
        uint256 agentPayout = task.amount - totalFee;

        _totalFees[task.token] += totalFee;
        _recordTaskSettlement(taskId, task.agentId, task.client);

        address agentOwner = _agentOwner(task.agentId);

        if (task.token == ETH) {
            _sendETH(agentOwner, agentPayout);
            _sendETH(_protocolWallet, protocolFee);
            _sendETH(_devWallet, devFee);
        } else {
            _sendERC20OrEscrow(task.token, agentOwner, agentPayout);
            _sendERC20OrEscrow(task.token, _protocolWallet, protocolFee);
            _sendERC20OrEscrow(task.token, _devWallet, devFee);
        }

        emit TaskSettled(taskId, task.agentId, agentOwner, agentPayout, protocolFee, devFee);
    }

    function _agentOwner(uint256 agentId) private view returns (address) {
        return IERC721(identityRegistry).ownerOf(agentId);
    }

    function _recordTaskSettlement(uint256 taskId, uint256 agentId, address client) private {
        if (reputationRegistry == address(0)) {
            return;
        }

        IFaivrReputationRegistry(reputationRegistry).recordTaskSettlement(taskId, agentId, client);
    }

    function _requireSupportedToken(address token) private view {
        if (!isSupportedToken(token)) revert UnsupportedToken(token);
    }

    function _pullERC20(address token, address from, uint256 amount) private {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;
        if (received != amount) revert TokenAmountMismatch(token, amount, received);
    }

    function _withdrawPendingETHTo(address payable recipient) private {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = _pendingWithdrawals[msg.sender];
        if (amount == 0) revert ZeroAmount();
        _pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }

    function _withdrawPendingTokenTo(address token, address recipient) private {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = _pendingTokenWithdrawals[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        _pendingTokenWithdrawals[msg.sender][token] = 0;
        if (!_tryTransferERC20(token, recipient, amount)) revert TokenTransferFailed(token);
    }

    function _sendETH(address to, uint256 amount) private {
        if (amount == 0) {
            return;
        }

        (bool ok,) = to.call{value: amount, gas: 10000}("");
        if (!ok) {
            // Escrow for pull withdrawal instead of reverting
            _pendingWithdrawals[to] += amount;
        }
    }

    function _sendERC20OrEscrow(address token, address to, uint256 amount) private {
        if (amount == 0) {
            return;
        }

        if (!_tryTransferERC20(token, to, amount)) {
            _pendingTokenWithdrawals[to][token] += amount;
        }
    }

    function _tryTransferERC20(address token, address to, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        return _didTokenTransferSucceed(ok, data);
    }

    function _didTokenTransferSucceed(bool ok, bytes memory data) private pure returns (bool) {
        if (!ok) {
            return false;
        }
        if (data.length == 0) {
            return true;
        }
        if (data.length == 32) {
            return abi.decode(data, (bool));
        }
        return false;
    }

    // ── Genesis Program ─────────────────────────────────
    function addGenesisAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (agent == address(0)) revert ZeroAddress();
        if (_genesisAgents[agent]) revert AlreadyGenesisAgent();
        if (_genesisAgentCount >= GENESIS_MAX_AGENTS) revert GenesisCapReached();

        _genesisAgents[agent] = true;
        _genesisAgentCount++;

        emit GenesisAgentAdded(agent);
    }

    function removeGenesisAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_genesisAgents[agent]) revert NotGenesisAgent();

        _genesisAgents[agent] = false;
        _genesisAgentCount--;

        emit GenesisAgentRemoved(agent);
    }

    function isGenesisAgent(address agent) external view returns (bool) {
        return _genesisAgents[agent];
    }

    function genesisTasksUsed(address agent) external view returns (uint8) {
        return _genesisTasksUsed[agent];
    }

    function genesisAgentCount() external view returns (uint256) {
        return _genesisAgentCount;
    }

    // ── Upgrade ──────────────────────────────────────────
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
