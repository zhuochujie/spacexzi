// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test} from "forge-std/Test.sol";
import {Mining} from "../src/Mining.sol";
import {SpaceXZIToken} from "../src/SpaceXZIToken.sol";
import {Vault} from "../src/Vault.sol";

contract MiningTestToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address recipient) ERC20(name_, symbol_) {
        _mint(recipient, 1_200_000_000 ether);
    }
}

contract MiningTest is Test {
    SpaceXZIToken public spaceToken;
    MiningTestToken public usdtToken;
    Vault public vault;
    Mining public mining;

    uint256 internal signerKey = 0xA11CE;
    address internal signer;
    address internal owner = address(0x1000);
    address internal buyer = address(0x2000);
    address internal vipFeeReceiver = address(0x3000);
    address internal nodeFeeReceiver = address(0x4000);
    address internal usdtFeeReceiver = address(0x5000);
    address internal marketFeeReceiver = address(0x6000);
    uint256 internal freeMinerSpaceAmount = 200 ether;

    function setUp() public {
        signer = vm.addr(signerKey);

        vm.startPrank(owner);
        vault = new Vault();
        spaceToken = new SpaceXZIToken(owner, marketFeeReceiver, nodeFeeReceiver);
        usdtToken = new MiningTestToken("Tether USD", "USDT", owner);
        mining = new Mining(
            address(spaceToken),
            address(usdtToken),
            address(vault),
            signer,
            vipFeeReceiver,
            nodeFeeReceiver,
            usdtFeeReceiver,
            freeMinerSpaceAmount
        );

        address[] memory whitelistAccounts = new address[](3);
        whitelistAccounts[0] = owner;
        whitelistAccounts[1] = address(vault);
        whitelistAccounts[2] = address(mining);
        spaceToken.setWhitelistBatch(whitelistAccounts, true);

        spaceToken.transfer(address(vault), 10_000_000 ether);
        vault.approve(address(spaceToken), address(mining), type(uint256).max);
        vm.stopPrank();

        vm.prank(owner);
        spaceToken.transfer(buyer, 1_000 ether);
        vm.prank(owner);
        usdtToken.transfer(buyer, 1_000 ether);

        vm.startPrank(buyer);
        spaceToken.approve(address(mining), type(uint256).max);
        usdtToken.approve(address(mining), type(uint256).max);
        vm.stopPrank();
    }

    function testPurchaseMinerWithBackendSignature() public {
        uint256 price = 100 ether;
        uint256 payValue = 80 ether;
        uint256 expectedReward = 500 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", price, payValue, expectedReward, "nonce-1", deadline, signerKey);

        vm.prank(owner);
        spaceToken.transfer(address(mining), price - payValue);

        vm.prank(buyer);
        mining.purchaseMiner("miner-1", price, payValue, expectedReward, "nonce-1", deadline, signature);

        assertTrue(mining.usedPurchaseNonces("nonce-1"));
        assertEq(spaceToken.balanceOf(address(0xdead)), price);
        assertEq(spaceToken.balanceOf(address(mining)), expectedReward);
    }

    function testPurchaseUsingOnlyPrepaidInternalSpace() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "internal", 100 ether, 0, 500 ether, "internal", deadline, signerKey);
        vm.prank(owner);
        spaceToken.transfer(address(mining), 100 ether);
        uint256 buyerBalance = spaceToken.balanceOf(buyer);
        uint256 usdtBalance = usdtToken.balanceOf(buyer);
        vm.prank(buyer);
        mining.purchaseMiner("internal", 100 ether, 0, 500 ether, "internal", deadline, signature);
        assertEq(spaceToken.balanceOf(buyer), buyerBalance);
        assertEq(usdtToken.balanceOf(buyer), usdtBalance);
        assertEq(spaceToken.balanceOf(address(0xdead)), 100 ether);
        assertEq(spaceToken.balanceOf(address(mining)), 500 ether);
    }

    function testSpacePayValueCannotExceedPrice() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "overpay", 100 ether, 101 ether, 0, "overpay", deadline, signerKey);
        vm.expectRevert(Mining.InvalidPayValue.selector);
        vm.prank(buyer);
        mining.purchaseMiner("overpay", 100 ether, 101 ether, 0, "overpay", deadline, signature);
        assertFalse(mining.usedPurchaseNonces("overpay"));
    }

    function testClaimFreeMinerTransfersSpaceFromVault() public {
        assertTrue(mining.freeMinerClaimEnabled());

        uint256 vaultSpaceBefore = spaceToken.balanceOf(address(vault));
        uint256 miningSpaceBefore = spaceToken.balanceOf(address(mining));

        vm.expectEmit(true, false, false, true, address(mining));
        emit Mining.FreeMinerClaimed(buyer, freeMinerSpaceAmount);

        vm.prank(buyer);
        mining.claimFreeMiner();

        assertTrue(mining.claimedFreeMiners(buyer));
        assertEq(spaceToken.balanceOf(address(vault)), vaultSpaceBefore - freeMinerSpaceAmount);
        assertEq(spaceToken.balanceOf(address(mining)), miningSpaceBefore + freeMinerSpaceAmount);
    }

    function testOwnerCanDisableFreeMinerClaim() public {
        vm.expectEmit(false, false, false, true, address(mining));
        emit Mining.FreeMinerClaimEnabledUpdated(false);

        vm.prank(owner);
        mining.setFreeMinerClaimEnabled(false);

        assertFalse(mining.freeMinerClaimEnabled());

        vm.prank(buyer);
        vm.expectRevert(Mining.FreeMinerClaimDisabled.selector);
        mining.claimFreeMiner();
    }

    function testOnlyOwnerCanSetFreeMinerClaimEnabled() public {
        vm.prank(buyer);
        vm.expectRevert();
        mining.setFreeMinerClaimEnabled(false);
    }

    function testCanClaimFreeMinerAfterReenabled() public {
        vm.startPrank(owner);
        mining.setFreeMinerClaimEnabled(false);
        mining.setFreeMinerClaimEnabled(true);
        vm.stopPrank();

        vm.prank(buyer);
        mining.claimFreeMiner();

        assertTrue(mining.claimedFreeMiners(buyer));
    }

    function testCannotClaimFreeMinerTwice() public {
        vm.startPrank(buyer);
        mining.claimFreeMiner();

        vm.expectRevert(Mining.FreeMinerAlreadyClaimed.selector);
        mining.claimFreeMiner();
        vm.stopPrank();
    }

    function testPurchaseMinerSkipsZeroValueTransfers() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signPurchase(buyer, "miner-1", 0, 0, 0, "nonce-1", deadline, signerKey);

        uint256 deadBalanceBefore = spaceToken.balanceOf(address(0xdead));
        uint256 miningBalanceBefore = spaceToken.balanceOf(address(mining));

        vm.prank(buyer);
        mining.purchaseMiner("miner-1", 0, 0, 0, "nonce-1", deadline, signature);

        assertTrue(mining.usedPurchaseNonces("nonce-1"));
        assertEq(spaceToken.balanceOf(address(0xdead)), deadBalanceBefore);
        assertEq(spaceToken.balanceOf(address(mining)), miningBalanceBefore);
    }

    function testCannotReplayPurchaseSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signerKey);

        vm.startPrank(buyer);
        mining.purchaseMiner("miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signature);

        vm.expectRevert(Mining.NonceAlreadyUsed.selector);
        mining.purchaseMiner("miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signature);
        vm.stopPrank();
    }

    function testNonceMustMatchBackendSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signerKey);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSignature.selector);
        mining.purchaseMiner("miner-1", 100 ether, 100 ether, 500 ether, "nonce-2", deadline, signature);
    }

    function testPayValueMustMatchBackendSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signerKey);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSignature.selector);
        mining.purchaseMiner("miner-1", 100 ether, 1 ether, 500 ether, "nonce-1", deadline, signature);
    }

    function testCannotUseExpiredSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signerKey);

        vm.warp(deadline + 1);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Mining.ExpiredSignature.selector, deadline));
        mining.purchaseMiner("miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signature);
    }

    function testCannotUseWrongSigner() public {
        uint256 wrongSignerKey = 0xB0B;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, wrongSignerKey);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSignature.selector);
        mining.purchaseMiner("miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signature);
    }

    function testClaimRewardWithBackendSignature() public {
        uint256 amount = 30 ether;
        uint256 vipFee = 2 ether;
        uint256 nodeFee = 1 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(buyer, amount, vipFee, nodeFee, "claim-nonce-1", deadline, signerKey);

        vm.prank(owner);
        spaceToken.transfer(address(mining), amount);

        uint256 buyerBalanceBefore = spaceToken.balanceOf(buyer);
        uint256 vipFeeReceiverBalanceBefore = spaceToken.balanceOf(vipFeeReceiver);
        uint256 nodeFeeReceiverBalanceBefore = spaceToken.balanceOf(nodeFeeReceiver);

        vm.expectEmit(true, false, false, true, address(mining));
        emit Mining.RewardClaimed(buyer, amount, vipFee, nodeFee, "claim-nonce-1");

        vm.prank(buyer);
        mining.claim(amount, vipFee, nodeFee, "claim-nonce-1", deadline, signature);

        assertTrue(mining.usedClaimNonces("claim-nonce-1"));
        assertEq(spaceToken.balanceOf(buyer), buyerBalanceBefore + amount - vipFee - nodeFee);
        assertEq(spaceToken.balanceOf(vipFeeReceiver), vipFeeReceiverBalanceBefore + vipFee);
        assertEq(spaceToken.balanceOf(nodeFeeReceiver), nodeFeeReceiverBalanceBefore + nodeFee);
    }

    function testCannotReplayClaimSignature() public {
        uint256 amount = 30 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(buyer, amount, 0, 0, "claim-nonce-1", deadline, signerKey);

        vm.prank(owner);
        spaceToken.transfer(address(mining), amount * 2);

        vm.startPrank(buyer);
        mining.claim(amount, 0, 0, "claim-nonce-1", deadline, signature);

        vm.expectRevert(Mining.NonceAlreadyUsed.selector);
        mining.claim(amount, 0, 0, "claim-nonce-1", deadline, signature);
        vm.stopPrank();
    }

    function testCannotUsePurchaseSignatureForClaim() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, "nonce-1", deadline, signerKey);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSignature.selector);
        mining.claim(100 ether, 0, 0, "nonce-1", deadline, signature);
    }

    function testClaimFeeMustMatchBackendSignature() public {
        uint256 amount = 30 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(buyer, amount, 2 ether, 1 ether, "claim-nonce-1", deadline, signerKey);

        vm.prank(owner);
        spaceToken.transfer(address(mining), amount);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSignature.selector);
        mining.claim(amount, 1 ether, 1 ether, "claim-nonce-1", deadline, signature);
    }

    function testCannotClaimWhenFeeGreaterThanAmount() public {
        uint256 amount = 30 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(buyer, amount, 20 ether, 11 ether, "claim-nonce-1", deadline, signerKey);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidFee.selector);
        mining.claim(amount, 20 ether, 11 ether, "claim-nonce-1", deadline, signature);
    }

    function testPurchaseAndClaimCanUseSameNonceValue() public {
        uint256 deadline = block.timestamp + 1 hours;
        string memory nonce = "same-nonce";
        bytes memory purchaseSignature =
            _signPurchase(buyer, "miner-1", 100 ether, 100 ether, 500 ether, nonce, deadline, signerKey);
        bytes memory claimSignature = _signClaim(buyer, 30 ether, 0, 0, nonce, deadline, signerKey);

        vm.prank(owner);
        spaceToken.transfer(address(mining), 30 ether);

        vm.startPrank(buyer);
        mining.purchaseMiner("miner-1", 100 ether, 100 ether, 500 ether, nonce, deadline, purchaseSignature);
        mining.claim(30 ether, 0, 0, nonce, deadline, claimSignature);
        vm.stopPrank();

        assertTrue(mining.usedPurchaseNonces(nonce));
        assertTrue(mining.usedClaimNonces(nonce));
    }

    function testWithdrawUsdtWithBackendSignature() public {
        uint256 amount = 50 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signWithdrawUsdt(buyer, amount, "usdt-nonce-1", deadline, signerKey);

        vm.prank(owner);
        usdtToken.transfer(address(mining), amount);

        uint256 buyerBalanceBefore = usdtToken.balanceOf(buyer);

        vm.expectEmit(true, false, false, true, address(mining));
        emit Mining.UsdtWithdrawn(buyer, amount, "usdt-nonce-1");

        vm.prank(buyer);
        mining.withdrawUsdt(amount, "usdt-nonce-1", deadline, signature);

        assertTrue(mining.usedWithdrawUsdtNonces("usdt-nonce-1"));
        assertEq(usdtToken.balanceOf(buyer), buyerBalanceBefore + amount);
    }

    function testCannotReplayWithdrawUsdtSignature() public {
        uint256 amount = 50 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signWithdrawUsdt(buyer, amount, "usdt-nonce-1", deadline, signerKey);

        vm.prank(owner);
        usdtToken.transfer(address(mining), amount * 2);

        vm.startPrank(buyer);
        mining.withdrawUsdt(amount, "usdt-nonce-1", deadline, signature);

        vm.expectRevert(Mining.NonceAlreadyUsed.selector);
        mining.withdrawUsdt(amount, "usdt-nonce-1", deadline, signature);
        vm.stopPrank();
    }

    function testCannotUseClaimSignatureForWithdrawUsdt() public {
        uint256 amount = 50 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(buyer, amount, 0, 0, "usdt-nonce-1", deadline, signerKey);

        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSignature.selector);
        mining.withdrawUsdt(amount, "usdt-nonce-1", deadline, signature);
    }

    function testDividendTransfersFeeVaultBalances() public {
        uint256 vipSpaceAmount = 10 ether;
        uint256 nodeSpaceAmount = 20 ether;
        uint256 nodeUsdtToMiner = 3 ether;
        uint256 nodeUsdtToFeeReceiver = 7 ether;

        vm.startPrank(owner);
        spaceToken.transfer(vipFeeReceiver, vipSpaceAmount);
        spaceToken.transfer(nodeFeeReceiver, nodeSpaceAmount);
        usdtToken.transfer(nodeFeeReceiver, nodeUsdtToMiner + nodeUsdtToFeeReceiver);
        vm.stopPrank();

        vm.prank(vipFeeReceiver);
        spaceToken.approve(address(mining), vipSpaceAmount);

        vm.startPrank(nodeFeeReceiver);
        spaceToken.approve(address(mining), nodeSpaceAmount);
        usdtToken.approve(address(mining), nodeUsdtToMiner + nodeUsdtToFeeReceiver);
        vm.stopPrank();

        uint256 miningSpaceBefore = spaceToken.balanceOf(address(mining));
        uint256 miningUsdtBefore = usdtToken.balanceOf(address(mining));
        uint256 usdtFeeReceiverBalanceBefore = usdtToken.balanceOf(usdtFeeReceiver);

        vm.expectEmit(false, false, false, true, address(mining));
        emit Mining.DividendDistributed(vipSpaceAmount, nodeSpaceAmount, nodeUsdtToMiner, nodeUsdtToFeeReceiver, 0);

        vm.prank(signer);
        mining.dividend(vipSpaceAmount, nodeSpaceAmount, nodeUsdtToMiner, nodeUsdtToFeeReceiver, 0);

        assertEq(spaceToken.balanceOf(address(mining)), miningSpaceBefore + vipSpaceAmount + nodeSpaceAmount);
        assertEq(usdtToken.balanceOf(address(mining)), miningUsdtBefore + nodeUsdtToMiner);
        assertEq(usdtToken.balanceOf(usdtFeeReceiver), usdtFeeReceiverBalanceBefore + nodeUsdtToFeeReceiver);
    }

    function testOnlySignerCanDividend() public {
        vm.prank(buyer);
        vm.expectRevert(Mining.InvalidSigner.selector);
        mining.dividend(0, 0, 0, 0, 0);
    }

    function testOwnerCanUpdateUsdtFeeReceiver() public {
        address newUsdtFeeReceiver = address(0x6000);

        vm.expectEmit(true, true, false, true, address(mining));
        emit Mining.UsdtFeeReceiverUpdated(usdtFeeReceiver, newUsdtFeeReceiver);

        vm.prank(owner);
        mining.setUsdtFeeReceiver(newUsdtFeeReceiver);

        assertEq(mining.usdtFeeReceiver(), newUsdtFeeReceiver);
    }

    function testOnlyOwnerCanUpdateUsdtFeeReceiver() public {
        vm.prank(buyer);
        vm.expectRevert();
        mining.setUsdtFeeReceiver(address(0x6000));
    }

    function testCannotSetZeroUsdtFeeReceiver() public {
        vm.prank(owner);
        vm.expectRevert(Mining.InvalidFeeReceiver.selector);
        mining.setUsdtFeeReceiver(address(0));
    }

    function _signPurchase(
        address account,
        string memory minerId,
        uint256 price,
        uint256 payValue,
        uint256 expectedReward,
        string memory nonce,
        uint256 deadline,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 digest = mining.getPurchaseMinerDigest(
            account, minerId, price, payValue, expectedReward, nonce, deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signClaim(
        address account,
        uint256 amount,
        uint256 vipFee,
        uint256 nodeFee,
        string memory nonce,
        uint256 deadline,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 digest = mining.getClaimDigest(account, amount, vipFee, nodeFee, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signWithdrawUsdt(
        address account,
        uint256 amount,
        string memory nonce,
        uint256 deadline,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 digest = mining.getWithdrawUsdtDigest(account, amount, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
