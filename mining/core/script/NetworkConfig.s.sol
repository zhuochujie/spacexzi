// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {Script} from "forge-std/Script.sol";

abstract contract NetworkConfig is Script {
    function _networkSettings() internal view returns (uint256 chainId, string memory rpc) {
        return _settingsFor(vm.envString("CHAIN_NETWORK"), vm.envOr("CHAIN_RPC_URL", string("")));
    }

    function _settingsFor(string memory name, string memory rpcOverride)
        internal
        view
        returns (uint256 chainId, string memory rpc)
    {
        require(bytes(name).length > 0, "CHAIN_NETWORK is required");
        string memory json = vm.readFile("config/networks.json");
        string memory key = string.concat(".", name);
        require(vm.keyExistsJson(json, key), "Unknown CHAIN_NETWORK; update network presets and sync");
        chainId = vm.parseJsonUint(json, string.concat(key, ".id"));
        rpc = rpcOverride;
        if (bytes(rpc).length == 0) rpc = vm.parseJsonString(json, string.concat(key, ".rpcUrl"));
    }

    function _configuredChainId() internal view returns (uint256 chainId) {
        (chainId,) = _networkSettings();
    }

    function _selectConfiguredNetwork() internal {
        (uint256 chainId, string memory rpc) = _networkSettings();
        vm.createSelectFork(rpc);
        require(block.chainid == chainId, "Configured network does not match RPC chain");
    }
}
