// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Vault is Ownable {
    constructor() Ownable(msg.sender) {}

    function approve(address tokenAddr, address spender, uint256 value) public onlyOwner {
        IERC20(tokenAddr).approve(spender, value);
    }
}
