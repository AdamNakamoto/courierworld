// MOON missions: special letters that pay MOON, the game's play-to-earn currency (MoonRewards, deployed by the IMD
// swarm). A courier who's signed in to the hunt, with an open post office, is handed one at a post office (on the
// planet) or a post box (on the moon and Mars), and the room signs a voucher for it once they've walked it to the
// door. They claim the voucher with MoonRewards the same UTC day.
//
// Shared by the game and the multiplayer server: what a letter pays on each world, how much a wallet can earn a day,
// how close you must be, and the voucher's EIP-712 shape. Where the letters go is mission-spots.json (every door on
// the planet and every local on the moon and Mars, by index into W.addresses and each world's residents, with each
// world's post office or post box), made from the game's own layout: remake it if the planet's houses or the locals
// move.

export const MISSION_PAY = { planet: 500, moon: 1000, mars: 2000 }; // MOON a letter
export const MISSION_DAILY = 10_000; // MOON one wallet can earn a UTC day (the contract allows 20,000)
export const MISSION_GLOBAL = 1_000_000; // MOON everyone together can earn a UTC day (the contract's cap)
export const MISSION_FAR = { planet: 20, moon: 4, mars: 4 }; // metres a letter's door is at least from the post
export const MISSION_TAKE = 4; // metres from the post office or box to be handed a letter (as the room sees you)
export const MISSION_REACH = 3.2; // metres from the door or local for a delivery to count (as the room sees you)

export const VOUCHER_DOMAIN = { name: "MOON Rewards", version: "1" }; // + chainId and MoonRewards' address
export const VOUCHER_TYPES = {
  MissionVoucher: [
    { name: "player", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "day", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
