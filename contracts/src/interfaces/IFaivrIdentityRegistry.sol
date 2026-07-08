// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/// @title IFaivrIdentityRegistry
/// @notice ERC-8004 compliant agent identity registry
interface IFaivrIdentityRegistry {
    // ── Structs ──────────────────────────────────────────
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    // ── Events (ERC-8004) ────────────────────────────────
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue);

    // ── Events (FAIVR extensions) ────────────────────────
    event AgentDeactivated(uint256 indexed agentId);
    event AgentReactivated(uint256 indexed agentId);

    // ── Errors ───────────────────────────────────────────
    error NotAgentOwner(uint256 agentId);
    error AgentNotActive(uint256 agentId);
    error AgentAlreadyActive(uint256 agentId);
    error ReservedMetadataKey(string key);
    error InvalidSignature();
    error SignatureExpired();
    error AgentDoesNotExist(uint256 agentId);
    error ZeroAddress();

    // ── ERC-8004 Registration ────────────────────────────
    function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);
    function register(string calldata agentURI) external returns (uint256 agentId);
    function register() external returns (uint256 agentId);
    function registerFor(address to, string calldata agentURI) external returns (uint256 agentId);

    // ── ERC-8004 URI ─────────────────────────────────────
    function setAgentURI(uint256 agentId, string calldata newURI) external;

    // ── ERC-8004 Metadata ────────────────────────────────
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory);
    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external;

    // ── ERC-8004 Agent Wallet ────────────────────────────
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function getAgentWallet(uint256 agentId) external view returns (address);
    function unsetAgentWallet(uint256 agentId) external;

    // ── FAIVR Extensions ─────────────────────────────────
    function deactivateAgent(uint256 agentId) external;
    function reactivateAgent(uint256 agentId) external;
    function isActive(uint256 agentId) external view returns (bool active);
    function agentCount() external view returns (uint256 count);
    function registeredAt(uint256 agentId) external view returns (uint256 timestamp);
}
