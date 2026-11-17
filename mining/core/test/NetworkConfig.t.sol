// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {Test} from "forge-std/Test.sol";
import {NetworkConfig} from "../script/NetworkConfig.s.sol";

contract NetworkConfigHarness is NetworkConfig {
    function settings(string memory name, string memory rpc) external view returns (uint256, string memory) {
        return _settingsFor(name, rpc);
    }
}

contract NetworkConfigTest is Test {
    NetworkConfigHarness harness;

    function setUp() public {
        harness = new NetworkConfigHarness();
    }

    function testUsesNamedBscPreset() public {
        (uint256 id, string memory rpc) = harness.settings("bsc", "");
        assertEq(id, 56);
        assertEq(rpc, "https://56.rpc.thirdweb.com");
    }

    function testUsesLocalPresetWithoutRpcEnv() public {
        (uint256 id, string memory rpc) = harness.settings("anvil", "");
        assertEq(id, 31337);
        assertEq(rpc, "http://127.0.0.1:8545");
    }

    function testAllowsRpcOverrideWithoutChangingChainId() public {
        (uint256 id, string memory rpc) = harness.settings("bscTestnet", "http://localhost:18545");
        assertEq(id, 97);
        assertEq(rpc, "http://localhost:18545");
    }

    function testRejectsMissingOrUnknownNetwork() public {
        vm.expectRevert("CHAIN_NETWORK is required");
        harness.settings("", "");
        vm.expectRevert("Unknown CHAIN_NETWORK; update network presets and sync");
        harness.settings("typo", "");
    }
}
