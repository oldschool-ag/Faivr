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

    struct Pricing {
        string mode;
        string amount;
        string token;
        string billingPeriod;
    }

    struct AgentRecord {
        string name;
        string description;
        string targetBuyer;
        string deliverable;
        string category;
        string mcpEndpoint;
        string a2aEndpoint;
        string domain;
        Pricing pricing;
    }

    function run() external {
        string memory inventoryPath = vm.envString("INVENTORY_PATH");
        string memory json = vm.readFile(inventoryPath);
        Pricing memory defaultPricing = Pricing({
            mode: json.readString(".pricing.mode"),
            amount: json.readString(".pricing.amount"),
            token: json.readString(".pricing.token"),
            billingPeriod: json.readString(".pricing.billingPeriod")
        });
        bytes memory raw = json.parseRaw(".agents");
        AgentRecord[] memory agents = abi.decode(raw, (AgentRecord[]));

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address expectedOwner = vm.parseAddress(json.readString(".ownerAddress"));
        require(deployer == expectedOwner, "PRIVATE_KEY does not match inventory ownerAddress");

        vm.startBroadcast(deployerKey);
        for (uint256 i; i < agents.length; i++) {
            string memory agentURI =
                _buildAgentURI(agents[i], json.readString(".ownerAddress"), _pricingForAgent(agents[i], defaultPricing));
            uint256 agentId = IIdentityOwnerRegistration(IDENTITY).register(agentURI);
            console2.log("Registered agent", agents[i].name, "with id", agentId);
        }
        vm.stopBroadcast();
    }

    function _pricingForAgent(AgentRecord memory agent, Pricing memory defaultPricing)
        internal
        pure
        returns (Pricing memory)
    {
        if (bytes(agent.pricing.mode).length == 0) {
            return defaultPricing;
        }

        if (bytes(agent.pricing.token).length == 0) {
            agent.pricing.token = defaultPricing.token;
        }

        return agent.pricing;
    }

    function _buildAgentURI(AgentRecord memory agent, string memory ownerString, Pricing memory pricing)
        internal
        pure
        returns (string memory)
    {
        bool includeFixedAmount = _containsIgnoreCase(pricing.mode, "fixed") && bytes(pricing.amount).length > 0;

        return string.concat(
            "{",
            '"name":"', _escape(agent.name), '",',
            '"description":"', _escape(agent.description), '",',
            '"targetBuyer":"', _escape(agent.targetBuyer), '",',
            '"category":"', _escape(agent.category), '",',
            '"pricingMode":"', _escape(pricing.mode), '",',
            '"primaryToken":"', _escape(pricing.token), '",',
            _pricingJsonFragment(pricing.billingPeriod, includeFixedAmount ? pricing.amount : ""),
            '"deliveryDescription":"', _escape(agent.deliverable), '",',
            '"ownerAddress":"', _escape(ownerString), '",',
            '"domain":"', _escape(agent.domain), '",',
            '"mcpEndpoint":"', _escape(agent.mcpEndpoint), '",',
            '"a2aEndpoint":"', _escape(agent.a2aEndpoint), '"',
            "}"
        );
    }

    function _pricingJsonFragment(string memory billingPeriod, string memory pricingAmount)
        internal
        pure
        returns (string memory)
    {
        if (bytes(pricingAmount).length > 0 && bytes(billingPeriod).length > 0) {
            return string.concat(
                '"fixedPriceAmount":"',
                _escape(pricingAmount),
                '",',
                '"billingPeriod":"',
                _escape(billingPeriod),
                '",'
            );
        }

        if (bytes(pricingAmount).length > 0) {
            return string.concat('"fixedPriceAmount":"', _escape(pricingAmount), '",');
        }

        if (bytes(billingPeriod).length > 0) {
            return string.concat('"billingPeriod":"', _escape(billingPeriod), '",');
        }

        return "";
    }

    function _containsIgnoreCase(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory source = bytes(haystack);
        bytes memory target = bytes(needle);

        if (target.length == 0 || target.length > source.length) {
            return false;
        }

        for (uint256 i; i <= source.length - target.length; i++) {
            bool matched = true;
            for (uint256 j; j < target.length; j++) {
                if (_lower(source[i + j]) != _lower(target[j])) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return true;
            }
        }

        return false;
    }

    function _lower(bytes1 char) internal pure returns (bytes1) {
        if (char >= 0x41 && char <= 0x5A) {
            return bytes1(uint8(char) + 32);
        }

        return char;
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
