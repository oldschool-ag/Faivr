// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {IFaivrReputationRegistry} from "./interfaces/IFaivrReputationRegistry.sol";

interface IFaivrReputationIdentityRegistry is IERC721 {
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @title FaivrReputationRegistry
/// @notice ERC-8004 compliant reputation registry
contract FaivrReputationRegistry is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    IFaivrReputationRegistry
{
    // ── Roles ────────────────────────────────────────────
    bytes32 public constant FEEDBACK_ROUTER_ROLE = keccak256("FEEDBACK_ROUTER_ROLE");
    bytes32 public constant SETTLEMENT_SOURCE_ROLE = keccak256("SETTLEMENT_SOURCE_ROLE");
    uint8 private constant SUMMARY_DECIMALS = 18;

    // ── Structs (internal storage) ───────────────────────
    struct FeedbackEntry {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    // ── Storage ──────────────────────────────────────────
    address private _identityRegistry;

    /// @dev agentId => clientAddress => feedbackIndex => FeedbackEntry
    /// feedbackIndex is 1-based
    mapping(uint256 => mapping(address => mapping(uint64 => FeedbackEntry))) private _feedback;

    /// @dev agentId => clientAddress => lastFeedbackIndex
    mapping(uint256 => mapping(address => uint64)) private _lastIndex;

    /// @dev agentId => list of unique client addresses
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _isClient;

    /// @dev agentId => clientAddress => feedbackIndex => responder => responseCount
    mapping(uint256 => mapping(address => mapping(uint64 => mapping(address => uint64)))) private _responseCounts;

    /// @dev agentId => clientAddress => number of settled tasks still eligible for feedback
    mapping(uint256 => mapping(address => uint256)) private _pendingFeedbackCredits;

    /// @dev taskId => whether settlement was already recorded for feedback provenance
    mapping(uint256 => bool) private _recordedTaskSettlements;

    /// @custom:storage-gap
    uint256[48] private __gap;

    // ── Initializer ──────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address identityRegistry_) external override initializer {
        if (admin == address(0)) revert ZeroAddress();
        if (identityRegistry_ == address(0)) revert ZeroAddress();

        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _identityRegistry = identityRegistry_;
    }

    // ── Views ────────────────────────────────────────────

    function getIdentityRegistry() external view override returns (address) {
        return _identityRegistry;
    }

    function pendingFeedbackCredits(uint256 agentId, address clientAddress) external view override returns (uint256) {
        return _pendingFeedbackCredits[agentId][clientAddress];
    }

    // ── Core ─────────────────────────────────────────────

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external override {
        _giveFeedback(msg.sender, agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function giveFeedbackFor(
        address clientAddress,
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external override onlyRole(FEEDBACK_ROUTER_ROLE) {
        if (clientAddress == address(0)) revert ZeroAddress();
        _giveFeedback(clientAddress, agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function recordTaskSettlement(uint256 taskId, uint256 agentId, address clientAddress) external override onlyRole(SETTLEMENT_SOURCE_ROLE) {
        if (clientAddress == address(0)) revert ZeroAddress();
        if (_recordedTaskSettlements[taskId]) revert TaskSettlementAlreadyRecorded(taskId);

        _requireAgentExists(agentId);

        _recordedTaskSettlements[taskId] = true;
        _pendingFeedbackCredits[agentId][clientAddress]++;

        emit TaskSettlementRecorded(taskId, agentId, clientAddress);
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external override {
        FeedbackEntry storage entry = _feedback[agentId][msg.sender][feedbackIndex];
        if (feedbackIndex == 0 || feedbackIndex > _lastIndex[agentId][msg.sender]) {
            revert FeedbackNotFound(agentId, msg.sender, feedbackIndex);
        }
        if (entry.isRevoked) revert FeedbackAlreadyRevoked(agentId, msg.sender, feedbackIndex);

        entry.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external override {
        if (feedbackIndex == 0 || feedbackIndex > _lastIndex[agentId][clientAddress]) {
            revert FeedbackNotFound(agentId, clientAddress, feedbackIndex);
        }

        // H-03: Only agent owner/operator or the feedback author may respond
        address agentOwner = IERC721(_identityRegistry).ownerOf(agentId);
        bool isAgentOwnerOrOperator = (msg.sender == agentOwner)
            || IERC721(_identityRegistry).isApprovedForAll(agentOwner, msg.sender)
            || (IERC721(_identityRegistry).getApproved(agentId) == msg.sender);
        bool isFeedbackAuthor = (msg.sender == clientAddress);
        if (!isAgentOwnerOrOperator && !isFeedbackAuthor) revert NotFeedbackOwner();

        _responseCounts[agentId][clientAddress][feedbackIndex][msg.sender]++;

        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

    // ── Read ─────────────────────────────────────────────

    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view override returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        if (clientAddresses.length == 0) revert EmptyClientAddresses();

        bytes32 tag1Hash = bytes(tag1).length > 0 ? keccak256(bytes(tag1)) : bytes32(0);
        bytes32 tag2Hash = bytes(tag2).length > 0 ? keccak256(bytes(tag2)) : bytes32(0);

        int256 total;
        for (uint256 i; i < clientAddresses.length; i++) {
            address client = clientAddresses[i];
            uint64 lastIdx = _lastIndex[agentId][client];
            for (uint64 j = 1; j <= lastIdx; j++) {
                FeedbackEntry storage entry = _feedback[agentId][client][j];
                if (entry.isRevoked) continue;
                if (tag1Hash != bytes32(0) && keccak256(bytes(entry.tag1)) != tag1Hash) continue;
                if (tag2Hash != bytes32(0) && keccak256(bytes(entry.tag2)) != tag2Hash) continue;
                total += _normalizeSummaryValue(entry.value, entry.valueDecimals);
                count++;
            }
        }

        (summaryValue, summaryValueDecimals) = _finalizeSummary(total, count);
    }

    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view override returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked) {
        if (feedbackIndex == 0 || feedbackIndex > _lastIndex[agentId][clientAddress]) {
            revert FeedbackNotFound(agentId, clientAddress, feedbackIndex);
        }
        FeedbackEntry storage entry = _feedback[agentId][clientAddress][feedbackIndex];
        return (entry.value, entry.valueDecimals, entry.tag1, entry.tag2, entry.isRevoked);
    }

    function readAllFeedback(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2,
        bool includeRevoked
    ) external view override returns (
        address[] memory clients,
        uint64[] memory feedbackIndexes,
        int128[] memory values,
        uint8[] memory valueDecimals_,
        string[] memory tag1s,
        string[] memory tag2s,
        bool[] memory revokedStatuses
    ) {
        bytes32 tag1Hash = bytes(tag1).length > 0 ? keccak256(bytes(tag1)) : bytes32(0);
        bytes32 tag2Hash = bytes(tag2).length > 0 ? keccak256(bytes(tag2)) : bytes32(0);

        // Use provided clients or all clients
        address[] memory searchClients;
        if (clientAddresses.length > 0) {
            searchClients = clientAddresses;
        } else {
            searchClients = _clients[agentId];
        }

        // First pass: count
        uint256 totalCount;
        for (uint256 i; i < searchClients.length; i++) {
            uint64 lastIdx = _lastIndex[agentId][searchClients[i]];
            for (uint64 j = 1; j <= lastIdx; j++) {
                FeedbackEntry storage entry = _feedback[agentId][searchClients[i]][j];
                if (!includeRevoked && entry.isRevoked) continue;
                if (tag1Hash != bytes32(0) && keccak256(bytes(entry.tag1)) != tag1Hash) continue;
                if (tag2Hash != bytes32(0) && keccak256(bytes(entry.tag2)) != tag2Hash) continue;
                totalCount++;
            }
        }

        // Allocate
        clients = new address[](totalCount);
        feedbackIndexes = new uint64[](totalCount);
        values = new int128[](totalCount);
        valueDecimals_ = new uint8[](totalCount);
        tag1s = new string[](totalCount);
        tag2s = new string[](totalCount);
        revokedStatuses = new bool[](totalCount);

        // Second pass: fill
        uint256 idx;
        for (uint256 i; i < searchClients.length; i++) {
            uint64 lastIdx = _lastIndex[agentId][searchClients[i]];
            for (uint64 j = 1; j <= lastIdx; j++) {
                FeedbackEntry storage entry = _feedback[agentId][searchClients[i]][j];
                if (!includeRevoked && entry.isRevoked) continue;
                if (tag1Hash != bytes32(0) && keccak256(bytes(entry.tag1)) != tag1Hash) continue;
                if (tag2Hash != bytes32(0) && keccak256(bytes(entry.tag2)) != tag2Hash) continue;
                clients[idx] = searchClients[i];
                feedbackIndexes[idx] = j;
                values[idx] = entry.value;
                valueDecimals_[idx] = entry.valueDecimals;
                tag1s[idx] = entry.tag1;
                tag2s[idx] = entry.tag2;
                revokedStatuses[idx] = entry.isRevoked;
                idx++;
            }
        }
    }

    function getSummaryPaginated(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2,
        uint256 offset,
        uint256 limit
    ) external view override returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        if (clientAddresses.length == 0) revert EmptyClientAddresses();

        PaginatedReadParams memory p = PaginatedReadParams({
            agentId: agentId,
            includeRevoked: false,
            tag1Hash: bytes(tag1).length > 0 ? keccak256(bytes(tag1)) : bytes32(0),
            tag2Hash: bytes(tag2).length > 0 ? keccak256(bytes(tag2)) : bytes32(0),
            offset: offset,
            limit: limit
        });

        int256 total;
        uint256 seen;
        uint256 collected;
        for (uint256 i; i < clientAddresses.length && collected < p.limit; i++) {
            uint64 lastIdx = _lastIndex[p.agentId][clientAddresses[i]];
            for (uint64 j = 1; j <= lastIdx && collected < p.limit; j++) {
                FeedbackEntry storage entry = _feedback[p.agentId][clientAddresses[i]][j];
                if (entry.isRevoked) continue;
                if (p.tag1Hash != bytes32(0) && keccak256(bytes(entry.tag1)) != p.tag1Hash) continue;
                if (p.tag2Hash != bytes32(0) && keccak256(bytes(entry.tag2)) != p.tag2Hash) continue;
                if (seen >= p.offset) {
                    total += _normalizeSummaryValue(entry.value, entry.valueDecimals);
                    count++;
                    collected++;
                }
                seen++;
            }
        }

        (summaryValue, summaryValueDecimals) = _finalizeSummary(total, count);
    }

    /// @dev Parameters for paginated feedback reading (avoids stack-too-deep)
    struct PaginatedReadParams {
        uint256 agentId;
        bool includeRevoked;
        bytes32 tag1Hash;
        bytes32 tag2Hash;
        uint256 offset;
        uint256 limit;
    }

    function readAllFeedbackPaginated(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2,
        bool includeRevoked,
        uint256 offset,
        uint256 limit
    ) external view override returns (
        address[] memory clients,
        uint64[] memory feedbackIndexes,
        int128[] memory values,
        uint8[] memory valueDecimals_,
        string[] memory tag1s,
        string[] memory tag2s,
        bool[] memory revokedStatuses
    ) {
        PaginatedReadParams memory p = PaginatedReadParams({
            agentId: agentId,
            includeRevoked: includeRevoked,
            tag1Hash: bytes(tag1).length > 0 ? keccak256(bytes(tag1)) : bytes32(0),
            tag2Hash: bytes(tag2).length > 0 ? keccak256(bytes(tag2)) : bytes32(0),
            offset: offset,
            limit: limit
        });

        address[] memory searchClients;
        if (clientAddresses.length > 0) {
            searchClients = clientAddresses;
        } else {
            searchClients = _clients[agentId];
        }

        // Allocate max-size arrays in struct
        FeedbackArrays memory out;
        out.clients = new address[](limit);
        out.feedbackIndexes = new uint64[](limit);
        out.values = new int128[](limit);
        out.valueDecimals_ = new uint8[](limit);
        out.tag1s = new string[](limit);
        out.tag2s = new string[](limit);
        out.revokedStatuses = new bool[](limit);

        uint256 collected = _fillPaginatedFeedback(p, searchClients, out);

        clients = out.clients;
        feedbackIndexes = out.feedbackIndexes;
        values = out.values;
        valueDecimals_ = out.valueDecimals_;
        tag1s = out.tag1s;
        tag2s = out.tag2s;
        revokedStatuses = out.revokedStatuses;

        // Trim arrays to actual size
        assembly {
            mstore(clients, collected)
            mstore(feedbackIndexes, collected)
            mstore(values, collected)
            mstore(valueDecimals_, collected)
            mstore(tag1s, collected)
            mstore(tag2s, collected)
            mstore(revokedStatuses, collected)
        }
    }

    /// @dev Output struct for paginated feedback (avoids stack-too-deep)
    struct FeedbackArrays {
        address[] clients;
        uint64[] feedbackIndexes;
        int128[] values;
        uint8[] valueDecimals_;
        string[] tag1s;
        string[] tag2s;
        bool[] revokedStatuses;
    }

    function _fillPaginatedFeedback(
        PaginatedReadParams memory p,
        address[] memory searchClients,
        FeedbackArrays memory out
    ) private view returns (uint256 collected) {
        uint256 seen;
        for (uint256 i; i < searchClients.length && collected < p.limit; i++) {
            uint64 lastIdx = _lastIndex[p.agentId][searchClients[i]];
            for (uint64 j = 1; j <= lastIdx && collected < p.limit; j++) {
                FeedbackEntry storage entry = _feedback[p.agentId][searchClients[i]][j];
                if (!p.includeRevoked && entry.isRevoked) continue;
                if (p.tag1Hash != bytes32(0) && keccak256(bytes(entry.tag1)) != p.tag1Hash) continue;
                if (p.tag2Hash != bytes32(0) && keccak256(bytes(entry.tag2)) != p.tag2Hash) continue;
                if (seen >= p.offset) {
                    out.clients[collected] = searchClients[i];
                    out.feedbackIndexes[collected] = j;
                    out.values[collected] = entry.value;
                    out.valueDecimals_[collected] = entry.valueDecimals;
                    out.tag1s[collected] = entry.tag1;
                    out.tag2s[collected] = entry.tag2;
                    out.revokedStatuses[collected] = entry.isRevoked;
                    collected++;
                }
                seen++;
            }
        }
    }

    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view override returns (uint64 count) {
        if (responders.length == 0) {
            // No filter — not feasible to enumerate all responders, return 0
            return 0;
        }
        for (uint256 i; i < responders.length; i++) {
            count += _responseCounts[agentId][clientAddress][feedbackIndex][responders[i]];
        }
    }

    function getClients(uint256 agentId) external view override returns (address[] memory) {
        return _clients[agentId];
    }

    function getLastIndex(uint256 agentId, address clientAddress) external view override returns (uint64) {
        return _lastIndex[agentId][clientAddress];
    }

    // ── Internal ─────────────────────────────────────────

    function _normalizeSummaryValue(int128 value, uint8 valueDecimals) private pure returns (int256) {
        return int256(value) * int256(10 ** uint256(SUMMARY_DECIMALS - valueDecimals));
    }

    function _finalizeSummary(int256 total, uint64 count) private pure returns (int128 summaryValue, uint8 summaryValueDecimals) {
        if (count == 0) {
            return (0, 0);
        }

        int256 avg = total / int256(uint256(count));
        summaryValueDecimals = SUMMARY_DECIMALS;
        while (summaryValueDecimals > 0 && avg % 10 == 0) {
            avg /= 10;
            summaryValueDecimals--;
        }

        require(avg >= type(int128).min && avg <= type(int128).max, "SafeCast: int128 overflow");
        summaryValue = int128(avg);
    }

    function _giveFeedback(
        address clientAddress,
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        string memory endpoint,
        string memory feedbackURI,
        bytes32 feedbackHash
    ) internal {
        if (valueDecimals > 18) revert InvalidValueDecimals(valueDecimals);

        // Verify agent exists
        _requireAgentExists(agentId);
        _consumeFeedbackCredit(agentId, clientAddress);

        // Submitter must not be the agent owner, agent wallet, or approved operator.
        IFaivrReputationIdentityRegistry registry = IFaivrReputationIdentityRegistry(_identityRegistry);
        address agentOwner = registry.ownerOf(agentId);
        address agentWallet = registry.getAgentWallet(agentId);
        if (clientAddress == agentOwner) revert SelfFeedbackNotAllowed();
        if (agentWallet != address(0) && clientAddress == agentWallet) revert SelfFeedbackNotAllowed();
        if (registry.isApprovedForAll(agentOwner, clientAddress)) revert SelfFeedbackNotAllowed();
        if (registry.getApproved(agentId) == clientAddress) revert SelfFeedbackNotAllowed();

        // Track client
        if (!_isClient[agentId][clientAddress]) {
            _clients[agentId].push(clientAddress);
            _isClient[agentId][clientAddress] = true;
        }

        // Increment feedback index (1-based)
        uint64 feedbackIndex = _lastIndex[agentId][clientAddress] + 1;
        _lastIndex[agentId][clientAddress] = feedbackIndex;

        _feedback[agentId][clientAddress][feedbackIndex] = FeedbackEntry({
            value: value,
            valueDecimals: valueDecimals,
            tag1: tag1,
            tag2: tag2,
            isRevoked: false
        });

        emit NewFeedback(agentId, clientAddress, feedbackIndex, value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function _consumeFeedbackCredit(uint256 agentId, address clientAddress) internal {
        uint256 credits = _pendingFeedbackCredits[agentId][clientAddress];
        if (credits == 0) revert FeedbackNotAuthorized(agentId, clientAddress);
        unchecked {
            _pendingFeedbackCredits[agentId][clientAddress] = credits - 1;
        }
    }

    function _requireAgentExists(uint256 agentId) internal view {
        // Check if agent exists by calling ownerOf — will revert if not minted
        IERC721(_identityRegistry).ownerOf(agentId);
    }

    // ── Upgrade ──────────────────────────────────────────
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
