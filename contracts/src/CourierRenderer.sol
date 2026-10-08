// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CourierTraits as CT} from "./CourierTraits.sol";
import {CourierSVG} from "./CourierSVG.sol";

interface ICourierSeed {
    function seed() external view returns (uint256);
}

interface ICourierDuty {
    function levelOf(uint256 tokenId) external view returns (uint8);
    function dutyOf(uint256 tokenId) external view returns (address);
}

/// @title CourierRenderer
/// @notice Fully on-chain metadata and art for the Courier collection. Each courier is
///         a postage stamp drawn as SVG from its traits; the stamp's value is its
///         delivery power. The art is live: it shows the courier's level and stamps an
///         ON DUTY postmark while it works at a post office.
contract CourierRenderer is Ownable {
    using Strings for uint256;

    string private constant INK = "#283033";
    string private constant FONT = "font-family=\"'Arial Black','Helvetica Neue',Arial,sans-serif\" font-weight=\"900\"";

    ICourierSeed public immutable nft;
    CourierSVG public immutable art;
    ICourierDuty public office;

    error OfficeAlreadySet();

    constructor(ICourierSeed nft_, CourierSVG art_, address owner_) Ownable(owner_) {
        nft = nft_;
        art = art_;
    }

    /// @notice One-shot link to the post office, so the art can show level and duty.
    function setOffice(ICourierDuty office_) external onlyOwner {
        if (address(office) != address(0)) revert OfficeAlreadySet();
        office = office_;
    }

    // ------------------------------------------------------------------ metadata

    function tokenURI(uint256 id) external view returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(tokenJSON(id))));
    }

    /// @notice The raw metadata JSON (tokenURI is this, base64-encoded).
    function tokenJSON(uint256 id) public view returns (string memory) {
        uint256 seed = nft.seed();
        string memory name = string.concat("Courier #", id.toString());
        if (seed == 0) {
            return _json(name, "A sealed courier. Traits are revealed when the mint closes.", sealedSVG(id), '[{"trait_type":"Status","value":"Sealed"}]');
        }
        uint8 level = 1;
        bool onDuty;
        if (address(office) != address(0)) {
            level = office.levelOf(id) + 1;
            onDuty = office.dutyOf(id) != address(0);
        }
        CT.Traits memory t = CT.derive(seed, id);
        return _json(
            name,
            "A courier on the tiny planet. Put them on duty at a post office to earn $STAMP. Art and metadata are generated entirely on-chain.",
            svg(t, id, level, onDuty),
            _attributes(t, level, onDuty)
        );
    }

    function _json(string memory name, string memory description, string memory image, string memory attributes)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '{"name":"', name, '","description":"', description,
            '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(image)),
            '","attributes":', attributes, "}"
        );
    }

    function _attributes(CT.Traits memory t, uint8 level, bool onDuty) private pure returns (string memory a) {
        uint256 power = (CT.ridePower(t.ride) * (100 + 12 * (uint256(level) - 1))) / 100;
        a = string.concat(
            '[{"trait_type":"Ride","value":"', CT.rideName(t.ride),
            '"},{"trait_type":"Rarity","value":"', CT.rideRarity(t.ride), '"}'
        );
        for (uint256 i = 0; i < CT.TRAIT_COUNT; i++) {
            a = string.concat(a, ',{"trait_type":"', CT.typeName(i), '","value":"', CT.optionName(i, t.opt[i]), '"}');
        }
        a = string.concat(
            a,
            ',{"display_type":"number","trait_type":"Delivery Power","value":', power.toString(),
            '},{"display_type":"number","trait_type":"Level","value":', uint256(level).toString(),
            '},{"trait_type":"Status","value":"', onDuty ? "On duty" : "Off duty", '"}]'
        );
    }

    // ------------------------------------------------------------------ art

    /// @notice Art for any seed and id, before or after minting. Used to preview the
    ///         collection and to check that the game and contract agree.
    function previewSVG(uint256 seed, uint256 id) external view returns (string memory) {
        return svg(CT.derive(seed, id), id, 1, false);
    }

    function traitsOf(uint256 seed, uint256 id) external pure returns (uint8 ride, uint8[11] memory opt) {
        CT.Traits memory t = CT.derive(seed, id);
        return (t.ride, t.opt);
    }

    function svg(CT.Traits memory t, uint256 id, uint8 level, bool onDuty) public view returns (string memory) {
        string memory bg = art.hexColour(CT.colour(CT.BACKGROUND, t.opt[CT.BACKGROUND]));
        return string.concat(
            _stampOpen(bg),
            _scene(t),
            _label("COURIER", id),
            _value(t.ride, (CT.ridePower(t.ride) * (100 + 12 * (uint256(level) - 1))) / 100),
            level > 1 ? _levelBadge(level) : "",
            onDuty ? _postmark() : "",
            "</svg>"
        );
    }

    function _scene(CT.Traits memory t) private view returns (string memory) {
        // Where the ride and the courier stand in the art window, per ride.
        string[5] memory rideAt = ["", "translate(256 388) scale(0.9)", "translate(338 390) scale(0.95)", "translate(342 390) scale(0.92)", "translate(256 372) scale(0.85)"];
        string[5] memory charAt = ["translate(256 386)", "translate(256 372)", "translate(178 388)", "translate(178 388)", "translate(250 348)"];
        uint256[5] memory charScale = [uint256(820), 800, 780, 780, 720];
        uint256 s = (charScale[t.ride] * t.heightPm) / 1000;
        return string.concat(
            '<ellipse cx="256" cy="390" rx="', t.ride == 0 ? "62" : "130", '" ry="9" fill="', INK, '" opacity=".14"/>',
            t.ride == 0 ? "" : string.concat('<g transform="', rideAt[t.ride], '">', art.ride(t), "</g>"),
            '<g transform="', charAt[t.ride], " scale(", _decimal(s), ')">', art.character(t), "</g>"
        );
    }

    /// @notice A sealed envelope on the stamp, shown until the reveal.
    function sealedSVG(uint256 id) public pure returns (string memory) {
        return string.concat(
            _stampOpen("#8fd2c9"),
            '<g stroke="', INK, '" stroke-width="4" stroke-linejoin="round">',
            '<rect x="146" y="160" width="220" height="146" rx="6" fill="#fbf8ef"/>',
            '<path d="M146 166 L256 246 L366 166" fill="none"/>',
            '<circle cx="256" cy="246" r="20" fill="#d9534a"/></g>',
            '<text x="256" y="356" text-anchor="middle" font-size="22" fill="', INK, '" ', FONT, ">SEALED UNTIL REVEAL</text>",
            _label("COURIER", id),
            "</svg>"
        );
    }

    // ------------------------------------------------------------------ stamp pieces

    function _stampOpen(string memory bg) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
            '<defs><pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.7" fill="#fff" opacity=".4"/></pattern></defs>',
            '<rect width="512" height="512" fill="#e9e1cf"/>',
            '<rect x="40" y="41" width="444" height="444" fill="', INK, '" opacity=".25"/>',
            '<rect x="34" y="34" width="444" height="444" fill="#fbf8ef"/>',
            // Perforations: round dots of the backdrop colour along the stamp's edge.
            '<rect x="34" y="34" width="444" height="444" fill="none" stroke="#e9e1cf" stroke-width="18" stroke-dasharray="0 26.1" stroke-linecap="round"/>',
            '<rect x="58" y="58" width="396" height="342" fill="', bg, '"/>',
            '<rect x="58" y="58" width="396" height="342" fill="url(#dots)"/>'
        );
    }

    function _label(string memory title, uint256 id) private pure returns (string memory) {
        string memory num = id.toString();
        while (bytes(num).length < 4) num = string.concat("0", num);
        return string.concat(
            '<rect x="58" y="400" width="396" height="54" fill="#fbf8ef"/>',
            '<rect x="58" y="58" width="396" height="396" fill="none" stroke="', INK, '" stroke-width="4"/>',
            '<path d="M58 400 H454" stroke="', INK, '" stroke-width="4"/>',
            '<text x="72" y="437" font-size="25" fill="', INK, '" ', FONT, ">", title, "</text>",
            '<text x="440" y="437" text-anchor="end" font-size="25" fill="', INK, '" ', FONT, ">No.", num, "</text>"
        );
    }

    /// @dev The stamp's value is the courier's current delivery power, level included.
    function _value(uint8 ride, uint256 power) private pure returns (string memory) {
        string[5] memory ink = ["#5f6b6e", "#5e9f57", "#3f6fbf", "#8d5a99", "#c9962a"];
        string memory rarity = CT.rideRarity(ride);
        return string.concat(
            '<g text-anchor="end" fill="', ink[ride], '" stroke="#fbf8ef" stroke-width="6" paint-order="stroke" ', FONT, ">",
            '<text x="440" y="100" font-size="34">', power.toString(), "</text>",
            '<text x="440" y="120" font-size="13" stroke-width="4">', _upper(rarity), "</text></g>"
        );
    }

    function _levelBadge(uint8 level) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(98 98)"><circle r="27" fill="#f2c94c" stroke="', INK, '" stroke-width="3.5"/>',
            '<text y="-3" text-anchor="middle" font-size="11" fill="', INK, '" ', FONT, ">LV</text>",
            '<text y="16" text-anchor="middle" font-size="20" fill="', INK, '" ', FONT, ">", uint256(level).toString(), "</text></g>"
        );
    }

    /// @dev A rubber-stamp postmark in the sky while the courier is working, its
    ///      cancellation lines running off the stamp's edge like a real one.
    function _postmark() private pure returns (string memory) {
        return string.concat(
            '<g transform="rotate(-12 372 178)" fill="none" stroke="#b23b33" stroke-width="3.5" opacity=".85">',
            '<circle cx="372" cy="178" r="44" fill="#fbf8ef" fill-opacity=".6"/><circle cx="372" cy="178" r="35" stroke-width="2"/>',
            '<path d="M420 162 Q434 154 448 162 T476 162 M422 178 Q436 170 450 178 T478 178 M420 194 Q434 186 448 194 T476 194" stroke-width="3"/>',
            '<text x="372" y="174" text-anchor="middle" font-size="18" fill="#b23b33" stroke="none" ', FONT, ">ON</text>",
            '<text x="372" y="195" text-anchor="middle" font-size="18" fill="#b23b33" stroke="none" ', FONT, ">DUTY</text></g>"
        );
    }

    function _decimal(uint256 perMille) private pure returns (string memory) {
        string memory frac = (perMille % 1000).toString();
        while (bytes(frac).length < 3) frac = string.concat("0", frac);
        return string.concat((perMille / 1000).toString(), ".", frac);
    }

    function _upper(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) if (b[i] >= 0x61 && b[i] <= 0x7a) b[i] = bytes1(uint8(b[i]) - 32);
        return string(b);
    }
}
