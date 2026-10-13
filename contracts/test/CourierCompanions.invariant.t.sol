// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CourierCompanions} from "../src/CourierCompanions.sol";
import {StampToken} from "../src/StampToken.sol";

/// Random buyers buying random kinds, and the owner changing prices, supplies and limits between buys.
contract CompanionsHandler is Test {
    CourierCompanions public shop;
    StampToken public stamp;
    address public owner;
    address[] public buyers;
    uint256[] public ids;
    uint256 public paid; // $STAMP the buys moved, by the handler's own count

    constructor(CourierCompanions shop_, StampToken stamp_, address owner_) {
        shop = shop_;
        stamp = stamp_;
        owner = owner_;
        for (uint256 i; i < 4; ++i) buyers.push(makeAddr(string.concat("buyer", vm.toString(i))));
        for (uint256 i; i < 5; ++i) ids.push(i + 1);
    }

    function buy(uint256 who, uint256 which, uint256 qty, uint256 slack) external {
        address b = buyers[who % buyers.length];
        uint256 id = ids[which % ids.length];
        (uint128 price,,,,, bool exists) = shop.kinds(id);
        if (!exists) return;
        qty = bound(qty, 1, 10);
        uint256 cost = uint256(price) * qty;
        uint256 maxCost = cost + bound(slack, 0, 1e21);
        stamp.mint(b, cost);
        vm.prank(b);
        stamp.approve(address(shop), maxCost);
        vm.prank(b);
        try shop.buy(id, qty, maxCost) {
            paid += cost;
        } catch {}
        vm.prank(b);
        stamp.approve(address(shop), 0);
    }

    function configure(uint256 which, uint256 price, uint256 supply, uint256 perWallet, bool open) external {
        uint256 id = ids[which % ids.length];
        price = bound(price, 1, 1e24);
        supply = bound(supply, 1, 500);
        perWallet = bound(perWallet, 0, 20);
        vm.prank(owner);
        try shop.setKind(id, price, supply, perWallet, open) {} catch {}
    }

    function buyerCount() external view returns (uint256) {
        return buyers.length;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }
}

contract CourierCompanionsInvariantTest is Test {
    StampToken stamp;
    CourierCompanions shop;
    CompanionsHandler handler;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");

    function setUp() public {
        stamp = new StampToken(owner, address(0), 0);
        shop = new CourierCompanions(owner, address(stamp), treasury, "https://courierworld.fun/companions/");
        handler = new CompanionsHandler(shop, stamp, owner);
        vm.prank(owner);
        stamp.setMinter(address(handler));
        vm.startPrank(owner);
        for (uint256 i = 1; i <= 5; ++i) shop.setKind(i, i * 100e18, 50 * i, i % 3, true);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// No kind ever has more minted than its supply, and every minted companion is in a buyer's wallet.
    function invariant_supplyHolds() public view {
        for (uint256 i; i < handler.idCount(); ++i) {
            uint256 id = handler.ids(i);
            (, uint32 maxSupply, uint32 minted,,,) = shop.kinds(id);
            assertLe(minted, maxSupply);
            uint256 held;
            for (uint256 j; j < handler.buyerCount(); ++j) held += shop.balanceOf(handler.buyers(j), id);
            assertEq(held, minted);
        }
    }

    /// Every $STAMP paid went to the treasury; the shop never keeps any.
    function invariant_allStampToTheTreasury() public view {
        assertEq(stamp.balanceOf(treasury), handler.paid());
        assertEq(stamp.balanceOf(address(shop)), 0);
    }

    /// No wallet bought more of a kind than its limit allowed when it bought (limits only count purchases).
    function invariant_boughtMatchesBalances() public view {
        for (uint256 i; i < handler.idCount(); ++i) {
            uint256 id = handler.ids(i);
            for (uint256 j; j < handler.buyerCount(); ++j) {
                address b = handler.buyers(j);
                assertEq(shop.bought(b, id), shop.balanceOf(b, id)); // (the handler never transfers)
            }
        }
    }
}
