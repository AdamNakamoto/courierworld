// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StampToken} from "../src/StampToken.sol";
import {CourierNFT, ICourierRenderer} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {CourierSVG} from "../src/CourierSVG.sol";
import {CourierRenderer, ICourierSeed, ICourierDuty} from "../src/CourierRenderer.sol";
import {CourierTraits} from "../src/CourierTraits.sol";

contract RendererTest is Test {
    StampToken stamp;
    CourierNFT nft;
    PostOffice office;
    CourierRenderer renderer;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    uint256 constant SECRET = 42;

    function setUp() public {
        vm.roll(50);
        vm.startPrank(owner);
        stamp = new StampToken(owner, address(0), 0);
        nft = new CourierNFT(owner, treasury, 0.003 ether, keccak256(abi.encode(SECRET)));
        office = new PostOffice(stamp, nft, 1000, 2.5e18, 0.005 ether, treasury, owner);
        stamp.setMinter(address(office));
        nft.setGame(address(office));
        office.addTier(2, 3, 0);
        renderer = new CourierRenderer(ICourierSeed(address(nft)), new CourierSVG(), owner);
        renderer.setOffice(ICourierDuty(address(office)));
        nft.setRenderer(ICourierRenderer(address(renderer)));
        nft.setSaleOpen(true);
        vm.stopPrank();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        nft.mint{value: 0.03 ether}(10);
    }

    function _reveal() internal {
        vm.startPrank(owner);
        nft.setSaleOpen(false);
        nft.reveal(SECRET);
        vm.stopPrank();
    }

    function _has(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length && ok; j++) ok = h[i + j] == n[j];
            if (ok) return true;
        }
        return false;
    }

    function test_TokenURIIsADataURI() public view {
        string memory uri = nft.tokenURI(1);
        assertTrue(_has(uri, "data:application/json;base64,"));
    }

    function test_SealedBeforeReveal() public view {
        string memory json = renderer.tokenJSON(1);
        assertTrue(_has(json, '"name":"Courier #1"'));
        assertTrue(_has(json, '"value":"Sealed"'));
        assertTrue(_has(renderer.sealedSVG(1), "SEALED UNTIL REVEAL"));
    }

    function test_RevealedMetadataMatchesTheNFTsRide() public {
        _reveal();
        for (uint256 id = 1; id <= 10; id++) {
            string memory json = renderer.tokenJSON(id);
            string memory ride = CourierTraits.rideName(nft.rideOf(id));
            assertTrue(_has(json, string.concat('"trait_type":"Ride","value":"', ride, '"')), "ride attribute");
            assertTrue(_has(json, '"image":"data:image/svg+xml;base64,'), "svg image");
            assertTrue(_has(json, '"trait_type":"Level","value":1'), "level 1");
            assertTrue(_has(json, '"value":"Off duty"'), "off duty");
        }
    }

    /// The trait library and CourierNFT.rideOf must always agree on the ride.
    function testFuzz_RideMatchesNFT(uint256 seed, uint256 id) public view {
        (uint8 ride,) = renderer.traitsOf(seed, id);
        uint256 r = uint256(keccak256(abi.encode(seed, id))) % 10_000;
        uint8 expected = r < 4500 ? 0 : r < 7000 ? 1 : r < 8700 ? 2 : r < 9600 ? 3 : 4;
        assertEq(ride, expected);
    }

    function test_ArtShowsLevelAndDuty() public {
        _reveal();
        vm.prank(alice);
        office.openOffice{value: 0.005 ether}(address(0));
        // Pick a courier that fits the Kiosk's 3 routes (anything but a paper plane).
        uint256 id = 1;
        while (nft.rideOf(id) == 4) id++;
        vm.prank(alice);
        office.assign(id);
        vm.warp(block.timestamp + 1000);
        vm.startPrank(alice);
        office.claim();
        stamp.approve(address(office), type(uint256).max);
        office.levelUp(id);
        vm.stopPrank();

        string memory json = renderer.tokenJSON(id);
        assertTrue(_has(json, '"trait_type":"Level","value":2'));
        assertTrue(_has(json, '"value":"On duty"'));
        (uint8 ride, uint8[11] memory opt) = renderer.traitsOf(nft.seed(), id);
        CourierTraits.Traits memory t;
        t.ride = ride;
        t.opt = opt;
        t.heightPm = 1000;
        string memory art = renderer.svg(t, id, 2, true);
        assertTrue(_has(art, ">DUTY</text>"));
        assertTrue(_has(art, ">LV</text>"));
    }

    function test_RendererCanBeFrozen() public {
        vm.startPrank(owner);
        nft.freezeRenderer();
        vm.expectRevert(CourierNFT.RendererIsFrozen.selector);
        nft.setRenderer(ICourierRenderer(address(0)));
        vm.stopPrank();
    }

    function test_EveryRideAndStyleRenders() public view {
        // Sweep seeds until each ride has rendered at least once.
        bool[5] memory seen;
        uint256 count;
        for (uint256 seed = 1; count < 5 && seed < 400; seed++) {
            (uint8 ride,) = renderer.traitsOf(seed, 1);
            if (seen[ride]) continue;
            seen[ride] = true;
            count++;
            string memory art = renderer.previewSVG(seed, 1);
            assertTrue(_has(art, "</svg>"));
        }
        assertEq(count, 5);
    }
}
