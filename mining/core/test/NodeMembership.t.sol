// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {NodeMembership} from "../src/NodeMembership.sol";

contract NodeTestToken is ERC20 {
    address public blockedRecipient;

    function blockRecipient(address recipient) external {
        blockedRecipient = recipient;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(to != blockedRecipient || to == address(0), "Blocked recipient");
        super._update(from, to, amount);
    }

    constructor() ERC20("USDT", "USDT") {
        _mint(msg.sender, 1000000 ether);
    }
}

contract NodeMiningReceiver {
    address public usdtToken;

    constructor(address token) {
        usdtToken = token;
    }
}

contract NodeMembershipTest is Test {
    NodeMembership node;
    NodeTestToken token;
    NodeMiningReceiver mining;
    uint256 constant KEY = 0xA11CE;
    address buyer = address(0xB0B);
    address treasury = address(0xABC);
    uint256 deadline;

    function setUp() public {
        token = new NodeTestToken();
        mining = new NodeMiningReceiver(address(token));
        node = new NodeMembership(address(token), treasury, vm.addr(KEY), address(mining));
        node.createLevel("One", 100 ether, true);
        node.createLevel("Two", 300 ether, true);
        node.createLevel("Disabled", 500 ether, false);
        token.transfer(buyer, 1000 ether);
        vm.prank(buyer);
        token.approve(address(node), type(uint256).max);
        deadline = block.timestamp + 180;
    }

    function signed(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function purchase(string memory nonce) internal {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, nonce, deadline));
        vm.prank(buyer);
        node.purchase(0, 100 ether, 15 ether, nonce, deadline, sig);
    }

    function testLevelsAndPayment() public {
        assertEq(node.getUserLevel(buyer), 0);
        purchase("first");
        assertEq(node.getUserLevel(buyer), 1);
        assertEq(token.balanceOf(treasury), 85 ether);
        assertEq(token.balanceOf(address(node)), 0);
        assertEq(token.balanceOf(address(mining)), 15 ether);
        assertTrue(node.usedPurchaseNonces("first"));
    }

    function testUpgradeDeltaAndNonce() public {
        purchase("first");
        bytes memory sig = signed(node.getUpgradeDigest(buyer, 1, 1, 200 ether, 30 ether, "upgrade", deadline));
        vm.prank(buyer);
        node.upgrade(1, 1, 200 ether, 30 ether, "upgrade", deadline, sig);
        assertEq(node.getUserLevel(buyer), 2);
        assertEq(token.balanceOf(buyer), 700 ether);
        assertEq(token.balanceOf(address(node)), 0);
        assertEq(token.balanceOf(address(mining)), 45 ether);
        assertTrue(node.usedPurchaseNonces("upgrade"));
    }

    function testReplayRejected() public {
        purchase("first");
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        vm.expectRevert(NodeMembership.NonceAlreadyUsed.selector);
        vm.prank(buyer);
        node.purchase(0, 100 ether, 15 ether, "first", deadline, sig);
    }

    function testExpiredSignatureRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(NodeMembership.SignatureExpired.selector);
        vm.prank(buyer);
        node.purchase(0, 100 ether, 15 ether, "first", deadline, sig);
    }

    function testTamperedAmountRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        vm.expectRevert(NodeMembership.InvalidSignature.selector);
        vm.prank(buyer);
        node.purchase(0, 1 ether, 15 ether, "first", deadline, sig);
    }

    function testSignedRewardAbovePaymentRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 101 ether, "first", deadline));
        vm.expectRevert(NodeMembership.InvalidAmount.selector);
        vm.prank(buyer);
        node.purchase(0, 100 ether, 101 ether, "first", deadline, sig);
    }

    function testFuzzSignedRewardDistribution(uint256 reward) public {
        reward = bound(reward, 0, 100 ether);
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, reward, "custom", deadline));
        vm.prank(buyer);
        node.purchase(0, 100 ether, reward, "custom", deadline, sig);
        assertEq(token.balanceOf(address(mining)), reward);
        assertEq(token.balanceOf(treasury), 100 ether - reward);
        assertEq(token.balanceOf(address(node)), 0);
    }

    function testUpgradeUsesSignedReward() public {
        purchase("first");
        bytes memory sig = signed(node.getUpgradeDigest(buyer, 1, 1, 200 ether, 40 ether, "upgrade", deadline));
        vm.prank(buyer);
        node.upgrade(1, 1, 200 ether, 40 ether, "upgrade", deadline, sig);
        assertEq(token.balanceOf(address(mining)), 55 ether);
        assertEq(token.balanceOf(treasury), 245 ether);
    }

    function testUpgradeRewardAboveDeltaRejected() public {
        purchase("first");
        bytes memory sig = signed(node.getUpgradeDigest(buyer, 1, 1, 200 ether, 201 ether, "upgrade", deadline));
        vm.expectRevert(NodeMembership.InvalidAmount.selector);
        vm.prank(buyer);
        node.upgrade(1, 1, 200 ether, 201 ether, "upgrade", deadline, sig);
        assertEq(node.getUserLevel(buyer), 1);
        assertFalse(node.usedPurchaseNonces("upgrade"));
    }

    function testTamperedRewardRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 20 ether, "custom", deadline));
        vm.expectRevert(NodeMembership.InvalidSignature.selector);
        vm.prank(buyer);
        node.purchase(0, 100 ether, 21 ether, "custom", deadline, sig);
    }

    function testCrossUserRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        vm.expectRevert(NodeMembership.InvalidSignature.selector);
        vm.prank(address(0xBAD));
        node.purchase(0, 100 ether, 15 ether, "first", deadline, sig);
    }

    function testCrossChainRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        vm.chainId(block.chainid + 1);
        vm.expectRevert(NodeMembership.InvalidSignature.selector);
        vm.prank(buyer);
        node.purchase(0, 100 ether, 15 ether, "first", deadline, sig);
    }

    function testCrossContractRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        NodeMembership other = new NodeMembership(address(token), treasury, vm.addr(KEY), address(mining));
        other.createLevel("One", 100 ether, true);
        vm.expectRevert(NodeMembership.InvalidSignature.selector);
        vm.prank(buyer);
        other.purchase(0, 100 ether, 15 ether, "first", deadline, sig);
    }

    function testTransferFailureDoesNotConsumeNonce() public {
        vm.prank(buyer);
        token.approve(address(node), 0);
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "first", deadline));
        vm.expectRevert();
        vm.prank(buyer);
        node.purchase(0, 100 ether, 15 ether, "first", deadline, sig);
        assertFalse(node.usedPurchaseNonces("first"));
        assertEq(node.getUserLevel(buyer), 0);
    }

    function testUpgradeCannotUsePurchaseSignature() public {
        purchase("first");
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 1, 200 ether, 30 ether, "second", deadline));
        vm.expectRevert(NodeMembership.InvalidSignature.selector);
        vm.prank(buyer);
        node.upgrade(1, 1, 200 ether, 30 ether, "second", deadline, sig);
    }

    function testWrongFromLevelRejected() public {
        purchase("first");
        bytes memory sig = signed(node.getUpgradeDigest(buyer, 2, 1, 200 ether, 30 ether, "second", deadline));
        vm.expectRevert(NodeMembership.InvalidUpgrade.selector);
        vm.prank(buyer);
        node.upgrade(2, 1, 200 ether, 30 ether, "second", deadline, sig);
    }

    function testDisabledAndPausedRejected() public {
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 2, 500 ether, 75 ether, "first", deadline));
        vm.expectRevert(NodeMembership.LevelDisabled.selector);
        vm.prank(buyer);
        node.purchase(2, 500 ether, 75 ether, "first", deadline, sig);
        node.setPurchasePaused(true);
        vm.expectRevert(NodeMembership.PurchasePausedError.selector);
        vm.prank(buyer);
        node.purchase(2, 500 ether, 75 ether, "first", deadline, sig);
    }

    function testFundingFailureRollsBackNodePurchaseAndNonce() public {
        token.blockRecipient(address(mining));
        bytes memory sig = signed(node.getPurchaseDigest(buyer, 0, 100 ether, 15 ether, "blocked", deadline));
        uint256 beforeBuyer = token.balanceOf(buyer);
        vm.expectRevert("Blocked recipient");
        vm.prank(buyer);
        node.purchase(0, 100 ether, 15 ether, "blocked", deadline, sig);
        assertEq(token.balanceOf(buyer), beforeBuyer);
        assertEq(token.balanceOf(address(mining)), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(node.getUserLevel(buyer), 0);
        assertFalse(node.usedPurchaseNonces("blocked"));
    }

    function testRejectsInvalidMiningTarget() public {
        vm.expectRevert(NodeMembership.InvalidMining.selector);
        new NodeMembership(address(token), treasury, vm.addr(KEY), address(0));
        vm.expectRevert(NodeMembership.InvalidMining.selector);
        new NodeMembership(address(token), treasury, vm.addr(KEY), address(0x123));
        NodeTestToken other = new NodeTestToken();
        NodeMiningReceiver wrong = new NodeMiningReceiver(address(other));
        vm.expectRevert(NodeMembership.InvalidMining.selector);
        new NodeMembership(address(token), treasury, vm.addr(KEY), address(wrong));
    }
}
