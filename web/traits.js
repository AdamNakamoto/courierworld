// Courier traits. Every courier's look is derived from keccak256(abi.encode(seed, id)),
// the same hash CourierNFT uses on-chain, so the ride (which sets delivery power)
// always matches between the contract and the art.
import { keccak256, encodeAbiParameters } from "https://esm.sh/viem@2";

export const SUPPLY = 3333;

/// Seed used for previews before the on-chain reveal.
export const PREVIEW_SEED = 0x6d657373616765n;

// The tables live in trait-tables.json, shared with the contracts
// (contracts/tools/gen_traits.py generates CourierTraits.sol from the same file).
const TABLES = await fetch(new URL("./trait-tables.json", import.meta.url)).then((r) => r.json());

// Rides: the trait that sets delivery power. Weights are out of 10,000.
export const RIDES = TABLES.rides;

// Cosmetic traits: [name, value, weight]. Colour values become numbers for three.js.
const T = Object.fromEntries(
  TABLES.traits.map(({ type, options }) => [
    type,
    options.map(([name, value, weight]) => [name, value.startsWith("#") ? parseInt(value.slice(1), 16) : value, weight]),
  ]),
);
export const TRAIT_TYPES = Object.keys(T);

function pickWeighted(options, roll) {
  const total = options.reduce((s, o) => s + o[2], 0);
  let r = roll % total;
  for (const o of options) if ((r -= o[2]) < 0) return o;
  return options[options.length - 1];
}

export function rideIndex(hash) {
  let r = Number(hash % 10000n);
  for (let i = 0; i < RIDES.length; i++) if ((r -= RIDES[i].weight) < 0) return i;
  return RIDES.length - 1;
}

export function hashOf(seed, id) {
  return BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(seed), BigInt(id)])));
}

/// Everything about courier #id: display traits, character params and game stats.
export function courier(id, seed = PREVIEW_SEED) {
  const h = hashOf(seed, id);
  const ride = RIDES[rideIndex(h)];
  const traits = { Ride: ride.name };
  const values = {};
  TRAIT_TYPES.forEach((type, i) => {
    const roll = Number((h >> BigInt(16 + 14 * i)) & 0x3fffn);
    const [name, value] = pickWeighted(T[type], roll);
    traits[type] = name;
    values[type] = value;
  });
  const height = 0.92 + Number((h >> 240n) & 0xffn) / 255 * 0.14;
  return {
    id,
    name: `Courier #${id}`,
    ride,
    traits,
    params: {
      skin: values.Skin, hair: values["Hair Colour"], hairStyle: values.Hairstyle, headwear: values.Headwear,
      shirt: values.Shirt, accent: values.Accent, bottoms: values["Bottoms Colour"], bottomsStyle: values.Bottoms,
      socks: 0xf4f1ea, shoes: values.Shoes, bag: values.Bag, height,
    },
    background: values.Background,
  };
}

/// ERC-721 metadata JSON for courier #id; `image` is filled in by the exporter.
export function metadata(c, image) {
  return {
    name: c.name,
    description: "A courier on the tiny planet. Put them on duty at your post office to earn $STAMP.",
    image,
    attributes: [
      ...Object.entries(c.traits).map(([trait_type, value]) => ({ trait_type, value })),
      { trait_type: "Rarity", value: c.ride.rarity },
      { trait_type: "Delivery Power", value: c.ride.power, display_type: "number" },
      { trait_type: "Routes", value: c.ride.routes, display_type: "number" },
    ],
  };
}
