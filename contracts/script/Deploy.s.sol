// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {StampToken} from "../src/StampToken.sol";
import {CourierNFT} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {CourierRenderer, ICourierDuty} from "../src/CourierRenderer.sol";
import {CourierDeployer} from "./DeployMainnet.s.sol";

/// @notice Local dev deploy (used by ../dev.sh): the couriers, minted for PLAYERS (COURIERS_EACH each) and
///         revealed, then $STAMP without a pool and the post office. For Robinhood Chain use DeployCouriers.s.sol
///         and DeployMainnet.s.sol; ../dev.sh --fork runs those stages against a fork.
///
///   TREASURY=0x... SECRET=<n> PLAYERS=0x..,0x.. forge script script/Deploy.s.sol --rpc-url <rpc> \
///     --unlocked --sender <dev account> --broadcast
contract Deploy is CourierDeployer {
    function run() external {
        address treasury = vm.envAddress("TREASURY");
        uint256 secret = vm.envUint("SECRET");

        vm.startBroadcast();
        address deployer = msg.sender;
        Couriers memory c = _deployCouriers(
            deployer, treasury, vm.envOr("MINT_PRICE", uint256(0.003 ether)), keccak256(abi.encode(secret))
        );
        _mintAndReveal(
            deployer, c, vm.envOr("PLAYERS", ",", new address[](0)), vm.envOr("COURIERS_EACH", uint256(6)), secret
        );

        StampToken stamp = new StampToken(deployer, address(0), 0);
        PostOffice office = new PostOffice(
            stamp,
            CourierNFT(c.nft),
            vm.envOr("BLOCK_TIME_MS", uint256(1_100)),
            2.5e18,
            vm.envOr("OFFICE_PRICE", uint256(0.005 ether)),
            treasury,
            _tiers()
        );
        stamp.setMinter(address(office));
        CourierNFT(c.nft).setGame(address(office));
        CourierRenderer(c.renderer).setOffice(ICourierDuty(address(office)));
        vm.stopBroadcast();

        _log(c, Game(address(0), address(0), address(0)));
        console.log("StampToken", address(stamp));
        console.log("PostOffice", address(office));
    }
}
