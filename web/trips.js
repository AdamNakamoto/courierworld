// Where the neon district's rocket flies: the moon and Mars. Each trip's ticket (paid in $STAMP to the treasury), its
// size and its golden stamps, in one table. Shared by the game and the multiplayer server.
import { MOON_R, MOON_PRICE, MOON_PRICE_TEXT, MOON_SECS, MOON_STAMPS, MOON_SPOTS, MOON_REACH, MOON_REACH_UP, MOON_TREASURY, moonSpots } from "./moon-pick.js";
import { MARS_R, MARS_PRICE, MARS_PRICE_TEXT, MARS_SECS, MARS_STAMPS, MARS_SPOTS, MARS_REACH, MARS_REACH_UP, marsSpots } from "./mars-pick.js";

export const TREASURY = MOON_TREASURY; // where every ticket goes

/// key -> { name, R (metres), price ($STAMP's smallest units), priceText, secs (a ticket's life), stamps (out a day),
/// spots (MOON_SPOTS / MARS_SPOTS), pick(day) (the day's spots), reach, reachUp (how close a find has to be) }
export const TRIPS = {
  moon: { name: "the moon", R: MOON_R, price: MOON_PRICE, priceText: MOON_PRICE_TEXT, secs: MOON_SECS, stamps: MOON_STAMPS, spots: MOON_SPOTS, pick: moonSpots, reach: MOON_REACH, reachUp: MOON_REACH_UP },
  mars: { name: "Mars", R: MARS_R, price: MARS_PRICE, priceText: MARS_PRICE_TEXT, secs: MARS_SECS, stamps: MARS_STAMPS, spots: MARS_SPOTS, pick: marsSpots, reach: MARS_REACH, reachUp: MARS_REACH_UP },
};
/// Every world a courier can be on.
export const WORLDS = ["planet", ...Object.keys(TRIPS)];
