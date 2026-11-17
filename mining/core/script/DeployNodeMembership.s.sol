// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NodeMembership} from "../src/NodeMembership.sol";
import {DeploymentBase} from "./DeploymentBase.s.sol";

/// @notice Optional standalone node deployment, using the same settings as DeployScript.
contract DeployNodeMembershipScript is DeploymentBase {
    function run() external returns (NodeMembership node) {
        _selectConfiguredNetwork();
        uint256 key = vm.envUint("PRIVATE_KEY");
        address usdt = vm.envAddress("USDT_TOKEN_ADDRESS");
        address mining = vm.envAddress("MINING_CONTRACT_ADDRESS");
        address signer = vm.envAddress("SIGNER_ADDRESS");
        address owner = vm.envOr("OWNER_ADDRESS", vm.addr(key));
        NodeConfig memory config = _loadNodeConfig();
        require(_configuredChainId() == block.chainid, "Wrong chain");
        require(usdt.code.length > 0 && IERC20Metadata(usdt).decimals() == 18, "Invalid 18-decimal USDT");
        require(signer != address(0) && owner != address(0), "Invalid signer/owner");
        _validateNodeConfig(config);
        vm.startBroadcast(key);
        node = _deployNode(usdt, signer, mining, config);
        if (owner != vm.addr(key)) node.transferOwnership(owner);
        vm.stopBroadcast();
        console2.log("nodeMembership", address(node));
    }
}
