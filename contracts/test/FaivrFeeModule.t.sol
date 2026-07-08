// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {FaivrFeeModule} from "../src/FaivrFeeModule.sol";
import {FaivrReputationRegistry} from "../src/FaivrReputationRegistry.sol";
import {IFaivrFeeModule} from "../src/interfaces/IFaivrFeeModule.sol";
import {FaivrIdentityRegistry} from "../src/FaivrIdentityRegistry.sol";

/// @dev Mock USDC for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ZeroRejectERC20 is ERC20 {
    constructor() ERC20("Zero Reject Token", "ZRT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(amount > 0, "ZERO_TRANSFER_BLOCKED");
        return super.transfer(to, amount);
    }
}

contract RecipientBlockedERC20 is ERC20 {
    address public blockedRecipient;

    constructor(address blockedRecipient_) ERC20("Recipient Blocked Token", "RBT") {
        blockedRecipient = blockedRecipient_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(to != blockedRecipient, "RECIPIENT_BLOCKED");
        return super.transfer(to, amount);
    }
}

contract RejectETHReceiver {
    function register(FaivrIdentityRegistry identity, string memory uri) external returns (uint256) {
        return identity.register(uri);
    }

    function withdrawPendingTo(FaivrFeeModule feeModule, address payable recipient) external {
        feeModule.withdrawPendingTo(recipient);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {
        revert("NO_ETH");
    }
}

contract FaivrFeeModuleLegacy is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    uint256 public constant MAX_FEE_BPS = 1000;

    uint256 private _nextTaskId;
    uint256 private _feeBps;
    address private _protocolWallet;
    address private _devWallet;
    address public identityRegistry;
    mapping(uint256 taskId => IFaivrFeeModule.Task) private _tasks;
    mapping(address token => uint256) private _totalFees;
    mapping(address => uint256) private _pendingWithdrawals;
    uint256 private _maxEscrowAmount;
    mapping(address => bool) private _genesisAgents;
    mapping(address => uint8) private _genesisTasksUsed;
    uint256 private _genesisAgentCount;
    uint256[46] private __gap;

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address protocolWallet_, address devWallet_, address identityRegistry_)
        external
        initializer
    {
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
        _feeBps = 250;
        _nextTaskId = 1;
        _maxEscrowAmount = 0.1 ether;
    }

    function setFeePercentage(uint256 feeBps) external onlyRole(FEE_MANAGER_ROLE) {
        _feeBps = feeBps;
    }

    function seedStorage(
        uint256 taskId,
        IFaivrFeeModule.Task calldata task,
        address feeToken,
        uint256 totalFee,
        address pendingAccount,
        uint256 pendingAmount,
        uint256 maxEscrow,
        address genesisAgent,
        uint8 genesisUsed,
        uint256 genesisCount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _tasks[taskId] = IFaivrFeeModule.Task({
            agentId: task.agentId,
            client: task.client,
            token: task.token,
            amount: task.amount,
            status: task.status,
            fundedAt: task.fundedAt,
            settledAt: task.settledAt,
            deadline: task.deadline
        });
        _totalFees[feeToken] = totalFee;
        _pendingWithdrawals[pendingAccount] = pendingAmount;
        _maxEscrowAmount = maxEscrow;
        _genesisAgents[genesisAgent] = true;
        _genesisTasksUsed[genesisAgent] = genesisUsed;
        _genesisAgentCount = genesisCount;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}

contract FaivrFeeModuleTest is Test {
    FaivrFeeModule public feeModule;
    FaivrReputationRegistry public reputation;
    FaivrIdentityRegistry public identity;
    MockUSDC public usdc;

    address public admin = makeAddr("admin");
    address public protocolWallet = makeAddr("protocol");
    address public devWallet = makeAddr("dev");
    address public alice = makeAddr("alice"); // client
    address public agentOwner = makeAddr("agentOwner");
    uint256 public agentId;

    function setUp() public {
        // Deploy identity registry
        FaivrIdentityRegistry identityImpl = new FaivrIdentityRegistry();
        ERC1967Proxy identityProxy =
            new ERC1967Proxy(address(identityImpl), abi.encodeCall(FaivrIdentityRegistry.initialize, (admin)));
        identity = FaivrIdentityRegistry(address(identityProxy));

        // Register an agent
        vm.prank(agentOwner);
        agentId = identity.register("ipfs://agent1");

        // Deploy reputation registry
        FaivrReputationRegistry repImpl = new FaivrReputationRegistry();
        ERC1967Proxy repProxy = new ERC1967Proxy(
            address(repImpl), abi.encodeCall(FaivrReputationRegistry.initialize, (admin, address(identity)))
        );
        reputation = FaivrReputationRegistry(address(repProxy));

        // Deploy fee module
        FaivrFeeModule feeImpl = new FaivrFeeModule();
        ERC1967Proxy feeProxy = new ERC1967Proxy(
            address(feeImpl),
            abi.encodeCall(FaivrFeeModule.initialize, (admin, protocolWallet, devWallet, address(identity)))
        );
        feeModule = FaivrFeeModule(address(feeProxy));

        // Deploy mock USDC
        usdc = new MockUSDC();

        vm.startPrank(admin);
        reputation.grantRole(reputation.SETTLEMENT_SOURCE_ROLE(), address(feeModule));
        feeModule.setReputationRegistry(address(reputation));
        feeModule.setSupportedToken(address(usdc), true);

        // Remove escrow cap for testing
        feeModule.setMaxEscrowAmount(0);
        vm.stopPrank();
    }

    // ── Fund Task (ETH) ─────────────────────────────────

    function test_fundTask_ETH() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        assertEq(taskId, 1);
        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertEq(task.agentId, agentId);
        assertEq(task.client, alice);
        assertEq(task.amount, 1 ether);
        assertTrue(task.status == IFaivrFeeModule.TaskStatus.FUNDED);
    }

    function test_revert_fundTask_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("ZeroAmount()"));
        feeModule.fundTask(agentId, address(0), 0, 1 days);
    }

    function test_revert_fundTask_msgValueMismatch() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("MsgValueMismatch()"));
        feeModule.fundTask{value: 0.5 ether}(agentId, address(0), 1 ether, 1 days);
    }

    function test_revert_fundTask_ethSentForERC20() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("MsgValueMismatch()"));
        feeModule.fundTask{value: 1 ether}(agentId, address(usdc), 1000e6, 1 days);
    }

    function test_revert_fundTask_unsupportedToken() public {
        MockUSDC unsupported = new MockUSDC();
        unsupported.mint(alice, 1000e6);

        vm.prank(alice);
        unsupported.approve(address(feeModule), 1000e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.UnsupportedToken.selector, address(unsupported)));
        feeModule.fundTask(agentId, address(unsupported), 1000e6, 1 days);
    }

    // ── Fund Task (ERC20) ────────────────────────────────

    function test_fundTask_ERC20() public {
        usdc.mint(alice, 1000e6);
        vm.prank(alice);
        usdc.approve(address(feeModule), 1000e6);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask(agentId, address(usdc), 1000e6, 1 days);

        assertEq(usdc.balanceOf(address(feeModule)), 1000e6);
        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertEq(task.token, address(usdc));
        assertEq(task.amount, 1000e6);
    }

    // ── Settle Task (ETH) ────────────────────────────────

    function test_settleTask_ETH() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        uint256 agentBefore = agentOwner.balance;
        uint256 protBefore = protocolWallet.balance;
        uint256 devBefore = devWallet.balance;

        vm.prank(alice);
        feeModule.settleTask(taskId);

        // 2.5% fee total = 0.025 ETH
        // 90% protocol = 0.0225 ETH, 10% dev = 0.0025 ETH
        // Agent gets 0.975 ETH
        uint256 totalFee = 1 ether * 250 / 10_000; // 0.025 ETH
        uint256 protFee = totalFee * 90 / 100;
        uint256 devFee = totalFee - protFee;
        uint256 agentPayout = 1 ether - totalFee;

        assertEq(agentOwner.balance - agentBefore, agentPayout);
        assertEq(protocolWallet.balance - protBefore, protFee);
        assertEq(devWallet.balance - devBefore, devFee);

        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertTrue(task.status == IFaivrFeeModule.TaskStatus.SETTLED);
    }

    // ── Settle Task (ERC20) ──────────────────────────────

    function test_settleTask_ERC20() public {
        usdc.mint(alice, 10_000e6);
        vm.prank(alice);
        usdc.approve(address(feeModule), 10_000e6);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask(agentId, address(usdc), 10_000e6, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        uint256 totalFee = 10_000e6 * 250 / 10_000; // 250 USDC
        uint256 protFee = totalFee * 90 / 100; // 225 USDC
        uint256 devFee = totalFee - protFee; // 25 USDC
        uint256 agentPayout = 10_000e6 - totalFee; // 9750 USDC

        assertEq(usdc.balanceOf(agentOwner), agentPayout);
        assertEq(usdc.balanceOf(protocolWallet), protFee);
        assertEq(usdc.balanceOf(devWallet), devFee);
    }

    function test_settleTask_ERC20_skipsZeroAmountFeeTransfers() public {
        ZeroRejectERC20 zeroReject = new ZeroRejectERC20();

        vm.prank(admin);
        feeModule.setSupportedToken(address(zeroReject), true);

        zeroReject.mint(alice, 1);

        vm.prank(alice);
        zeroReject.approve(address(feeModule), 1);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask(agentId, address(zeroReject), 1, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        assertEq(zeroReject.balanceOf(agentOwner), 1);
        assertEq(zeroReject.balanceOf(protocolWallet), 0);
        assertEq(zeroReject.balanceOf(devWallet), 0);
    }

    function test_settleTask_ERC20_queuesPendingWithdrawalWhenRecipientRejects() public {
        RecipientBlockedERC20 blocked = new RecipientBlockedERC20(agentOwner);

        vm.prank(admin);
        feeModule.setSupportedToken(address(blocked), true);

        blocked.mint(alice, 10_000e6);

        vm.prank(alice);
        blocked.approve(address(feeModule), 10_000e6);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask(agentId, address(blocked), 10_000e6, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        uint256 totalFee = 10_000e6 * 250 / 10_000;
        uint256 protFee = totalFee * 90 / 100;
        uint256 devFee = totalFee - protFee;
        uint256 agentPayout = 10_000e6 - totalFee;
        address alternateRecipient = makeAddr("alternateRecipient");

        assertEq(blocked.balanceOf(agentOwner), 0);
        assertEq(feeModule.pendingTokenWithdrawal(address(blocked), agentOwner), agentPayout);
        assertEq(blocked.balanceOf(protocolWallet), protFee);
        assertEq(blocked.balanceOf(devWallet), devFee);

        vm.prank(agentOwner);
        feeModule.withdrawPendingTokenTo(address(blocked), alternateRecipient);

        assertEq(blocked.balanceOf(alternateRecipient), agentPayout);
        assertEq(feeModule.pendingTokenWithdrawal(address(blocked), agentOwner), 0);
    }

    function test_settleTask_ETH_allowsPendingWithdrawalRedirect() public {
        RejectETHReceiver rejectingOwner = new RejectETHReceiver();
        uint256 rejectingAgentId = rejectingOwner.register(identity, "ipfs://rejecting-agent");
        address rescueRecipient = makeAddr("rescueRecipient");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(rejectingAgentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        uint256 totalFee = 1 ether * 250 / 10_000;
        uint256 agentPayout = 1 ether - totalFee;
        uint256 rescueBefore = rescueRecipient.balance;

        assertEq(feeModule.pendingWithdrawal(address(rejectingOwner)), agentPayout);

        rejectingOwner.withdrawPendingTo(feeModule, payable(rescueRecipient));

        assertEq(rescueRecipient.balance - rescueBefore, agentPayout);
        assertEq(feeModule.pendingWithdrawal(address(rejectingOwner)), 0);
    }

    function test_settleTask_recordsFeedbackCreditForDirectReview() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        assertEq(reputation.pendingFeedbackCredits(agentId, alice), 1);

        vm.prank(alice);
        reputation.giveFeedback(agentId, 91, 0, "quality", "direct", "", "", bytes32(0));

        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool isRevoked) =
            reputation.readFeedback(agentId, alice, 1);
        assertEq(value, 91);
        assertEq(decimals, 0);
        assertEq(tag1, "quality");
        assertEq(tag2, "direct");
        assertFalse(isRevoked);
        assertEq(reputation.pendingFeedbackCredits(agentId, alice), 0);
    }

    function test_revert_settle_notClient() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.NotTaskClient.selector, taskId));
        feeModule.settleTask(taskId);
    }

    function test_revert_settle_alreadySettled() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.TaskNotFunded.selector, taskId));
        feeModule.settleTask(taskId);
    }

    // ── Reclaim ──────────────────────────────────────────

    function test_reclaimTask() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        // Warp past deadline
        vm.warp(block.timestamp + 1 days + 1);

        uint256 before = alice.balance;
        vm.prank(alice);
        feeModule.reclaimTask(taskId);

        assertEq(alice.balance - before, 1 ether);
        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertTrue(task.status == IFaivrFeeModule.TaskStatus.RECLAIMED);
    }

    function test_revert_reclaim_notExpired() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.TaskNotExpired.selector, taskId));
        feeModule.reclaimTask(taskId);
    }

    function test_revert_reclaim_notClient() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.NotTaskClient.selector, taskId));
        feeModule.reclaimTask(taskId);
    }

    // ── Admin ────────────────────────────────────────────

    function test_revert_initialize_zeroAdmin() public {
        FaivrFeeModule feeImpl = new FaivrFeeModule();
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        new ERC1967Proxy(
            address(feeImpl),
            abi.encodeCall(FaivrFeeModule.initialize, (address(0), protocolWallet, devWallet, address(identity)))
        );
    }

    function test_setFeePercentage() public {
        vm.prank(admin);
        feeModule.setFeePercentage(500); // 5%
        assertEq(feeModule.feePercentage(), 500);
    }

    function test_revert_feeTooHigh() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.FeeTooHigh.selector, 1001));
        feeModule.setFeePercentage(1001);
    }

    function test_setWallets() public {
        address newProt = makeAddr("newProt");
        address newDev = makeAddr("newDev");

        vm.prank(admin);
        feeModule.setProtocolWallet(newProt);
        assertEq(feeModule.protocolWallet(), newProt);

        vm.prank(admin);
        feeModule.setDevWallet(newDev);
        assertEq(feeModule.devWallet(), newDev);
    }

    function test_revert_setWallet_zero() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        feeModule.setProtocolWallet(address(0));
    }

    function test_pause_unpause() public {
        vm.prank(admin);
        feeModule.pause();

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(admin);
        feeModule.unpause();

        vm.prank(alice);
        feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);
    }

    function test_totalFeesAccrued() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        feeModule.settleTask(taskId);

        uint256 totalFee = 1 ether * 250 / 10_000;
        assertEq(feeModule.totalFeesAccrued(address(0)), totalFee);
    }

    // ── Escrow Cap Tests ─────────────────────────────────
    function test_escrowCap_enforced() public {
        vm.prank(admin);
        feeModule.setMaxEscrowAmount(0.1 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrFeeModule.EscrowCapExceeded.selector, 0.5 ether, 0.1 ether));
        feeModule.fundTask{value: 0.5 ether}(agentId, address(0), 0.5 ether, 1 days);
    }

    function test_escrowCap_allowsUnderLimit() public {
        vm.prank(admin);
        feeModule.setMaxEscrowAmount(0.1 ether);

        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 0.05 ether}(agentId, address(0), 0.05 ether, 1 days);
        assertEq(taskId, 1);
    }

    function test_escrowCap_zeroMeansUnlimited() public {
        vm.prank(admin);
        feeModule.setMaxEscrowAmount(0);

        vm.deal(alice, 100 ether);
        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 100 ether}(agentId, address(0), 100 ether, 1 days);
        assertEq(taskId, 1);
    }

    function test_escrowCap_onlyFeeManager() public {
        vm.prank(alice);
        vm.expectRevert();
        feeModule.setMaxEscrowAmount(1 ether);
    }

    function test_upgrade_preservesLegacyStorageLayout() public {
        FaivrFeeModuleLegacy legacyImpl = new FaivrFeeModuleLegacy();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(legacyImpl),
            abi.encodeCall(FaivrFeeModuleLegacy.initialize, (admin, protocolWallet, devWallet, address(identity)))
        );
        FaivrFeeModuleLegacy legacy = FaivrFeeModuleLegacy(address(proxy));

        IFaivrFeeModule.Task memory seededTask = IFaivrFeeModule.Task({
            agentId: agentId,
            client: alice,
            token: address(usdc),
            amount: 1234e6,
            status: IFaivrFeeModule.TaskStatus.FUNDED,
            fundedAt: 111,
            settledAt: 0,
            deadline: 222
        });

        vm.startPrank(admin);
        legacy.setFeePercentage(500);
        legacy.seedStorage(7, seededTask, address(usdc), 42e6, alice, 0.5 ether, 9 ether, agentOwner, 3, 1);
        vm.stopPrank();

        FaivrFeeModule newImpl = new FaivrFeeModule();
        vm.prank(admin);
        legacy.upgradeToAndCall(address(newImpl), "");

        FaivrFeeModule upgraded = FaivrFeeModule(address(proxy));

        assertEq(upgraded.feePercentage(), 500);
        assertEq(upgraded.protocolWallet(), protocolWallet);
        assertEq(upgraded.devWallet(), devWallet);
        assertEq(upgraded.identityRegistry(), address(identity));
        assertEq(upgraded.totalFeesAccrued(address(usdc)), 42e6);
        assertEq(upgraded.pendingWithdrawal(alice), 0.5 ether);
        assertEq(upgraded.pendingTokenWithdrawal(address(usdc), alice), 0);
        assertEq(upgraded.maxEscrowAmount(), 9 ether);
        assertTrue(upgraded.isGenesisAgent(agentOwner));
        assertEq(upgraded.genesisTasksUsed(agentOwner), 3);
        assertEq(upgraded.genesisAgentCount(), 1);
        assertEq(upgraded.reputationRegistry(), address(0));
        assertFalse(upgraded.isSupportedToken(address(usdc)));

        IFaivrFeeModule.Task memory storedTask = upgraded.getTask(7);
        assertEq(storedTask.agentId, seededTask.agentId);
        assertEq(storedTask.client, seededTask.client);
        assertEq(storedTask.token, seededTask.token);
        assertEq(storedTask.amount, seededTask.amount);
        assertTrue(storedTask.status == seededTask.status);
        assertEq(storedTask.fundedAt, seededTask.fundedAt);
        assertEq(storedTask.settledAt, seededTask.settledAt);
        assertEq(storedTask.deadline, seededTask.deadline);

        vm.prank(admin);
        upgraded.setReputationRegistry(address(reputation));
        assertEq(upgraded.reputationRegistry(), address(reputation));
    }
}
