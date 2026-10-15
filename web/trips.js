// Where the neon district's rocket flies: the moon and Mars. Each trip's ticket (paid in $STAMP to the treasury) and
// its size, in one table. Shared by the game and the multiplayer server.
import { MOON_R, MOON_PRICE, MOON_PRICE_TEXT, MOON_SECS, MOON_TREASURY } from "./moon-pick.js";
import { MARS_R, MARS_PRICE, MARS_PRICE_TEXT, MARS_SECS } from "./mars-pick.js";

export const TREASURY = MOON_TREASURY; // where every ticket goes

/// key -> { name, R (metres), price ($STAMP's smallest units), priceText, secs (a ticket's life) }
export const TRIPS = {
  moon: { name: "the moon", R: MOON_R, price: MOON_PRICE, priceText: MOON_PRICE_TEXT, secs: MOON_SECS },
  mars: { name: "Mars", R: MARS_R, price: MARS_PRICE, priceText: MARS_PRICE_TEXT, secs: MARS_SECS },
};
/// Every world a courier can be on.
export const WORLDS = ["planet", ...Object.keys(TRIPS)];
