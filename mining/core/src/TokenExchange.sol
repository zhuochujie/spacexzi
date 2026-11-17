// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TokenExchange is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    bytes32 private constant SET_FEE_EXEMPT_ACTION = keccak256("SET_FEE_EXEMPT");

    enum OrderSide {
        Buy,
        Sell
    }

    enum OrderStatus {
        Open,
        Filled,
        Cancelled
    }

    struct Order {
        bytes32 id;
        address maker;
        OrderSide side;
        uint256 spaceAmount;
        uint256 remainingSpaceAmount;
        uint256 price;
        OrderStatus status;
        bool visible;
        uint256 createdAt;
    }

    IERC20 public immutable SPACE_TOKEN;
    IERC20 public immutable USDT_TOKEN;

    uint256 public minPrice;
    uint256 public maxPrice;
    uint256 public minOrderSpaceAmount;
    uint256 public nodeFeeBps;
    uint256 public markerFeeBps;
    address private immutable NODE_FEE_RECEIVER;
    address public markerFeeReceiver;
    address public signer;

    mapping(bytes32 orderId => Order order) public orders;
    mapping(address account => bool exempt) public feeExemptAccounts;
    mapping(address account => uint256 quota) public feeExemptSpaceQuotas;
    mapping(address account => uint256 nonce) public feeExemptNonces;

    mapping(address source => bool allowed) public buybackSources;
    event BuybackSourceUpdated(address indexed source, bool allowed);
    event BuybackPurchaseRecorded(address indexed pool, address indexed account, uint256 spaceAmount, uint256 newQuota);
    error UnauthorizedBuybackSource();
    error MarketMakerRequired();

    function setBuybackSource(address source, bool allowed) external onlyOwner {
        if (source == address(0)) revert InvalidAddress();
        buybackSources[source] = allowed;
        emit BuybackSourceUpdated(source, allowed);
    }

    function creditBuybackPurchase(address account, uint256 amount) external {
        if (!buybackSources[msg.sender]) revert UnauthorizedBuybackSource();
        if (!feeExemptAccounts[account]) revert MarketMakerRequired();
        if (amount == 0) revert InvalidAmount();
        _increaseFeeExemptQuota(account, amount);
        emit BuybackPurchaseRecorded(msg.sender, account, amount, feeExemptSpaceQuotas[account]);
    }

    function consumeBuybackReturnQuota(address account, uint256 amount) external {
        if (!buybackSources[msg.sender]) revert UnauthorizedBuybackSource();
        uint256 quota = feeExemptSpaceQuotas[account];
        uint256 used = amount < quota ? amount : quota;
        if (used > 0) {
            feeExemptSpaceQuotas[account] = quota - used;
            emit FeeExemptQuotaUsed(account, used, quota - used);
        }
    }

    event PriceRangeUpdated(uint256 minPrice, uint256 maxPrice);
    event MinOrderSpaceAmountUpdated(uint256 minOrderSpaceAmount);
    event FeeBpsUpdated(uint256 nodeFeeBps, uint256 markerFeeBps);
    event MarkerFeeReceiverUpdated(address indexed oldMarkerFeeReceiver, address indexed newMarkerFeeReceiver);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event FeeExemptUpdated(address indexed account, bool exempt);
    event FeeExemptQuotaIncreased(address indexed account, uint256 amount, uint256 newQuota);
    event FeeExemptQuotaUsed(address indexed account, uint256 amount, uint256 remainingQuota);
    event OrderPlaced(
        bytes32 indexed orderId,
        address indexed maker,
        OrderSide side,
        uint256 spaceAmount,
        uint256 price,
        uint256 usdtAmount,
        bool visible
    );
    event OrderFilled(
        bytes32 indexed orderId,
        address indexed maker,
        address indexed taker,
        uint256 spaceAmount,
        uint256 price,
        uint256 usdtAmount,
        uint256 nodeFee,
        uint256 markerFee
    );
    event OrderCancelled(bytes32 indexed orderId, address indexed maker);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeBps();
    error InvalidOrderStatus();
    error InvalidOrderId();
    error InvalidPriceRange();
    error InvalidSignature();
    error InvalidSigner();
    error NotOrderMaker();
    error OrderAlreadyExists();
    error PriceOutOfRange();

    constructor(
        address spaceTokenAddr,
        address usdtTokenAddr,
        address nodeFeeReceiverAddr,
        address markerFeeReceiverAddr,
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 minOrderSpaceAmount_,
        uint256 nodeFeeBps_,
        uint256 markerFeeBps_,
        address signerAddr
    ) Ownable(msg.sender) {
        if (
            spaceTokenAddr == address(0) || usdtTokenAddr == address(0) || nodeFeeReceiverAddr == address(0)
                || markerFeeReceiverAddr == address(0) || signerAddr == address(0)
        ) {
            revert InvalidAddress();
        }
        if (minPrice_ == 0 || minPrice_ > maxPrice_) {
            revert InvalidPriceRange();
        }
        if (nodeFeeBps_ + markerFeeBps_ > BPS_DENOMINATOR) {
            revert InvalidFeeBps();
        }

        SPACE_TOKEN = IERC20(spaceTokenAddr);
        USDT_TOKEN = IERC20(usdtTokenAddr);
        NODE_FEE_RECEIVER = nodeFeeReceiverAddr;
        markerFeeReceiver = markerFeeReceiverAddr;
        signer = signerAddr;
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        minOrderSpaceAmount = minOrderSpaceAmount_;
        nodeFeeBps = nodeFeeBps_;
        markerFeeBps = markerFeeBps_;
    }

    function setPriceRange(uint256 minPrice_, uint256 maxPrice_) external onlyOwner {
        if (minPrice_ == 0 || minPrice_ > maxPrice_) {
            revert InvalidPriceRange();
        }

        minPrice = minPrice_;
        maxPrice = maxPrice_;

        emit PriceRangeUpdated(minPrice_, maxPrice_);
    }

    function setMinOrderSpaceAmount(uint256 minOrderSpaceAmount_) external onlyOwner {
        minOrderSpaceAmount = minOrderSpaceAmount_;

        emit MinOrderSpaceAmountUpdated(minOrderSpaceAmount_);
    }

    function setFeeBps(uint256 nodeFeeBps_, uint256 markerFeeBps_) external onlyOwner {
        if (nodeFeeBps_ + markerFeeBps_ > BPS_DENOMINATOR) {
            revert InvalidFeeBps();
        }

        nodeFeeBps = nodeFeeBps_;
        markerFeeBps = markerFeeBps_;

        emit FeeBpsUpdated(nodeFeeBps_, markerFeeBps_);
    }

    function setMarkerFeeReceiver(address markerFeeReceiver_) external onlyOwner {
        if (markerFeeReceiver_ == address(0)) {
            revert InvalidAddress();
        }

        address oldMarkerFeeReceiver = markerFeeReceiver;
        markerFeeReceiver = markerFeeReceiver_;

        emit MarkerFeeReceiverUpdated(oldMarkerFeeReceiver, markerFeeReceiver_);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) {
            revert InvalidSigner();
        }

        address oldSigner = signer;
        signer = signer_;

        emit SignerUpdated(oldSigner, signer_);
    }

    function setFeeExempt(address account, bool exempt, bytes calldata signature) external {
        if (account == address(0)) {
            revert InvalidAddress();
        }
        if (ECDSA.recoverCalldata(getFeeExemptDigest(account, exempt), signature) != signer) {
            revert InvalidSignature();
        }

        feeExemptNonces[account] += 1;
        feeExemptAccounts[account] = exempt;
        if (!exempt) {
            feeExemptSpaceQuotas[account] = 0;
        }

        emit FeeExemptUpdated(account, exempt);
    }

    function placeBuyOrder(bytes32 orderId, uint256 spaceAmount, uint256 price, bool visible) external nonReentrant {
        _checkOrderInput(spaceAmount, price);
        _checkOrderId(orderId);

        uint256 usdtAmount = quoteUsdtAmount(spaceAmount, price);
        if (usdtAmount == 0) {
            revert InvalidAmount();
        }

        _createOrder(orderId, OrderSide.Buy, spaceAmount, price, visible);
        USDT_TOKEN.safeTransferFrom(msg.sender, address(this), usdtAmount);

        emit OrderPlaced(orderId, msg.sender, OrderSide.Buy, spaceAmount, price, usdtAmount, visible);
    }

    function placeSellOrder(bytes32 orderId, uint256 spaceAmount, uint256 price, bool visible) external nonReentrant {
        _checkOrderInput(spaceAmount, price);
        _checkOrderId(orderId);

        uint256 usdtAmount = quoteUsdtAmount(spaceAmount, price);
        if (usdtAmount == 0) {
            revert InvalidAmount();
        }

        _createOrder(orderId, OrderSide.Sell, spaceAmount, price, visible);
        SPACE_TOKEN.safeTransferFrom(msg.sender, address(this), spaceAmount);

        emit OrderPlaced(orderId, msg.sender, OrderSide.Sell, spaceAmount, price, usdtAmount, visible);
    }

    function fillOrder(bytes32 orderId, uint256 spaceAmount, string calldata orderIdSource) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.Open) {
            revert InvalidOrderStatus();
        }
        if (spaceAmount == 0 || spaceAmount > order.remainingSpaceAmount) {
            revert InvalidAmount();
        }
        if (!order.visible && (bytes(orderIdSource).length == 0 || orderId != getOrderId(orderIdSource))) {
            revert InvalidOrderId();
        }

        uint256 usdtAmount = quoteUsdtAmount(spaceAmount, order.price);
        if (usdtAmount == 0) {
            revert InvalidAmount();
        }

        address buyer = order.side == OrderSide.Sell ? msg.sender : order.maker;
        address feePayer = order.side == OrderSide.Sell ? order.maker : msg.sender;
        (uint256 nodeFee, uint256 markerFee) = _consumeFeeExemptQuota(feePayer, spaceAmount, order.price, usdtAmount);
        uint256 totalFee = nodeFee + markerFee;
        order.remainingSpaceAmount -= spaceAmount;
        if (order.remainingSpaceAmount == 0) {
            order.status = OrderStatus.Filled;
        }
        _increaseFeeExemptQuota(buyer, spaceAmount);

        if (order.side == OrderSide.Sell) {
            USDT_TOKEN.safeTransferFrom(msg.sender, address(this), usdtAmount);
            USDT_TOKEN.safeTransfer(order.maker, usdtAmount - totalFee);
            _transferFees(nodeFee, markerFee);
            SPACE_TOKEN.safeTransfer(msg.sender, spaceAmount);
        } else {
            SPACE_TOKEN.safeTransferFrom(msg.sender, address(this), spaceAmount);
            SPACE_TOKEN.safeTransfer(order.maker, spaceAmount);
            USDT_TOKEN.safeTransfer(msg.sender, usdtAmount - totalFee);
            _transferFees(nodeFee, markerFee);
        }

        emit OrderFilled(orderId, order.maker, msg.sender, spaceAmount, order.price, usdtAmount, nodeFee, markerFee);
    }

    function cancelOrder(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.Open) {
            revert InvalidOrderStatus();
        }
        if (order.maker != msg.sender) {
            revert NotOrderMaker();
        }

        uint256 remainingSpaceAmount = order.remainingSpaceAmount;
        order.remainingSpaceAmount = 0;
        order.status = OrderStatus.Cancelled;

        if (order.side == OrderSide.Buy) {
            USDT_TOKEN.safeTransfer(msg.sender, quoteUsdtAmount(remainingSpaceAmount, order.price));
        } else {
            SPACE_TOKEN.safeTransfer(msg.sender, remainingSpaceAmount);
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    function quoteUsdtAmount(uint256 spaceAmount, uint256 price) public pure returns (uint256) {
        return spaceAmount * price / PRICE_PRECISION;
    }

    function quoteFee(uint256 usdtAmount) public view returns (uint256 nodeFee, uint256 markerFee) {
        nodeFee = usdtAmount * nodeFeeBps / BPS_DENOMINATOR;
        markerFee = usdtAmount * markerFeeBps / BPS_DENOMINATOR;
    }

    function nodeFeeReceiver() public view returns (address) {
        return NODE_FEE_RECEIVER;
    }

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getOrderId(string calldata orderIdSource) public pure returns (bytes32) {
        return keccak256(bytes(orderIdSource));
    }

    function getFeeExemptDigest(address account, bool exempt) public view returns (bytes32) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                SET_FEE_EXEMPT_ACTION, address(this), block.chainid, account, exempt, feeExemptNonces[account]
            )
        );

        return MessageHashUtils.toEthSignedMessageHash(messageHash);
    }

    function _createOrder(bytes32 orderId, OrderSide side, uint256 spaceAmount, uint256 price, bool visible) internal {
        orders[orderId] = Order({
            id: orderId,
            maker: msg.sender,
            side: side,
            spaceAmount: spaceAmount,
            remainingSpaceAmount: spaceAmount,
            price: price,
            status: OrderStatus.Open,
            visible: visible,
            createdAt: block.timestamp
        });
    }

    function _checkOrderId(bytes32 orderId) internal view {
        if (orderId == bytes32(0)) {
            revert InvalidOrderId();
        }
        if (orders[orderId].id != bytes32(0)) {
            revert OrderAlreadyExists();
        }
    }

    function _checkOrderInput(uint256 spaceAmount, uint256 price) internal view {
        if (spaceAmount == 0 || spaceAmount < minOrderSpaceAmount) {
            revert InvalidAmount();
        }
        if (price < minPrice || price > maxPrice) {
            revert PriceOutOfRange();
        }
    }

    function _consumeFeeExemptQuota(address account, uint256 spaceAmount, uint256 price, uint256 usdtAmount)
        internal
        returns (uint256 nodeFee, uint256 markerFee)
    {
        if (!feeExemptAccounts[account]) {
            return quoteFee(usdtAmount);
        }

        uint256 quota = feeExemptSpaceQuotas[account];
        if (quota >= spaceAmount) {
            feeExemptSpaceQuotas[account] = quota - spaceAmount;
            emit FeeExemptQuotaUsed(account, spaceAmount, quota - spaceAmount);
            return (0, 0);
        }

        if (quota > 0) {
            feeExemptSpaceQuotas[account] = 0;
            emit FeeExemptQuotaUsed(account, quota, 0);
        }

        return quoteFee(quoteUsdtAmount(spaceAmount - quota, price));
    }

    function _increaseFeeExemptQuota(address account, uint256 spaceAmount) internal {
        if (!feeExemptAccounts[account]) {
            return;
        }

        uint256 newQuota = feeExemptSpaceQuotas[account] + spaceAmount;
        feeExemptSpaceQuotas[account] = newQuota;
        emit FeeExemptQuotaIncreased(account, spaceAmount, newQuota);
    }

    function _transferFees(uint256 nodeFee, uint256 markerFee) internal {
        if (nodeFee > 0) {
            USDT_TOKEN.safeTransfer(NODE_FEE_RECEIVER, nodeFee);
        }
        if (markerFee > 0) {
            USDT_TOKEN.safeTransfer(markerFeeReceiver, markerFee);
        }
    }
}
