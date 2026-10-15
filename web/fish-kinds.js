// Courier Fish: the 24 species of the bay, shared by the game, the Post Office panel, the multiplayer room and the
// metadata (web/fish/make.mjs). Ids match the CourierFish contract's lineup (contracts/script/DeployFish.s.sol): the
// supplies and daily caps here are what it was deployed with, and the chain has the final word. No imports, no DOM.

/// The most fish a wallet catches a day (the contract's maxPerDay).
export const FISH_PER_DAY = 10;
/// Days after the catch that it can still be minted (the contract's CLAIM_DAYS: that day and the six after).
export const FISH_MINT_DAYS = 7;

/// Rarity tiers, rarest last: `odds` out of 1000 per catch (the room picks the tier, then a species in it).
export const FISH_TIERS = [
  { key: "Common", odds: 600, ink: "#5f6b6e" },
  { key: "Uncommon", odds: 280, ink: "#5e9f57" },
  { key: "Rare", odds: 92, ink: "#3f6fbf" },
  { key: "Epic", odds: 24, ink: "#8d5a99" },
  { key: "Legendary", odds: 4, ink: "#c9962a" },
];

/// Every species. `supply`: the most ever minted (0: never runs out); `daily`: the most caught a day across everyone
/// (0: no cap). `shape` and `pal` draw its picture (web/fish-art.js).
export const FISH = [
  { id: 1, name: "Sardine", tier: "Common", supply: 0, daily: 0, shape: "slim", pal: ["#8fa8bf", "#d9e4ee", "#4d6a86"], pattern: "dots", blurb: "Small, silver and always in a crowd." },
  { id: 2, name: "Mackerel", tier: "Common", supply: 0, daily: 0, shape: "torpedo", pal: ["#3f7f8c", "#dfe9e4", "#1f3f4a"], pattern: "tiger", blurb: "Striped like waves, quick as a gust." },
  { id: 3, name: "Anchovy", tier: "Common", supply: 0, daily: 0, shape: "slim", pal: ["#a7b6b9", "#eef3f2", "#6d7f84"], pattern: "line", blurb: "Tiny, but it never travels alone." },
  { id: 4, name: "Sea Bream", tier: "Common", supply: 0, daily: 0, shape: "round", pal: ["#c7b7a3", "#f2ebe1", "#8a7a66"], pattern: "plain", blurb: "A tidy, round fish that likes the rocks." },
  { id: 5, name: "Mullet", tier: "Common", supply: 0, daily: 0, shape: "torpedo", pal: ["#8f9a8a", "#e3e8de", "#5a6556"], pattern: "line", blurb: "Grazes the sand by the pier all day." },
  { id: 6, name: "Herring", tier: "Common", supply: 0, daily: 0, shape: "slim", pal: ["#6f8fae", "#e7eef5", "#3c5878"], pattern: "plain", blurb: "Blue-backed and shiny in the sun." },
  { id: 7, name: "Goby", tier: "Common", supply: 0, daily: 0, shape: "goby", pal: ["#b59a6e", "#efe3cc", "#6e5838"], pattern: "dots", blurb: "Sits on the bottom and watches everything." },
  { id: 8, name: "Old Boot", tier: "Common", supply: 0, daily: 0, shape: "boot", pal: ["#6b4a2f", "#9a7350", "#3a2818"], pattern: "plain", blurb: "Not a fish. Someone's still looking for the other one." },
  { id: 9, name: "Pufferfish", tier: "Uncommon", supply: 0, daily: 0, shape: "puffer", pal: ["#e7c45a", "#fbf0c8", "#9a7a1f"], pattern: "dots", blurb: "Puffs up when surprised. Is surprised often." },
  { id: 10, name: "Clownfish", tier: "Uncommon", supply: 0, daily: 0, shape: "round", pal: ["#f08a2c", "#ffffff", "#1d1d1d"], pattern: "bands", blurb: "Orange with white bands, and very sure of itself." },
  { id: 11, name: "Flounder", tier: "Uncommon", supply: 0, daily: 0, shape: "flat", pal: ["#a08c6a", "#e6dcc6", "#5e4f36"], pattern: "dots", blurb: "Flat as a letter, with both eyes on one side." },
  { id: 12, name: "Red Snapper", tier: "Uncommon", supply: 0, daily: 0, shape: "round", pal: ["#d9534a", "#fbd9d2", "#8c2a24"], pattern: "plain", blurb: "Bright red and proud of it." },
  { id: 13, name: "Parrotfish", tier: "Uncommon", supply: 0, daily: 0, shape: "torpedo", pal: ["#3fbf9a", "#f3a6c8", "#1f6f5a"], pattern: "scales", blurb: "Every colour of the reef in one fish." },
  { id: 14, name: "Seahorse", tier: "Uncommon", supply: 0, daily: 0, shape: "seahorse", pal: ["#e8a33b", "#fbe3b4", "#9a5e14"], pattern: "plain", blurb: "Swims upright, slowly, with great dignity." },
  { id: 15, name: "Message in a Bottle", tier: "Uncommon", supply: 0, daily: 0, shape: "bottle", pal: ["#7fc2a4", "#f6efd9", "#3f7a62"], pattern: "plain", blurb: "A letter that never reached the post, still sealed." },
  { id: 16, name: "Lionfish", tier: "Rare", supply: 500, daily: 20, shape: "lion", pal: ["#d9653b", "#fbe8de", "#7a2a14"], pattern: "tiger", blurb: "All frills and stripes. Look, don't touch." },
  { id: 17, name: "Swordfish", tier: "Rare", supply: 500, daily: 20, shape: "sword", pal: ["#4f6f9a", "#dfe7f2", "#26385a"], pattern: "plain", blurb: "Comes with its own letter opener." },
  { id: 18, name: "Octopus", tier: "Rare", supply: 500, daily: 20, shape: "octopus", pal: ["#c2577f", "#f6d5e2", "#7a2a4a"], pattern: "dots", blurb: "Eight arms, and every one of them is curious." },
  { id: 19, name: "Manta Ray", tier: "Rare", supply: 500, daily: 20, shape: "manta", pal: ["#3b4f6b", "#e6edf5", "#1b2638"], pattern: "plain", blurb: "Glides like a paper plane under the waves." },
  { id: 20, name: "Moonfish", tier: "Rare", supply: 500, daily: 20, shape: "moon", pal: ["#c45a5a", "#f6d6a8", "#7a2a2a"], pattern: "dots", blurb: "Round, red and spotted, like a little sunset." },
  { id: 21, name: "Coelacanth", tier: "Epic", supply: 100, daily: 5, shape: "coela", pal: ["#3f5f7a", "#cfe0ea", "#1e3040"], pattern: "scales", blurb: "Older than the dinosaurs, and still here." },
  { id: 22, name: "Giant Squid", tier: "Epic", supply: 100, daily: 5, shape: "squid", pal: ["#c0453f", "#f6cfc2", "#6f1f1a"], pattern: "dots", blurb: "Its eyes are as big as dinner plates." },
  { id: 23, name: "Anglerfish", tier: "Epic", supply: 100, daily: 5, shape: "angler", pal: ["#3a3550", "#7fe3ff", "#15121f"], pattern: "plain", blurb: "Carries its own lantern down in the dark." },
  { id: 24, name: "Golden Stampfish", tier: "Legendary", supply: 21, daily: 1, shape: "stamp", pal: ["#e8b53a", "#fff3c4", "#8a5e12"], pattern: "stamp", blurb: "A golden fish on its own postage stamp: the rarest catch in the bay." },
];

export const fishOf = (id) => FISH.find((f) => f.id === Number(id)) ?? null;
export const tierOf = (key) => FISH_TIERS.find((t) => t.key === key) ?? FISH_TIERS[0];
