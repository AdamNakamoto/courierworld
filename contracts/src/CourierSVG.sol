// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CourierTraits as CT} from "./CourierTraits.sol";

/// @title CourierSVG
/// @notice Draws a courier and their ride as SVG, in the game's flat-ink style: flat
///         fills with dark rounded outlines. The character stands with feet at the
///         origin, facing the viewer; rides are drawn side-on with the ground at y = 0.
contract CourierSVG {
    string private constant INK = "#283033";

    function hexColour(uint24 c) public pure returns (string memory) {
        bytes memory h = "0123456789abcdef";
        bytes memory out = new bytes(7);
        out[0] = "#";
        for (uint256 i = 0; i < 6; i++) out[6 - i] = h[(c >> (4 * i)) & 0xf];
        return string(out);
    }

    struct Look {
        string skin;
        string hair;
        string shirt;
        string accent;
        string bottoms;
        string shoes;
        uint8 hairstyle;
        uint8 headwear;
        uint8 bottomsStyle;
        uint8 bag;
    }

    function _look(CT.Traits memory t) private pure returns (Look memory l) {
        l.skin = hexColour(CT.colour(CT.SKIN, t.opt[CT.SKIN]));
        l.hair = hexColour(CT.colour(CT.HAIR_COLOUR, t.opt[CT.HAIR_COLOUR]));
        l.shirt = hexColour(CT.colour(CT.SHIRT, t.opt[CT.SHIRT]));
        l.accent = hexColour(CT.colour(CT.ACCENT, t.opt[CT.ACCENT]));
        l.bottoms = hexColour(CT.colour(CT.BOTTOMS_COLOUR, t.opt[CT.BOTTOMS_COLOUR]));
        l.shoes = hexColour(CT.colour(CT.SHOES, t.opt[CT.SHOES]));
        l.hairstyle = t.opt[CT.HAIRSTYLE];
        l.headwear = t.opt[CT.HEADWEAR];
        l.bottomsStyle = t.opt[CT.BOTTOMS];
        l.bag = t.opt[CT.BAG];
    }

    // ------------------------------------------------------------------ character

    /// @notice The courier as an SVG group, feet at (0, 0), about 310 units tall.
    function character(CT.Traits memory t) external pure returns (string memory) {
        Look memory l = _look(t);
        return string.concat(
            '<g stroke="', INK, '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">',
            _behind(l),
            _legs(l),
            _body(l),
            _bagFront(l),
            _arms(l),
            _head(l),
            _hairFront(l),
            _headwear(l),
            "</g>"
        );
    }

    function _behind(Look memory l) private pure returns (string memory s) {
        if (l.bag == CT.BAG_BACKPACK) s = string.concat('<rect x="-41" y="-208" width="82" height="72" rx="13" fill="', l.accent, '"/>');
        if (l.bag == CT.BAG_SACK) {
            s = string.concat(
                '<ellipse cx="-38" cy="-214" rx="29" ry="33" fill="#d2b48c"/>',
                '<path d="M-49 -247 L-36 -238 L-25 -249 Z" fill="#b8986e"/>',
                '<rect x="-56" y="-240" width="21" height="13" fill="#fbf8ef" transform="rotate(-15 -45 -233)"/>'
            );
        }
        if (l.hairstyle == CT.HAIRSTYLE_LONG) {
            s = string.concat(s, '<path d="M-47 -252 Q-54 -172 -42 -148 H42 Q54 -172 47 -252 Z" fill="', l.hair, '"/>');
        } else if (l.hairstyle == CT.HAIRSTYLE_PONY) {
            s = string.concat(s, '<ellipse cx="44" cy="-222" rx="13" ry="33" fill="', l.hair, '" transform="rotate(-18 44 -222)"/>');
        } else if (l.hairstyle == CT.HAIRSTYLE_TWIN) {
            s = string.concat(
                s,
                '<ellipse cx="-52" cy="-220" rx="13" ry="34" fill="', l.hair, '" transform="rotate(16 -52 -220)"/>',
                '<ellipse cx="52" cy="-220" rx="13" ry="34" fill="', l.hair, '" transform="rotate(-16 52 -220)"/>'
            );
        } else if (l.hairstyle == CT.HAIRSTYLE_BUN) {
            s = string.concat(s, '<circle cx="0" cy="-298" r="17" fill="', l.hair, '"/>');
        }
        // Hair behind the head shows around its edge.
        s = string.concat(s, '<ellipse cx="0" cy="-254" rx="45" ry="46" fill="', l.hair, '"/>');
    }

    function _legs(Look memory l) private pure returns (string memory) {
        if (l.bottomsStyle == CT.BOTTOMS_PANTS) {
            return string.concat(
                '<rect x="-30" y="-128" width="20" height="116" rx="8" fill="', l.bottoms, '"/>',
                '<rect x="10" y="-128" width="20" height="116" rx="8" fill="', l.bottoms, '"/>',
                _shoes(l)
            );
        }
        return string.concat(
            '<rect x="-27" y="-114" width="15" height="102" rx="7" fill="', l.skin, '"/>',
            '<rect x="12" y="-114" width="15" height="102" rx="7" fill="', l.skin, '"/>',
            '<rect x="-28" y="-36" width="17" height="21" rx="4" fill="#f4f1ea"/>',
            '<rect x="11" y="-36" width="17" height="21" rx="4" fill="#f4f1ea"/>',
            _shoes(l)
        );
    }

    function _shoes(Look memory l) private pure returns (string memory) {
        return string.concat(
            '<ellipse cx="-21" cy="-8" rx="15" ry="9" fill="', l.shoes, '"/>',
            '<ellipse cx="21" cy="-8" rx="15" ry="9" fill="', l.shoes, '"/>'
        );
    }

    function _body(Look memory l) private pure returns (string memory bottoms) {
        if (l.bottomsStyle == CT.BOTTOMS_SKIRT) bottoms = '<path d="M-31 -140 H31 L47 -88 Q0 -79 -47 -88 Z" fill="';
        else if (l.bottomsStyle == CT.BOTTOMS_PANTS) bottoms = '<path d="M-33 -140 H33 L32 -118 H-32 Z" fill="';
        else bottoms = '<path d="M-34 -140 H34 L36 -98 H5 L0 -114 L-5 -98 H-36 Z" fill="';
        return string.concat(
            bottoms, l.bottoms, '"/>',
            '<rect x="-8" y="-220" width="16" height="22" rx="5" fill="', l.skin, '"/>',
            '<path d="M-34 -204 Q-37 -170 -32 -134 H32 Q37 -170 34 -204 Q0 -214 -34 -204 Z" fill="', l.shirt, '"/>',
            '<path d="M-17 -209 Q0 -201 17 -209 L13 -198 Q0 -190 -13 -198 Z" fill="', l.accent, '"/>'
        );
    }

    function _bagFront(Look memory l) private pure returns (string memory) {
        if (l.bag == CT.BAG_SATCHEL || l.bag == CT.BAG_GOLDEN) {
            bool gold = l.bag == CT.BAG_GOLDEN;
            return string.concat(
                '<path d="M-34 -198 L-28 -204 L32 -142 L26 -136 Z" fill="', gold ? "#b88a22" : "#6e4a2c", '"/>',
                '<rect x="22" y="-148" width="31" height="35" rx="4" fill="', gold ? "#e8b93a" : "#a0693c", '"/>',
                '<path d="M22 -148 H53 V-131 Q37.5 -125 22 -131 Z" fill="', gold ? "#c9962a" : "#7e5230", '"/>',
                '<rect x="34" y="-134" width="8" height="6" fill="', gold ? "#fff2b0" : "#e2c46a", '"/>'
            );
        }
        if (l.bag == CT.BAG_BACKPACK) {
            return '<rect x="-25" y="-206" width="9" height="60" rx="3" fill="#4e5a67"/><rect x="16" y="-206" width="9" height="60" rx="3" fill="#4e5a67"/>';
        }
        if (l.bag == CT.BAG_TOTE) {
            return string.concat(
                '<path d="M26 -205 L32 -205 L40 -152 L34 -152 Z" fill="#d8cdb0"/>',
                '<path d="M30 -154 H63 L61 -111 H32 Z" fill="#eee4c8"/>',
                '<rect x="31" y="-140" width="31" height="9" fill="', l.accent, '"/>'
            );
        }
        // Mail sack: strap across the chest from the right shoulder.
        return '<path d="M26 -201 L32 -206 L-29 -140 L-35 -146 Z" fill="#8a6a4a"/>';
    }

    function _arms(Look memory l) private pure returns (string memory) {
        return string.concat(
            '<rect x="-51" y="-205" width="18" height="35" rx="8" fill="', l.shirt, '"/>',
            '<rect x="-49" y="-178" width="12" height="54" rx="6" fill="', l.skin, '"/>',
            '<circle cx="-43" cy="-122" r="8" fill="', l.skin, '"/>',
            '<rect x="33" y="-205" width="18" height="35" rx="8" fill="', l.shirt, '"/>',
            '<rect x="37" y="-178" width="12" height="54" rx="6" fill="', l.skin, '"/>',
            '<circle cx="43" cy="-122" r="8" fill="', l.skin, '"/>'
        );
    }

    function _head(Look memory l) private pure returns (string memory) {
        return string.concat(
            '<circle cx="-40" cy="-247" r="8" fill="', l.skin, '"/>',
            '<circle cx="40" cy="-247" r="8" fill="', l.skin, '"/>',
            '<ellipse cx="0" cy="-250" rx="40" ry="42" fill="', l.skin, '"/>',
            // Face details have no outline.
            '<g stroke="none"><ellipse cx="-25" cy="-233" rx="7" ry="3.5" fill="#f0a49a"/><ellipse cx="25" cy="-233" rx="7" ry="3.5" fill="#f0a49a"/>',
            '<ellipse cx="-15" cy="-246" rx="5.5" ry="8" fill="#231d20"/><ellipse cx="15" cy="-246" rx="5.5" ry="8" fill="#231d20"/>',
            '<circle cx="-13" cy="-250" r="2.2" fill="#fff"/><circle cx="17" cy="-250" r="2.2" fill="#fff"/></g>',
            '<path d="M-22 -262 L-9 -264 M9 -264 L22 -262" fill="none" stroke-width="3"/>',
            '<path d="M-5 -226 Q0 -222 5 -226" fill="none" stroke-width="2.5"/>'
        );
    }

    function _hairFront(Look memory l) private pure returns (string memory s) {
        if (l.hairstyle == CT.HAIRSTYLE_BOB) {
            s = string.concat(
                '<path d="M-45 -260 Q-52 -222 -39 -210 L-31 -213 Q-36 -240 -34 -260 Z" fill="', l.hair, '"/>',
                '<path d="M45 -260 Q52 -222 39 -210 L31 -213 Q36 -240 34 -260 Z" fill="', l.hair, '"/>'
            );
        } else {
            uint256 len = l.hairstyle == CT.HAIRSTYLE_LONG ? 64 : 38;
            s = string.concat(
                '<rect x="-45" y="-264" width="10" height="', _u(len), '" rx="5" fill="', l.hair, '"/>',
                '<rect x="35" y="-264" width="10" height="', _u(len), '" rx="5" fill="', l.hair, '"/>'
            );
        }
        s = string.concat(
            s,
            '<path d="M-42 -252 Q-44 -297 0 -298 Q44 -297 42 -252 Q34 -266 22 -262 Q12 -272 0 -264 Q-12 -272 -22 -262 Q-34 -266 -42 -252 Z" fill="',
            l.hair,
            '"/>'
        );
        // Hair ties sit at the root of the tails.
        if (l.hairstyle == CT.HAIRSTYLE_PONY) s = string.concat(s, '<circle cx="38" cy="-256" r="6" fill="', l.accent, '"/>');
        if (l.hairstyle == CT.HAIRSTYLE_TWIN) {
            s = string.concat(s, '<circle cx="-43" cy="-258" r="6" fill="', l.accent, '"/><circle cx="43" cy="-258" r="6" fill="', l.accent, '"/>');
        }
    }

    function _headwear(Look memory l) private pure returns (string memory) {
        if (l.headwear == CT.HEADWEAR_CAP) {
            return string.concat(
                '<path d="M-43 -258 Q-44 -305 0 -306 Q44 -305 43 -258 Z" fill="', l.accent, '"/>',
                '<path d="M-31 -258 Q0 -268 31 -258 Q37 -248 23 -246 Q0 -252 -23 -246 Q-37 -248 -31 -258 Z" fill="', l.accent, '"/>',
                '<rect x="-7" y="-290" width="14" height="10" rx="2" fill="#f2c94c"/>'
            );
        }
        if (l.headwear == CT.HEADWEAR_BUCKET) {
            return string.concat(
                '<path d="M-35 -268 L-31 -308 Q0 -316 31 -308 L35 -268 Z" fill="', l.accent, '"/>',
                '<rect x="-35" y="-279" width="70" height="9" fill="#f4efe0"/>',
                '<ellipse cx="0" cy="-266" rx="61" ry="11" fill="', l.accent, '"/>'
            );
        }
        if (l.headwear == CT.HEADWEAR_BEANIE) {
            return string.concat(
                '<circle cx="0" cy="-318" r="10" fill="#f4efe0"/>',
                '<path d="M-43 -262 Q-46 -313 0 -313 Q46 -313 43 -262 Z" fill="', l.accent, '"/>',
                '<rect x="-46" y="-278" width="92" height="17" rx="6" fill="', l.accent, '"/>',
                '<path d="M-30 -276 V-263 M-15 -276 V-263 M0 -276 V-263 M15 -276 V-263 M30 -276 V-263" fill="none" stroke-width="2"/>'
            );
        }
        if (l.headwear == CT.HEADWEAR_HEADPHONES) {
            return string.concat(
                '<path d="M-46 -246 Q-49 -307 0 -307 Q49 -307 46 -246" fill="none" stroke-width="7"/>',
                '<rect x="-56" y="-264" width="16" height="31" rx="7" fill="', l.accent, '"/>',
                '<rect x="40" y="-264" width="16" height="31" rx="7" fill="', l.accent, '"/>'
            );
        }
        if (l.headwear == CT.HEADWEAR_GOGGLES) {
            return string.concat(
                '<rect x="-45" y="-288" width="90" height="8" rx="3" fill="#6c5446"/>',
                '<circle cx="-15" cy="-284" r="11" fill="#c9962a"/><circle cx="15" cy="-284" r="11" fill="#c9962a"/>',
                '<circle cx="-15" cy="-284" r="6.5" fill="#8db8c6"/><circle cx="15" cy="-284" r="6.5" fill="#8db8c6"/>'
            );
        }
        return "";
    }

    // ------------------------------------------------------------------ rides

    /// @notice The ride, side-on, ground at y = 0. Empty for couriers on foot.
    function ride(CT.Traits memory t) external pure returns (string memory) {
        string memory a = hexColour(CT.colour(CT.ACCENT, t.opt[CT.ACCENT]));
        string memory open = string.concat('<g stroke="', INK, '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">');
        if (t.ride == 1) {
            return string.concat(
                open,
                '<rect x="-60" y="-22" width="120" height="10" rx="5" fill="', a, '"/>',
                '<rect x="-44" y="-13" width="18" height="5" fill="#d9d8d2"/><rect x="26" y="-13" width="18" height="5" fill="#d9d8d2"/>',
                '<circle cx="-35" cy="-6" r="7" fill="#f2c94c"/><circle cx="35" cy="-6" r="7" fill="#f2c94c"/></g>'
            );
        }
        if (t.ride == 2) {
            return string.concat(
                open,
                _wheel("-50", "-38", "36"),
                _wheel("50", "-38", "36"),
                // Frame: an ink tube with the accent colour inside.
                '<path d="M-50 -38 L-8 -40 L28 -104 M-8 -40 L-26 -102 L28 -104 L50 -38" fill="none" stroke-width="10"/>',
                '<path d="M-50 -38 L-8 -40 L28 -104 M-8 -40 L-26 -102 L28 -104 L50 -38" fill="none" stroke="', a, '" stroke-width="5"/>',
                '<rect x="-38" y="-112" width="25" height="8" rx="3" fill="#3b4145"/>',
                '<path d="M26 -104 L24 -118 L42 -120" fill="none" stroke-width="5"/>',
                '<rect x="42" y="-114" width="38" height="27" rx="3" fill="#c49a6c"/>',
                '<rect x="48" y="-126" width="23" height="13" fill="#fbf8ef" transform="rotate(-10 59 -119)"/></g>'
            );
        }
        if (t.ride == 3) {
            return string.concat(
                open,
                '<circle cx="-56" cy="-24" r="24" fill="#2b3134"/><circle cx="-56" cy="-24" r="9" fill="#d9d8d2"/>',
                '<circle cx="58" cy="-24" r="24" fill="#2b3134"/><circle cx="58" cy="-24" r="9" fill="#d9d8d2"/>',
                '<path d="M-82 -42 Q-86 -88 -42 -88 L4 -86 Q8 -62 -4 -42 Z" fill="', a, '"/>',
                '<rect x="-6" y="-48" width="46" height="10" rx="4" fill="#3b4145"/>',
                '<path d="M34 -42 L44 -114 L58 -114 L52 -42 Z" fill="', a, '"/>',
                '<rect x="-64" y="-98" width="60" height="12" rx="6" fill="#3b4145"/>',
                '<path d="M50 -114 L48 -130 L66 -132" fill="none" stroke-width="5"/>',
                '<circle cx="61" cy="-102" r="7" fill="#fff2b0"/>',
                '<rect x="-96" y="-138" width="46" height="40" rx="4" fill="#d9534a"/>',
                '<rect x="-85" y="-126" width="24" height="15" fill="#fbf8ef"/><path d="M-85 -126 L-73 -117 L-61 -126" fill="none" stroke-width="2"/></g>'
            );
        }
        if (t.ride == 4) {
            return string.concat(
                open,
                '<path d="M-132 -10 L142 -38 L-112 24 Z" fill="#fbf8ef"/>',
                '<path d="M-132 -10 L142 -38 L-72 8 Z" fill="#e6e0d0"/>',
                '<path d="M-122 -4 L132 -35" fill="none" stroke-width="2"/>',
                '<rect x="-74" y="2" width="22" height="18" fill="', a, '" transform="rotate(-8 -63 11)"/></g>'
            );
        }
        return "";
    }

    function _wheel(string memory cx, string memory cy, string memory r) private pure returns (string memory) {
        return string.concat(
            '<circle cx="', cx, '" cy="', cy, '" r="', r, '" fill="none" stroke-width="7"/>',
            '<circle cx="', cx, '" cy="', cy, '" r="5" fill="#d9d8d2"/>'
        );
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        while (v > 0) {
            b = abi.encodePacked(bytes1(uint8(48 + (v % 10))), b);
            v /= 10;
        }
        return string(b);
    }
}
