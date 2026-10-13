// MOON missions: special letters that pay MOON, the game's play-to-earn currency (MoonRewards, deployed by the IMD
// swarm). A courier who's signed in to the hunt, with an open post office, picks one up at a MOON Missions board (by
// the post office on the planet, by the landing pad on the moon and Mars) for someone on any of the three worlds, and
// the room signs a voucher for it once they've walked it to them. They claim the voucher with MoonRewards the same UTC
// day.
//
// Shared by the game and the multiplayer server: what a letter pays on each world, how much a wallet can earn a day,
// how close you must be, and the voucher's EIP-712 shape. Where the letters go is mission-spots.json: each world's
// board, and everyone who can get one (`id`: "a12", W.addresses[12], a door on the planet; "n3", W.npcs[3], one of
// the planet's characters; "r4", the moon's or Mars's residents[4]), with their name. It's made from the game's own
// layout: remake it if any of them move.

export const MISSION_PAY = { planet: 500, moon: 1000, mars: 2000 }; // MOON a letter
export const MISSION_DAILY = 10_000; // MOON one wallet can earn a UTC day (the contract allows 20,000)
export const MISSION_GLOBAL = 1_000_000; // MOON everyone together can earn a UTC day (the contract's cap)
export const MISSION_FAR = { planet: 20, moon: 4, mars: 4 }; // metres a letter's door is at least from the board
export const MISSION_TAKE = 4; // metres from the MOON Missions board to pick up a letter (as the room sees you)
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
