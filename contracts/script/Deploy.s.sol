// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StampToken} from "../src/StampToken.sol";
import {CourierNFT} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {CourierSVG} from "../src/CourierSVG.sol";
import {CourierRenderer, ICourierSeed, ICourierDuty} from "../src/CourierRenderer.sol";
import {ICourierRenderer} from "../src/CourierNFT.sol";

/// @notice Local dev deploy (used by ../dev.sh): $STAMP without a pool, the Courier
///         collection, its on-chain renderer and the post office. For Robinhood Chain use
///         DeployMainnet.s.sol, which also opens the taxed $STAMP/IMD pool.
///
///   TREASURY=0x... SEED_COMMIT=$(cast keccak $(cast abi-encode "f(uint256)" $SECRET)) \
///   forge script script/Deploy.s.sol --rpc-url <rpc> --account <keystore> --broadcast
///
/// Keep SECRET private until the mint is over, then call CourierNFT.reveal(SECRET).
contract Deploy is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY");
        bytes32 commit = vm.envBytes32("SEED_COMMIT");
        uint256 mintPrice = vm.envOr("MINT_PRICE", uint256(0.003 ether));
        uint256 officePrice = vm.envOr("OFFICE_PRICE", uint256(0.005 ether));
        uint256 blockTimeMs = vm.envOr("BLOCK_TIME_MS", uint256(1_100));
        bool openSale = vm.envOr("OPEN_SALE", false);

        vm.startBroadcast();
        address deployer = msg.sender;
        StampToken stamp = new StampToken(deployer, address(0), 0);
        CourierNFT nft = new CourierNFT(deployer, treasury, mintPrice, commit);
        PostOffice office = new PostOffice(stamp, nft, blockTimeMs, 2.5e18, officePrice, treasury, deployer);
        stamp.setMinter(address(office));
        nft.setGame(address(office));

        // Art and metadata come entirely from the chain. Call nft.freezeRenderer()
        // once you're happy with it to lock the art forever.
        CourierRenderer renderer = new CourierRenderer(ICourierSeed(address(nft)), new CourierSVG(), deployer);
        renderer.setOffice(ICourierDuty(address(office)));
        nft.setRenderer(ICourierRenderer(address(renderer)));

        //             slots routes upgradeCost
        office.addTier(2, 3, 0); // Kiosk
        office.addTier(4, 7, 100e18); // Branch
        office.addTier(6, 14, 400e18); // Depot
        office.addTier(9, 24, 1_500e18); // Hub
        office.addTier(12, 40, 5_000e18); // HQ
        if (openSale) nft.setSaleOpen(true);
        vm.stopBroadcast();

        console.log("StampToken", address(stamp));
        console.log("CourierNFT", address(nft));
        console.log("PostOffice", address(office));
        console.log("Renderer  ", address(renderer));
    }
}
