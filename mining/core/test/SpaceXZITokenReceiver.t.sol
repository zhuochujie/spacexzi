// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SpaceXZIToken} from "../src/SpaceXZIToken.sol";

contract SpaceXZITokenReceiverTest is Test {
    SpaceXZIToken token;
    address owner = address(0x1000);
    address user = address(0x2000);
    address recipient = address(0x3000);
    address oldReceiver = address(0x4000);
    address newReceiver = address(0x5000);
    address nodeReceiver = address(0x6000);

    event MarketFeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    function setUp() public {
        vm.startPrank(owner);
        token = new SpaceXZIToken(owner, oldReceiver, nodeReceiver);
        token.setWhitelist(owner, true);
        token.transfer(user, 1000 ether);
        vm.stopPrank();
    }

    function testOwnerUpdatesReceiverAndEmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit MarketFeeReceiverUpdated(oldReceiver, newReceiver);
        vm.prank(owner);
        token.setMarketFeeReceiver(newReceiver);
        assertEq(token.marketFeeReceiver(), newReceiver);
        assertEq(token.nodeFeeReceiver(), nodeReceiver);
        assertFalse(token.isWhitelisted(newReceiver));
    }

    function testNonOwnerCannotUpdateReceiver() public {
        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        vm.prank(user);
        token.setMarketFeeReceiver(newReceiver);
        assertEq(token.marketFeeReceiver(), oldReceiver);
    }

    function testZeroReceiverIsRejected() public {
        vm.expectRevert(bytes("FeeToken: zero market fee receiver"));
        vm.prank(owner);
        token.setMarketFeeReceiver(address(0));
        assertEq(token.marketFeeReceiver(), oldReceiver);
    }

    function testTransferPaysNewMarketReceiverAndKeepsNodeFee() public {
        vm.prank(owner);
        token.setMarketFeeReceiver(newReceiver);
        vm.prank(user);
        token.transfer(recipient, 100 ether);
        assertEq(token.balanceOf(recipient), 90 ether);
        assertEq(token.balanceOf(newReceiver), 5 ether);
        assertEq(token.balanceOf(oldReceiver), 0);
        assertEq(token.balanceOf(nodeReceiver), 5 ether);
    }

    function testTransferFromAlsoPaysNewReceiver() public {
        vm.prank(owner);
        token.setMarketFeeReceiver(newReceiver);
        vm.prank(user);
        token.approve(address(this), 100 ether);
        token.transferFrom(user, recipient, 100 ether);
        assertEq(token.balanceOf(recipient), 90 ether);
        assertEq(token.balanceOf(newReceiver), 5 ether);
        assertEq(token.balanceOf(oldReceiver), 0);
        assertEq(token.balanceOf(nodeReceiver), 5 ether);
    }
}
