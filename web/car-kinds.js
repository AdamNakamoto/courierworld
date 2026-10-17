// Courier Cars: the cars a courier can drive (an ERC-1155 bought only with $STAMP, the Courier Companions contract
// deployed again for cars; each kind is a token id). Shared by the game (cars.js draws them), the Post Office panel
// (the shop), the multiplayer server (it shows a car only to wallets that own one) and the marketplace metadata
// (web/cars/<id>.json). The prices, supplies and wallet limits live on chain; TIER_TERMS is what the deploy sets.
//
// Every car is Courier World's own design: no real makes or models.

/// id -> { key, name, tier, icon, blurb }. Ids never change (they're token ids); add new cars with new ids.
export const CARS = [
  { id: 1, key: "van", name: "Courier Van", tier: "Common", icon: "🚐", blurb: "The post office's own red van, an envelope on each door. Room in the back for a thousand letters." },
  { id: 2, key: "taxi", name: "City Taxi", tier: "Common", icon: "🚕", blurb: "A yellow cab with a light on the roof and a checkered stripe. Where to, courier?" },
  { id: 3, key: "hatch", name: "Hatchback", tier: "Common", icon: "🚗", blurb: "A little two-tone runabout. Parks anywhere, goes everywhere." },
  { id: 4, key: "pickup", name: "Pickup Truck", tier: "Common", icon: "🛻", blurb: "A sturdy pickup with an open bed, for parcels too big for any bag." },
  { id: 5, key: "offroad", name: "Trail 4x4", tier: "Common", icon: "🚙", blurb: "An open-top four-by-four with a spare wheel on the back. Made for the mountain roads." },
  { id: 6, key: "camper", name: "Camper Van", tier: "Common", icon: "🚌", blurb: "A two-tone camper with a pop-up roof. Deliver by day, stargaze by night." },
  { id: 11, key: "icecream", name: "Ice-Cream Truck", tier: "Rare", icon: "🍦", blurb: "Pastel stripes and a giant cone on the roof. Everyone waves." },
  { id: 12, key: "monster", name: "Monster Truck", tier: "Rare", icon: "💥", blurb: "Wheels taller than you are. Curbs? What curbs?" },
  { id: 13, key: "tuktuk", name: "Tuk-Tuk", tier: "Rare", icon: "🛺", blurb: "A zippy three-wheeler with a striped canopy. Beep beep!" },
  { id: 14, key: "bus", name: "Double-Decker Bus", tier: "Rare", icon: "🚍", blurb: "A red double-decker, every seat for a letter. The top deck has the best view." },
  { id: 15, key: "tractor", name: "Tractor", tier: "Rare", icon: "🚜", blurb: "Big back wheels, a puffing chimney and no hurry at all." },
  { id: 21, key: "sports", name: "Sports Car", tier: "Epic", icon: "🏎️", blurb: "A low, wedge-shaped coupe with a rear wing. Looks fast standing still." },
  { id: 22, key: "convertible", name: "Convertible", tier: "Epic", icon: "🚘", blurb: "Top down, sun out. A sea-green cruiser with white-wall tyres." },
  { id: 23, key: "racer", name: "Race Car", tier: "Epic", icon: "🏁", blurb: "An open-wheel racer with a number on the nose and wings front and back." },
  { id: 24, key: "muscle", name: "Muscle Car", tier: "Epic", icon: "🔥", blurb: "A long hood, twin racing stripes and a rumble you can feel." },
  { id: 31, key: "hover", name: "Hover Car", tier: "Legendary", icon: "🛸", blurb: "No wheels: it floats on a cushion of light, a hand's width off the road." },
  { id: 32, key: "limo", name: "Golden Limo", tier: "Legendary", icon: "👑", blurb: "A stretch limousine finished in gold. For couriers who have made it." },
  { id: 33, key: "cyber", name: "Neon Cyber Car", tier: "Legendary", icon: "⚡", blurb: "All hard angles and glowing edges, straight out of the neon district." },
  { id: 34, key: "rocketcar", name: "Rocket Car", tier: "Legendary", icon: "🚀", blurb: "A silver dart with fins and a rocket on the back, flame and all." },
];
export const CAR_IDS = CARS.map((c) => c.id);
export const carOf = (id) => CARS.find((c) => c.id === id) ?? null;
/// The tiers, in shop order, and what each costs ($STAMP, whole tokens), how many of each car there are, and how many
/// of a car one wallet can buy (the contract's per-kind limit).
export const CAR_TIERS = ["Common", "Rare", "Epic", "Legendary"];
export const TIER_TERMS = {
  Common: { price: 250, supply: 300, perWallet: 5 },
  Rare: { price: 750, supply: 100, perWallet: 3 },
  Epic: { price: 2000, supply: 30, perWallet: 2 },
  Legendary: { price: 5000, supply: 10, perWallet: 1 },
}; // (halved on 2026-10-17, launch day: DeployCars.s.sol's `reprice`)
