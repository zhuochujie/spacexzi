// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BuybackPool} from "../src/BuybackPool.sol";
import {SpaceXZIToken} from "../src/SpaceXZIToken.sol";
import {TokenExchange} from "../src/TokenExchange.sol";
import {Mining} from "../src/Mining.sol";
import {Vault} from "../src/Vault.sol";

contract PoolUsdt is ERC20 {
    constructor() ERC20("USDT", "USDT") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

contract BuybackPoolTest is Test {
    SpaceXZIToken space;
    PoolUsdt usdt;
    BuybackPool pool;
    TokenExchange market;
    Vault dividendVault;
    uint256 signerKey = 0xA11CE;
    address buyer = address(0xBEEF);
    address user = address(0xCAFE);
    address receiver = address(0x1234);

    function setUp() public {
        vm.warp(1794153600 + 2 days);
        usdt = new PoolUsdt();
        space = new SpaceXZIToken(address(this), receiver, address(0x4321));
        market = new TokenExchange(
            address(space),
            address(usdt),
            address(0x4321),
            receiver,
            0.1 ether,
            2 ether,
            1 ether,
            500,
            500,
            vm.addr(signerKey)
        );
        dividendVault = new Vault();
        pool = new BuybackPool(
            address(space), address(usdt), address(market), address(dividendVault), receiver, 1 ether, 0.2 ether
        );
        market.setBuybackSource(address(pool), true);
        space.setWhitelist(address(this), true);
        space.setWhitelist(address(pool), true);
        space.setWhitelist(address(market), true);
        space.approve(address(pool), type(uint256).max);
        usdt.approve(address(pool), type(uint256).max);
        pool.fundSpace(10000 ether);
        usdt.transfer(buyer, 1000 ether);
        space.transfer(buyer, 1000 ether);
        space.transfer(user, 100 ether);
        vm.startPrank(buyer);
        space.approve(address(pool), type(uint256).max);
        usdt.approve(address(pool), type(uint256).max);
        space.approve(address(market), type(uint256).max);
        vm.stopPrank();
        vm.prank(user);
        space.approve(address(pool), type(uint256).max);
        bytes32 digest = market.getFeeExemptDigest(buyer, true);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        market.setFeeExempt(buyer, true, abi.encodePacked(r, s, v));
    }

    function buy100() internal {
        vm.prank(buyer);
        pool.buy(100 ether, 100 ether, block.timestamp + 180);
    }

    function testBuySplitsAndGrantsUnifiedQuota() public {
        buy100();
        assertEq(usdt.balanceOf(address(dividendVault)), 50 ether);
        assertEq(usdt.balanceOf(address(pool)), 30 ether);
        assertEq(usdt.balanceOf(receiver), 20 ether);
        assertEq(space.balanceOf(buyer), 1100 ether);
        assertEq(market.feeExemptSpaceQuotas(buyer), 100 ether);
    }

    function testOnlyMakerCanBuyButAnyUserCanSell() public {
        vm.expectRevert(BuybackPool.MarketMakerRequired.selector);
        vm.prank(user);
        pool.buy(1 ether, 1 ether, block.timestamp + 180);
        pool.fundUsdt(20 ether);
        vm.prank(user);
        pool.sell(100 ether, 20 ether, block.timestamp + 180);
        assertEq(usdt.balanceOf(user), 20 ether);
    }

    function testReturnConsumesQuotaButNotDividendFunds() public {
        buy100();
        vm.prank(buyer);
        pool.sell(100 ether, 20 ether, block.timestamp + 180);
        assertEq(market.feeExemptSpaceQuotas(buyer), 0);
        assertEq(usdt.balanceOf(address(dividendVault)), 50 ether);
        assertEq(usdt.balanceOf(address(pool)), 10 ether);
    }

    function testPoolCannotSpendDividendVaultBalance() public {
        buy100();
        vm.expectRevert(BuybackPool.InsufficientLiquidity.selector);
        vm.prank(buyer);
        pool.sell(200 ether, 40 ether, block.timestamp + 180);
        assertEq(usdt.balanceOf(address(dividendVault)), 50 ether);
        assertEq(market.feeExemptSpaceQuotas(buyer), 100 ether);
    }

    function testMarketSaleSharesPoolQuota() public {
        buy100();
        bytes32 id = keccak256("order");
        vm.prank(buyer);
        market.placeSellOrder(id, 20 ether, 1 ether, true);
        usdt.approve(address(market), 20 ether);
        market.fillOrder(id, 20 ether, "");
        assertEq(market.feeExemptSpaceQuotas(buyer), 80 ether);
        vm.prank(buyer);
        pool.sell(30 ether, 6 ether, block.timestamp + 180);
        assertEq(market.feeExemptSpaceQuotas(buyer), 50 ether);
    }

    function testUnauthorizedQuotaSourceRejected() public {
        vm.expectRevert(TokenExchange.UnauthorizedBuybackSource.selector);
        market.creditBuybackPurchase(buyer, 1 ether);
        vm.expectRevert(TokenExchange.UnauthorizedBuybackSource.selector);
        market.consumeBuybackReturnQuota(buyer, 1 ether);
    }

    function testQuotaFailureRollsBackPaymentAndSplit() public {
        market.setBuybackSource(address(pool), false);
        vm.expectRevert(TokenExchange.UnauthorizedBuybackSource.selector);
        vm.prank(buyer);
        pool.buy(100 ether, 100 ether, block.timestamp + 180);
        assertEq(usdt.balanceOf(buyer), 1000 ether);
        assertEq(usdt.balanceOf(address(dividendVault)), 0);
        assertEq(usdt.balanceOf(receiver), 0);
    }

    function testRepeatedBuysAccumulateQuota() public {
        buy100();
        buy100();
        assertEq(market.feeExemptSpaceQuotas(buyer), 200 ether);
    }

    function testLiquidityFailureDoesNotTakePayment() public {
        vm.expectRevert(BuybackPool.InsufficientLiquidity.selector);
        vm.prank(buyer);
        pool.buy(10001 ether, 10001 ether, block.timestamp + 180);
        assertEq(usdt.balanceOf(buyer), 1000 ether);
    }

    function testDeadlineAndPriceBounds() public {
        vm.expectRevert(BuybackPool.Expired.selector);
        vm.prank(buyer);
        pool.buy(100 ether, 100 ether, block.timestamp - 1);
        vm.expectRevert(BuybackPool.PriceChanged.selector);
        vm.prank(buyer);
        pool.buy(100 ether, 99 ether, block.timestamp + 180);
        vm.expectRevert(BuybackPool.PriceChanged.selector);
        vm.prank(user);
        pool.sell(1 ether, 1 ether, block.timestamp + 180);
    }

    function testPricesOnlyChangeWhilePausedAndRequireSpread() public {
        vm.expectRevert();
        pool.setPrices(2 ether, 1 ether);
        pool.pause();
        vm.expectRevert(BuybackPool.InvalidPrice.selector);
        pool.setPrices(1 ether, 1 ether);
        pool.setPrices(2 ether, 1 ether);
        pool.unpause();
        assertEq(pool.quoteBuy(1 ether), 2 ether);
        assertEq(pool.quoteSell(1 ether), 1 ether);
    }

    function testFundingDoesNotSplitOrGrantQuota() public {
        pool.fundUsdt(100 ether);
        assertEq(usdt.balanceOf(address(pool)), 100 ether);
        assertEq(usdt.balanceOf(address(dividendVault)), 0);
        assertEq(market.feeExemptSpaceQuotas(address(this)), 0);
    }

    function testQuotesRoundBuyUpAndSellDown() public {
        pool.pause();
        pool.setPrices(1.1 ether, 0.2 ether);
        assertEq(pool.quoteBuy(1), 2);
        assertEq(pool.quoteSell(1), 0);
    }

    function testMiningCollectsOnlyAllocatedAmountAndRetainsRemainder() public {
        usdt.transfer(address(dividendVault), 5000 ether);
        Mining mining = new Mining(
            address(space),
            address(usdt),
            address(0x2222),
            vm.addr(signerKey),
            address(0x3333),
            address(0x4444),
            receiver,
            0
        );
        space.setWhitelist(address(mining), true);
        mining.setBuybackDividendVault(address(dividendVault));
        dividendVault.approve(address(usdt), address(mining), type(uint256).max);
        vm.prank(vm.addr(signerKey));
        mining.dividend(0, 0, 0, 0, 4400 ether);
        assertEq(usdt.balanceOf(address(mining)), 4400 ether);
        assertEq(usdt.balanceOf(address(dividendVault)), 600 ether);
        vm.expectRevert(Mining.InvalidSigner.selector);
        mining.dividend(0, 0, 0, 0, 1 ether);
        vm.expectRevert(Mining.InvalidFeeReceiver.selector);
        mining.setBuybackDividendVault(address(0x5555));
    }

    function testOwnerWithdrawsOnlyPoolBalancesAndEmitsAuditEvents() public {
        buy100();
        uint256 quota = market.feeExemptSpaceQuotas(buyer);
        uint256 receiverBefore = usdt.balanceOf(receiver);
        uint256 recipientSpace = space.balanceOf(user);
        vm.expectEmit(true, true, true, true, address(pool));
        emit BuybackPool.Withdrawn(address(this), address(space), user, 50 ether);
        pool.withdrawSpace(user, 50 ether);
        assertEq(space.balanceOf(user), recipientSpace + 50 ether);
        assertEq(space.balanceOf(address(pool)), 9850 ether);
        vm.expectEmit(true, true, true, true, address(pool));
        emit BuybackPool.Withdrawn(address(this), address(usdt), user, 12 ether);
        pool.withdrawUsdt(user, 12 ether);
        assertEq(usdt.balanceOf(user), 12 ether);
        assertEq(usdt.balanceOf(address(pool)), 18 ether);
        assertEq(usdt.balanceOf(address(dividendVault)), 50 ether);
        assertEq(usdt.balanceOf(receiver), receiverBefore);
        assertEq(market.feeExemptSpaceQuotas(buyer), quota);
    }

    function testOnlyCurrentOwnerCanWithdrawEitherAsset() public {
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", buyer));
        vm.prank(buyer);
        pool.withdrawSpace(user, 1 ether);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", buyer));
        vm.prank(buyer);
        pool.withdrawUsdt(user, 1 ether);
        pool.transferOwnership(buyer);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        pool.withdrawSpace(user, 1 ether);
        vm.prank(buyer);
        pool.withdrawSpace(user, 1 ether);
        assertEq(space.balanceOf(user), 101 ether);
    }

    function testWithdrawalRejectsInvalidRecipientAmountsAndInsufficientBalance() public {
        vm.expectRevert(BuybackPool.InvalidAddress.selector);
        pool.withdrawSpace(address(0), 1 ether);
        vm.expectRevert(BuybackPool.InvalidAddress.selector);
        pool.withdrawUsdt(address(pool), 1 ether);
        vm.expectRevert(BuybackPool.InvalidAmount.selector);
        pool.withdrawSpace(user, 0);
        vm.expectRevert(BuybackPool.InvalidAmount.selector);
        pool.withdrawUsdt(user, 0);
        vm.expectRevert(BuybackPool.InsufficientLiquidity.selector);
        pool.withdrawSpace(user, 10001 ether);
        vm.expectRevert(BuybackPool.InsufficientLiquidity.selector);
        pool.withdrawUsdt(user, 1);
    }

    function testOwnerCanWithdrawWhilePaused() public {
        pool.fundUsdt(100 ether);
        pool.pause();
        pool.withdrawUsdt(user, 100 ether);
        pool.withdrawSpace(user, 10000 ether);
        assertEq(usdt.balanceOf(address(pool)), 0);
        assertEq(space.balanceOf(address(pool)), 0);
        assertTrue(pool.paused());
    }
}
