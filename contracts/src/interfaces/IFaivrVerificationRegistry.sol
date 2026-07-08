// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/// @title IFaivrVerificationRegistry
/// @notice Interface for agent domain/Twitter verification with soulbound NFTs
interface IFaivrVerificationRegistry {
    // ── Enums ────────────────────────────────────────────
    enum VerificationMethod { DNS, FILE, TWITTER }

    // ── Structs ──────────────────────────────────────────
    struct Verification {
        string domain;
        VerificationMethod method;
        uint256 verifiedAt;
        uint256 expiresAt;
        bool verified;
        uint256 tokenId; // soulbound NFT token id (0 if none)
    }

    // ── Events ───────────────────────────────────────────
    event AgentVerified(uint256 indexed agentId, string domain, VerificationMethod method, uint256 tokenId);
    event VerificationRevoked(uint256 indexed agentId);
    event ExpiryPeriodUpdated(uint256 newPeriod);

    // ── Errors ───────────────────────────────────────────
    error AgentDoesNotExist(uint256 agentId);
    error NotVerifier();
    error VerificationNotFound(uint256 agentId);
    error SoulboundTransferBlocked();
    error ZeroAddress();

    // ── Functions ────────────────────────────────────────
    function verify(uint256 agentId, string calldata domain, VerificationMethod method) external;
    function revoke(uint256 agentId) external;
    function syncVerification(uint256 agentId) external returns (uint256 tokenId);
    function isVerified(uint256 agentId) external view returns (bool);
    function getVerification(uint256 agentId) external view returns (Verification memory);
    function setExpiryPeriod(uint256 newPeriod) external;
}
