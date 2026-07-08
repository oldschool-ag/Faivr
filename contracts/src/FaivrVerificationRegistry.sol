// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {IFaivrVerificationRegistry} from "./interfaces/IFaivrVerificationRegistry.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IFaivrVerificationIdentityRegistry is IERC721 {
    function agentCount() external view returns (uint256);
}

/// @title FaivrVerificationRegistry
/// @notice Soulbound verification NFTs for FAIVR agents — proves domain/Twitter ownership
contract FaivrVerificationRegistry is
    Initializable,
    ERC721Upgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    IFaivrVerificationRegistry
{
    using Strings for uint256;

    // ── Roles ────────────────────────────────────────────
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ── Storage ──────────────────────────────────────────
    IFaivrVerificationIdentityRegistry public identityRegistry;
    uint256 public expiryPeriod; // seconds, default 90 days
    uint256 private _nextTokenId;

    mapping(uint256 agentId => Verification) private _verifications;
    mapping(uint256 tokenId => uint256 agentId) private _tokenAgents;

    /// @custom:storage-gap
    uint256[49] private __gap;

    // ── Initializer ──────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address identityAddr) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        if (identityAddr == address(0)) revert ZeroAddress();

        __ERC721_init("FAIVR Verified Agent", "FVERIFY");
        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);

        identityRegistry = IFaivrVerificationIdentityRegistry(identityAddr);
        expiryPeriod = 90 days;
        _nextTokenId = 1;
    }

    // ── Verification ─────────────────────────────────────

    /// @notice Mark an agent as verified. Only callable by VERIFIER_ROLE.
    function verify(
        uint256 agentId,
        string calldata domain,
        VerificationMethod method
    ) external onlyRole(VERIFIER_ROLE) {
        address agentOwner = _agentOwner(agentId);
        Verification storage v = _verifications[agentId];
        uint256 tokenId = _syncVerification(agentId, agentOwner, v.tokenId);

        v.domain = domain;
        v.method = method;
        v.verifiedAt = block.timestamp;
        v.expiresAt = block.timestamp + expiryPeriod;
        v.verified = true;
        v.tokenId = tokenId;

        emit AgentVerified(agentId, domain, method, tokenId);
    }

    /// @notice Revoke verification for an agent.
    function revoke(uint256 agentId) external onlyRole(VERIFIER_ROLE) {
        Verification storage v = _verifications[agentId];
        if (!v.verified) revert VerificationNotFound(agentId);

        uint256 tokenId = v.tokenId;
        v.verified = false;
        v.expiresAt = 0;
        v.tokenId = 0;

        if (tokenId != 0 && _ownerOf(tokenId) != address(0)) {
            _burn(tokenId);
            _tokenAgents[tokenId] = 0;
        }

        emit VerificationRevoked(agentId);
    }

    /// @notice Sync a verification NFT to the current agent owner and backfill reverse token lookup.
    function syncVerification(uint256 agentId) external returns (uint256 tokenId) {
        Verification storage v = _verifications[agentId];
        if (v.tokenId == 0) revert VerificationNotFound(agentId);

        address agentOwner = _agentOwner(agentId);
        tokenId = _syncVerification(agentId, agentOwner, v.tokenId);
        v.tokenId = tokenId;
    }

    /// @notice Check if an agent is currently verified (not expired and still bound to the current owner).
    function isVerified(uint256 agentId) external view returns (bool) {
        (bool active,) = _verificationState(agentId, _verifications[agentId]);
        return active;
    }

    /// @notice Get full verification record.
    function getVerification(uint256 agentId) external view returns (Verification memory verification) {
        verification = _verifications[agentId];
        (bool active,) = _verificationState(agentId, _verifications[agentId]);
        if (!active) {
            verification.verified = false;
        }
    }

    /// @notice Update the expiry period (admin only).
    function setExpiryPeriod(uint256 newPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        expiryPeriod = newPeriod;
        emit ExpiryPeriodUpdated(newPeriod);
    }

    // ── Soulbound ────────────────────────────────────────

    /// @dev Block all transfers — soulbound tokens
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)) and burning, block transfers
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransferBlocked();
        }
        return super._update(to, tokenId, auth);
    }

    // ── Token Metadata (on-chain SVG) ────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        uint256 agentId = _tokenAgents[tokenId];
        if (agentId == 0) {
            agentId = _findAgentIdByTokenId(tokenId);
        }
        require(agentId != 0, "Token not linked");

        Verification storage v = _verifications[agentId];
        string memory domain = v.domain;
        string memory method = _methodToString(v.method);
        uint256 verifiedAt = v.verifiedAt;
        (bool active, string memory status) = _verificationState(agentId, v);
        string memory namePrefix = active ? "FAIVR Verified Agent #" : "FAIVR Verification Record #";
        string memory descriptionPrefix = active
            ? "Current verification proof for agent #"
            : "Historical verification record for agent #";

        string memory svg = _generateSVG(agentId, domain, method, status, active);
        string memory json = string(abi.encodePacked(
            '{"name":"', namePrefix, agentId.toString(),
            '","description":"', descriptionPrefix, agentId.toString(),
            ' on FAIVR. Status: ', status, ' | Domain: ', domain, ' | Method: ', method, '",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[',
                '{"trait_type":"Agent ID","value":"', agentId.toString(), '"},',
                '{"trait_type":"Domain","value":"', domain, '"},',
                '{"trait_type":"Method","value":"', method, '"},',
                '{"trait_type":"Status","value":"', status, '"},',
                '{"trait_type":"Verified At","display_type":"date","value":', verifiedAt.toString(), '},',
                '{"trait_type":"Soulbound","value":"true"}',
            ']}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function _methodToString(VerificationMethod m) internal pure returns (string memory) {
        if (m == VerificationMethod.DNS) return "dns";
        if (m == VerificationMethod.FILE) return "file";
        return "twitter";
    }

    function _generateSVG(uint256 agentId, string memory domain, string memory method, string memory status, bool active)
        internal
        pure
        returns (string memory)
    {
        string memory accentStart = active ? "#10b981" : "#f59e0b";
        string memory accentEnd = active ? "#6366f1" : "#ef4444";
        string memory icon = active ? "&#x2713;" : "&#x26A0;";
        string memory title = active ? "FAIVR VERIFIED" : "FAIVR VERIFICATION";

        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="#0f0f23"/><stop offset="100%" stop-color="#1a1a3e"/></linearGradient>',
            '<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">',
            '<stop offset="0%" stop-color="', accentStart, '"/><stop offset="100%" stop-color="', accentEnd, '"/></linearGradient></defs>',
            '<rect width="400" height="400" rx="20" fill="url(#bg)"/>',
            '<rect x="20" y="20" width="360" height="360" rx="12" fill="none" stroke="url(#accent)" stroke-width="2" opacity="0.5"/>',
            '<text x="200" y="100" text-anchor="middle" fill="', accentStart, '" font-family="monospace" font-size="48">', icon, '</text>',
            '<text x="200" y="150" text-anchor="middle" fill="white" font-family="sans-serif" font-size="20" font-weight="bold">', title, '</text>',
            '<text x="200" y="200" text-anchor="middle" fill="#a1a1aa" font-family="monospace" font-size="14">Agent #', agentId.toString(), '</text>',
            '<text x="200" y="232" text-anchor="middle" fill="#d4d4d8" font-family="monospace" font-size="12">', domain, '</text>',
            '<text x="200" y="262" text-anchor="middle" fill="#71717a" font-family="monospace" font-size="11">method: ', method, '</text>',
            '<text x="200" y="286" text-anchor="middle" fill="#71717a" font-family="monospace" font-size="11">status: ', status, '</text>',
            '<text x="200" y="360" text-anchor="middle" fill="#3f3f46" font-family="sans-serif" font-size="10">SOULBOUND \xE2\x80\xA2 NON-TRANSFERABLE</text>',
            '</svg>'
        ));
    }

    function _agentOwner(uint256 agentId) internal view returns (address owner) {
        owner = identityRegistry.ownerOf(agentId);
        if (owner == address(0)) revert AgentDoesNotExist(agentId);
    }

    function _syncVerification(uint256 agentId, address agentOwner, uint256 currentTokenId) internal returns (uint256 tokenId) {
        tokenId = currentTokenId;

        if (tokenId == 0) {
            tokenId = _nextTokenId++;
            _mint(agentOwner, tokenId);
        } else {
            address tokenOwner = _ownerOf(tokenId);
            if (tokenOwner == address(0) || tokenOwner != agentOwner) {
                if (tokenOwner != address(0)) {
                    _burn(tokenId);
                    _tokenAgents[tokenId] = 0;
                }
                tokenId = _nextTokenId++;
                _mint(agentOwner, tokenId);
            }
        }

        _tokenAgents[tokenId] = agentId;
    }

    function _verificationBoundToCurrentOwner(uint256 agentId, uint256 tokenId) internal view returns (bool) {
        if (tokenId == 0) {
            return false;
        }

        address tokenOwner = _ownerOf(tokenId);
        if (tokenOwner == address(0)) {
            return false;
        }

        try identityRegistry.ownerOf(agentId) returns (address agentOwner) {
            return tokenOwner == agentOwner;
        } catch {
            return false;
        }
    }

    function _verificationState(uint256 agentId, Verification storage v)
        internal
        view
        returns (bool active, string memory status)
    {
        if (!v.verified) {
            return (false, "revoked");
        }
        if (block.timestamp > v.expiresAt) {
            return (false, "expired");
        }
        if (!_verificationBoundToCurrentOwner(agentId, v.tokenId)) {
            return (false, "stale-owner");
        }
        return (true, "active");
    }

    function _findAgentIdByTokenId(uint256 tokenId) internal view returns (uint256 agentId) {
        uint256 totalAgents = identityRegistry.agentCount();
        for (uint256 i = 1; i <= totalAgents; i++) {
            if (_verifications[i].tokenId == tokenId) {
                return i;
            }
        }
    }

    // ── Required Overrides ───────────────────────────────

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
