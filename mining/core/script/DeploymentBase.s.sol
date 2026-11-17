// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {NetworkConfig} from "./NetworkConfig.s.sol";
import {NodeMembership} from "../src/NodeMembership.sol";

abstract contract DeploymentBase is NetworkConfig {
    struct NodeConfig {
        address treasury;
        string[4] names;
        uint256[4] prices;
        bool[4] enabled;
        bool paused;
    }

    function _loadNodeConfig() internal view returns (NodeConfig memory config) {
        config.treasury = vm.envAddress("NODE_TREASURY_ADDRESS");
        string[4] memory defaultNames = [string("Starter"), "Core", "Elite", "Prime"];
        uint256[4] memory defaultPrices = [uint256(100 ether), 500 ether, 1000 ether, 2000 ether];
        for (uint256 i; i < 4; ++i) {
            string memory prefix = string.concat("NODE_LEVEL_", vm.toString(i + 1));
            config.names[i] = vm.envOr(string.concat(prefix, "_NAME"), defaultNames[i]);
            config.prices[i] = vm.envOr(string.concat(prefix, "_PRICE_WEI"), defaultPrices[i]);
            config.enabled[i] = vm.envOr(string.concat(prefix, "_ENABLED"), true);
        }
        config.paused = vm.envOr("NODE_PURCHASE_PAUSED", false);
    }

    function _validateNodeConfig(NodeConfig memory config) internal pure {
        require(config.treasury != address(0), "NODE_TREASURY_ADDRESS is zero");
        for (uint256 i; i < 4; ++i) {
            require(bytes(config.names[i]).length > 0, "Node level name is empty");
            require(config.prices[i] > 0, "Node level price is zero");
            if (i > 0) require(config.prices[i] > config.prices[i - 1], "Node prices must increase");
        }
    }

    function _deployNode(address usdt, address signer, address mining, NodeConfig memory config)
        internal
        returns (NodeMembership node)
    {
        node = new NodeMembership(usdt, config.treasury, signer, mining);
        for (uint256 i; i < 4; ++i) {
            node.createLevel(config.names[i], config.prices[i], config.enabled[i]);
        }
        if (config.paused) node.setPurchasePaused(true);
    }
}
