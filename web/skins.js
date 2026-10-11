// Courier Skins: 999 cosmetic NFTs, outfits to wear and rides to drive in the game. They change
// how you look (to you and everyone else), never what you earn: $STAMP still comes only from
// couriers on duty at post offices.
import { COURIER } from "./character.js";

export const SKIN_SUPPLY = 999;

const outfit = (o) => ({ ...COURIER, ...o });

/// Every design, with how many of it exist (they add up to SKIN_SUPPLY).
export const SKINS = [
  // ---- common (600)
  { key: "nightrider", name: "Night Rider", rarity: "Common", supply: 120, background: 0x4a4366,
    params: outfit({ shirt: 0x1f1d2b, sleeves: "long", accent: 0xff3ea5, headwear: "visor", hair: 0x1c1a1c, hairStyle: "bob", bottoms: 0x1c1a24, bottomsStyle: "pants" }) },
  { key: "chef", name: "Chef", rarity: "Common", supply: 120, background: 0xf6d2b8,
    params: outfit({ shirt: 0xfbf8ef, sleeves: "long", accent: 0xd9534a, headwear: "chef", hairStyle: "bun", bottoms: 0x2a2a35, bottomsStyle: "pants" }) },
  { key: "pirate", name: "Pirate", rarity: "Common", supply: 120, background: 0xbfe0f2,
    params: outfit({ shirt: 0xf4efe0, accent: 0xd9534a, headwear: "tricorn", eyepatch: true, hair: 0x2a2326, hairStyle: "long", bottoms: 0x5a3b2c, bottomsStyle: "pants" }) },
  { key: "gardener", name: "Gardener", rarity: "Common", supply: 120, background: 0xd6eac4,
    params: outfit({ shirt: 0xf2c94c, accent: 0x5e9f57, headwear: "straw", overalls: 0x5a7ea6, bottoms: 0x5a7ea6, bottomsStyle: "pants", hairStyle: "twin" }) },
  { key: "scooter", name: "Neon Scooter", rarity: "Common", supply: 120, background: 0xd6cdee, params: COURIER, ride: "scooter", rideColour: 0xff3ea5 },
  // ---- rare (320)
  { key: "astronaut", name: "Astronaut", rarity: "Rare", supply: 60, background: 0x2c3e6b,
    params: outfit({ shirt: 0xe9ecef, sleeves: "long", accent: 0xd9dde0, collar: 0xd9534a, headwear: "helmet", bottoms: 0xe9ecef, bottomsStyle: "pants", shoes: 0x8d9790, bag: "backpack" }) },
  { key: "samurai", name: "Samurai Postman", rarity: "Rare", supply: 60, background: 0xf2c6cf,
    params: outfit({ shirt: 0x34476b, sleeves: "long", accent: 0xfbf8ef, headwear: "hachimaki", hair: 0x1c1a1c, hairStyle: "bun", bottoms: 0x1c1c22, bottomsStyle: "pants" }) },
  { key: "robot", name: "Robot Courier", rarity: "Rare", supply: 60, background: 0xd6cdee,
    params: outfit({ head: "robot", skin: 0xb8c4cc, shirt: 0x9aa6ad, sleeves: "long", accent: 0x5ff3ff, headwear: "none", bottoms: 0x6b7178, bottomsStyle: "pants", shoes: 0x3b4145, bag: "backpack" }) },
  { key: "ninja", name: "Ninja", rarity: "Rare", supply: 60, background: 0xf6e7a8,
    params: outfit({ shirt: 0x1f1d24, sleeves: "long", accent: 0x1f1d24, headwear: "hood", bottoms: 0x1f1d24, bottomsStyle: "pants", socks: 0x1f1d24 }) },
  { key: "hoverboard", name: "Hoverboard", rarity: "Rare", supply: 40, background: 0xbfe0f2, params: COURIER, ride: "hoverboard", rideColour: 0x2b2f45 },
  { key: "neonbike", name: "Neon Bike", rarity: "Rare", supply: 40, background: 0xf2c6cf, params: COURIER, ride: "neonbike", rideColour: 0x2b2f45 },
  // ---- legendary (79)
  { key: "golden", name: "Golden Courier", rarity: "Legendary", supply: 20, background: 0x2c3e6b,
    params: outfit({ shirt: 0xe8b93a, accent: 0xc9962a, bottoms: 0xc9962a, socks: 0xfff2b0, shoes: 0xe8b93a, headwear: "crown", bag: "golden" }) },
  { key: "hologram", name: "Hologram Courier", rarity: "Legendary", supply: 20, background: 0x1b2a3a, params: outfit({ finish: "holo" }) },
  { key: "car-gold", name: "Moonwedge Gold", rarity: "Legendary", supply: 13, background: 0x2c3e6b, params: COURIER, ride: "supercar", rideColour: 0xe8b93a },
  { key: "car-red", name: "Moonwedge Rosso", rarity: "Legendary", supply: 13, background: 0xf6e7a8, params: COURIER, ride: "supercar", rideColour: 0xd9534a },
  { key: "car-violet", name: "Moonwedge Neon", rarity: "Legendary", supply: 13, background: 0x1b2a3a, params: COURIER, ride: "supercar", rideColour: 0xb967ff },
];

if (SKINS.reduce((s, x) => s + x.supply, 0) !== SKIN_SUPPLY) console.warn("Skin supplies don't add up to", SKIN_SUPPLY);
