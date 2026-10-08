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

/// @notice Deploys everything on Robinhood Chain and opens the taxed $STAMP/IMD pool:
///   StampHook (mined CREATE2 address) with its IMD and ETH routers, $STAMP (launch allocation minted to the hook,
///   then token ownership renounced), Courier NFT + on-chain renderer, and the post office.
///
///   FEE_RECIPIENT=0x... SEED_COMMIT=0x... START_MCAP=<IMD wei> \
///   forge script script/DeployMainnet.s.sol --rpc-url robinhood --broadcast --interactive
///
/// Required env:
///   FEE_RECIPIENT  receives the 4% trading fee (in IMD)
///   SEED_COMMIT    keccak256(abi.encode(secret)); keep the secret until the mint is over, then reveal(secret)
///   START_MCAP_USD launch price as a fully diluted market cap for all 21M $STAMP, in whole US dollars; converted
///                  to IMD at deploy time from the IMD/ETH pool and Chainlink ETH/USD. Or set START_MCAP (IMD wei).
/// Optional env:
///   TREASURY (default FEE_RECIPIENT)  mint, post office and $STAMP-spend revenue
///   LAUNCH_STAMP (default 2,100,000e18)  $STAMP locked single-sided in the pool
///   MINT_PRICE (0.003 ether), OFFICE_PRICE (0.005 ether), BLOCK_TIME_MS (1100), OPEN_SALE (false), SALT_START (0)
contract DeployMainnet is Script {
    struct Deployed {
        address hook;
        address stamp;
        address nft;
        address office;
        address renderer;
    }

    function run() external {
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address treasury = vm.envOr("TREASURY", feeRecipient);
        bytes32 commit = vm.envBytes32("SEED_COMMIT");
        uint256 startMcap = vm.envOr("START_MCAP", uint256(0));
        if (startMcap == 0) startMcap = _usdToImd(vm.envUint("START_MCAP_USD"));
        console.log("Launch FDV (IMD wei)", startMcap);
        uint256 launch = vm.envOr("LAUNCH_STAMP", uint256(2_100_000e18));

        vm.startBroadcast();
        address deployer = msg.sender;
        Deployed memory d = _deploy(deployer, feeRecipient, treasury, commit, startMcap, launch);
        vm.stopBroadcast();

        console.log("StampHook   ", d.hook);
        console.log("Router      ", StampHook(d.hook).router());
        console.log("EthRouter   ", StampHook(d.hook).ethRouter());
        console.log("StampToken  ", d.stamp);
        console.log("CourierNFT  ", d.nft);
        console.log("PostOffice  ", d.office);
        console.log("Renderer    ", d.renderer);
        console.log("STAMP price at launch (IMD wei per STAMP)", StampHook(d.hook).price(d.stamp));
        console.log("FDV at launch (IMD wei, 21M STAMP)        ", StampHook(d.hook).marketCap(d.stamp));

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;
        string memory json = "courier";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "hook", d.hook);
        vm.serializeAddress(json, "router", StampHook(d.hook).router());
        vm.serializeAddress(json, "ethRouter", StampHook(d.hook).ethRouter());
        vm.serializeAddress(json, "stamp", d.stamp);
        vm.serializeAddress(json, "nft", d.nft);
        vm.serializeAddress(json, "office", d.office);
        vm.serializeAddress(json, "renderer", d.renderer);
        vm.serializeAddress(json, "imd", RobinhoodConfig.IMD);
        vm.serializeAddress(json, "feeRecipient", feeRecipient);
        vm.serializeAddress(json, "treasury", treasury);
        vm.serializeUint(json, "launchStamp", launch);
        string memory out = vm.serializeUint(json, "startMarketCapImd", startMcap);
        vm.writeJson(out, "./deployments/robinhood.json");
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

    function _deploy(address deployer, address feeRecipient, address treasury, bytes32 commit, uint256 startMcap, uint256 launch)
        internal
        returns (Deployed memory d)
    {
        // 1. The hook, at an address carrying its permission flags.
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
        d.hook = expected;

        // 2. $STAMP: launch allocation to the hook; the rest is emitted by the post office, totalling 21M.
        StampToken stamp = new StampToken(deployer, d.hook, launch);
        d.stamp = address(stamp);

        // 3. Couriers, the post office and the on-chain art.
        CourierNFT nft = new CourierNFT(deployer, treasury, vm.envOr("MINT_PRICE", uint256(0.003 ether)), commit);
        d.nft = address(nft);
        uint256 reward = (stamp.MAX_SUPPLY() - launch) / (2 * 4_200_000);
        PostOffice office = new PostOffice(
            stamp, nft, vm.envOr("BLOCK_TIME_MS", uint256(1_100)), reward,
            vm.envOr("OFFICE_PRICE", uint256(0.005 ether)), treasury, deployer
        );
        d.office = address(office);
        CourierRenderer renderer = new CourierRenderer(ICourierSeed(address(nft)), new CourierSVG(), deployer);
        d.renderer = address(renderer);

        stamp.setMinter(address(office));
        stamp.renounceOwnership(); // the token has no owner powers left
        nft.setGame(address(office));
        nft.setRenderer(ICourierRenderer(address(renderer)));
        renderer.setOffice(ICourierDuty(address(office)));

        //             slots routes upgradeCost
        office.addTier(2, 3, 0); // Kiosk
        office.addTier(4, 7, 100e18); // Branch
        office.addTier(6, 14, 400e18); // Depot
        office.addTier(9, 24, 1_500e18); // Hub
        office.addTier(12, 40, 5_000e18); // HQ

        // 4. Open the pool: locks the launch allocation forever.
        StampHook(d.hook).openPool(d.stamp);
        if (vm.envOr("OPEN_SALE", false)) nft.setSaleOpen(true);
    }
}
