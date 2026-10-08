// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StampHook} from "../src/StampHook.sol";
import {StampToken} from "../src/StampToken.sol";
import {CourierNFT, ICourierRenderer} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {CourierSVG} from "../src/CourierSVG.sol";
import {CourierRenderer, ICourierSeed, ICourierDuty} from "../src/CourierRenderer.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Robinhood Chain (4663) addresses (checked on-chain 2026-10-07).
library RobinhoodConfig {
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address internal constant IMD = 0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127;
    /// @dev IMD/ETH pool for the ETH router: fee 1%, tick spacing 100, no hook.
    uint24 internal constant IMD_ETH_FEE = 10_000;
    int24 internal constant IMD_ETH_SPACING = 100;
    uint160 internal constant HOOK_FLAGS = 0x28CC;
    /// @dev Chainlink ETH/USD on Robinhood Chain (8 decimals).
    address internal constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
}

interface IAggregatorV3 {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice The two launch stages, shared by the mainnet scripts and the dev ones.
///   1. Couriers: the NFT and its on-chain art. The mint runs; the owner reveals when it's over.
///   2. Game, once the couriers are revealed (PostOffice refuses to deploy before): StampHook (mined CREATE2
///      address) with its routers, $STAMP (launch allocation to the hook), the post office. Everything is linked,
///      then renounced: token, hook, renderer and NFT. The post office never has an owner.
abstract contract CourierDeployer is Script {
    struct Couriers {
        address nft;
        address renderer;
    }

    struct Game {
        address hook;
        address stamp;
        address office;
    }

    /// @dev Office tiers, smallest first.
    function _tiers() internal pure returns (PostOffice.Tier[] memory t) {
        t = new PostOffice.Tier[](5);
        //                    slots routes upgradeCost
        t[0] = PostOffice.Tier(2, 3, 0); // Kiosk
        t[1] = PostOffice.Tier(4, 7, 100e18); // Branch
        t[2] = PostOffice.Tier(6, 14, 400e18); // Depot
        t[3] = PostOffice.Tier(9, 24, 1_500e18); // Hub
        t[4] = PostOffice.Tier(12, 40, 5_000e18); // HQ
    }

    /// @dev Stage 1: the NFT, with its on-chain art already attached.
    function _deployCouriers(address deployer, address treasury, uint256 mintPrice, bytes32 commit)
        internal
        returns (Couriers memory c)
    {
        CourierNFT nft = new CourierNFT(deployer, treasury, mintPrice, commit);
        CourierRenderer renderer = new CourierRenderer(ICourierSeed(address(nft)), new CourierSVG(), deployer);
        nft.setRenderer(ICourierRenderer(address(renderer)));
        c = Couriers(address(nft), address(renderer));
    }

    /// @dev Stage 2. `deployer` must own the NFT and the renderer, and the couriers must be revealed.
    function _deployGame(
        address deployer,
        address feeRecipient,
        address treasury,
        uint256 startMcap,
        uint256 launch,
        uint256 officePrice,
        uint256 blockTimeMs,
        Couriers memory c
    ) internal returns (Game memory g) {
        _checkCouriers(deployer, treasury, c);

        // The hook, at an address carrying its permission flags.
        bytes memory initCode = abi.encodePacked(
            type(StampHook).creationCode,
            abi.encode(
                RobinhoodConfig.POOL_MANAGER,
                RobinhoodConfig.IMD,
                deployer,
                feeRecipient,
                DeployLib.startTickForMarketCap(startMcap, 21_000_000e18),
                launch,
                StampHook.ImdEthPool(RobinhoodConfig.IMD_ETH_FEE, RobinhoodConfig.IMD_ETH_SPACING, address(0))
            )
        );
        (bytes32 salt, address expected) =
            DeployLib.mineSalt(CREATE2_FACTORY, RobinhoodConfig.HOOK_FLAGS, initCode, vm.envOr("SALT_START", uint256(0)));
        require(expected.code.length == 0, "already deployed at mined address");
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        require(ok && expected.code.length > 0, "hook deploy failed");
        g.hook = expected;

        // $STAMP: launch allocation to the hook; the rest is emitted by the post office, totalling 21M.
        StampToken stamp = new StampToken(deployer, g.hook, launch);
        g.stamp = address(stamp);
        uint256 reward = (stamp.MAX_SUPPLY() - launch) / (2 * 4_200_000);
        PostOffice office =
            new PostOffice(stamp, CourierNFT(c.nft), blockTimeMs, reward, officePrice, treasury, _tiers());
        g.office = address(office);

        // Link everything, then give it all up.
        stamp.setMinter(address(office));
        stamp.renounceOwnership();
        CourierNFT(c.nft).setGame(address(office));
        CourierRenderer(c.renderer).setOffice(ICourierDuty(address(office)));
        CourierRenderer(c.renderer).renounceOwnership();
        StampHook(g.hook).openPool(address(stamp)); // locks the launch allocation forever
        StampHook(g.hook).renounceOwnership(); // the fee recipient is final
        CourierNFT(c.nft).freezeRenderer(); // the art is final
        CourierNFT(c.nft).renounceOwnership();
    }

    /// @dev Everything stage 2 relies on, checked before it deploys anything, so it can't stop half-way.
    function _checkCouriers(address deployer, address treasury, Couriers memory c) internal view {
        CourierNFT nft = CourierNFT(c.nft);
        CourierRenderer renderer = CourierRenderer(c.renderer);
        // The renderer to link and give up is the one the NFT actually uses, the same one freezeRenderer locks.
        require(address(nft.renderer()) == c.renderer, "the NFT uses a different renderer");
        require(c.renderer.code.length > 0 && address(renderer.nft()) == c.nft, "the renderer isn't this collection's");
        require(renderer.owner() == deployer && address(renderer.office()) == address(0), "the renderer is already set up");
        require(nft.owner() == deployer && nft.seed() != 0, "the couriers aren't revealed by this wallet");
        require(nft.game() == address(0) && !nft.rendererFrozen(), "the couriers are already linked or frozen");
        // One treasury for the whole game: mint money, royalties, office sales and spending.
        require(nft.treasury() == treasury, "the NFT's treasury differs from TREASURY");
    }

    /// @dev Dev chains only: the deployer mints `each` couriers for every player, hands them over, and reveals.
    function _mintAndReveal(address deployer, Couriers memory c, address[] memory players, uint256 each, uint256 secret)
        internal
    {
        CourierNFT nft = CourierNFT(c.nft);
        if (!nft.saleOpen()) nft.setSaleOpen(true);
        uint256 total = players.length * each;
        uint256 first = nft.totalMinted() + 1;
        for (uint256 minted; minted < total; minted += 10) {
            uint256 k = total - minted < 10 ? total - minted : 10;
            nft.mint{value: nft.price() * k}(k);
        }
        for (uint256 i; i < total; i++) {
            nft.transferFrom(deployer, players[i / each], first + i);
        }
        nft.reveal(secret);
    }

    /// @dev $usd in IMD wei, from the IMD/ETH pool price and Chainlink ETH/USD (refuses a feed older than a day).
    function _usdToImd(uint256 usd) internal view returns (uint256) {
        PoolKey memory imdEth = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(RobinhoodConfig.IMD), RobinhoodConfig.IMD_ETH_FEE,
            RobinhoodConfig.IMD_ETH_SPACING, IHooks(address(0))
        );
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(RobinhoodConfig.POOL_MANAGER, imdEth.toId());
        (, int256 ethUsd,, uint256 updatedAt,) = IAggregatorV3(RobinhoodConfig.ETH_USD).latestRoundData();
        require(ethUsd > 0 && block.timestamp - updatedAt < 1 days, "stale ETH/USD");
        // IMD per ETH = (sqrtP / 2^96)^2; IMD for $usd = usd * IMD-per-ETH / ETH-USD.
        uint256 imdPerEthX = FullMath.mulDiv(FullMath.mulDiv(usd * 1e26, sqrtP, 1 << 96), sqrtP, 1 << 96);
        uint256 imd = imdPerEthX / uint256(ethUsd);
        console.log("ETH/USD (8 dec)", uint256(ethUsd));
        console.log("USD -> IMD wei ", usd, imd);
        return imd;
    }

    function _startMcap() internal view returns (uint256 startMcap) {
        startMcap = vm.envOr("START_MCAP", uint256(0));
        if (startMcap == 0) startMcap = _usdToImd(vm.envOr("START_MCAP_USD", uint256(3_000)));
        console.log("Launch FDV (IMD wei)", startMcap);
    }

    function _log(Couriers memory c, Game memory g) internal view {
        console.log("CourierNFT", c.nft);
        console.log("Renderer", c.renderer);
        console.log("Treasury (NFT)", CourierNFT(c.nft).treasury());
        if (g.hook == address(0)) return;
        console.log("Treasury (PostOffice)", PostOffice(g.office).treasury());
        console.log("Fee recipient", StampHook(g.hook).feeRecipient());
        console.log("StampHook", g.hook);
        console.log("Router", StampHook(g.hook).router());
        console.log("EthRouter", StampHook(g.hook).ethRouter());
        console.log("StampToken", g.stamp);
        console.log("PostOffice", g.office);
        console.log("STAMP price at launch (IMD wei per STAMP)", StampHook(g.hook).price(g.stamp));
        console.log("FDV at launch (IMD wei, 21M STAMP)        ", StampHook(g.hook).marketCap(g.stamp));
        // Nothing should have an owner left (the post office never has one).
        console.log("Owner: StampToken ", StampToken(g.stamp).owner());
        console.log("Owner: StampHook  ", StampHook(g.hook).owner());
        console.log("Owner: Renderer   ", CourierRenderer(c.renderer).owner());
        console.log("Owner: CourierNFT ", CourierNFT(c.nft).owner());
    }
}

/// @notice Stage 2 on Robinhood Chain, once the couriers (DeployCouriers.s.sol) are minted and revealed.
///
///   ./script/deploy-mainnet.sh game --broadcast --interactive
///
/// Env: FEE_RECIPIENT (the 4% trading fee, in IMD), TREASURY (default FEE_RECIPIENT), START_MCAP_USD (launch price
/// as a fully diluted market cap for all 21M $STAMP in whole dollars, converted to IMD from the IMD/ETH pool and
/// Chainlink ETH/USD; or START_MCAP in IMD wei), LAUNCH_STAMP (2,100,000e18), OFFICE_PRICE (0.005 ether),
/// BLOCK_TIME_MS (1100), SALT_START (0). The couriers come from deployments/robinhood-couriers.json, or NFT. Run it
/// from the wallet that deployed the couriers.
contract DeployMainnet is CourierDeployer {
    function run() external {
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address treasury = vm.envOr("TREASURY", feeRecipient);
        uint256 launch = vm.envOr("LAUNCH_STAMP", uint256(2_100_000e18));
        Couriers memory c = _couriers();
        require(CourierNFT(c.nft).seed() != 0, "reveal the couriers first");
        uint256 startMcap = _startMcap();

        vm.startBroadcast();
        require(CourierNFT(c.nft).owner() == msg.sender, "run this from the wallet that owns the couriers");
        Game memory g = _deployGame(
            msg.sender,
            feeRecipient,
            treasury,
            startMcap,
            launch,
            vm.envOr("OFFICE_PRICE", uint256(0.005 ether)),
            vm.envOr("BLOCK_TIME_MS", uint256(1_100)),
            c
        );
        vm.stopBroadcast();
        _log(c, g);

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;
        string memory json = "courier";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "hook", g.hook);
        vm.serializeAddress(json, "router", StampHook(g.hook).router());
        vm.serializeAddress(json, "ethRouter", StampHook(g.hook).ethRouter());
        vm.serializeAddress(json, "stamp", g.stamp);
        vm.serializeAddress(json, "nft", c.nft);
        vm.serializeAddress(json, "office", g.office);
        vm.serializeAddress(json, "renderer", c.renderer);
        vm.serializeAddress(json, "imd", RobinhoodConfig.IMD);
        vm.serializeAddress(json, "feeRecipient", feeRecipient);
        vm.serializeAddress(json, "treasury", treasury);
        vm.serializeUint(json, "launchStamp", launch);
        string memory out = vm.serializeUint(json, "startMarketCapImd", startMcap);
        vm.writeJson(out, "./deployments/robinhood.json");
    }

    /// @dev The NFT from NFT or deployments/robinhood-couriers.json; its renderer is read from the NFT itself.
    function _couriers() internal view returns (Couriers memory c) {
        c.nft = vm.envOr("NFT", address(0));
        if (c.nft == address(0)) c.nft = vm.parseJsonAddress(vm.readFile("./deployments/robinhood-couriers.json"), ".nft");
        c.renderer = address(CourierNFT(c.nft).renderer());
    }
}
