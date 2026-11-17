// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BuybackPool} from "../src/BuybackPool.sol";
import {console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Mining} from "../src/Mining.sol";
import {SpaceXZIToken} from "../src/SpaceXZIToken.sol";
import {TokenExchange} from "../src/TokenExchange.sol";
import {Vault} from "../src/Vault.sol";
import {NodeMembership} from "../src/NodeMembership.sol";
import {DeploymentBase} from "./DeploymentBase.s.sol";

/// @notice Native Foundry entry point: deploys and configures all application contracts.
contract DeployScript is DeploymentBase {
    struct DeployConfig {
        uint256 chainId;
        address deployer;
        address owner;
        address signer;
        address marker;
        address usdtToken;
        address usdtFeeReceiver;
        uint256 minPrice;
        uint256 maxPrice;
        uint256 minOrderSpaceAmount;
        uint256 exchangeNodeFeeBps;
        uint256 exchangeMarkerFeeBps;
        uint256 freeMinerSpaceAmount;
        bool buybackPaused;
        address buybackFixedReceiver;
        uint256 buybackBuyPrice;
        uint256 buybackSellPrice;
        uint256 initialBuybackSpace;
        uint256 initialBuybackUsdt;
        NodeConfig node;
    }

    struct Deployment {
        SpaceXZIToken spaceToken;
        Vault vault;
        Vault nodeFeeVault;
        Vault vipFeeVault;
        Mining mining;
        TokenExchange market;
        NodeMembership node;
        Vault buybackDividendVault;
        BuybackPool buybackPool;
    }

    function run() external returns (Deployment memory deployed) {
        _selectConfiguredNetwork();
        uint256 key = vm.envUint("PRIVATE_KEY");
        DeployConfig memory config = _loadConfig(vm.addr(key));
        _validateConfig(config);
        vm.startBroadcast(key);
        deployed = _deploy(config);
        vm.stopBroadcast();
        _log(config, deployed);
    }

    function _loadConfig(address deployer) internal view returns (DeployConfig memory config) {
        config.chainId = _configuredChainId();
        config.deployer = deployer;
        config.owner = vm.envOr("OWNER_ADDRESS", deployer);
        config.signer = vm.envAddress("SIGNER_ADDRESS");
        config.marker = vm.envAddress("MARKET_FEE_RECEIVER_ADDRESS");
        config.usdtToken = vm.envAddress("USDT_TOKEN_ADDRESS");
        config.usdtFeeReceiver = vm.envOr("USDT_FEE_RECEIVER_ADDRESS", config.marker);
        config.minPrice = vm.envOr("MARKET_MIN_PRICE_WEI", uint256(0.7 ether));
        config.maxPrice = vm.envOr("MARKET_MAX_PRICE_WEI", uint256(0.8 ether));
        config.minOrderSpaceAmount = vm.envOr("MARKET_MIN_ORDER_SPACE_WEI", uint256(1 ether));
        config.exchangeNodeFeeBps = vm.envOr("MARKET_NODE_FEE_BP", uint256(500));
        config.exchangeMarkerFeeBps = vm.envOr("MARKET_MARKER_FEE_BP", uint256(500));
        config.freeMinerSpaceAmount = vm.envOr("FREE_MINER_SPACE_AMOUNT_WEI", uint256(50 ether));
        config.buybackPaused = vm.envOr("BUYBACK_PAUSED", false);
        config.buybackFixedReceiver = vm.envAddress("BUYBACK_FIXED_RECEIVER_ADDRESS");
        config.buybackBuyPrice = vm.envUint("BUYBACK_BUY_PRICE_WEI");
        config.buybackSellPrice = vm.envUint("BUYBACK_SELL_PRICE_WEI");
        config.initialBuybackSpace = vm.envOr("INITIAL_BUYBACK_SPACE_WEI", uint256(2_000_000 ether));
        config.initialBuybackUsdt = vm.envOr("INITIAL_BUYBACK_USDT_WEI", uint256(0));
        config.node = _loadNodeConfig();
    }

    function _validateConfig(DeployConfig memory config) internal view {
        require(config.chainId == block.chainid, "Configured network does not match RPC chain");
        require(config.deployer != address(0) && config.owner != address(0), "Invalid deployer/owner");
        require(config.signer != address(0), "SIGNER_ADDRESS is zero");
        require(config.marker != address(0), "MARKET_FEE_RECEIVER_ADDRESS is zero");
        require(config.usdtFeeReceiver != address(0), "USDT_FEE_RECEIVER_ADDRESS is zero");
        require(config.usdtToken.code.length > 0, "USDT_TOKEN_ADDRESS has no code");
        // The existing mining, market and buyback calculations use 18-decimal units.
        require(IERC20Metadata(config.usdtToken).decimals() == 18, "USDT must have 18 decimals");
        require(config.minPrice > 0 && config.minPrice <= config.maxPrice, "Invalid market price range");
        require(config.minOrderSpaceAmount > 0, "Minimum order amount is zero");
        require(config.exchangeNodeFeeBps <= 10_000 && config.exchangeMarkerFeeBps <= 10_000, "Invalid market fee");
        require(config.exchangeNodeFeeBps + config.exchangeMarkerFeeBps <= 10_000, "Market fees exceed 100%");
        require(config.buybackFixedReceiver != address(0), "Invalid buyback receiver");
        require(
            config.buybackBuyPrice > config.buybackSellPrice && config.buybackSellPrice > 0, "Invalid buyback prices"
        );
        require(config.initialBuybackSpace <= 1_000_000_000 ether, "Buyback SPACE exceeds supply");
        require(
            IERC20Metadata(config.usdtToken).balanceOf(config.deployer) >= config.initialBuybackUsdt,
            "Insufficient initial USDT"
        );
        _validateNodeConfig(config.node);
    }

    function _deploy(DeployConfig memory config) internal returns (Deployment memory d) {
        d.vault = new Vault();
        d.nodeFeeVault = new Vault();
        d.vipFeeVault = new Vault();
        d.buybackDividendVault = new Vault();
        // SpaceXZIToken constructor order: market fee receiver, then node fee receiver.
        d.spaceToken = new SpaceXZIToken(config.deployer, config.marker, address(d.nodeFeeVault));
        d.mining = new Mining(
            address(d.spaceToken),
            config.usdtToken,
            address(d.vault),
            config.signer,
            address(d.vipFeeVault),
            address(d.nodeFeeVault),
            config.usdtFeeReceiver,
            config.freeMinerSpaceAmount
        );
        d.market = new TokenExchange(
            address(d.spaceToken),
            config.usdtToken,
            address(d.nodeFeeVault),
            config.marker,
            config.minPrice,
            config.maxPrice,
            config.minOrderSpaceAmount,
            config.exchangeNodeFeeBps,
            config.exchangeMarkerFeeBps,
            config.signer
        );
        d.mining.setBuybackDividendVault(address(d.buybackDividendVault));
        d.buybackPool = new BuybackPool(
            address(d.spaceToken),
            config.usdtToken,
            address(d.market),
            address(d.buybackDividendVault),
            config.buybackFixedReceiver,
            config.buybackBuyPrice,
            config.buybackSellPrice
        );
        d.market.setBuybackSource(address(d.buybackPool), true);
        d.node = _deployNode(config.usdtToken, config.signer, address(d.mining), config.node);
        _configure(config, d);
        if (config.owner != config.deployer) _transferOwnership(config.owner, d);
    }

    function _configure(DeployConfig memory config, Deployment memory d) internal {
        address[] memory whitelist = new address[](7);
        whitelist[0] = config.deployer;
        whitelist[1] = address(d.vault);
        whitelist[2] = address(d.nodeFeeVault);
        whitelist[3] = address(d.vipFeeVault);
        whitelist[4] = address(d.mining);
        whitelist[5] = address(d.market);
        whitelist[6] = address(d.buybackPool);
        d.spaceToken.setWhitelistBatch(whitelist, true);
        if (config.initialBuybackSpace > 0) {
            d.spaceToken.approve(address(d.buybackPool), config.initialBuybackSpace);
            d.buybackPool.fundSpace(config.initialBuybackSpace);
        }
        require(
            d.spaceToken.transfer(address(d.vault), d.spaceToken.balanceOf(config.deployer)), "SPACE allocation failed"
        );
        d.buybackDividendVault.approve(config.usdtToken, address(d.mining), type(uint256).max);
        if (config.initialBuybackUsdt > 0) {
            IERC20Metadata(config.usdtToken).approve(address(d.buybackPool), config.initialBuybackUsdt);
            d.buybackPool.fundUsdt(config.initialBuybackUsdt);
        }
        d.vault.approve(address(d.spaceToken), address(d.mining), type(uint256).max);
        d.nodeFeeVault.approve(address(d.spaceToken), address(d.mining), type(uint256).max);
        d.nodeFeeVault.approve(config.usdtToken, address(d.mining), type(uint256).max);
        d.vipFeeVault.approve(address(d.spaceToken), address(d.mining), type(uint256).max);
        if (config.buybackPaused) d.buybackPool.pause();
    }

    function _transferOwnership(address owner, Deployment memory d) internal {
        d.spaceToken.transferOwnership(owner);
        d.vault.transferOwnership(owner);
        d.nodeFeeVault.transferOwnership(owner);
        d.vipFeeVault.transferOwnership(owner);
        d.mining.transferOwnership(owner);
        d.market.transferOwnership(owner);
        d.node.transferOwnership(owner);
        d.buybackDividendVault.transferOwnership(owner);
        d.buybackPool.transferOwnership(owner);
    }

    function _log(DeployConfig memory config, Deployment memory d) internal view {
        console2.log("chainId", block.chainid);
        console2.log("deployer", config.deployer);
        console2.log("owner", config.owner);
        console2.log("signer", config.signer);
        console2.log("spaceToken", address(d.spaceToken));
        console2.log("usdtToken", config.usdtToken);
        console2.log("vault", address(d.vault));
        console2.log("nodeFeeVault", address(d.nodeFeeVault));
        console2.log("vipFeeVault", address(d.vipFeeVault));
        console2.log("mining", address(d.mining));
        console2.log("tokenExchange", address(d.market));
        console2.log("nodeMembership", address(d.node));
        console2.log("buybackPool", address(d.buybackPool));
        console2.log("buybackDividendVault", address(d.buybackDividendVault));
    }
}
