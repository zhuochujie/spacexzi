// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBuybackMarket {
    function feeExemptAccounts(address account) external view returns (bool);
    function creditBuybackPurchase(address account, uint256 amount) external;
    function consumeBuybackReturnQuota(address account, uint256 amount) external;
}

contract BuybackPool is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant PRICE_PRECISION = 1e18;
    IERC20 public immutable SPACE;
    IERC20 public immutable USDT;
    IBuybackMarket public immutable market;
    address public immutable dividendVault;
    address public immutable fixedReceiver;
    uint256 public buyPrice;
    uint256 public sellPrice;

    event Bought(
        address indexed account,
        uint256 spaceAmount,
        uint256 usdtAmount,
        uint256 dividendAmount,
        uint256 reserveAmount,
        uint256 receiverAmount
    );
    event Sold(address indexed account, uint256 spaceAmount, uint256 usdtAmount);
    event Funded(address indexed account, address indexed token, uint256 amount);
    event Withdrawn(address indexed operator, address indexed token, address indexed recipient, uint256 amount);
    event PricesUpdated(uint256 buyPrice, uint256 sellPrice);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidPrice();
    error Expired();
    error MarketMakerRequired();
    error PriceChanged();
    error InsufficientLiquidity();
    error InvalidReceivedAmount();

    constructor(
        address space,
        address usdt,
        address market_,
        address dividendVault_,
        address fixedReceiver_,
        uint256 buyPrice_,
        uint256 sellPrice_
    ) Ownable(msg.sender) {
        if (
            space == address(0) || usdt == address(0) || market_ == address(0) || dividendVault_ == address(0)
                || fixedReceiver_ == address(0)
        ) revert InvalidAddress();
        if (space == usdt || dividendVault_ == fixedReceiver_) revert InvalidAddress();
        SPACE = IERC20(space);
        USDT = IERC20(usdt);
        market = IBuybackMarket(market_);
        dividendVault = dividendVault_;
        fixedReceiver = fixedReceiver_;
        _setPrices(buyPrice_, sellPrice_);
    }

    function quoteBuy(uint256 spaceAmount) public view returns (uint256) {
        return Math.mulDiv(spaceAmount, buyPrice, PRICE_PRECISION, Math.Rounding.Ceil);
    }

    function quoteSell(uint256 spaceAmount) public view returns (uint256) {
        return Math.mulDiv(spaceAmount, sellPrice, PRICE_PRECISION);
    }

    function buy(uint256 spaceAmount, uint256 maxUsdtIn, uint256 deadline) external nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert Expired();
        if (!market.feeExemptAccounts(msg.sender)) revert MarketMakerRequired();
        uint256 paid = quoteBuy(spaceAmount);
        if (spaceAmount == 0 || paid == 0) revert InvalidAmount();
        if (paid > maxUsdtIn) revert PriceChanged();
        if (SPACE.balanceOf(address(this)) < spaceAmount) revert InsufficientLiquidity();
        _receive(USDT, paid);
        uint256 dividendAmount = Math.mulDiv(paid, 5000, 10000);
        uint256 receiverAmount = Math.mulDiv(paid, 2000, 10000);
        if (dividendAmount > 0) USDT.safeTransfer(dividendVault, dividendAmount);
        if (receiverAmount > 0) USDT.safeTransfer(fixedReceiver, receiverAmount);
        uint256 beforeBalance = SPACE.balanceOf(msg.sender);
        SPACE.safeTransfer(msg.sender, spaceAmount);
        if (SPACE.balanceOf(msg.sender) - beforeBalance != spaceAmount) revert InvalidReceivedAmount();
        market.creditBuybackPurchase(msg.sender, spaceAmount);
        emit Bought(
            msg.sender, spaceAmount, paid, dividendAmount, paid - dividendAmount - receiverAmount, receiverAmount
        );
    }

    function sell(uint256 spaceAmount, uint256 minUsdtOut, uint256 deadline) external nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert Expired();
        uint256 amount = quoteSell(spaceAmount);
        if (spaceAmount == 0 || amount == 0) revert InvalidAmount();
        if (amount < minUsdtOut) revert PriceChanged();
        if (USDT.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
        _receive(SPACE, spaceAmount);
        market.consumeBuybackReturnQuota(msg.sender, spaceAmount);
        USDT.safeTransfer(msg.sender, amount);
        emit Sold(msg.sender, spaceAmount, amount);
    }

    function fundSpace(uint256 amount) external nonReentrant {
        _fund(SPACE, amount);
    }

    function fundUsdt(uint256 amount) external nonReentrant {
        _fund(USDT, amount);
    }

    function withdrawSpace(address recipient, uint256 amount) external onlyOwner nonReentrant {
        _withdraw(SPACE, recipient, amount);
    }

    function withdrawUsdt(address recipient, uint256 amount) external onlyOwner nonReentrant {
        _withdraw(USDT, recipient, amount);
    }

    function _withdraw(IERC20 token, address recipient, uint256 amount) private {
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (token.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
        token.safeTransfer(recipient, amount);
        emit Withdrawn(msg.sender, address(token), recipient, amount);
    }

    function _fund(IERC20 token, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        _receive(token, amount);
        emit Funded(msg.sender, address(token), amount);
    }

    function _receive(IERC20 token, uint256 amount) internal {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert InvalidReceivedAmount();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setPrices(uint256 buyPrice_, uint256 sellPrice_) external onlyOwner whenPaused {
        _setPrices(buyPrice_, sellPrice_);
    }

    function _setPrices(uint256 buyPrice_, uint256 sellPrice_) internal {
        if (sellPrice_ == 0 || buyPrice_ <= sellPrice_) revert InvalidPrice();
        buyPrice = buyPrice_;
        sellPrice = sellPrice_;
        emit PricesUpdated(buyPrice_, sellPrice_);
    }
}
