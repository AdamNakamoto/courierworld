// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CourierNFT} from "../src/CourierNFT.sol";
import {CourierDeployer} from "./DeployMainnet.s.sol";

/// @notice Dev only: both launch stages on an Anvil fork of Robinhood Chain, with the real PoolManager, IMD and
///         IMD/ETH pool, so the game and the trade panel can be tried without real money. Writes no files.
///
///   runAll()       couriers, PLAYERS each get COURIERS_EACH (6) couriers, reveal, then the game
///   runCouriers()  stage 1 only, with the mint open
///   runGame()      reveal NFT with SECRET, then the game
///
///   FEE_RECIPIENT=0x... TREASURY=0x... SECRET=<n> PLAYERS=0x..,0x.. \
///   forge script script/DeployFork.s.sol --sig "runAll()" --rpc-url <fork> --unlocked --sender <dev account> --broadcast
contract DeployFork is CourierDeployer {
    function runAll() external {
        uint256 startMcap = _startMcap();
        vm.startBroadcast();
        Couriers memory c = _deployCouriers(msg.sender, _treasury(), _mintPrice(), _commit());
        _mintAndReveal(msg.sender, c, vm.envOr("PLAYERS", ",", new address[](0)), vm.envOr("COURIERS_EACH", uint256(6)), _secret());
        Game memory g = _game(c, startMcap);
        vm.stopBroadcast();
        _log(c, g);
    }

    function runCouriers() external {
        vm.startBroadcast();
        Couriers memory c = _deployCouriers(msg.sender, _treasury(), _mintPrice(), _commit());
        CourierNFT(c.nft).setSaleOpen(true);
        vm.stopBroadcast();
        _log(c, Game(address(0), address(0), address(0)));
    }

    function runGame() external {
        address nft = vm.envAddress("NFT");
        Couriers memory c = Couriers(nft, address(CourierNFT(nft).renderer()));
        uint256 startMcap = _startMcap();
        vm.startBroadcast();
        if (CourierNFT(c.nft).seed() == 0) CourierNFT(c.nft).reveal(_secret());
        Game memory g = _game(c, startMcap);
        vm.stopBroadcast();
        _log(c, g);
    }

    function _game(Couriers memory c, uint256 startMcap) internal returns (Game memory) {
        return _deployGame(
            msg.sender,
            vm.envAddress("FEE_RECIPIENT"),
            _treasury(),
            startMcap,
            vm.envOr("LAUNCH_STAMP", uint256(2_100_000e18)),
            vm.envOr("OFFICE_PRICE", uint256(0.005 ether)),
            vm.envOr("BLOCK_TIME_MS", uint256(1_100)),
            c
        );
    }

    function _treasury() internal view returns (address) {
        return vm.envOr("TREASURY", vm.envAddress("FEE_RECIPIENT"));
    }

    function _mintPrice() internal view returns (uint256) {
        return vm.envOr("MINT_PRICE", uint256(0.003 ether));
    }

    function _secret() internal view returns (uint256) {
        return vm.envUint("SECRET");
    }

    function _commit() internal view returns (bytes32) {
        return keccak256(abi.encode(_secret()));
    }
}
