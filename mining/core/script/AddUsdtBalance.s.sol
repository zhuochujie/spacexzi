// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPancakeRouterV2 {
    function WETH() external pure returns (address);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
}

contract AddUsdtBalanceScript is Script {
    // Edit these values before running. PRIVATE_KEY is the only environment variable used.
    address private constant ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address private constant USDT_TOKEN = 0x55d398326f99059fF775485246999027B3197955;
    address private constant ACCOUNT = 0xF5000667E17Ca2208A653009306C02d7d94fD7d4;
    uint256 private constant BNB_AMOUNT_IN = 1 ether;
    uint256 private constant SLIPPAGE_BPS = 100;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(privateKey);

        require(ROUTER != address(0), "ROUTER not set");
        require(USDT_TOKEN != address(0), "USDT_TOKEN not set");
        require(ACCOUNT != address(0), "ACCOUNT not set");
        require(BNB_AMOUNT_IN > 0, "BNB_AMOUNT_IN is zero");
        require(SLIPPAGE_BPS <= BPS_DENOMINATOR, "invalid slippage");

        IPancakeRouterV2 router = IPancakeRouterV2(ROUTER);
        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = USDT_TOKEN;

        uint256[] memory quotedAmounts = router.getAmountsOut(BNB_AMOUNT_IN, path);
        uint256 amountOutMin = quotedAmounts[1] * (BPS_DENOMINATOR - SLIPPAGE_BPS) / BPS_DENOMINATOR;
        uint256 balanceBefore = IERC20(USDT_TOKEN).balanceOf(ACCOUNT);

        vm.startBroadcast(privateKey);
        uint256[] memory amounts = router.swapExactETHForTokens{value: BNB_AMOUNT_IN}(
            amountOutMin, path, ACCOUNT, block.timestamp + 20 minutes
        );
        vm.stopBroadcast();

        uint256 balanceAfter = IERC20(USDT_TOKEN).balanceOf(ACCOUNT);

        console2.log("sender", sender);
        console2.log("router", ROUTER);
        console2.log("usdtToken", USDT_TOKEN);
        console2.log("account", ACCOUNT);
        console2.log("bnbAmountIn", BNB_AMOUNT_IN);
        console2.log("quotedUsdtOut", quotedAmounts[1]);
        console2.log("amountOutMin", amountOutMin);
        console2.log("actualUsdtOut", amounts[1]);
        console2.log("accountUsdtBefore", balanceBefore);
        console2.log("accountUsdtAfter", balanceAfter);
    }
}
