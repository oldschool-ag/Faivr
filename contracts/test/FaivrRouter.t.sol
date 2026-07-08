// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FaivrIdentityRegistry} from "../src/FaivrIdentityRegistry.sol";
import {FaivrReputationRegistry} from "../src/FaivrReputationRegistry.sol";
import {FaivrValidationRegistry} from "../src/FaivrValidationRegistry.sol";
import {FaivrFeeModule} from "../src/FaivrFeeModule.sol";
import {FaivrRouter} from "../src/FaivrRouter.sol";
import {IFaivrFeeModule} from "../src/interfaces/IFaivrFeeModule.sol";
import {IFaivrRouter} from "../src/interfaces/IFaivrRouter.sol";

contract RouterMockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FaivrRouterTest is Test {
    FaivrIdentityRegistry public identity;
    FaivrReputationRegistry public reputation;
    FaivrValidationRegistry public validation;
    FaivrFeeModule public feeModule;
    FaivrRouter public router;
    RouterMockUSDC public usdc;

    address public admin = makeAddr("admin");
    address public protocolWallet = makeAddr("protocol");
    address public devWallet = makeAddr("dev");
    address public agentOwner = makeAddr("agentOwner");
    address public secondAgentOwner = makeAddr("secondAgentOwner");
    address public alice = makeAddr("alice");

    uint256 public agentId;
    uint256 public secondAgentId;

    function setUp() public {
        // Deploy identity
        FaivrIdentityRegistry identityImpl = new FaivrIdentityRegistry();
        ERC1967Proxy identityProxy =
            new ERC1967Proxy(address(identityImpl), abi.encodeCall(FaivrIdentityRegistry.initialize, (admin)));
        identity = FaivrIdentityRegistry(address(identityProxy));

        vm.prank(agentOwner);
        agentId = identity.register("ipfs://agent1");

        vm.prank(secondAgentOwner);
        secondAgentId = identity.register("ipfs://agent2");

        // Deploy reputation
        FaivrReputationRegistry repImpl = new FaivrReputationRegistry();
        ERC1967Proxy repProxy = new ERC1967Proxy(
            address(repImpl), abi.encodeCall(FaivrReputationRegistry.initialize, (admin, address(identityProxy)))
        );
        reputation = FaivrReputationRegistry(address(repProxy));

        // Deploy validation
        FaivrValidationRegistry valImpl = new FaivrValidationRegistry();
        ERC1967Proxy valProxy = new ERC1967Proxy(
            address(valImpl), abi.encodeCall(FaivrValidationRegistry.initialize, (admin, address(identityProxy)))
        );
        validation = FaivrValidationRegistry(address(valProxy));

        // Deploy fee module
        FaivrFeeModule feeImpl = new FaivrFeeModule();
        ERC1967Proxy feeProxy = new ERC1967Proxy(
            address(feeImpl),
            abi.encodeCall(FaivrFeeModule.initialize, (admin, protocolWallet, devWallet, address(identityProxy)))
        );
        feeModule = FaivrFeeModule(address(feeProxy));

        // Deploy router
        FaivrRouter routerImpl = new FaivrRouter();
        ERC1967Proxy routerProxy = new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(
                FaivrRouter.initialize,
                (admin, address(identityProxy), address(repProxy), address(valProxy), address(feeProxy))
            )
        );
        router = FaivrRouter(address(routerProxy));

        usdc = new RouterMockUSDC();

        vm.startPrank(admin);
        identity.grantRole(identity.REGISTRAR_ROLE(), address(router));
        feeModule.grantRole(feeModule.ROUTER_ROLE(), address(router));
        reputation.grantRole(reputation.FEEDBACK_ROUTER_ROLE(), address(router));
        reputation.grantRole(reputation.SETTLEMENT_SOURCE_ROLE(), address(feeModule));
        feeModule.setReputationRegistry(address(reputation));
        feeModule.setSupportedToken(address(usdc), true);
        feeModule.setMaxEscrowAmount(0);
        vm.stopPrank();
    }

    function test_getContracts() public view {
        (address id, address rep, address val, address fee) = router.getContracts();
        assertEq(id, address(identity));
        assertEq(rep, address(reputation));
        assertEq(val, address(validation));
        assertEq(fee, address(feeModule));
    }

    function test_registerAndFund_ETH() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        (uint256 newAgentId, uint256 taskId) =
            router.registerAndFund{value: 1 ether}("ipfs://new-agent", address(0), 1 ether, 1 days);

        assertEq(identity.ownerOf(newAgentId), alice);

        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertEq(task.agentId, newAgentId);
        assertEq(task.client, alice);
        assertEq(task.amount, 1 ether);
        assertEq(task.token, address(0));
        assertTrue(task.status == IFaivrFeeModule.TaskStatus.FUNDED);
    }

    function test_registerAndFund_ERC20() public {
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(feeModule), 1_000e6);

        vm.prank(alice);
        (uint256 newAgentId, uint256 taskId) =
            router.registerAndFund("ipfs://new-agent", address(usdc), 1_000e6, 1 days);

        assertEq(identity.ownerOf(newAgentId), alice);
        assertEq(usdc.balanceOf(address(feeModule)), 1_000e6);

        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertEq(task.agentId, newAgentId);
        assertEq(task.client, alice);
        assertEq(task.token, address(usdc));
        assertEq(task.amount, 1_000e6);
    }

    function test_settleAndGiveFeedback_ETH() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        router.settleAndGiveFeedback(taskId, agentId, 95, 0, "quality", "");

        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertTrue(task.status == IFaivrFeeModule.TaskStatus.SETTLED);

        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool isRevoked) =
            reputation.readFeedback(agentId, alice, 1);
        assertEq(value, 95);
        assertEq(decimals, 0);
        assertEq(tag1, "quality");
        assertEq(tag2, "");
        assertFalse(isRevoked);
        assertEq(reputation.pendingFeedbackCredits(agentId, alice), 0);
    }

    function test_settleAndGiveFeedback_ERC20() public {
        usdc.mint(alice, 10_000e6);
        vm.prank(alice);
        usdc.approve(address(feeModule), 10_000e6);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask(agentId, address(usdc), 10_000e6, 1 days);

        vm.prank(alice);
        router.settleAndGiveFeedback(taskId, agentId, 88, 0, "delivery", "erc20");

        IFaivrFeeModule.Task memory task = feeModule.getTask(taskId);
        assertTrue(task.status == IFaivrFeeModule.TaskStatus.SETTLED);

        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool isRevoked) =
            reputation.readFeedback(agentId, alice, 1);
        assertEq(value, 88);
        assertEq(decimals, 0);
        assertEq(tag1, "delivery");
        assertEq(tag2, "erc20");
        assertFalse(isRevoked);
    }

    function test_revert_settleAndGiveFeedback_agentMismatch() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        uint256 taskId = feeModule.fundTask{value: 1 ether}(agentId, address(0), 1 ether, 1 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrRouter.InvalidTaskAgent.selector, taskId, secondAgentId, agentId));
        router.settleAndGiveFeedback(taskId, secondAgentId, 90, 0, "quality", "");
    }

    function test_revert_initialize_zeroAdmin() public {
        FaivrRouter impl = new FaivrRouter();
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                FaivrRouter.initialize,
                (address(0), address(identity), address(reputation), address(validation), address(feeModule))
            )
        );
    }

    function test_revert_initialize_zeroDependencyAddress() public {
        FaivrRouter impl = new FaivrRouter();
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                FaivrRouter.initialize,
                (admin, address(0), address(reputation), address(validation), address(feeModule))
            )
        );
    }
}
