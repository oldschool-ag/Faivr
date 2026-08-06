// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

interface IIdentityOwnerRegistration {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

/// @notice Owner-signed bulk registration for agents minted directly by the controlling wallet.
/// @dev Broadcast with the private key for the intended owner address. No registrar role required.
contract OwnerRegisterAgents is Script {
    using stdJson for string;

    address internal constant IDENTITY = 0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6;

    struct AgentRecord {
        string name;
        string description;
        string targetBuyer;
        string deliverable;
        string category;
        string mcpEndpoint;
        string a2aEndpoint;
        string domain;
    }

    function run() external {
        string memory inventoryPath = vm.envString("INVENTORY_PATH");
        string memory json = vm.readFile(inventoryPath);
        string memory pricingMode = json.readString(".pricing.mode");
        string memory pricingAmount = json.readString(".pricing.amount");
        string memory pricingToken = json.readString(".pricing.token");
        string memory billingPeriod = json.readString(".pricing.billingPeriod");
        bytes memory raw = json.parseRaw(".agents");
        AgentRecord[] memory agents = abi.decode(raw, (AgentRecord[]));

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address expectedOwner = vm.parseAddress(json.readString(".ownerAddress"));
        require(deployer == expectedOwner, "PRIVATE_KEY does not match inventory ownerAddress");

        vm.startBroadcast(deployerKey);
        for (uint256 i; i < agents.length; i++) {
            string memory agentURI =
                _buildAgentURI(agents[i], json.readString(".ownerAddress"), pricingMode, pricingAmount, pricingToken, billingPeriod);
            uint256 agentId = IIdentityOwnerRegistration(IDENTITY).register(agentURI);
            console2.log("Registered agent", agents[i].name, "with id", agentId);
        }
        vm.stopBroadcast();
    }

    function _buildAgentURI(
        AgentRecord memory agent,
        string memory ownerString,
        string memory pricingMode,
        string memory pricingAmount,
        string memory pricingToken,
        string memory billingPeriod
    ) internal pure returns (string memory) {
        return string.concat(
            "{",
            '"name":"', _escape(agent.name), '",',
            '"description":"', _escape(agent.description), '",',
            '"targetBuyer":"', _escape(agent.targetBuyer), '",',
            '"category":"', _escape(agent.category), '",',
            '"pricingMode":"', _escape(pricingMode), '",',
            '"primaryToken":"', _escape(pricingToken), '",',
            '"fixedPriceAmount":"', _escape(pricingAmount), '",',
            '"billingPeriod":"', _escape(billingPeriod), '",',
            '"deliveryDescription":"', _escape(agent.deliverable), '",',
            '"ownerAddress":"', _escape(ownerString), '",',
            '"domain":"', _escape(agent.domain), '",',
            '"mcpEndpoint":"', _escape(agent.mcpEndpoint), '",',
            '"a2aEndpoint":"', _escape(agent.a2aEndpoint), '"',
            "}"
        );
    }

    function _escape(string memory value) internal pure returns (string memory) {
        bytes memory source = bytes(value);
        bytes memory out = new bytes(source.length * 2 + 16);
        uint256 j = 0;

        for (uint256 i = 0; i < source.length; i++) {
            bytes1 char = source[i];
            if (char == bytes1(uint8(0x22)) || char == bytes1(uint8(0x5c))) {
                out[j++] = bytes1(uint8(0x5c));
                out[j++] = char;
                continue;
            }

            if (char == bytes1(uint8(0x0a))) {
                out[j++] = bytes1(uint8(0x5c));
                out[j++] = bytes1("n");
                continue;
            }

            if (char == bytes1(uint8(0x0d))) {
                out[j++] = bytes1(uint8(0x5c));
                out[j++] = bytes1("r");
                continue;
            }

            if (char == bytes1(uint8(0x09))) {
                out[j++] = bytes1(uint8(0x5c));
                out[j++] = bytes1("t");
                continue;
            }

            out[j++] = char;
        }

        bytes memory trimmed = new bytes(j);
        for (uint256 i = 0; i < j; i++) {
            trimmed[i] = out[i];
        }
        return string(trimmed);
    }
}
