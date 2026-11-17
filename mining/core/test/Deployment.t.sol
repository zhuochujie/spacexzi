// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DeployScript} from "../script/Deploy.s.sol";

contract DeploymentUsdt is ERC20 {
    constructor() ERC20("USDT", "USDT") {}
}

contract DeploymentUsdtSixDecimals is ERC20 {
    constructor() ERC20("USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract DeploymentHarness is DeployScript {
    function execute(DeployConfig memory config) external returns (Deployment memory) {
        _validateConfig(config);
        return _deploy(config);
    }

    function validate(DeployConfig memory config) external view {
        _validateConfig(config);
    }
}

contract DeploymentTest is Test {
    DeploymentHarness harness;
    DeploymentUsdt usdt;

    function setUp() public {
        harness = new DeploymentHarness();
        usdt = new DeploymentUsdt();
    }

    function config() internal view returns (DeployScript.DeployConfig memory c) {
        c.chainId = block.chainid;
        c.deployer = address(harness);
        c.owner = address(harness);
        c.signer = address(0x1111);
        c.marker = address(0x2222);
        c.usdtToken = address(usdt);
        c.usdtFeeReceiver = address(0x3333);
        c.minPrice = 0.7 ether;
        c.maxPrice = 0.8 ether;
        c.minOrderSpaceAmount = 1 ether;
        c.exchangeNodeFeeBps = 500;
        c.exchangeMarkerFeeBps = 500;
        c.freeMinerSpaceAmount = 50 ether;
        c.buybackFixedReceiver = address(0x5555);
        c.buybackBuyPrice = 1 ether;
        c.buybackSellPrice = 0.2 ether;
        c.node.treasury = address(0x4444);
        c.node.names = [string("Starter"), "Core", "Elite", "Prime"];
        c.node.prices = [uint256(100 ether), 500 ether, 1000 ether, 5000 ether];
        c.node.enabled = [true, true, true, true];
    }

    function testCompleteDeploymentConfiguresAllContracts() public {
        DeployScript.DeployConfig memory c = config();
        DeployScript.Deployment memory d = harness.execute(c);
        assertEq(d.spaceToken.totalSupply(), 1_000_000_000 ether);
        assertEq(d.spaceToken.balanceOf(address(d.vault)), d.spaceToken.totalSupply());
        assertEq(d.spaceToken.balanceOf(address(harness)), 0);
        assertEq(d.spaceToken.marketFeeReceiver(), c.marker);
        assertEq(d.spaceToken.nodeFeeReceiver(), address(d.nodeFeeVault));
        assertTrue(d.spaceToken.isWhitelisted(address(d.mining)));
        assertTrue(d.spaceToken.isWhitelisted(address(d.market)));
        assertTrue(d.spaceToken.isWhitelisted(address(d.vault)));
        assertTrue(d.spaceToken.isWhitelisted(address(d.nodeFeeVault)));
        assertTrue(d.spaceToken.isWhitelisted(address(d.vipFeeVault)));
        assertEq(d.mining.signer(), c.signer);
        assertEq(d.market.signer(), c.signer);
        assertEq(d.node.signer(), c.signer);
        assertEq(d.node.mining(), address(d.mining));
        assertEq(d.mining.vault(), address(d.vault));
        assertEq(d.mining.vipFeeReceiver(), address(d.vipFeeVault));
        assertEq(d.mining.nodeFeeReceiver(), address(d.nodeFeeVault));
        assertEq(d.mining.usdtFeeReceiver(), c.usdtFeeReceiver);
        assertEq(d.node.treasury(), c.node.treasury);
        assertEq(d.node.getAllLevels().length, 4);
        assertEq(d.node.getAllLevels()[3].price, 5000 ether);
        assertFalse(d.buybackPool.paused());
        assertEq(d.mining.buybackDividendVault(), address(d.buybackDividendVault));
        assertTrue(d.market.buybackSources(address(d.buybackPool)));
        assertFalse(d.node.purchasePaused());
    }

    function testAllocatesTwoMillionSpaceToBuybackPool() public {
        DeployScript.DeployConfig memory c = config();
        c.initialBuybackSpace = 2_000_000 ether;
        DeployScript.Deployment memory d = harness.execute(c);
        assertEq(d.spaceToken.balanceOf(address(d.buybackPool)), 2_000_000 ether);
        assertEq(d.spaceToken.balanceOf(address(d.vault)), 998_000_000 ether);
        assertEq(d.spaceToken.balanceOf(address(harness)), 0);
        assertEq(d.spaceToken.totalSupply(), 1_000_000_000 ether);
    }

    function testVaultAllowanceAllowsMiningToClaimFreeMiner() public {
        DeployScript.Deployment memory d = harness.execute(config());
        assertEq(d.spaceToken.allowance(address(d.vault), address(d.mining)), type(uint256).max);
        assertEq(d.spaceToken.allowance(address(d.nodeFeeVault), address(d.mining)), type(uint256).max);
        assertEq(d.spaceToken.allowance(address(d.vipFeeVault), address(d.mining)), type(uint256).max);
        assertEq(usdt.allowance(address(d.nodeFeeVault), address(d.mining)), type(uint256).max);
        vm.prank(address(0xBEEF));
        d.mining.claimFreeMiner();
        assertEq(d.spaceToken.balanceOf(address(d.mining)), 50 ether);
        assertEq(d.spaceToken.balanceOf(address(d.vault)), d.spaceToken.totalSupply() - 50 ether);
    }

    function testOwnershipTransfersAfterConfiguration() public {
        DeployScript.DeployConfig memory c = config();
        c.owner = address(0x9999);
        DeployScript.Deployment memory d = harness.execute(c);
        assertEq(d.spaceToken.owner(), c.owner);
        assertEq(d.vault.owner(), c.owner);
        assertEq(d.nodeFeeVault.owner(), c.owner);
        assertEq(d.vipFeeVault.owner(), c.owner);
        assertEq(d.mining.owner(), c.owner);
        assertEq(d.market.owner(), c.owner);
        assertEq(d.node.owner(), c.owner);
        assertEq(d.buybackPool.owner(), c.owner);
        assertEq(d.buybackDividendVault.owner(), c.owner);
        assertEq(d.spaceToken.allowance(address(d.vault), address(d.mining)), type(uint256).max);
    }

    function testOptionalPauseAndDisabledTierSettings() public {
        DeployScript.DeployConfig memory c = config();
        c.buybackPaused = true;
        c.node.paused = true;
        c.node.enabled[3] = false;
        DeployScript.Deployment memory d = harness.execute(c);
        assertTrue(d.buybackPool.paused());
        assertTrue(d.node.purchasePaused());
        assertFalse(d.node.getAllLevels()[3].enabled);
    }

    function testRejectsWrongChain() public {
        DeployScript.DeployConfig memory c = config();
        c.chainId += 1;
        vm.expectRevert("Configured network does not match RPC chain");
        harness.validate(c);
    }

    function testRejectsWrongUsdtDecimals() public {
        DeployScript.DeployConfig memory c = config();
        c.usdtToken = address(new DeploymentUsdtSixDecimals());
        vm.expectRevert("USDT must have 18 decimals");
        harness.validate(c);
    }

    function testRejectsTokenWithoutCode() public {
        DeployScript.DeployConfig memory c = config();
        c.usdtToken = address(0xBAD);
        vm.expectRevert("USDT_TOKEN_ADDRESS has no code");
        harness.validate(c);
    }

    function testRejectsNonIncreasingNodePrices() public {
        DeployScript.DeployConfig memory c = config();
        c.node.prices[1] = c.node.prices[0];
        vm.expectRevert("Node prices must increase");
        harness.validate(c);
    }

    function testRejectsExcessiveFees() public {
        DeployScript.DeployConfig memory c = config();
        c.exchangeNodeFeeBps = 9501;
        vm.expectRevert("Market fees exceed 100%");
        harness.validate(c);
    }

    function testRejectsBuybackAllocationAboveSpaceXZISupply() public {
        DeployScript.DeployConfig memory c = config();
        c.initialBuybackSpace = 1_000_000_000 ether + 1;
        vm.expectRevert("Buyback SPACE exceeds supply");
        harness.validate(c);
    }
}
