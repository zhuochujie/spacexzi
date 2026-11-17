// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INodeRewardMining {
    function usdtToken() external view returns (address);
}

contract NodeMembership is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MessageHashUtils for bytes32;


    error InvalidLevel();
    error LevelDisabled();
    error AlreadyActivated();
    error NotActivated();
    error InvalidUpgrade();
    error InvalidTreasury();
    error InvalidUsdt();
    error InvalidSigner();
    error InvalidMining();
    error InvalidReceivedAmount();
    error InvalidSignature();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error PurchasePausedError();
    error InvalidAmount();
    bytes32 public constant PURCHASE_NODE_ACTION = keccak256("PURCHASE_NODE");
    bytes32 public constant UPGRADE_NODE_ACTION = keccak256("UPGRADE_NODE");

    struct LevelConfig {
        string name;
        uint256 price;
        bool enabled;
    }

    struct UserInfo {
        bool activated;
        uint256 levelIndex;
        uint256 totalPaid;
    }

    IERC20 public immutable USDT;
    address public treasury;
    address public signer;
    address public immutable mining;
    uint256 public totalActivatedUsers;
    bool public purchasePaused;

    LevelConfig[] public levels;
    mapping(address => UserInfo) public users;
    mapping(string => bool) public usedPurchaseNonces;

    event LevelCreated(uint256 indexed levelIndex, string name, uint256 price, bool enabled);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PurchasePausedSet(bool paused);
    event NodePurchased(
        address indexed user, uint256 indexed level, uint256 amount, uint256 rewardAmount, string nonce
    );

    constructor(address usdt_, address treasury_, address signer_, address mining_) Ownable(msg.sender) {
        if (usdt_ == address(0)) {
            revert InvalidUsdt();
        }
        if (treasury_ == address(0)) {
            revert InvalidTreasury();
        }
        if (signer_ == address(0)) {
            revert InvalidSigner();
        }

        if (mining_ == address(0) || mining_.code.length == 0) revert InvalidMining();
        try INodeRewardMining(mining_).usdtToken() returns (address token) {
            if (token != usdt_) revert InvalidMining();
        } catch {
            revert InvalidMining();
        }
        mining = mining_;
        USDT = IERC20(usdt_);
        treasury = treasury_;
        signer = signer_;
    }

    function createLevel(string calldata name, uint256 price, bool enabled) external onlyOwner {
        if (price == 0) {
            revert InvalidLevel();
        }

        uint256 levelIndex = levels.length;
        levels.push(LevelConfig({name: name, price: price, enabled: enabled}));

        emit LevelCreated(levelIndex, name, price, enabled);
    }

    function getAllLevels() external view returns (LevelConfig[] memory) {
        return levels;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) {
            revert InvalidTreasury();
        }

        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) {
            revert InvalidSigner();
        }

        address oldSigner = signer;
        signer = newSigner;
        emit SignerUpdated(oldSigner, newSigner);
    }

    function setPurchasePaused(bool paused) external onlyOwner {
        purchasePaused = paused;
        emit PurchasePausedSet(paused);
    }

    function purchase(
        uint256 targetLevelIndex,
        uint256 amount,
        uint256 rewardAmount,
        string calldata nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (purchasePaused) {
            revert PurchasePausedError();
        }
        _validatePurchase(
            getPurchaseDigest(msg.sender, targetLevelIndex, amount, rewardAmount, nonce, deadline),
            nonce,
            deadline,
            signature
        );

        UserInfo storage user = users[msg.sender];
        if (user.activated) {
            revert AlreadyActivated();
        }

        LevelConfig memory level = _getEnabledLevel(targetLevelIndex);

        if (amount != level.price || rewardAmount > amount) revert InvalidAmount();
        usedPurchaseNonces[nonce] = true;
        user.activated = true;
        user.levelIndex = targetLevelIndex;
        user.totalPaid += level.price;

        _settlePayment(amount, rewardAmount);
        totalActivatedUsers += 1;

        emit NodePurchased(msg.sender, targetLevelIndex + 1, amount, rewardAmount, nonce);
    }

    function upgrade(
        uint256 fromLevel,
        uint256 targetLevelIndex,
        uint256 amount,
        uint256 rewardAmount,
        string calldata nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (purchasePaused) {
            revert PurchasePausedError();
        }
        _validatePurchase(
            getUpgradeDigest(msg.sender, fromLevel, targetLevelIndex, amount, rewardAmount, nonce, deadline),
            nonce,
            deadline,
            signature
        );

        UserInfo storage user = users[msg.sender];
        if (!user.activated) {
            revert NotActivated();
        }

        LevelConfig memory currentLevel = _getLevel(user.levelIndex);
        LevelConfig memory targetLevel = _getEnabledLevel(targetLevelIndex);

        if (
            fromLevel != user.levelIndex + 1 || targetLevelIndex <= user.levelIndex
                || targetLevel.price <= currentLevel.price
        ) {
            revert InvalidUpgrade();
        }

        uint256 delta = targetLevel.price - currentLevel.price;
        if (amount != delta || rewardAmount > amount) revert InvalidAmount();
        usedPurchaseNonces[nonce] = true;

        user.levelIndex = targetLevelIndex;
        user.totalPaid += delta;

        _settlePayment(delta, rewardAmount);

        emit NodePurchased(msg.sender, targetLevelIndex + 1, delta, rewardAmount, nonce);
    }

    function getUpgradeCost(address userAddress, uint256 targetLevelIndex) external view returns (uint256) {
        LevelConfig memory targetLevel = _getLevel(targetLevelIndex);
        UserInfo storage user = users[userAddress];

        if (!user.activated) {
            return targetLevel.price;
        }

        LevelConfig memory currentLevel = _getLevel(user.levelIndex);
        if (targetLevelIndex <= user.levelIndex || targetLevel.price <= currentLevel.price) {
            return 0;
        }

        return targetLevel.price - currentLevel.price;
    }

    function getUserLevel(address userAddress) external view returns (uint256) {
        UserInfo storage user = users[userAddress];
        return user.activated ? user.levelIndex + 1 : 0;
    }

    function _settlePayment(uint256 amount, uint256 rewardAmount) internal {
        uint256 platformAmount = amount - rewardAmount;
        uint256 beforeBalance = USDT.balanceOf(address(this));
        USDT.safeTransferFrom(msg.sender, address(this), amount);
        if (USDT.balanceOf(address(this)) - beforeBalance != amount) revert InvalidReceivedAmount();
        if (rewardAmount > 0) {
            uint256 beforeMining = USDT.balanceOf(mining);
            USDT.safeTransfer(mining, rewardAmount);
            if (USDT.balanceOf(mining) - beforeMining != rewardAmount) revert InvalidReceivedAmount();
        }
        if (platformAmount > 0) {
            USDT.safeTransfer(treasury, platformAmount);
        }
    }

    function _getLevel(uint256 levelIndex) internal view returns (LevelConfig memory level) {
        if (levelIndex >= levels.length) {
            revert InvalidLevel();
        }

        level = levels[levelIndex];
    }

    function _getEnabledLevel(uint256 levelIndex) internal view returns (LevelConfig memory level) {
        level = _getLevel(levelIndex);
        if (!level.enabled) {
            revert LevelDisabled();
        }
    }

    function getPurchaseDigest(
        address buyer,
        uint256 targetLevelIndex,
        uint256 amount,
        uint256 rewardAmount,
        string calldata nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
                abi.encodePacked(
                    PURCHASE_NODE_ACTION,
                    address(this),
                    block.chainid,
                    buyer,
                    uint256(0),
                    targetLevelIndex,
                    amount,
                    rewardAmount,
                    keccak256(bytes(nonce)),
                    deadline
                )
            ).toEthSignedMessageHash();
    }

    function getUpgradeDigest(
        address buyer,
        uint256 fromLevel,
        uint256 targetLevelIndex,
        uint256 amount,
        uint256 rewardAmount,
        string calldata nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
                abi.encodePacked(
                    UPGRADE_NODE_ACTION,
                    address(this),
                    block.chainid,
                    buyer,
                    fromLevel,
                    targetLevelIndex,
                    amount,
                    rewardAmount,
                    keccak256(bytes(nonce)),
                    deadline
                )
            ).toEthSignedMessageHash();
    }

    function _validatePurchase(bytes32 digest, string calldata nonce, uint256 deadline, bytes calldata signature)
        internal
        view
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (usedPurchaseNonces[nonce]) revert NonceAlreadyUsed();
        (address recoveredSigner, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(digest, signature);
        if (recoverError != ECDSA.RecoverError.NoError || recoveredSigner != signer) revert InvalidSignature();
    }
}
