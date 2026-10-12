// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CourierPad, IPostOfficeOpen} from "../src/CourierPad.sol";
import {PadToken} from "../src/PadToken.sol";
import {StampEthRouter} from "../src/StampEthRouter.sol";
import {DeployLib} from "../script/DeployLib.sol";

/// @notice The launchpad against the live Uniswap v4 PoolManager, IMD, $STAMP, post office and IMD/ETH pool on
///         Robinhood Chain:
///   forge test --match-contract CourierPadForkTest --fork-url robinhood
/// Skipped when not forked.
contract CourierPadForkTest is Test {
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant IMD = 0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127;
    address constant STAMP = 0xBaB43AF01C32a952ff14B395D026cf1874932Bc5;
    address constant POST_OFFICE = 0x26D80804D0FA2F4598369E0062bFC9536d115D82;
    /// @dev A wallet with a post office open on mainnet (the treasury's).
    address constant PLAYER = 0x72215670C2266Bc224949A12C514a77D7fD5D566;

    function test_Fork_LaunchAndTradeWithEth() public {
        vm.skip(block.chainid != 4663);
        address feeTo = makeAddr("fees");
        address drops = makeAddr("drops");
        bytes memory initCode = abi.encodePacked(
            type(CourierPad).creationCode,
            abi.encode(
                PM,
                IMD,
                STAMP,
                IPostOfficeOpen(POST_OFFICE),
                makeAddr("owner"),
                feeTo,
                drops,
                500e18,
                DeployLib.startTickForMarketCap(635e18, 1_000_000_000e18),
                CourierPad.ImdEthPool(10_000, 100, address(0))
            )
        );
        (bytes32 salt,) = DeployLib.mineSalt(address(this), uint160(0x28CC), initCode, 0);
        CourierPad pad;
        assembly {
            pad := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }

        int24 startTick = pad.startTick();

        // Someone without a post office can't launch.
        address stranger = makeAddr("stranger");
        deal(STAMP, stranger, 1_000e18);
        vm.startPrank(stranger);
        IERC20(STAMP).approve(address(pad), 500e18);
        vm.expectRevert(CourierPad.NoPostOffice.selector);
        pad.launch("Nope", "NOPE", "{}", 500e18, startTick);
        vm.stopPrank();

        // A player with one launches, burning the real $STAMP fee.
        deal(STAMP, PLAYER, IERC20(STAMP).balanceOf(PLAYER) + 500e18);
        uint256 supply = IERC20(STAMP).totalSupply();
        vm.startPrank(PLAYER);
        IERC20(STAMP).approve(address(pad), 500e18);
        PadToken t = PadToken(pad.launch("Fork Cat", "FCAT", '{"description":"fork"}', 500e18, startTick));
        vm.stopPrank();
        assertEq(IERC20(STAMP).totalSupply(), supply - 500e18, "fee burned");
        assertEq(t.balanceOf(drops), 50_000_000e18, "5% for drops");
        assertApproxEqRel(pad.marketCap(address(t)), 635e18, 0.03e18);

        // Buy with ETH through the real IMD/ETH pool, sell half back, and the fees reach the fee wallet in IMD.
        StampEthRouter er = StampEthRouter(payable(pad.ethRouter()));
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 1 ether);
        vm.startPrank(buyer);
        uint256 got = er.buyWithEth{value: 0.01 ether}(address(t), 1, block.timestamp);
        assertGt(got, 0);
        t.approve(address(er), got / 2);
        uint256 ethBefore = buyer.balance;
        uint256 ethOut = er.sellForEth(address(t), got / 2, 1, block.timestamp);
        vm.stopPrank();
        assertEq(buyer.balance - ethBefore, ethOut);
        uint256 fees = pad.pendingProtocolFees(IMD);
        assertGt(fees, 0);
        pad.collectProtocolFees(IMD);
        assertEq(IERC20(IMD).balanceOf(feeTo), fees);
    }
}
