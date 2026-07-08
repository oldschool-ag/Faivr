// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {ERC721URIStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IFaivrIdentityRegistry} from "./interfaces/IFaivrIdentityRegistry.sol";

/// @title FaivrIdentityRegistry
/// @notice ERC-8004 compliant agent identity registry — each agent is an ERC-721 NFT
contract FaivrIdentityRegistry is
    Initializable,
    ERC721URIStorageUpgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    EIP712Upgradeable,
    IFaivrIdentityRegistry
{
    using ECDSA for bytes32;

    // ── Constants ────────────────────────────────────────
    bytes32 private constant _AGENT_WALLET_KEY_HASH = keccak256(bytes("agentWallet"));
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant SET_AGENT_WALLET_TYPEHASH = keccak256(
        "SetAgentWallet(uint256 agentId,address newWallet,uint256 nonce,uint256 deadline)"
    );

    // ── Storage ──────────────────────────────────────────
    uint256 private _nextAgentId;
    mapping(uint256 agentId => bool) private _agentActive;
    mapping(uint256 agentId => uint256) private _registeredAt;
    mapping(uint256 agentId => mapping(bytes32 keyHash => bytes)) private _metadata;
    mapping(uint256 agentId => address) private _agentWallets;

    /// @dev Per-agent nonce for setAgentWallet replay protection (H-05)
    mapping(uint256 agentId => uint256) private _walletNonces;

    /// @custom:storage-gap
    uint256[49] private __gap;

    // ── Initializer ──────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();

        __ERC721_init("FAIVR Agent", "FAGENT");
        __ERC721URIStorage_init();
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __EIP712_init("FaivrIdentity", "1");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _nextAgentId = 1;
    }

    // ── ERC-8004 Registration ────────────────────────────

    function register(string calldata agentURI, MetadataEntry[] calldata metadata) external override returns (uint256 agentId) {
        // Validate no reserved keys in metadata
        for (uint256 i; i < metadata.length; i++) {
            if (keccak256(bytes(metadata[i].metadataKey)) == _AGENT_WALLET_KEY_HASH) {
                revert ReservedMetadataKey("agentWallet");
            }
        }

        agentId = _registerInternal(msg.sender, agentURI);

        // Set additional metadata
        for (uint256 i; i < metadata.length; i++) {
            bytes32 keyHash = keccak256(bytes(metadata[i].metadataKey));
            _metadata[agentId][keyHash] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }
    }

    function register(string calldata agentURI) external override returns (uint256 agentId) {
        agentId = _registerInternal(msg.sender, agentURI);
    }

    function register() external override returns (uint256 agentId) {
        agentId = _registerInternal(msg.sender, "");
    }

    /// @notice Register an agent on behalf of another address. Requires REGISTRAR_ROLE.
    function registerFor(address to, string calldata agentURI) external onlyRole(REGISTRAR_ROLE) returns (uint256 agentId) {
        agentId = _registerInternal(to, agentURI);
    }

    function _registerInternal(address owner, string memory agentURI) internal returns (uint256 agentId) {
        agentId = _nextAgentId;
        unchecked { _nextAgentId++; }

        // Set state BEFORE _safeMint to prevent reentrancy (H-02)
        _agentActive[agentId] = true;
        _registeredAt[agentId] = block.timestamp;
        _agentWallets[agentId] = owner;

        _safeMint(owner, agentId);
        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(owner));
        emit Registered(agentId, agentURI, owner);
    }

    // ── ERC-8004 URI ─────────────────────────────────────

    function setAgentURI(uint256 agentId, string calldata newURI) external override {
        _requireOwnerOrApproved(agentId);
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    // ── ERC-8004 Metadata ────────────────────────────────

    function getMetadata(uint256 agentId, string memory metadataKey) external view override returns (bytes memory) {
        _requireExists(agentId);
        bytes32 keyHash = keccak256(bytes(metadataKey));
        if (keyHash == _AGENT_WALLET_KEY_HASH) {
            return abi.encodePacked(_agentWallets[agentId]);
        }
        return _metadata[agentId][keyHash];
    }

    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external override {
        _requireOwnerOrApproved(agentId);
        bytes32 keyHash = keccak256(bytes(metadataKey));
        if (keyHash == _AGENT_WALLET_KEY_HASH) {
            revert ReservedMetadataKey("agentWallet");
        }
        _metadata[agentId][keyHash] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ── ERC-8004 Agent Wallet ────────────────────────────

    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external override {
        _requireOwnerOrApproved(agentId);
        if (block.timestamp > deadline) revert SignatureExpired();

        uint256 nonce = _walletNonces[agentId];

        // Verify the new wallet signed the EIP-712 message (includes nonce for replay protection — H-05)
        bytes32 structHash = keccak256(abi.encode(
            SET_AGENT_WALLET_TYPEHASH,
            agentId,
            newWallet,
            nonce,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);

        bool valid = SignatureChecker.isValidSignatureNow(newWallet, digest, signature);
        if (!valid) revert InvalidSignature();

        _walletNonces[agentId] = nonce + 1;
        _agentWallets[agentId] = newWallet;
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(newWallet));
    }

    /// @notice Get the current wallet nonce for an agent (for EIP-712 signing)
    function walletNonce(uint256 agentId) external view returns (uint256) {
        return _walletNonces[agentId];
    }

    function getAgentWallet(uint256 agentId) external view override returns (address) {
        _requireExists(agentId);
        return _agentWallets[agentId];
    }

    function unsetAgentWallet(uint256 agentId) external override {
        _requireOwnerOrApproved(agentId);
        _agentWallets[agentId] = address(0);
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(address(0)));
    }

    // ── FAIVR Extensions ─────────────────────────────────

    function deactivateAgent(uint256 agentId) external override {
        _requireOwnerOrApproved(agentId);
        if (!_agentActive[agentId]) revert AgentNotActive(agentId);
        _agentActive[agentId] = false;
        emit AgentDeactivated(agentId);
    }

    function reactivateAgent(uint256 agentId) external override {
        _requireOwnerOrApproved(agentId);
        if (_agentActive[agentId]) revert AgentAlreadyActive(agentId);
        _agentActive[agentId] = true;
        emit AgentReactivated(agentId);
    }

    // ── Views ────────────────────────────────────────────

    function isActive(uint256 agentId) external view override returns (bool) {
        return _agentActive[agentId];
    }

    function agentCount() external view override returns (uint256) {
        unchecked { return _nextAgentId - 1; }
    }

    function registeredAt(uint256 agentId) external view override returns (uint256) {
        return _registeredAt[agentId];
    }

    // ── Transfer hook: clear agentWallet ─────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721Upgradeable)
        returns (address)
    {
        address from = super._update(to, tokenId, auth);
        // Clear wallet on transfer (not on mint)
        if (from != address(0) && to != address(0)) {
            _agentWallets[tokenId] = address(0);
            emit MetadataSet(tokenId, "agentWallet", "agentWallet", abi.encodePacked(address(0)));
        }
        return from;
    }

    // ── Internal helpers ─────────────────────────────────

    function _requireOwnerOrApproved(uint256 agentId) internal view {
        _requireExists(agentId);
        address owner = ownerOf(agentId);
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender) && getApproved(agentId) != msg.sender) {
            revert NotAgentOwner(agentId);
        }
    }

    function _requireExists(uint256 agentId) internal view {
        if (agentId == 0 || agentId >= _nextAgentId) revert AgentDoesNotExist(agentId);
    }

    // ── Overrides ────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorageUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
