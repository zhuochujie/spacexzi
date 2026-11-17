// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test} from "forge-std/Test.sol";
import {TokenExchange} from "../src/TokenExchange.sol";

contract TestToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TokenExchangeTest is Test {
    TestToken public spaceToken;
    TestToken public usdtToken;
    TokenExchange public exchange;

    address public owner = address(0x1000);
    address public nodeFeeReceiver = address(0x2000);
    address public markerFeeReceiver = address(0x2100);
    address public alice = address(0x3000);
    address public bob = address(0x4000);
    uint256 public signerKey = 0xA11CE;
    address public signer;

    uint256 public constant PRICE = 2 ether;
    uint256 public constant MIN_PRICE = 1 ether;
    uint256 public constant MAX_PRICE = 3 ether;
    uint256 public constant MIN_ORDER_SPACE_AMOUNT = 10 ether;
    uint256 public constant NODE_FEE_BPS = 40;
    uint256 public constant MARKER_FEE_BPS = 60;
    string public constant ORDER_SOURCE = "order-1";
    bytes32 public constant ORDER_ID = keccak256("order-1");

    function setUp() public {
        signer = vm.addr(signerKey);
        spaceToken = new TestToken("Space Token", "SPACE");
        usdtToken = new TestToken("Tether USD", "USDT");

        vm.prank(owner);
        exchange = new TokenExchange(
            address(spaceToken),
            address(usdtToken),
            nodeFeeReceiver,
            markerFeeReceiver,
            MIN_PRICE,
            MAX_PRICE,
            MIN_ORDER_SPACE_AMOUNT,
            NODE_FEE_BPS,
            MARKER_FEE_BPS,
            signer
        );

        spaceToken.mint(alice, 1_000 ether);
        spaceToken.mint(bob, 1_000 ether);
        usdtToken.mint(alice, 10_000 ether);
        usdtToken.mint(bob, 10_000 ether);

        vm.startPrank(alice);
        spaceToken.approve(address(exchange), type(uint256).max);
        usdtToken.approve(address(exchange), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        spaceToken.approve(address(exchange), type(uint256).max);
        usdtToken.approve(address(exchange), type(uint256).max);
        vm.stopPrank();
    }

    function testPlaceSellOrderLocksSpace() public {
        vm.expectEmit(true, true, false, true, address(exchange));
        emit TokenExchange.OrderPlaced(ORDER_ID, alice, TokenExchange.OrderSide.Sell, 100 ether, PRICE, 200 ether, true);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        assertEq(spaceToken.balanceOf(address(exchange)), 100 ether);
        assertEq(spaceToken.balanceOf(alice), 900 ether);

        (
            bytes32 id,
            address maker,
            TokenExchange.OrderSide side,
            uint256 spaceAmount,
            uint256 remainingSpaceAmount,
            uint256 price,
            TokenExchange.OrderStatus status,
            bool visible,
        ) = exchange.orders(ORDER_ID);

        assertEq(id, ORDER_ID);
        assertEq(maker, alice);
        assertEq(uint8(side), uint8(TokenExchange.OrderSide.Sell));
        assertEq(spaceAmount, 100 ether);
        assertEq(remainingSpaceAmount, 100 ether);
        assertEq(price, PRICE);
        assertEq(uint8(status), uint8(TokenExchange.OrderStatus.Open));
        assertTrue(visible);
    }

    function testGetOrderReturnsOrder() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        TokenExchange.Order memory order = exchange.getOrder(ORDER_ID);

        assertEq(order.id, ORDER_ID);
        assertEq(order.maker, alice);
        assertEq(uint8(order.side), uint8(TokenExchange.OrderSide.Sell));
        assertEq(order.spaceAmount, 100 ether);
        assertEq(order.remainingSpaceAmount, 100 ether);
        assertEq(order.price, PRICE);
        assertEq(uint8(order.status), uint8(TokenExchange.OrderStatus.Open));
        assertTrue(order.visible);
    }

    function testCanPlaceHiddenOrder() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, false);

        TokenExchange.Order memory order = exchange.getOrder(ORDER_ID);

        assertFalse(order.visible);
    }

    function testFillSellOrderTransfersSpaceAndUsdtFee() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        uint256 aliceUsdtBefore = usdtToken.balanceOf(alice);
        uint256 bobSpaceBefore = spaceToken.balanceOf(bob);

        vm.expectEmit(true, true, true, true, address(exchange));
        emit TokenExchange.OrderFilled(ORDER_ID, alice, bob, 40 ether, PRICE, 80 ether, 0.32 ether, 0.48 ether);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertEq(spaceToken.balanceOf(bob), bobSpaceBefore + 40 ether);
        assertEq(usdtToken.balanceOf(alice), aliceUsdtBefore + 79.2 ether);
        assertEq(usdtToken.balanceOf(nodeFeeReceiver), 0.32 ether);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), 0.48 ether);

        (,,,, uint256 remainingSpaceAmount,, TokenExchange.OrderStatus status,,) = exchange.orders(ORDER_ID);
        assertEq(remainingSpaceAmount, 60 ether);
        assertEq(uint8(status), uint8(TokenExchange.OrderStatus.Open));
    }

    function testFeeExemptSellOrderMakerPaysNoFee() public {
        bytes memory signature = _signFeeExempt(alice, true, signerKey);

        exchange.setFeeExempt(alice, true, signature);

        bytes32 buyQuotaOrderId = keccak256("buy-quota-order");
        vm.prank(bob);
        exchange.placeSellOrder(buyQuotaOrderId, 40 ether, PRICE, true);

        vm.prank(alice);
        exchange.fillOrder(buyQuotaOrderId, 40 ether, "buy-quota-order");

        assertEq(exchange.feeExemptSpaceQuotas(alice), 40 ether);

        uint256 nodeFeeReceiverBefore = usdtToken.balanceOf(nodeFeeReceiver);
        uint256 markerFeeReceiverBefore = usdtToken.balanceOf(markerFeeReceiver);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        uint256 aliceUsdtBefore = usdtToken.balanceOf(alice);

        vm.expectEmit(true, true, true, true, address(exchange));
        emit TokenExchange.OrderFilled(ORDER_ID, alice, bob, 40 ether, PRICE, 80 ether, 0, 0);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertTrue(exchange.feeExemptAccounts(alice));
        assertEq(exchange.feeExemptSpaceQuotas(alice), 0);
        assertEq(usdtToken.balanceOf(alice), aliceUsdtBefore + 80 ether);
        assertEq(usdtToken.balanceOf(nodeFeeReceiver), nodeFeeReceiverBefore);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), markerFeeReceiverBefore);
    }

    function testFillBuyOrderTransfersSpaceAndUsdtFee() public {
        vm.prank(alice);
        exchange.placeBuyOrder(ORDER_ID, 100 ether, PRICE, true);

        uint256 aliceSpaceBefore = spaceToken.balanceOf(alice);
        uint256 bobUsdtBefore = usdtToken.balanceOf(bob);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 25 ether, ORDER_SOURCE);

        assertEq(spaceToken.balanceOf(alice), aliceSpaceBefore + 25 ether);
        assertEq(usdtToken.balanceOf(bob), bobUsdtBefore + 49.5 ether);
        assertEq(usdtToken.balanceOf(nodeFeeReceiver), 0.2 ether);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), 0.3 ether);
        assertEq(usdtToken.balanceOf(address(exchange)), 150 ether);

        (,,,, uint256 remainingSpaceAmount,, TokenExchange.OrderStatus status,,) = exchange.orders(ORDER_ID);
        assertEq(remainingSpaceAmount, 75 ether);
        assertEq(uint8(status), uint8(TokenExchange.OrderStatus.Open));
    }

    function testFeeExemptBuyOrderTakerPaysNoFee() public {
        bytes memory signature = _signFeeExempt(bob, true, signerKey);

        exchange.setFeeExempt(bob, true, signature);

        bytes32 buyQuotaOrderId = keccak256("buy-quota-order");
        vm.prank(alice);
        exchange.placeSellOrder(buyQuotaOrderId, 25 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(buyQuotaOrderId, 25 ether, "buy-quota-order");

        assertEq(exchange.feeExemptSpaceQuotas(bob), 25 ether);

        uint256 nodeFeeReceiverBefore = usdtToken.balanceOf(nodeFeeReceiver);
        uint256 markerFeeReceiverBefore = usdtToken.balanceOf(markerFeeReceiver);

        vm.prank(alice);
        exchange.placeBuyOrder(ORDER_ID, 100 ether, PRICE, true);

        uint256 bobUsdtBefore = usdtToken.balanceOf(bob);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 25 ether, ORDER_SOURCE);

        assertEq(usdtToken.balanceOf(bob), bobUsdtBefore + 50 ether);
        assertEq(exchange.feeExemptSpaceQuotas(bob), 0);
        assertEq(usdtToken.balanceOf(nodeFeeReceiver), nodeFeeReceiverBefore);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), markerFeeReceiverBefore);
    }

    function testNonFeeExemptBuyerDoesNotIncreaseFeeExemptQuota() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertFalse(exchange.feeExemptAccounts(bob));
        assertEq(exchange.feeExemptSpaceQuotas(bob), 0);
    }

    function testFeeExemptBuyerIncreasesQuotaWhenFillingSellOrder() public {
        bytes memory signature = _signFeeExempt(bob, true, signerKey);
        exchange.setFeeExempt(bob, true, signature);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertEq(exchange.feeExemptSpaceQuotas(bob), 40 ether);
    }

    function testFeeExemptBuyOrderMakerIncreasesQuotaWhenOrderFilled() public {
        bytes memory signature = _signFeeExempt(alice, true, signerKey);
        exchange.setFeeExempt(alice, true, signature);

        vm.prank(alice);
        exchange.placeBuyOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 25 ether, ORDER_SOURCE);

        assertEq(exchange.feeExemptSpaceQuotas(alice), 25 ether);
    }

    function testFeeExemptSellerPaysFeeOnlyForAmountAboveQuota() public {
        bytes memory signature = _signFeeExempt(bob, true, signerKey);
        exchange.setFeeExempt(bob, true, signature);

        bytes32 buyQuotaOrderId = keccak256("buy-quota-order");
        vm.prank(alice);
        exchange.placeSellOrder(buyQuotaOrderId, 25 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(buyQuotaOrderId, 25 ether, "buy-quota-order");

        uint256 nodeFeeReceiverBefore = usdtToken.balanceOf(nodeFeeReceiver);
        uint256 markerFeeReceiverBefore = usdtToken.balanceOf(markerFeeReceiver);
        uint256 bobUsdtBefore = usdtToken.balanceOf(bob);

        vm.prank(alice);
        exchange.placeBuyOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertEq(exchange.feeExemptSpaceQuotas(bob), 0);
        assertEq(usdtToken.balanceOf(bob), bobUsdtBefore + 79.7 ether);
        assertEq(usdtToken.balanceOf(nodeFeeReceiver), nodeFeeReceiverBefore + 0.12 ether);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), markerFeeReceiverBefore + 0.18 ether);
    }

    function testCannotUseWrongSignerForFeeExempt() public {
        bytes memory signature = _signFeeExempt(alice, true, 0xB0B);

        vm.expectRevert(TokenExchange.InvalidSignature.selector);
        exchange.setFeeExempt(alice, true, signature);
    }

    function testCannotReplayFeeExemptSignature() public {
        bytes memory signature = _signFeeExempt(alice, true, signerKey);

        exchange.setFeeExempt(alice, true, signature);

        vm.expectRevert(TokenExchange.InvalidSignature.selector);
        exchange.setFeeExempt(alice, true, signature);

        assertTrue(exchange.feeExemptAccounts(alice));
        assertEq(exchange.feeExemptNonces(alice), 1);
    }

    function testOldEnableSignatureCannotReenableAfterDisable() public {
        bytes memory enableSignature = _signFeeExempt(alice, true, signerKey);
        exchange.setFeeExempt(alice, true, enableSignature);

        bytes memory disableSignature = _signFeeExempt(alice, false, signerKey);
        exchange.setFeeExempt(alice, false, disableSignature);

        vm.expectRevert(TokenExchange.InvalidSignature.selector);
        exchange.setFeeExempt(alice, true, enableSignature);

        assertFalse(exchange.feeExemptAccounts(alice));
        assertEq(exchange.feeExemptNonces(alice), 2);
    }

    function testDisablingFeeExemptClearsQuota() public {
        bytes memory enableSignature = _signFeeExempt(bob, true, signerKey);
        exchange.setFeeExempt(bob, true, enableSignature);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertEq(exchange.feeExemptSpaceQuotas(bob), 40 ether);

        bytes memory disableSignature = _signFeeExempt(bob, false, signerKey);
        exchange.setFeeExempt(bob, false, disableSignature);

        assertFalse(exchange.feeExemptAccounts(bob));
        assertEq(exchange.feeExemptSpaceQuotas(bob), 0);
    }

    function testFeeExemptSellerWithZeroQuotaPaysFullFee() public {
        bytes memory signature = _signFeeExempt(alice, true, signerKey);
        exchange.setFeeExempt(alice, true, signature);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        uint256 aliceUsdtBefore = usdtToken.balanceOf(alice);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertEq(exchange.feeExemptSpaceQuotas(alice), 0);
        assertEq(usdtToken.balanceOf(alice), aliceUsdtBefore + 79.2 ether);
        assertEq(usdtToken.balanceOf(nodeFeeReceiver), 0.32 ether);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), 0.48 ether);
    }

    function testCancelBuyOrderRefundsRemainingUsdt() public {
        vm.startPrank(alice);
        exchange.placeBuyOrder(ORDER_ID, 100 ether, PRICE, true);

        exchange.cancelOrder(ORDER_ID);
        vm.stopPrank();

        assertEq(usdtToken.balanceOf(alice), 10_000 ether);
        assertEq(usdtToken.balanceOf(address(exchange)), 0);

        (,,,, uint256 remainingSpaceAmount,, TokenExchange.OrderStatus status,,) = exchange.orders(ORDER_ID);
        assertEq(remainingSpaceAmount, 0);
        assertEq(uint8(status), uint8(TokenExchange.OrderStatus.Cancelled));
    }

    function testCancelSellOrderRefundsRemainingSpaceAfterPartialFill() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        vm.prank(alice);
        exchange.cancelOrder(ORDER_ID);

        assertEq(spaceToken.balanceOf(alice), 960 ether);
        assertEq(spaceToken.balanceOf(address(exchange)), 0);

        (,,,, uint256 remainingSpaceAmount,, TokenExchange.OrderStatus status,,) = exchange.orders(ORDER_ID);
        assertEq(remainingSpaceAmount, 0);
        assertEq(uint8(status), uint8(TokenExchange.OrderStatus.Cancelled));
    }

    function testCannotPlaceOrderOutsidePriceRange() public {
        vm.prank(alice);
        vm.expectRevert(TokenExchange.PriceOutOfRange.selector);
        exchange.placeSellOrder(ORDER_ID, 100 ether, MAX_PRICE + 1, true);
    }

    function testCannotPlaceOrderBelowMinimumSpaceAmount() public {
        vm.prank(alice);
        vm.expectRevert(TokenExchange.InvalidAmount.selector);
        exchange.placeSellOrder(ORDER_ID, MIN_ORDER_SPACE_AMOUNT - 1, PRICE, true);
    }

    function testVisibleOrderDoesNotRequireOrderIdSource() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, "");

        assertEq(exchange.getOrder(ORDER_ID).remainingSpaceAmount, 60 ether);
    }

    function testHiddenOrderRequiresSourceToFill() public {
        bytes32 hiddenOrderId = keccak256("hidden-order-1");

        vm.prank(alice);
        exchange.placeSellOrder(hiddenOrderId, 100 ether, PRICE, false);

        vm.prank(bob);
        vm.expectRevert(TokenExchange.InvalidOrderId.selector);
        exchange.fillOrder(hiddenOrderId, 40 ether, "wrong-order");

        vm.prank(bob);
        vm.expectRevert(TokenExchange.InvalidOrderId.selector);
        exchange.fillOrder(hiddenOrderId, 40 ether, "");
    }

    function testHiddenOrderFillsWithCorrectSource() public {
        bytes32 hiddenOrderId = keccak256("hidden-order-1");

        vm.prank(alice);
        exchange.placeSellOrder(hiddenOrderId, 100 ether, PRICE, false);

        vm.prank(bob);
        exchange.fillOrder(hiddenOrderId, 40 ether, "hidden-order-1");

        assertEq(exchange.getOrder(hiddenOrderId).id, hiddenOrderId);
    }

    function testCannotReuseOrderId() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        vm.expectRevert(TokenExchange.OrderAlreadyExists.selector);
        exchange.placeBuyOrder(ORDER_ID, 100 ether, PRICE, true);
    }

    function testFillOrderDoesNotRequireMinimumSpaceAmount() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 1 ether, ORDER_SOURCE);

        assertEq(spaceToken.balanceOf(bob), 1_001 ether);
        (,,,, uint256 remainingSpaceAmount,, TokenExchange.OrderStatus status,,) = exchange.orders(ORDER_ID);
        assertEq(remainingSpaceAmount, 99 ether);
        assertEq(uint8(status), uint8(TokenExchange.OrderStatus.Open));
    }

    function testOwnerCanUpdatePriceRange() public {
        vm.prank(owner);
        exchange.setPriceRange(4 ether, 5 ether);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, 4 ether, true);

        assertEq(exchange.getOrder(ORDER_ID).id, ORDER_ID);
    }

    function testOwnerCanUpdateMinimumSpaceAmount() public {
        vm.prank(owner);
        exchange.setMinOrderSpaceAmount(200 ether);

        vm.prank(alice);
        vm.expectRevert(TokenExchange.InvalidAmount.selector);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 200 ether, PRICE, true);

        assertEq(exchange.getOrder(ORDER_ID).id, ORDER_ID);
    }

    function testOwnerCanUpdateMarkerFeeReceiver() public {
        address newMarkerFeeReceiver = address(0x2200);

        vm.expectEmit(true, true, false, true, address(exchange));
        emit TokenExchange.MarkerFeeReceiverUpdated(markerFeeReceiver, newMarkerFeeReceiver);

        vm.prank(owner);
        exchange.setMarkerFeeReceiver(newMarkerFeeReceiver);

        assertEq(exchange.nodeFeeReceiver(), nodeFeeReceiver);
        assertEq(exchange.markerFeeReceiver(), newMarkerFeeReceiver);
    }

    function testCannotSetZeroMarkerFeeReceiver() public {
        vm.prank(owner);
        vm.expectRevert(TokenExchange.InvalidAddress.selector);
        exchange.setMarkerFeeReceiver(address(0));
    }

    function testOnlyOwnerCanUpdateMarkerFeeReceiver() public {
        vm.prank(alice);
        vm.expectRevert();
        exchange.setMarkerFeeReceiver(address(0x2200));
    }

    function testUpdatedMarkerFeeReceiverReceivesFees() public {
        address newMarkerFeeReceiver = address(0x2200);

        vm.prank(owner);
        exchange.setMarkerFeeReceiver(newMarkerFeeReceiver);

        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        exchange.fillOrder(ORDER_ID, 40 ether, ORDER_SOURCE);

        assertEq(usdtToken.balanceOf(nodeFeeReceiver), 0.32 ether);
        assertEq(usdtToken.balanceOf(markerFeeReceiver), 0);
        assertEq(usdtToken.balanceOf(newMarkerFeeReceiver), 0.48 ether);
    }

    function testOnlyMakerCanCancelOrder() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        vm.expectRevert(TokenExchange.NotOrderMaker.selector);
        exchange.cancelOrder(ORDER_ID);
    }

    function testCannotFillMoreThanRemaining() public {
        vm.prank(alice);
        exchange.placeSellOrder(ORDER_ID, 100 ether, PRICE, true);

        vm.prank(bob);
        vm.expectRevert(TokenExchange.InvalidAmount.selector);
        exchange.fillOrder(ORDER_ID, 101 ether, ORDER_SOURCE);
    }

    function _signFeeExempt(address account, bool exempt, uint256 privateKey) internal view returns (bytes memory) {
        bytes32 digest = exchange.getFeeExemptDigest(account, exempt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
