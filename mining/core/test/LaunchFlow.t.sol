// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {DeployScript} from "../script/Deploy.s.sol";
import {DeploymentHarness, DeploymentUsdt} from "./Deployment.t.sol";

contract LaunchFlowTest is Test {
    uint256 constant SIGNER_KEY = 0xA11CE;

    function sign(bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function testNodeToMakerToBuybackToMarketAndWalletMinerPurchase() public {
        DeploymentHarness harness = new DeploymentHarness();
        DeploymentUsdt usdt = new DeploymentUsdt();
        DeployScript.DeployConfig memory c;
        c.chainId = block.chainid;
        c.deployer = address(harness);
        c.owner = address(this);
        c.signer = vm.addr(SIGNER_KEY);
        c.marker = address(0x1111);
        c.usdtToken = address(usdt);
        c.usdtFeeReceiver = address(0x2222);
        c.minPrice = 0.7 ether;
        c.maxPrice = 0.8 ether;
        c.minOrderSpaceAmount = 1 ether;
        c.exchangeNodeFeeBps = 500;
        c.exchangeMarkerFeeBps = 500;
        c.freeMinerSpaceAmount = 50 ether;
        c.buybackFixedReceiver = address(0x3333);
        c.buybackBuyPrice = 1 ether;
        c.buybackSellPrice = 0.2 ether;
        c.initialBuybackSpace = 2_000_000 ether;
        c.node.treasury = address(0x4444);
        c.node.names = [string("Starter"), "Core", "Elite", "Prime"];
        c.node.prices = [uint256(100 ether), 500 ether, 1000 ether, 2000 ether];
        c.node.enabled = [true, true, true, true];
        DeployScript.Deployment memory d = harness.execute(c);
        address maker = address(0xBEEF);
        address taker = address(0xCAFE);
        deal(address(usdt), maker, 3000 ether);
        deal(address(usdt), taker, 100 ether);
        uint256 deadline = block.timestamp + 180;

        // The backend independently checks the confirmed-signature slot before issuing this maker signature.
        bytes memory nodeSignature = sign(d.node.getPurchaseDigest(maker, 3, 2000 ether, 300 ether, "node", deadline));
        vm.startPrank(maker);
        usdt.approve(address(d.node), 2000 ether);
        d.node.purchase(3, 2000 ether, 300 ether, "node", deadline, nodeSignature);
        vm.stopPrank();
        assertEq(d.node.getUserLevel(maker), 4);
        assertEq(usdt.balanceOf(address(d.node)), 0);
        assertEq(usdt.balanceOf(address(d.mining)), 300 ether);
        assertTrue(d.node.usedPurchaseNonces("node"));
        bytes memory makerSignature = sign(d.market.getFeeExemptDigest(maker, true));
        vm.prank(maker);
        d.market.setFeeExempt(maker, true, makerSignature);
        assertTrue(d.market.feeExemptAccounts(maker));

        vm.startPrank(maker);
        usdt.approve(address(d.buybackPool), 100 ether);
        d.buybackPool.buy(100 ether, 100 ether, deadline);
        vm.stopPrank();
        assertEq(d.spaceToken.balanceOf(maker), 100 ether);
        assertEq(d.market.feeExemptSpaceQuotas(maker), 100 ether);
        assertEq(usdt.balanceOf(address(d.buybackDividendVault)), 50 ether);
        assertEq(usdt.balanceOf(address(d.buybackPool)), 30 ether);
        assertEq(usdt.balanceOf(c.buybackFixedReceiver), 20 ether);

        bytes32 orderId = keccak256("launch-market-sell");
        vm.startPrank(maker);
        d.spaceToken.approve(address(d.market), 40 ether);
        d.market.placeSellOrder(orderId, 40 ether, 0.75 ether, true);
        vm.stopPrank();
        uint256 usdtBefore = usdt.balanceOf(maker);
        vm.startPrank(taker);
        usdt.approve(address(d.market), 30 ether);
        d.market.fillOrder(orderId, 40 ether, "");
        vm.stopPrank();
        assertEq(usdt.balanceOf(maker) - usdtBefore, 30 ether);
        assertEq(d.market.feeExemptSpaceQuotas(maker), 60 ether);
        assertEq(d.spaceToken.balanceOf(maker), 60 ether);

        bytes memory minerSignature =
            sign(d.mining.getPurchaseMinerDigest(maker, "SPACE_10", 10 ether, 10 ether, 50 ether, "miner", deadline));
        vm.startPrank(maker);
        d.spaceToken.approve(address(d.mining), 10 ether);
        d.mining.purchaseMiner("SPACE_10", 10 ether, 10 ether, 50 ether, "miner", deadline, minerSignature);
        vm.stopPrank();
        assertTrue(d.mining.usedPurchaseNonces("miner"));
        assertEq(d.spaceToken.balanceOf(maker), 50 ether);
        assertEq(d.spaceToken.balanceOf(address(d.mining)), 50 ether);
        assertEq(d.spaceToken.balanceOf(address(0xdead)), 10 ether);
        assertEq(d.spaceToken.balanceOf(address(d.buybackPool)), 1_999_900 ether);
        bytes memory rewardSignature = sign(d.mining.getWithdrawUsdtDigest(taker, 300 ether, "node-reward", deadline));
        uint256 beforeReward = usdt.balanceOf(taker);
        vm.prank(taker);
        d.mining.withdrawUsdt(300 ether, "node-reward", deadline, rewardSignature);
        assertEq(usdt.balanceOf(taker) - beforeReward, 300 ether);
        assertEq(usdt.balanceOf(address(d.mining)), 0);
    }
}
