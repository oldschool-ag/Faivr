// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {FaivrVerificationRegistry} from "../src/FaivrVerificationRegistry.sol";
import {IFaivrVerificationRegistry} from "../src/interfaces/IFaivrVerificationRegistry.sol";
import {FaivrIdentityRegistry} from "../src/FaivrIdentityRegistry.sol";

contract FaivrVerificationRegistryLegacy is Initializable, ERC721Upgradeable, UUPSUpgradeable, AccessControlUpgradeable {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    IERC721 public identityRegistry;
    uint256 public expiryPeriod;
    uint256 private _nextTokenId;
    mapping(uint256 agentId => IFaivrVerificationRegistry.Verification) private _verifications;
    uint256[50] private __gap;

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address identityAddr) external initializer {
        __ERC721_init("FAIVR Verified Agent", "FVERIFY");
        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);

        identityRegistry = IERC721(identityAddr);
        expiryPeriod = 90 days;
        _nextTokenId = 1;
    }

    function verify(
        uint256 agentId,
        string calldata domain,
        IFaivrVerificationRegistry.VerificationMethod method
    ) external onlyRole(VERIFIER_ROLE) {
        address agentOwner = identityRegistry.ownerOf(agentId);
        IFaivrVerificationRegistry.Verification storage v = _verifications[agentId];

        uint256 tokenId = v.tokenId;
        if (tokenId == 0) {
            tokenId = _nextTokenId++;
            _mint(agentOwner, tokenId);
        }

        v.domain = domain;
        v.method = method;
        v.verifiedAt = block.timestamp;
        v.expiresAt = block.timestamp + expiryPeriod;
        v.verified = true;
        v.tokenId = tokenId;
    }

    function getVerification(uint256 agentId) external view returns (IFaivrVerificationRegistry.Verification memory) {
        return _verifications[agentId];
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}

contract FaivrVerificationRegistryTest is Test {
    FaivrVerificationRegistry public verifier;
    FaivrIdentityRegistry public identity;

    address public admin = makeAddr("admin");
    address public verifierBot = makeAddr("verifierBot");
    address public agentOwner = makeAddr("agentOwner");
    address public rando = makeAddr("rando");
    uint256 public agentId;

    function setUp() public {
        // Deploy identity registry
        FaivrIdentityRegistry identityImpl = new FaivrIdentityRegistry();
        ERC1967Proxy identityProxy = new ERC1967Proxy(
            address(identityImpl),
            abi.encodeCall(FaivrIdentityRegistry.initialize, (admin))
        );
        identity = FaivrIdentityRegistry(address(identityProxy));

        // Register an agent
        vm.prank(agentOwner);
        agentId = identity.register("ipfs://agent1");

        // Deploy verification registry
        FaivrVerificationRegistry verifierImpl = new FaivrVerificationRegistry();
        ERC1967Proxy verifierProxy = new ERC1967Proxy(
            address(verifierImpl),
            abi.encodeCall(FaivrVerificationRegistry.initialize, (admin, address(identity)))
        );
        verifier = FaivrVerificationRegistry(address(verifierProxy));

        // Grant verifier role to bot
        bytes32 verifierRole = verifier.VERIFIER_ROLE();
        vm.prank(admin);
        verifier.grantRole(verifierRole, verifierBot);
    }

    // ── Verify ───────────────────────────────────────────

    function test_revert_initialize_zeroAdmin() public {
        FaivrVerificationRegistry verifierImpl = new FaivrVerificationRegistry();
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        new ERC1967Proxy(
            address(verifierImpl), abi.encodeCall(FaivrVerificationRegistry.initialize, (address(0), address(identity)))
        );
    }

    function test_revert_initialize_zeroIdentity() public {
        FaivrVerificationRegistry verifierImpl = new FaivrVerificationRegistry();
        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        new ERC1967Proxy(
            address(verifierImpl), abi.encodeCall(FaivrVerificationRegistry.initialize, (admin, address(0)))
        );
    }

    function test_verify_dns() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);

        assertTrue(verifier.isVerified(agentId));

        IFaivrVerificationRegistry.Verification memory v = verifier.getVerification(agentId);
        assertEq(v.domain, "example.com");
        assertEq(uint(v.method), uint(IFaivrVerificationRegistry.VerificationMethod.DNS));
        assertTrue(v.verified);
        assertGt(v.tokenId, 0);

        // NFT minted to agent owner
        assertEq(verifier.ownerOf(v.tokenId), agentOwner);
    }

    function test_verify_file() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "myagent.io", IFaivrVerificationRegistry.VerificationMethod.FILE);
        assertTrue(verifier.isVerified(agentId));
    }

    function test_verify_twitter() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "@myagent", IFaivrVerificationRegistry.VerificationMethod.TWITTER);
        assertTrue(verifier.isVerified(agentId));
    }

    function test_reverify_noNewNFT() public {
        vm.startPrank(verifierBot);
        verifier.verify(agentId, "old.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 tokenId1 = verifier.getVerification(agentId).tokenId;

        verifier.verify(agentId, "new.com", IFaivrVerificationRegistry.VerificationMethod.FILE);
        uint256 tokenId2 = verifier.getVerification(agentId).tokenId;
        vm.stopPrank();

        assertEq(tokenId1, tokenId2, "Re-verification should not mint new NFT");
        assertEq(verifier.getVerification(agentId).domain, "new.com");
    }

    // ── Revoke ───────────────────────────────────────────

    function test_revoke() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);

        vm.prank(verifierBot);
        verifier.revoke(agentId);

        assertFalse(verifier.isVerified(agentId));
    }

    function test_revoke_burnsVerificationNFT() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 tokenId = verifier.getVerification(agentId).tokenId;

        vm.prank(verifierBot);
        verifier.revoke(agentId);

        IFaivrVerificationRegistry.Verification memory v = verifier.getVerification(agentId);
        assertFalse(v.verified);
        assertEq(v.tokenId, 0);

        vm.expectRevert();
        verifier.ownerOf(tokenId);

        vm.expectRevert();
        verifier.tokenURI(tokenId);
    }

    function test_revoke_notVerified_reverts() public {
        vm.prank(verifierBot);
        vm.expectRevert(abi.encodeWithSelector(IFaivrVerificationRegistry.VerificationNotFound.selector, agentId));
        verifier.revoke(agentId);
    }

    // ── Expiry ───────────────────────────────────────────

    function test_expiry() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);

        assertTrue(verifier.isVerified(agentId));

        // Warp past expiry
        vm.warp(block.timestamp + 91 days);
        assertFalse(verifier.isVerified(agentId));
    }

    function test_getVerification_marksExpiredVerificationInactive() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);

        vm.warp(block.timestamp + 91 days);

        IFaivrVerificationRegistry.Verification memory v = verifier.getVerification(agentId);
        assertFalse(v.verified);
    }

    function test_tokenURI_changesWhenVerificationExpires() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 tokenId = verifier.getVerification(agentId).tokenId;
        string memory activeURI = verifier.tokenURI(tokenId);

        vm.warp(block.timestamp + 91 days);

        string memory expiredURI = verifier.tokenURI(tokenId);
        assertTrue(keccak256(bytes(activeURI)) != keccak256(bytes(expiredURI)));
    }

    function test_setExpiryPeriod() public {
        vm.prank(admin);
        verifier.setExpiryPeriod(30 days);
        assertEq(verifier.expiryPeriod(), 30 days);
    }

    // ── Soulbound ────────────────────────────────────────

    function test_soulbound_transferBlocked() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 tokenId = verifier.getVerification(agentId).tokenId;

        vm.prank(agentOwner);
        vm.expectRevert(IFaivrVerificationRegistry.SoulboundTransferBlocked.selector);
        verifier.transferFrom(agentOwner, rando, tokenId);
    }

    function test_tokenURI_changesWhenOwnerChangesWithoutSync() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 tokenId = verifier.getVerification(agentId).tokenId;
        string memory activeURI = verifier.tokenURI(tokenId);

        vm.prank(agentOwner);
        identity.transferFrom(agentOwner, rando, agentId);

        string memory staleURI = verifier.tokenURI(tokenId);
        assertTrue(keccak256(bytes(activeURI)) != keccak256(bytes(staleURI)));
        assertFalse(verifier.getVerification(agentId).verified);
    }

    function test_transferInvalidatesVerificationUntilSynced() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 oldTokenId = verifier.getVerification(agentId).tokenId;

        vm.prank(agentOwner);
        identity.transferFrom(agentOwner, rando, agentId);

        assertFalse(verifier.isVerified(agentId));
        assertFalse(verifier.getVerification(agentId).verified);

        uint256 newTokenId = verifier.syncVerification(agentId);
        assertTrue(newTokenId > oldTokenId);
        assertEq(verifier.ownerOf(newTokenId), rando);
        assertTrue(verifier.isVerified(agentId));

        vm.expectRevert();
        verifier.ownerOf(oldTokenId);
    }

    function test_upgrade_preservesLegacyStorageLayout_andSyncsTokenLookup() public {
        FaivrVerificationRegistryLegacy legacyImpl = new FaivrVerificationRegistryLegacy();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(legacyImpl),
            abi.encodeCall(FaivrVerificationRegistryLegacy.initialize, (admin, address(identity)))
        );
        FaivrVerificationRegistryLegacy legacy = FaivrVerificationRegistryLegacy(address(proxy));

        bytes32 verifierRole = legacy.VERIFIER_ROLE();
        vm.prank(admin);
        legacy.grantRole(verifierRole, verifierBot);

        vm.prank(verifierBot);
        legacy.verify(agentId, "legacy.example", IFaivrVerificationRegistry.VerificationMethod.FILE);

        IFaivrVerificationRegistry.Verification memory legacyVerification = legacy.getVerification(agentId);
        assertTrue(legacyVerification.verified);
        assertEq(legacy.ownerOf(legacyVerification.tokenId), agentOwner);

        FaivrVerificationRegistry newImpl = new FaivrVerificationRegistry();
        vm.prank(admin);
        legacy.upgradeToAndCall(address(newImpl), "");

        FaivrVerificationRegistry upgraded = FaivrVerificationRegistry(address(proxy));
        IFaivrVerificationRegistry.Verification memory upgradedVerification = upgraded.getVerification(agentId);
        assertEq(upgradedVerification.domain, "legacy.example");
        assertEq(uint256(upgradedVerification.method), uint256(IFaivrVerificationRegistry.VerificationMethod.FILE));
        assertTrue(upgradedVerification.verified);
        assertEq(upgraded.ownerOf(upgradedVerification.tokenId), agentOwner);

        string memory uriBeforeSync = upgraded.tokenURI(upgradedVerification.tokenId);
        assertTrue(bytes(uriBeforeSync).length > 0);

        uint256 syncedTokenId = upgraded.syncVerification(agentId);
        assertEq(syncedTokenId, upgradedVerification.tokenId);

        string memory uriAfterSync = upgraded.tokenURI(syncedTokenId);
        assertTrue(bytes(uriAfterSync).length > 0);
    }

    // ── Access Control ───────────────────────────────────

    function test_verify_notVerifier_reverts() public {
        vm.prank(rando);
        vm.expectRevert();
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
    }

    // ── Token URI ────────────────────────────────────────

    function test_tokenURI() public {
        vm.prank(verifierBot);
        verifier.verify(agentId, "example.com", IFaivrVerificationRegistry.VerificationMethod.DNS);
        uint256 tokenId = verifier.getVerification(agentId).tokenId;

        string memory uri = verifier.tokenURI(tokenId);
        // Should be a data URI
        assertTrue(bytes(uri).length > 0);
        // Basic check it starts with data:
        bytes memory uriBytes = bytes(uri);
        assertEq(uriBytes[0], "d");
        assertEq(uriBytes[1], "a");
        assertEq(uriBytes[2], "t");
        assertEq(uriBytes[3], "a");
    }
}
