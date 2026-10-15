// Courier Companions: the kinds of companion that follow a courier around (contracts/src/CourierCompanions.sol, an
// ERC-1155 bought only with $STAMP; each kind is a token id). Shared by the game (companions.js draws them), the Post
// Office panel (the shop), the multiplayer server (it shows a companion only to wallets that own one) and the
// marketplace metadata (web/companions/<id>.json). The prices and supplies live on chain; this is what each one is.
//
// The mecha, the colossus and the anime-style companions are Courier World's own designs.

/// id -> { key, name, tier, icon, floats (hovers instead of walking), height (metres, about), blurb }
export const COMPANIONS = [
  { id: 1, key: "cat", name: "Cat", tier: "Pet", icon: "🐱", floats: false, height: 0.45, blurb: "A ginger post-office cat. Naps on parcels, chases butterflies, always comes back." },
  { id: 2, key: "dog", name: "Dog", tier: "Pet", icon: "🐶", floats: false, height: 0.55, blurb: "A loyal pup with a tiny mailbag. Thinks every letter is for them." },
  { id: 3, key: "frog", name: "Frog", tier: "Pet", icon: "🐸", floats: false, height: 0.35, blurb: "A little green frog that hops after you, puddle to puddle." },
  { id: 11, key: "ufo", name: "Mini UFO", tier: "Space buddy", icon: "🛸", floats: true, height: 0.5, blurb: "A pocket flying saucer with blinking lights and a tractor beam for stray letters." },
  { id: 12, key: "drone", name: "Robot Drone", tier: "Space buddy", icon: "🤖", floats: true, height: 0.4, blurb: "A hovering helper bot with a big friendly screen face." },
  { id: 13, key: "martian", name: "Little Martian", tier: "Space buddy", icon: "👽", floats: false, height: 0.7, blurb: "A young Martian, one big eye and a dust scarf, on their first trip off Mars." },
  { id: 21, key: "spirit", name: "Golden Stamp Spirit", tier: "Legendary", icon: "✨", floats: true, height: 0.6, blurb: "A golden stamp come to life, trailing sparkles wherever you go." },
  { id: 22, key: "rocket", name: "Mini Rocket", tier: "Legendary", icon: "🚀", floats: true, height: 0.8, blurb: "A tiny rocket that flies beside you on a little flame." },
  { id: 31, key: "mecha", name: "Mecha Guardian", tier: "Mecha", icon: "🦾", floats: false, height: 1.1, blurb: "A pint-sized guardian mech with a glowing visor and jet boots. Built to keep couriers safe." },
  { id: 32, key: "colossus", name: "Colossus", tier: "Mecha", icon: "🗿", floats: false, height: 1.4, blurb: "A towering stone giant with mossy shoulders and warm amber eyes. Gentle, slow, unstoppable." },
  { id: 41, key: "sakura", name: "Sakura", tier: "Anime", icon: "🌸", floats: false, height: 0.95, blurb: "A cheerful companion in cherry-blossom pink, with a sakura hairpin and boundless energy." },
  { id: 42, key: "luna", name: "Luna", tier: "Anime", icon: "🌙", floats: false, height: 0.95, blurb: "A calm stargazer with silver hair and a crescent-moon cloak. Knows every constellation." },
  { id: 43, key: "hana", name: "Hana", tier: "Anime", icon: "🌺", floats: false, height: 0.95, blurb: "A sunny flower-crowned helper with her own tiny satchel. Loves exploring the planet with you." },
];
export const COMPANION_IDS = COMPANIONS.map((c) => c.id);
export const companionOf = (id) => COMPANIONS.find((c) => c.id === id) ?? null;
/// The tiers, in shop order.
export const TIERS = ["Pet", "Space buddy", "Legendary", "Mecha", "Anime"];
