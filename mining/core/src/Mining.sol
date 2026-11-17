// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Mining is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant PURCHASE_MINER_ACTION = keccak256("PURCHASE_MINER");
    bytes32 private constant CLAIM_REWARD_ACTION = keccak256("CLAIM_REWARD");
    bytes32 private constant WITHDRAW_USDT_ACTION = keccak256("WITHDRAW_USDT");

    IERC20 public spaceToken;
    IERC20 public usdtToken;
    address public vault;
    address public signer;
    address public vipFeeReceiver;
    address public nodeFeeReceiver;

    address public usdtFeeReceiver;
    uint256 public freeMinerSpaceAmount;
    bool public freeMinerClaimEnabled;
    address public buybackDividendVault;

    mapping(string nonce => bool used) public usedPurchaseNonces;
    mapping(string nonce => bool used) public usedClaimNonces;
    mapping(string nonce => bool used) public usedWithdrawUsdtNonces;
    mapping(address account => bool claimed) public claimedFreeMiners;

    event BuybackDividendVaultUpdated(address indexed vault);

    event MinerPurchased(
        address indexed buyer, string minerId, uint256 price, uint256 payValue, uint256 expectedReward, string nonce
    );
    event RewardClaimed(address indexed account, uint256 amount, uint256 vipFee, uint256 nodeFee, string nonce);
    event UsdtWithdrawn(address indexed account, uint256 amount, string nonce);
    event DividendDistributed(
        uint256 vipFeeVaultSpaceAmount,
        uint256 nodeFeeVaultSpaceAmount,
        uint256 nodeFeeVaultUsdtAmountToMiner,
        uint256 nodeFeeVaultUsdtAmountToUsdtFeeReceiver,
        uint256 buybackDividendUsdtAmount
    );
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event FeeReceiversUpdated(
        address indexed oldVipFeeReceiver,
        address indexed newVipFeeReceiver,
        address indexed oldNodeFeeReceiver,
        address newNodeFeeReceiver
    );
    event UsdtFeeReceiverUpdated(address indexed oldUsdtFeeReceiver, address indexed newUsdtFeeReceiver);
    event FreeMinerClaimed(address indexed account, uint256 spaceAmount);
    event FreeMinerClaimEnabledUpdated(bool enabled);

    error ExpiredSignature(uint256 deadline);
    error InvalidSignature();
    error InvalidSigner();
    error NonceAlreadyUsed();
    error InvalidPayValue();
    error InvalidFee();
    error InvalidFeeReceiver();
    error FreeMinerAlreadyClaimed();
    error FreeMinerClaimDisabled();
    error InvalidAmount();
    error InvalidReceivedAmount();

    constructor(
        address tokenAddr,
        address usdtTokenAddr,
        address vaultAddr,
        address signerAddr,
        address vipFeeReceiverAddr,
        address nodeFeeReceiverAddr,
        address usdtFeeReceiverAddr,
        uint256 freeMinerSpaceAmount_
    ) Ownable(msg.sender) {
        if (signerAddr == address(0)) {
            revert InvalidSigner();
        }
        if (vipFeeReceiverAddr == address(0) || nodeFeeReceiverAddr == address(0) || usdtFeeReceiverAddr == address(0))
        {
            revert InvalidFeeReceiver();
        }

        spaceToken = IERC20(tokenAddr);
        usdtToken = IERC20(usdtTokenAddr);
        vault = vaultAddr;
        signer = signerAddr;
        vipFeeReceiver = vipFeeReceiverAddr;
        nodeFeeReceiver = nodeFeeReceiverAddr;
        usdtFeeReceiver = usdtFeeReceiverAddr;
        freeMinerSpaceAmount = freeMinerSpaceAmount_;
        freeMinerClaimEnabled = true;
    }

    function setSigner(address newSigner) public onlyOwner {
        if (newSigner == address(0)) {
            revert InvalidSigner();
        }

        address oldSigner = signer;
        signer = newSigner;

        emit SignerUpdated(oldSigner, newSigner);
    }

    function setFeeReceivers(address newVipFeeReceiver, address newNodeFeeReceiver) public onlyOwner {
        if (newVipFeeReceiver == address(0) || newNodeFeeReceiver == address(0)) {
            revert InvalidFeeReceiver();
        }

        address oldVipFeeReceiver = vipFeeReceiver;
        address oldNodeFeeReceiver = nodeFeeReceiver;
        vipFeeReceiver = newVipFeeReceiver;
        nodeFeeReceiver = newNodeFeeReceiver;

        emit FeeReceiversUpdated(oldVipFeeReceiver, newVipFeeReceiver, oldNodeFeeReceiver, newNodeFeeReceiver);
    }

    function setUsdtFeeReceiver(address newUsdtFeeReceiver) public onlyOwner {
        if (newUsdtFeeReceiver == address(0)) {
            revert InvalidFeeReceiver();
        }

        address oldUsdtFeeReceiver = usdtFeeReceiver;
        usdtFeeReceiver = newUsdtFeeReceiver;

        emit UsdtFeeReceiverUpdated(oldUsdtFeeReceiver, newUsdtFeeReceiver);
    }

    function setFreeMinerClaimEnabled(bool enabled) external onlyOwner {
        freeMinerClaimEnabled = enabled;

        emit FreeMinerClaimEnabledUpdated(enabled);
    }

    function claimFreeMiner() external {
        if (!freeMinerClaimEnabled) {
            revert FreeMinerClaimDisabled();
        }
        if (claimedFreeMiners[msg.sender]) {
            revert FreeMinerAlreadyClaimed();
        }

        claimedFreeMiners[msg.sender] = true;
        spaceToken.safeTransferFrom(vault, address(this), freeMinerSpaceAmount);

        emit FreeMinerClaimed(msg.sender, freeMinerSpaceAmount);
    }

    function setBuybackDividendVault(address vault_) external onlyOwner {
        if (vault_ == address(0) || buybackDividendVault != address(0)) revert InvalidFeeReceiver();
        buybackDividendVault = vault_;
        emit BuybackDividendVaultUpdated(vault_);
    }

    function purchaseMiner(
        string calldata minerId,
        uint256 price,
        uint256 payValue,
        uint256 expectedReward,
        string calldata nonce,
        uint256 deadline,
        bytes calldata signature
    ) public {
        if (payValue > price) {
            revert InvalidPayValue();
        }
        if (block.timestamp > deadline) {
            revert ExpiredSignature(deadline);
        }
        if (usedPurchaseNonces[nonce]) {
            revert NonceAlreadyUsed();
        }

        if (
            ECDSA.recoverCalldata(
                    getPurchaseMinerDigest(msg.sender, minerId, price, payValue, expectedReward, nonce, deadline),
                    signature
                ) != signer
        ) {
            revert InvalidSignature();
        }

        usedPurchaseNonces[nonce] = true;

        if (payValue > 0) {
            spaceToken.safeTransferFrom(msg.sender, address(this), payValue);
        }
        if (price > 0) {
            spaceToken.safeTransfer(address(0xdead), price);
        }
        if (expectedReward > 0) {
            spaceToken.safeTransferFrom(vault, address(this), expectedReward);
        }

        emit MinerPurchased(msg.sender, minerId, price, payValue, expectedReward, nonce);
    }

    function claim(
        uint256 amount,
        uint256 vipFee,
        uint256 nodeFee,
        string calldata nonce,
        uint256 deadline,
        bytes calldata signature
    ) public {
        if (vipFee + nodeFee > amount) {
            revert InvalidFee();
        }
        if (block.timestamp > deadline) {
            revert ExpiredSignature(deadline);
        }
        if (usedClaimNonces[nonce]) {
            revert NonceAlreadyUsed();
        }

        if (
            ECDSA.recoverCalldata(getClaimDigest(msg.sender, amount, vipFee, nodeFee, nonce, deadline), signature)
                != signer
        ) {
            revert InvalidSignature();
        }

        usedClaimNonces[nonce] = true;

        spaceToken.safeTransfer(msg.sender, amount - vipFee - nodeFee);
        if (vipFee > 0) {
            spaceToken.safeTransfer(vipFeeReceiver, vipFee);
        }
        if (nodeFee > 0) {
            spaceToken.safeTransfer(nodeFeeReceiver, nodeFee);
        }

        emit RewardClaimed(msg.sender, amount, vipFee, nodeFee, nonce);
    }

    function withdrawUsdt(uint256 amount, string calldata nonce, uint256 deadline, bytes calldata signature) public {
        if (block.timestamp > deadline) {
            revert ExpiredSignature(deadline);
        }
        if (usedWithdrawUsdtNonces[nonce]) {
            revert NonceAlreadyUsed();
        }

        if (ECDSA.recoverCalldata(getWithdrawUsdtDigest(msg.sender, amount, nonce, deadline), signature) != signer) {
            revert InvalidSignature();
        }

        usedWithdrawUsdtNonces[nonce] = true;

        if (amount > 0) {
            usdtToken.safeTransfer(msg.sender, amount);
        }

        emit UsdtWithdrawn(msg.sender, amount, nonce);
    }

    function getPurchaseMinerDigest(
        address buyer,
        string calldata minerId,
        uint256 price,
        uint256 payValue,
        uint256 expectedReward,
        string calldata nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                PURCHASE_MINER_ACTION,
                address(this),
                block.chainid,
                buyer,
                keccak256(bytes(minerId)),
                price,
                payValue,
                expectedReward,
                keccak256(bytes(nonce)),
                deadline
            )
        );

        return MessageHashUtils.toEthSignedMessageHash(messageHash);
    }

    function getClaimDigest(
        address account,
        uint256 amount,
        uint256 vipFee,
        uint256 nodeFee,
        string calldata nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                CLAIM_REWARD_ACTION,
                address(this),
                block.chainid,
                account,
                amount,
                vipFee,
                nodeFee,
                keccak256(bytes(nonce)),
                deadline
            )
        );

        return MessageHashUtils.toEthSignedMessageHash(messageHash);
    }

    function getWithdrawUsdtDigest(address account, uint256 amount, string calldata nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                WITHDRAW_USDT_ACTION, address(this), block.chainid, account, amount, keccak256(bytes(nonce)), deadline
            )
        );

        return MessageHashUtils.toEthSignedMessageHash(messageHash);
    }

    function dividend(
        uint256 vipFeeVaultSpaceAmount,
        uint256 nodeFeeVaultSpaceAmount,
        uint256 nodeFeeVaultUsdtAmountToMiner,
        uint256 nodeFeeVaultUsdtAmountToUsdtFeeReceiver,
        uint256 buybackDividendUsdtAmount
    ) external {
        if (_msgSender() != signer) {
            revert InvalidSigner();
        }

        if (buybackDividendUsdtAmount > 0) {
            if (buybackDividendVault == address(0)) revert InvalidFeeReceiver();
            usdtToken.safeTransferFrom(buybackDividendVault, address(this), buybackDividendUsdtAmount);
        }
        spaceToken.safeTransferFrom(vipFeeReceiver, address(this), vipFeeVaultSpaceAmount);
        spaceToken.safeTransferFrom(nodeFeeReceiver, address(this), nodeFeeVaultSpaceAmount);
        usdtToken.safeTransferFrom(nodeFeeReceiver, address(this), nodeFeeVaultUsdtAmountToMiner);
        usdtToken.safeTransferFrom(nodeFeeReceiver, usdtFeeReceiver, nodeFeeVaultUsdtAmountToUsdtFeeReceiver);

        emit DividendDistributed(
            vipFeeVaultSpaceAmount,
            nodeFeeVaultSpaceAmount,
            nodeFeeVaultUsdtAmountToMiner,
            nodeFeeVaultUsdtAmountToUsdtFeeReceiver,
            buybackDividendUsdtAmount
        );
    }
}
