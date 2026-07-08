// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IFaivrIdentityRegistry} from "../src/interfaces/IFaivrIdentityRegistry.sol";
import {FaivrIdentityRegistry} from "../src/FaivrIdentityRegistry.sol";

contract FaivrIdentityRegistryTest is Test {
    FaivrIdentityRegistry public registry;
    address public admin = makeAddr("admin");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    uint256 internal walletPk = 0xBEEF;
    address internal walletAddr = vm.addr(walletPk);

    function setUp() public {
        FaivrIdentityRegistry impl = new FaivrIdentityRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(FaivrIdentityRegistry.initialize, (admin))
        );
        registry = FaivrIdentityRegistry(address(proxy));
    }

    // ── register(string, MetadataEntry[]) ────────────────

    function test_revert_initialize_zeroAdmin() public {
        FaivrIdentityRegistry impl = new FaivrIdentityRegistry();
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        new ERC1967Proxy(address(impl), abi.encodeCall(FaivrIdentityRegistry.initialize, (address(0))));
    }

    function test_registerWithMetadata() public {
        IFaivrIdentityRegistry.MetadataEntry[] memory meta = new IFaivrIdentityRegistry.MetadataEntry[](1);
        meta[0] = IFaivrIdentityRegistry.MetadataEntry("foo", abi.encode(42));

        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent1", meta);

        assertEq(agentId, 1);
        assertEq(registry.ownerOf(agentId), alice);
        assertEq(registry.tokenURI(agentId), "ipfs://agent1");
        assertEq(registry.getMetadata(agentId, "foo"), abi.encode(42));
        assertTrue(registry.isActive(agentId));
        assertEq(registry.agentCount(), 1);
        assertGt(registry.registeredAt(agentId), 0);
        assertEq(registry.getAgentWallet(agentId), alice);
    }

    function test_revert_registerWithMetadata_reservedKey() public {
        IFaivrIdentityRegistry.MetadataEntry[] memory meta = new IFaivrIdentityRegistry.MetadataEntry[](1);
        meta[0] = IFaivrIdentityRegistry.MetadataEntry("agentWallet", abi.encode(address(1)));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.ReservedMetadataKey.selector, "agentWallet"));
        registry.register("ipfs://agent1", meta);
    }

    // ── register(string) ─────────────────────────────────

    function test_registerWithURI() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent1");
        assertEq(agentId, 1);
        assertEq(registry.tokenURI(agentId), "ipfs://agent1");
    }

    // ── register() ───────────────────────────────────────

    function test_registerNoArgs() public {
        vm.prank(alice);
        uint256 agentId = registry.register();
        assertEq(agentId, 1);
        assertEq(registry.ownerOf(agentId), alice);
    }

    function test_registerMultipleAgents() public {
        vm.prank(alice);
        uint256 id1 = registry.register("ipfs://agent1");
        vm.prank(bob);
        uint256 id2 = registry.register("ipfs://agent2");
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(registry.agentCount(), 2);
    }

    // ── setAgentURI ──────────────────────────────────────

    function test_setAgentURI() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://old");
        vm.prank(alice);
        registry.setAgentURI(agentId, "ipfs://new");
        assertEq(registry.tokenURI(agentId), "ipfs://new");
    }

    function test_revert_setAgentURI_notOwner() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.NotAgentOwner.selector, agentId));
        registry.setAgentURI(agentId, "ipfs://hack");
    }

    // ── setMetadata / getMetadata ────────────────────────

    function test_setAndGetMetadata() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        registry.setMetadata(agentId, "key1", abi.encode("value1"));
        assertEq(registry.getMetadata(agentId, "key1"), abi.encode("value1"));
    }

    function test_revert_setMetadata_reservedKey() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.ReservedMetadataKey.selector, "agentWallet"));
        registry.setMetadata(agentId, "agentWallet", abi.encode(address(1)));
    }

    function test_revert_setMetadata_notOwner() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.NotAgentOwner.selector, agentId));
        registry.setMetadata(agentId, "key1", abi.encode("value1"));
    }

    function test_getMetadata_agentWalletKey() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        bytes memory walletBytes = registry.getMetadata(agentId, "agentWallet");
        assertEq(walletBytes, abi.encodePacked(alice));
    }

    // ── setAgentWallet / getAgentWallet / unsetAgentWallet ─

    function test_setAgentWallet() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.walletNonce(agentId);
        bytes32 structHash = keccak256(abi.encode(
            registry.SET_AGENT_WALLET_TYPEHASH(),
            agentId, walletAddr, nonce, deadline
        ));
        bytes32 domainSep = _getDomainSeparator();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
        assertEq(registry.getAgentWallet(agentId), walletAddr);
    }

    function test_revert_setAgentWallet_expired() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");

        uint256 deadline = block.timestamp - 1;
        vm.prank(alice);
        vm.expectRevert(IFaivrIdentityRegistry.SignatureExpired.selector);
        registry.setAgentWallet(agentId, walletAddr, deadline, "");
    }

    function test_revert_setAgentWallet_invalidSignature() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");

        uint256 deadline = block.timestamp + 1 hours;
        // Wrong signer
        uint256 nonce = registry.walletNonce(agentId);
        bytes32 structHash = keccak256(abi.encode(
            registry.SET_AGENT_WALLET_TYPEHASH(),
            agentId, walletAddr, nonce, deadline
        ));
        bytes32 domainSep = _getDomainSeparator();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, digest); // wrong key
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(IFaivrIdentityRegistry.InvalidSignature.selector);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
    }

    function test_unsetAgentWallet() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        registry.unsetAgentWallet(agentId);
        assertEq(registry.getAgentWallet(agentId), address(0));
    }

    // ── Transfer clears wallet ───────────────────────────

    function test_transferClearsWallet() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        assertEq(registry.getAgentWallet(agentId), alice);

        vm.prank(alice);
        registry.transferFrom(alice, bob, agentId);
        assertEq(registry.getAgentWallet(agentId), address(0));
    }

    // ── Deactivate / Reactivate ──────────────────────────

    function test_deactivateAgent() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        registry.deactivateAgent(agentId);
        assertFalse(registry.isActive(agentId));
    }

    function test_reactivateAgent() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        registry.deactivateAgent(agentId);
        vm.prank(alice);
        registry.reactivateAgent(agentId);
        assertTrue(registry.isActive(agentId));
    }

    function test_deactivateAndReactivate_approvedAddress() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");

        vm.prank(alice);
        registry.approve(bob, agentId);

        vm.prank(bob);
        registry.deactivateAgent(agentId);
        assertFalse(registry.isActive(agentId));

        vm.prank(bob);
        registry.reactivateAgent(agentId);
        assertTrue(registry.isActive(agentId));
    }

    function test_revert_deactivate_notOwner() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.NotAgentOwner.selector, agentId));
        registry.deactivateAgent(agentId);
    }

    function test_revert_deactivate_alreadyInactive() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        registry.deactivateAgent(agentId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.AgentNotActive.selector, agentId));
        registry.deactivateAgent(agentId);
    }

    function test_revert_reactivate_alreadyActive() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://agent");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IFaivrIdentityRegistry.AgentAlreadyActive.selector, agentId));
        registry.reactivateAgent(agentId);
    }

    // ── Upgrade ──────────────────────────────────────────

    function test_revert_upgrade_notAdmin() public {
        FaivrIdentityRegistry newImpl = new FaivrIdentityRegistry();
        vm.prank(alice);
        vm.expectRevert();
        registry.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_asAdmin() public {
        FaivrIdentityRegistry newImpl = new FaivrIdentityRegistry();
        vm.prank(admin);
        registry.upgradeToAndCall(address(newImpl), "");
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://post-upgrade");
        assertEq(registry.tokenURI(agentId), "ipfs://post-upgrade");
    }

    // ── Helpers ──────────────────────────────────────────

    function _getDomainSeparator() internal view returns (bytes32) {
        // EIP-712 domain separator for FaivrIdentity v1
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("FaivrIdentity"),
            keccak256("1"),
            block.chainid,
            address(registry)
        ));
    }
}
