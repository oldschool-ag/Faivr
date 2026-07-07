// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IAccessControlRead {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @notice Read-only helper for Safe/admin migration preparation.
/// @dev This script never calls startBroadcast and never requires a private key.
contract AdminRoleReadiness is Script {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 internal constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 internal constant FEEDBACK_ROUTER_ROLE = keccak256("FEEDBACK_ROUTER_ROLE");
    bytes32 internal constant SETTLEMENT_SOURCE_ROLE = keccak256("SETTLEMENT_SOURCE_ROLE");
    bytes32 internal constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 internal constant ROUTER_ROLE = keccak256("ROUTER_ROLE");
    bytes32 internal constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ERC1967_ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    address internal constant IDENTITY = 0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6;
    address internal constant REPUTATION = 0x00280bc9cFF156a8E8E9aE7c54029B74902a829c;
    address internal constant VALIDATION = 0x95DF02B02e2D777E0fcB80F83c061500C112F05b;
    address internal constant FEE_MODULE = 0xD68D402Bb450A79D8e639e41F0455990A223E47F;
    address internal constant ROUTER = 0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa;
    address internal constant VERIFICATION = 0x6654FA7d6eE8A0f6641a5535AeE346115f06e161;

    struct CandidateSet {
        address currentAdmin;
        address targetSafe;
        address extraCandidate;
    }

    function run() external view {
        CandidateSet memory candidates = CandidateSet({
            currentAdmin: vm.envOr("CURRENT_ADMIN", address(0)),
            targetSafe: vm.envOr("TARGET_SAFE", address(0)),
            extraCandidate: vm.envOr("EXTRA_CANDIDATE", address(0))
        });

        console2.log("FAIVR admin role readiness report");
        console2.log("No broadcast is performed by this script.");
        console2.log("");
        _printCandidate("CURRENT_ADMIN", candidates.currentAdmin);
        _printCandidate("TARGET_SAFE", candidates.targetSafe);
        _printCandidate("EXTRA_CANDIDATE", candidates.extraCandidate);
        console2.log("");

        _reportContract("Identity", IDENTITY, candidates);
        _reportRole("Identity", IDENTITY, "REGISTRAR_ROLE", REGISTRAR_ROLE, candidates);

        _reportContract("Reputation", REPUTATION, candidates);
        _reportRole("Reputation", REPUTATION, "FEEDBACK_ROUTER_ROLE", FEEDBACK_ROUTER_ROLE, candidates);
        _reportRole("Reputation", REPUTATION, "SETTLEMENT_SOURCE_ROLE", SETTLEMENT_SOURCE_ROLE, candidates);

        _reportContract("Validation", VALIDATION, candidates);

        _reportContract("FeeModule", FEE_MODULE, candidates);
        _reportRole("FeeModule", FEE_MODULE, "FEE_MANAGER_ROLE", FEE_MANAGER_ROLE, candidates);
        _reportRole("FeeModule", FEE_MODULE, "PAUSER_ROLE", PAUSER_ROLE, candidates);
        _reportRole("FeeModule", FEE_MODULE, "ROUTER_ROLE", ROUTER_ROLE, candidates);

        _reportContract("Router", ROUTER, candidates);

        _reportContract("Verification", VERIFICATION, candidates);
        _reportRole("Verification", VERIFICATION, "VERIFIER_ROLE", VERIFIER_ROLE, candidates);

        console2.log("");
        console2.log("Prepared migration sequence model:");
        console2.log("1. For every relevant role still held by CURRENT_ADMIN, grant the same role to TARGET_SAFE.");
        console2.log("2. Verify TARGET_SAFE has each role onchain.");
        console2.log("3. Only after verification, revoke each role from CURRENT_ADMIN.");
        console2.log("4. Re-run this script and archive the report with the release notes.");
    }

    function _reportContract(string memory label, address proxy, CandidateSet memory candidates) internal view {
        console2.log("");
        console2.log(label);
        console2.log("Proxy:");
        console2.log(proxy);
        console2.log("Implementation:");
        console2.log(_readAddressSlot(proxy, ERC1967_IMPLEMENTATION_SLOT));
        console2.log("ERC1967 admin slot:");
        console2.log(_readAddressSlot(proxy, ERC1967_ADMIN_SLOT));
        _reportRole(label, proxy, "DEFAULT_ADMIN_ROLE", DEFAULT_ADMIN_ROLE, candidates);
    }

    function _reportRole(
        string memory contractLabel,
        address target,
        string memory roleLabel,
        bytes32 role,
        CandidateSet memory candidates
    ) internal view {
        console2.log("");
        console2.log(contractLabel);
        console2.log(roleLabel);
        console2.logBytes32(role);
        _printRoleHolder("CURRENT_ADMIN", target, role, candidates.currentAdmin);
        _printRoleHolder("TARGET_SAFE", target, role, candidates.targetSafe);
        _printRoleHolder("EXTRA_CANDIDATE", target, role, candidates.extraCandidate);

        if (candidates.currentAdmin != address(0) && candidates.targetSafe != address(0)) {
            console2.log("Preparation:");
            console2.log("  grantRole(role, TARGET_SAFE), then verify, then revokeRole(role, CURRENT_ADMIN)");
        }
    }

    function _printRoleHolder(string memory label, address target, bytes32 role, address candidate) internal view {
        if (candidate == address(0)) {
            console2.log(label);
            console2.log("  unset");
            return;
        }

        bool hasRole = IAccessControlRead(target).hasRole(role, candidate);
        console2.log(label);
        console2.log(candidate);
        console2.log(hasRole ? "  has role" : "  does not have role");
    }

    function _printCandidate(string memory label, address candidate) internal pure {
        console2.log(label);
        console2.log(candidate);
    }

    function _readAddressSlot(address target, bytes32 slot) internal view returns (address) {
        bytes32 value = vm.load(target, slot);
        return address(uint160(uint256(value)));
    }
}
