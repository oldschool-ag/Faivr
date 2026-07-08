// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FaivrIdentityRegistry} from "../src/FaivrIdentityRegistry.sol";
import {FaivrReputationRegistry} from "../src/FaivrReputationRegistry.sol";
import {IFaivrReputationRegistry} from "../src/interfaces/IFaivrReputationRegistry.sol";

contract FaivrReputationRegistryTest is Test {
    FaivrIdentityRegistry public identity;
    FaivrReputationRegistry public reputation;

    address public admin = makeAddr("admin");
    address public settlementSource = makeAddr("settlementSource");
    address public agentOwner = makeAddr("agentOwner");
    address public client1 = makeAddr("client1");
    address public client2 = makeAddr("client2");
    address public responder = makeAddr("responder");
    address public feedbackRouter = makeAddr("feedbackRouter");
    uint256 internal agentWalletPk = 0xA11CE;
    address internal agentWallet;

    uint256 public agentId;
    uint256 internal nextTaskId = 1;

    function setUp() public {
        agentWallet = vm.addr(agentWalletPk);

        // Deploy identity
        FaivrIdentityRegistry idImpl = new FaivrIdentityRegistry();
        ERC1967Proxy idProxy = new ERC1967Proxy(
            address(idImpl),
            abi.encodeCall(FaivrIdentityRegistry.initialize, (admin))
        );
        identity = FaivrIdentityRegistry(address(idProxy));

        // Register an agent
        vm.prank(agentOwner);
        agentId = identity.register("ipfs://agent1");

        // Deploy reputation
        FaivrReputationRegistry repImpl = new FaivrReputationRegistry();
        ERC1967Proxy repProxy = new ERC1967Proxy(
            address(repImpl),
            abi.encodeCall(FaivrReputationRegistry.initialize, (admin, address(identity)))
        );
        reputation = FaivrReputationRegistry(address(repProxy));

        vm.startPrank(admin);
        reputation.grantRole(reputation.SETTLEMENT_SOURCE_ROLE(), settlementSource);
        reputation.grantRole(reputation.FEEDBACK_ROUTER_ROLE(), feedbackRouter);
        vm.stopPrank();
    }

    function _recordSettlement(address client) internal returns (uint256 taskId) {
        taskId = nextTaskId++;
        vm.prank(settlementSource);
        reputation.recordTaskSettlement(taskId, agentId, client);
    }

    // ── initialize ───────────────────────────────────────

    function test_getIdentityRegistry() public view {
        assertEq(reputation.getIdentityRegistry(), address(identity));
    }

    // ── giveFeedback ─────────────────────────────────────

    function test_giveFeedback() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 87, 0, "starred", "", "", "", bytes32(0));

        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool isRevoked) =
            reputation.readFeedback(agentId, client1, 1);
        assertEq(value, 87);
        assertEq(decimals, 0);
        assertEq(tag1, "starred");
        assertEq(tag2, "");
        assertFalse(isRevoked);
        assertEq(reputation.pendingFeedbackCredits(agentId, client1), 0);
    }

    function test_giveFeedback_multipleFeedbackSameClient() public {
        _recordSettlement(client1);
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "starred", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.giveFeedback(agentId, 90, 0, "starred", "", "", "", bytes32(0));

        assertEq(reputation.getLastIndex(agentId, client1), 2);

        (int128 v1,,,,) = reputation.readFeedback(agentId, client1, 1);
        (int128 v2,,,,) = reputation.readFeedback(agentId, client1, 2);
        assertEq(v1, 80);
        assertEq(v2, 90);
    }

    function test_revert_giveFeedback_withoutSettledTaskProof() public {
        vm.prank(client1);
        vm.expectRevert(abi.encodeWithSelector(IFaivrReputationRegistry.FeedbackNotAuthorized.selector, agentId, client1));
        reputation.giveFeedback(agentId, 87, 0, "starred", "", "", "", bytes32(0));
    }

    function test_revert_giveFeedback_selfFeedback() public {
        _recordSettlement(agentOwner);

        vm.prank(agentOwner);
        vm.expectRevert(IFaivrReputationRegistry.SelfFeedbackNotAllowed.selector);
        reputation.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
    }

    function test_revert_giveFeedback_agentWalletSelfFeedback() public {
        _setAgentWallet(agentWallet, agentWalletPk);
        _recordSettlement(agentWallet);

        vm.prank(agentWallet);
        vm.expectRevert(IFaivrReputationRegistry.SelfFeedbackNotAllowed.selector);
        reputation.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));

        assertEq(reputation.pendingFeedbackCredits(agentId, agentWallet), 1);
    }

    function test_revert_giveFeedbackFor_agentWalletSelfFeedback() public {
        _setAgentWallet(agentWallet, agentWalletPk);
        _recordSettlement(agentWallet);

        vm.prank(feedbackRouter);
        vm.expectRevert(IFaivrReputationRegistry.SelfFeedbackNotAllowed.selector);
        reputation.giveFeedbackFor(agentWallet, agentId, 100, 0, "", "", "", "", bytes32(0));

        assertEq(reputation.pendingFeedbackCredits(agentId, agentWallet), 1);
    }

    function test_revert_giveFeedback_invalidDecimals() public {
        _recordSettlement(client1);

        vm.prank(client1);
        vm.expectRevert(abi.encodeWithSelector(IFaivrReputationRegistry.InvalidValueDecimals.selector, 19));
        reputation.giveFeedback(agentId, 100, 19, "", "", "", "", bytes32(0));
    }

    function test_giveFeedback_negativeValue() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, -32, 1, "tradingYield", "month", "", "", bytes32(0));

        (int128 value, uint8 decimals, string memory tag1, string memory tag2,) =
            reputation.readFeedback(agentId, client1, 1);
        assertEq(value, -32);
        assertEq(decimals, 1);
        assertEq(tag1, "tradingYield");
        assertEq(tag2, "month");
    }

    function test_recordTaskSettlement_cannotDoubleRecordTask() public {
        uint256 taskId = _recordSettlement(client1);

        vm.prank(settlementSource);
        vm.expectRevert(abi.encodeWithSelector(IFaivrReputationRegistry.TaskSettlementAlreadyRecorded.selector, taskId));
        reputation.recordTaskSettlement(taskId, agentId, client1);
    }

    // ── revokeFeedback ───────────────────────────────────

    function test_revokeFeedback() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 87, 0, "", "", "", "", bytes32(0));

        vm.prank(client1);
        reputation.revokeFeedback(agentId, 1);

        (,,,, bool isRevoked) = reputation.readFeedback(agentId, client1, 1);
        assertTrue(isRevoked);
    }

    function test_revert_revokeFeedback_notFound() public {
        vm.prank(client1);
        vm.expectRevert(abi.encodeWithSelector(IFaivrReputationRegistry.FeedbackNotFound.selector, agentId, client1, 99));
        reputation.revokeFeedback(agentId, 99);
    }

    function test_revert_revokeFeedback_alreadyRevoked() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 87, 0, "", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.revokeFeedback(agentId, 1);
        vm.prank(client1);
        vm.expectRevert(abi.encodeWithSelector(IFaivrReputationRegistry.FeedbackAlreadyRevoked.selector, agentId, client1, 1));
        reputation.revokeFeedback(agentId, 1);
    }

    // ── appendResponse ───────────────────────────────────

    function test_appendResponse() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 87, 0, "", "", "", "", bytes32(0));

        vm.prank(agentOwner);
        reputation.appendResponse(agentId, client1, 1, "ipfs://response", bytes32(0));

        address[] memory responders = new address[](1);
        responders[0] = agentOwner;
        uint64 count = reputation.getResponseCount(agentId, client1, 1, responders);
        assertEq(count, 1);
    }

    function test_revert_appendResponse_notFound() public {
        vm.prank(responder);
        vm.expectRevert(abi.encodeWithSelector(IFaivrReputationRegistry.FeedbackNotFound.selector, agentId, client1, 1));
        reputation.appendResponse(agentId, client1, 1, "ipfs://response", bytes32(0));
    }

    // ── getSummary ───────────────────────────────────────

    function test_getSummary() public {
        _recordSettlement(client1);
        _recordSettlement(client2);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "starred", "", "", "", bytes32(0));
        vm.prank(client2);
        reputation.giveFeedback(agentId, 90, 0, "starred", "", "", "", bytes32(0));

        address[] memory clients = new address[](2);
        clients[0] = client1;
        clients[1] = client2;

        (uint64 count, int128 summaryValue,) = reputation.getSummary(agentId, clients, "", "");
        assertEq(count, 2);
        assertEq(summaryValue, 85); // (80+90)/2
    }

    function test_getSummary_normalizesMixedValueDecimals() public {
        _recordSettlement(client1);
        _recordSettlement(client2);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 1, 0, "quality", "", "", "", bytes32(0));
        vm.prank(client2);
        reputation.giveFeedback(agentId, 15, 1, "quality", "", "", "", bytes32(0));

        address[] memory clients = new address[](2);
        clients[0] = client1;
        clients[1] = client2;

        (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) = reputation.getSummary(agentId, clients, "", "");
        assertEq(count, 2);
        assertEq(summaryValue, 125);
        assertEq(summaryValueDecimals, 2);
    }

    function test_getSummary_withTagFilter() public {
        _recordSettlement(client1);
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "starred", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.giveFeedback(agentId, 50, 0, "uptime", "", "", "", bytes32(0));

        address[] memory clients = new address[](1);
        clients[0] = client1;

        (uint64 count, int128 summaryValue,) = reputation.getSummary(agentId, clients, "starred", "");
        assertEq(count, 1);
        assertEq(summaryValue, 80);
    }

    function test_revert_getSummary_emptyClients() public {
        address[] memory clients = new address[](0);
        vm.expectRevert(IFaivrReputationRegistry.EmptyClientAddresses.selector);
        reputation.getSummary(agentId, clients, "", "");
    }

    function test_getSummary_excludesRevoked() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.revokeFeedback(agentId, 1);

        address[] memory clients = new address[](1);
        clients[0] = client1;

        (uint64 count,,) = reputation.getSummary(agentId, clients, "", "");
        assertEq(count, 0);
    }

    // ── readAllFeedback ──────────────────────────────────

    function test_readAllFeedback() public {
        _recordSettlement(client1);
        _recordSettlement(client2);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "starred", "", "", "", bytes32(0));
        vm.prank(client2);
        reputation.giveFeedback(agentId, 90, 0, "starred", "", "", "", bytes32(0));

        address[] memory clients = new address[](2);
        clients[0] = client1;
        clients[1] = client2;

        (
            address[] memory returnedClients,
            uint64[] memory indexes,
            int128[] memory values,
            ,,
            ,
        ) = reputation.readAllFeedback(agentId, clients, "", "", false);

        assertEq(returnedClients.length, 2);
        assertEq(values[0], 80);
        assertEq(values[1], 90);
        assertEq(indexes[0], 1);
        assertEq(indexes[1], 1);
    }

    function test_readAllFeedback_excludesRevokedByDefault() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.revokeFeedback(agentId, 1);

        address[] memory clients = new address[](1);
        clients[0] = client1;

        (address[] memory returnedClients,,,,,,) =
            reputation.readAllFeedback(agentId, clients, "", "", false);
        assertEq(returnedClients.length, 0);
    }

    function test_readAllFeedback_includesRevokedWhenRequested() public {
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.revokeFeedback(agentId, 1);

        address[] memory clients = new address[](1);
        clients[0] = client1;

        (address[] memory returnedClients,,,,,,) =
            reputation.readAllFeedback(agentId, clients, "", "", true);
        assertEq(returnedClients.length, 1);
    }

    // ── getClients / getLastIndex ────────────────────────

    function test_getClients() public {
        _recordSettlement(client1);
        _recordSettlement(client2);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));
        vm.prank(client2);
        reputation.giveFeedback(agentId, 90, 0, "", "", "", "", bytes32(0));

        address[] memory clients = reputation.getClients(agentId);
        assertEq(clients.length, 2);
        assertEq(clients[0], client1);
        assertEq(clients[1], client2);
    }

    function test_getLastIndex() public {
        _recordSettlement(client1);
        _recordSettlement(client1);

        vm.prank(client1);
        reputation.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));
        vm.prank(client1);
        reputation.giveFeedback(agentId, 90, 0, "", "", "", "", bytes32(0));

        assertEq(reputation.getLastIndex(agentId, client1), 2);
    }

    function test_getLastIndex_noFeedback() public view {
        assertEq(reputation.getLastIndex(agentId, client1), 0);
    }

    function _setAgentWallet(address wallet, uint256 walletPk) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = identity.walletNonce(agentId);
        bytes32 structHash = keccak256(abi.encode(
            identity.SET_AGENT_WALLET_TYPEHASH(),
            agentId,
            wallet,
            nonce,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _identityDomainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(agentOwner);
        identity.setAgentWallet(agentId, wallet, deadline, sig);
    }

    function _identityDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("FaivrIdentity"),
            keccak256("1"),
            block.chainid,
            address(identity)
        ));
    }
}
