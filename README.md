# Courier

A tiny-planet courier game in the style of Messenger (messenger.abeto.co), with an
on-chain economy on Robinhood Chain: 3,333 Courier NFTs work out of player-run post
offices and earn $STAMP, which trades in a Uniswap v4 pool with a 4% fee.

Everything here is original: the town, the characters, the dialogue and the UI are built
from scratch in three.js. No assets, code or text are taken from Messenger.

## Layout

- `web/`: the site Vercel serves (set the project's root directory to `web`). Plain
  HTML/JS, no build step; three.js and viem load from esm.sh.
- `contracts/`: Foundry project (submodules: `git submodule update --init --recursive`).
- `dev.sh`: local chain + deploy + site.

## Run it locally

```bash
./dev.sh
```

Starts a fresh Anvil chain on port 8600, deploys the couriers, gives each dev player six
and reveals them, then deploys the game (without the trading pool), writes `web/chain.json`
and serves the site at http://localhost:5792 (collection browser at `/studio.html`). Press
**P** in game for the post office. Pick a player from the panel's menu; Anvil's dev accounts
are unlocked, so no wallet is needed. The panel's local-chain tools skip time.

```bash
./dev.sh --fork
```

Same, on a fork of Robinhood Chain: the full mainnet deployment (pool, hook and routers)
runs against the real PoolManager, IMD and IMD/ETH pool, so the panel's **Trade $STAMP**
section works with play money. It buys and sells $STAMP with ETH or IMD, quotes through
Uniswap's v4 quoter (fees and price impact included), and protects each trade with a
slippage minimum. Sells use a permit signature in place of a separate approval.

```bash
./dev.sh --fork --wallet
```

Launch rehearsal with your own browser wallet (MetaMask or another extension): you log in exactly
as on mainnet, and the page asks the wallet to add the "Courier practice" network (chain ID 466399,
RPC `http://127.0.0.1:8600`). That ID belongs to no public chain and is never Robinhood Chain's,
so nothing signed on the practice chain can be replayed on a real one. In the post office panel,
**+10 play ETH** funds your wallet and **+3 couriers** hands you some from the dev players. After
restarting `dev.sh`, MetaMask may show a nonce error: Settings > Advanced > Clear activity tab data.

```bash
./dev.sh --fork --wallet --staged
```

The launch as it will happen: only the couriers exist at first, with the mint open, so you mint
with your wallet; then press Enter in the terminal to reveal them and launch the game, and
reload the page.

## Multiplayer

Other players walk the planet with you: `multiplayer/` is a Cloudflare Worker with one Durable
Object holding the planet's room. Each player says who they are (their courier's look and ride,
and their wallet if logged in), then sends where they are while moving; the room passes it on to
the players near them, plus waves and emotes (keys 1-9, 0), and chat lines to everyone (text only:
`web/chat-rules.js`, shared with the game, refuses links and wallet addresses; one line every two
seconds; the last 30 kept for newcomers). It reads the chain only to check worn Courier Skins, and
signs the treasure hunt's coin vouchers. `GET /count` tells the title screen how many are playing.

```bash
cd multiplayer
npm install
npx wrangler dev          # a local room on :8787; open the game with ?mp=ws://127.0.0.1:8787/ws
npx wrangler deploy       # the live room, at wss://courier-world-mp.courier-world-mp.workers.dev/ws
```

### Names

Players can pick a name to show instead of their wallet address: on name tags, in chat, on their
post office's sign and on the leaderboard. In the Post Office panel, **✏️ Pick a name** takes 3 to
15 letters, numbers or `_` (`web/name-rules.js`, shared with the room: no names starting `0x`, a
few reserved ones such as admin or official, and a word filter). The room checks it's free, the
player's wallet signs `nameMessage` for this connection (free, no transaction), and the name is
that wallet's: one name per wallet, first come first served (case doesn't matter), changed at most
once a day. The game keeps a token per wallet so later visits show the name without signing; a name
sent in a hello is ignored, so nobody can wear someone else's. `GET /names` lists every name
(wallet → name) for the signs and the leaderboard. To take an offensive name off the planet, add it
to `BANNED` in `web/name-rules.js` and redeploy the room and the site; its owner shows as their
wallet address again and the name can't be used.

## The treasure hunt: token drops

Every UTC day the spots in `web/hunt-spots.json` are shuffled (`web/hunt-pick.js`, `web/drop-pick.js`, the same
in the game and on the server): the first 24 stay empty (they held the golden stamps until 2026-10-15; the order is
kept so the coins' spots, which finds are stored by, never move), and each token drop running that day puts
its coins on the next ones, oldest drop first, with the token's picture on them. Anyone can collect them for fun.
A player with a post office can also sign in with their wallet (one signature, no transaction): the
multiplayer room then checks each find against where they've actually been, and signs a voucher per drop for
the day's finds. `TokenDrops.sol` pays them from each drop's own tokens (it never mints), claimed for the day of
the finds or the day after, all drops in one transaction from the Post Office panel's Treasure hunt section.
The golden stamps (and the moon's and Mars's) ended on 2026-10-15: players took them for $STAMP earnings, and they
paid nothing. Games loaded before then still grab them (`["grab", spot]` on one of the 24, `["wgrab", world, spot]`,
`["mgrab", spot]`): the room keeps nothing and answers once per connection with a nope (-3) saying they're gone. Its
hunt state still carries empty `found`, `moon` and `mars` lists for those games' panel, and sign-in accepts the old
wording (`authMessageBefore`) as well as the new.
`TokenDrops` is live since 2026-10-13 at `0xD0e785276840F7175DF12678991605042e89771C` (source verified on Sourcify);
the room's voucher key is the multiplayer server's secret `DROPS_KEY` (its address, `0xac7e8d5A3b94ac56Ec1DD10a0Ec6a5ABD3b155Ca`,
is the contract's signer).

Only the treasury (the contract's owner) starts drops, from that same section: a launchpad token (its 5% of
each launch). TokenDrops always gives a $STAMP drop the 24 golden spots, which the game no longer fills, so the panel
only offers launchpad tokens ($STAMP drops are only for the companion bonus pool). Each drop sets the tokens per coin,
how many coins are out a day (1 to 48), how many one wallet is paid for a day, how many are paid a day
across everyone (required, up to 10,000: every player can collect each coin, so this caps a day, and it's the most a
leaked server key could take from a drop a day), and for how many days. The treasury can top a drop up, end it after today, take what's left
back once nobody can claim, and pause every claim (if the server's key leaks, say). In Times Square, a drop
poster with the coin's picture, a "live now" banner on the Launchpad's poster and the ticker announce the drops
that are running.

```bash
cd contracts
DROPS_SIGNER=0x… RPC_URL=… ./script/deploy-drops.sh --broadcast --browser --browser-disable-open
cd ../multiplayer
npx wrangler secret put DROPS_KEY          # the voucher key (its address is DROPS_SIGNER)
npx wrangler deploy --var DROPS_ADDRESS:0x…
```

**Partner drops.** Tokens that aren't the Launchpad's (a partner project's, such as $MINE) drop from a second
TokenDrops, the same contract, which asks a `DropsTokenList` (`contracts/src/DropsTokenList.sol`) instead of the
Launchpad whether it can drop a token: the tokens the treasury approved, plus the Launchpad's. The room signs for
both with the same `DROPS_KEY` (`DROPS2_ADDRESS` in `wrangler.toml`), each voucher with its own contract's domain.
So that neither contract's drops can ever move the other's coins, each has its own block of the day's shuffle
(`web/drop-pick.js`): after the 24 empty spots, the next 60 are the first contract's and the rest (36) the
partner contract's; the game and the room number the partner contract's drop k as drop 1000 + k. The room sends
the partner vouchers apart (`["vouchers", first, partner]`), so games loaded before there were two only see the
first's, and claiming takes one transaction per contract. The panel's drop form offers the partner tokens (on
the partner contract) next to the Launchpad's, says how many coins a day each contract has free, and has a pause
for each.

```bash
cd contracts
./script/deploy-partner-drops.sh --broadcast --browser --browser-disable-open       # the list and the contract
# (put its address in wrangler.toml's DROPS2_ADDRESS, deploy the room, push the site, then:)
./script/deploy-partner-drops.sh drop --broadcast --browser --browser-disable-open  # start the $MINE drop
```

`./dev.sh` deploys local drops and writes `multiplayer/.dev.vars`, so `npx wrangler dev` runs them too (token
drops need the launchpad: `./dev.sh --fork`). `StampHunt.sol`, the $STAMP-only version, was never deployed.

## The moon and Mars

The neon district's rocket flies couriers to two small worlds, each built the first time someone goes: the moon
(`web/moon.js`, rules in `web/moon-pick.js`: radius 12 m, gravity 0.35 of the planet's, craters, the moon frogs and
their base, a saucer) and Mars (`web/mars.js`, rules in `web/mars-pick.js`: as big as the planet, radius 34 m, gravity 0.55; the spaceport;
Mars City with a walk-in plaza dome, greenhouses, homes, tubes, pools, farms and a ring road; red mountains; a canyon,
a sleeping volcano and an ice cap; seven Martians and thirteen astronauts; a rover to drive; and a dust storm every
seven minutes, the same for everyone). Mars's static scenery is merged into one mesh as it's built. `web/trips.js` holds both trips' tickets in one table, shared by the
game and the server; `web/space.js` holds what both worlds share (the pad and rocket, a post box for show, the
locals). On a trip the arrow at the top points back to the rocket. Each world's group sits so its top is where the planet's is, so the sun, the shadows and the camera work
unchanged; `main.js` walks on whichever world you're on (its radius, centre, ground, obstacles and gravity) and turns
that one under you. The painted sky has a "space" mode for the moon and a "mars" mode (butterscotch, hazier in a storm).

The rover is a ride (`rides.js`): hopping in swaps your courier onto it, and it's parked where
you hop out (back in the garage when you fly home).

A ticket is sent from the player's wallet to the treasury (`chain.ticket(world)`: 100 $STAMP for the moon, 200 for
Mars), good for an hour. The room checks it (`["ticket", world, txHash]`): a successful transaction from the player's
signed-in hunt wallet that moved at least the price to the treasury, less than three hours old, never used before for
any trip; the ticket is kept per wallet, so a reload doesn't lose it. Players tell the room which world they're on
(`["world", "moon" | "mars" | "planet"]`, a trip only with its ticket), and positions and emotes go only to players
on the same world; a newcomer gets everyone there (`["here", …]`). The room still answers games loaded before Mars
(`["moon", txHash]`). The moon and Mars stamps ended with the golden stamps (see the treasure hunt); `MOON_SPOTS` and
`MARS_SPOTS` stay only so the scenery that keeps clear of them doesn't move.

Signing in to the hunt also gives the browser a token (`["hunttoken"]`, kept for the session) so a new connection
picks the hunt up again (`["resume"]`) without another signature. For local testing, `MOON_DEV=1` in
`multiplayer/.dev.vars` makes the room accept any ticket; never set it in production.

## MOON (retired)

MOON was a play-to-earn currency the IMD swarm deployed on 2026-10-13 (explorer.imd.fun/jobs/ee210497-4d31-4153-9cc8-ca23b7898f70):
the MOON token (0x7dEEc126e0bc35b1246129f30B6D6F17a6EC9392), MoonRewards (0x55c6548125C5fe33d59950D814FCd91222E87cD6) and
MoonShop (0x2c328E6D3aE72E5b06e10884d83B01F1b0342F85). The game paid it for MOON letters for one day; the community
preferred $STAMP for everything, so the game dropped MOON the same day: the letters, the boards, the panel section, the
server's code and its signing key are gone, and the treasury paused MoonRewards (tx 0x70e244a6…7655). The contracts and the MOON/IMD pool stay
on chain (contracts can't be deleted), and the MOON in MoonRewards can't be withdrawn by design.

## Courier Skins

`CourierSkins.sol`: 999 cosmetic NFTs, 16 outfits and rides (`web/skins.js`), minted blind for ETH
(to the treasury) and revealed after the mint, commit-reveal like the couriers: each token takes a
different card of the 999-card deck, so a sold-out mint matches every design's supply exactly. The
metadata is on-chain; the pictures are `web/skins/*.png` (rendered by `renderSkinStamp` in
`web/portrait.js`), under an image base the owner can move (to IPFS, say) and then freeze.

The 5% royalty is enforced, not optional: every transfer goes through a transfer validator
(ERC721-C), OpenSea's `StrictAuthorizedTransferSecurityRegistry` at launch. Holders can always move
their own skins; a marketplace can only move them in trades OpenSea's signed zone has checked pay
the royalty. The validator can be replaced but never removed, and the 5% can't be changed.

Players wear a revealed skin from the Post Office panel. The multiplayer room shows it to others
only after reading on-chain that the wallet on their name tag owns it (`SKINS_ADDRESS`, `SKINS_RPC`).

```bash
cd contracts
./script/deploy-skins.sh                          # dry run on a fork
./script/deploy-skins.sh --broadcast --browser    # deploy (in your own terminal: it prints the reveal secret once)
# OPEN_SALE=true opens the mint at deploy. After it: close the sale, wait ~15 s, reveal with the secret
# (the owner sees these controls in the Post Office panel)
cd ../multiplayer
npx wrangler deploy --var SKINS_ADDRESS:0x…
```

### Paying in $STAMP

`SkinsStampSale.sol` (live at `0x6DB7DCdFDBCe63Dd1e960CB8cE676bd32c99bc6a`) sells the same skins for $STAMP (150 a
skin at launch, to the treasury). Courier
Skins only takes ETH, so the sale pays each skin's ETH price from a float its owner tops up (that ETH
goes straight on to the skins treasury, so it only goes round), takes the buyer's $STAMP (one permit
signature, or an approval), and moves the minted skins on to the buyer in the same transaction. Buyers
name the most $STAMP they'll pay (the panel sends the price it showed), so a price change can't charge
them more. Same 999, same enforced royalty; Courier Skins itself is untouched. The owner can change the
$STAMP price, pause it, top up or withdraw the float (all in the Post Office panel too, except
withdrawing), and return a skin someone sent to the sale by mistake.

```bash
cd contracts
./script/deploy-skins-stamp.sh --sender 0x7221…    # dry run on a fork, as the wallet that will sign
./script/deploy-skins-stamp.sh --broadcast --browser
# SKINS_STAMP_PRICE and SKINS_STAMP_FLOAT (sent with the deploy) are in launch.env; top up later by
# sending ETH to the sale
```

`deploy-skins.sh` runs `export-web.sh`, which adds the skins to `web/deployments/robinhood.json`.
The collection's page on OpenSea comes from `contractURI()`: name, description (with the X link),
`collection.png`, `banner.png` and https://courierworld.fun/ as the website. Then, in OpenSea Studio,
add the X link (https://x.com/PlayCourierWld) to the collection's links and turn on creator earnings
(the registry is already the transfer validator). `./dev.sh` deploys local skins with the sale open; "Reveal skins" in the panel reveals them.

## Courier Companions

`CourierCompanions.sol` (live since 2026-10-14 at `0x4254cEac6B7C9F8911Ce908A910DD1874C5B49B7`, owned by the treasury) sells companions
that follow your courier around. It's an ERC-1155: each
kind of companion is a token id with its own $STAMP price, a limited supply (which can only shrink) and a per-wallet
limit (counting purchases, per address). Paid only in $STAMP, straight from the buyer to the treasury (`buy`, or
`buyWithPermit` for one signature); buyers name the most they'll pay, nothing is minted except by buying, and resales
carry an ERC-2981 royalty to the treasury (5%, at most 10%), enforced like the skins': every transfer between
wallets goes through a transfer validator (ERC1155-C, OpenSea's creator fee enforcement registry
`0xA000027A9B2802E1ddf7000061001e5c005A0000`), so marketplaces can only move companions in sales that pay it, while
holders can always move their own; mints (buys) never touch it, and it can be replaced but never removed. Ownership is
two-step and can't be renounced; the owner sets prices, the treasury and the validator, and can `rescue` tokens sent
to the contract by mistake (it never holds any otherwise). The first lineup, in `DeployCompanions.s.sol`:
pets 100 $STAMP (300 of each, 5 a wallet), space buddies 250 (150, 3 a wallet), legendaries 500 (50, 2 a wallet), the
mecha guardian and colossus 2,500 (30, 1 a wallet) and three anime-style companions 3,000 (25, 1 a wallet).

IMD audited it ([job 145af84f](https://explorer.imd.fun/jobs/145af84f-02c5-4db7-8dc3-3ec3a300b8f1): 3 low, 6
informational, no critical, high or medium). All nine are addressed (deployed without IMD re-checking the fixes): the
royalty follows the treasury, the treasury
can't be the contract, `renounceOwnership` reverts, a failed permit reverts `PermitFailed`, new kinds announce their
`URI`, `contractURI` (ERC-7572) and `rescue` exist, the trust notes are in the NatSpec, every kind has a wallet limit,
the royalty is now enforced (finding 6 offered it as an option; Courier World wants its royalties enforced), and the
tests cover the gaps (`CourierCompanions.t.sol`; `CourierCompanions.invariant.t.sol` predicts
every call's outcome and fails on any surprise).

### The room's speed check

The treasure hunt trusts where the room saw a player. The speed check is a travel budget in the room's own time: it
grows at 22 m/s, up to 15 s (330 m) saved, and each position update spends the distance moved; no single update may
jump further than 2 s at 22 m/s. So nobody averages more than 22 m/s however their updates are bunched (the old
check skipped updates closer together than 0.12 s, which let a script teleport between spots), while updates the
network held back for up to ~20 s still pass. A strike pauses finds for 3 s (overspending in those 3 s doesn't strike
again); three end the session's finds. A world hop restarts the 5 s wait before finds.

### The companion play bonus (built, paused)

Not running: no season's drop is listed, the treasury's form to start one is off (`BONUS_POOL_FORM`), and its
public wording (docs, collection.json) is held back in a local stash. The room code ships inert. When it's switched
on: while a companion follows its owner, the minutes they spend playing (moving about any world) earn extra $STAMP: up to 120 active
minutes a day, at most Pet 6, Space buddy 9, Legendary 12, Mecha 18 and Anime 24 $STAMP a day (`web/bonus-rules.js`).
It can't come from the PostOffice (no owner, the only $STAMP minter), so it's a $STAMP drop in the live TokenDrops
contract that the treasury funds from its share of in-game spending, in seasons. No contract changes.

- **What counts** (multiplayer/src/index.js, `bonusTick`): a minute with at least one position update from a socket
  signed in to the hunt (signature or resume token), whose name tag is that wallet, with that wallet's own companion
  following, a post office open, at least 3 m moved since the wallet's last counted minute, a minute's warm-up, and no
  speed strikes; one per wallet per minute across tabs. Counted from the position updates the game already sends.
- **One companion, one wallet a day**: at random times (2 to 25 minutes apart), and once more at 23:59:30 UTC (an
  alarm, so even a sleeping room checks), the room reads every earning wallet's companions in one `balanceOfBatch`; a
  wallet that doesn't hold the kind it earned with loses that kind's minutes for the day, and one that does is
  confirmed.
- **Settled the next day, pro rata**: once a day is over, each wallet's coins are its tier-weighted minutes, or its share
  of the drop's `dailyCoins` in proportion to what it earned if everyone together earned more. They're signed as that
  drop's day + 1 (claimable that day and the next, with the treasure hunt's Claim button), so nobody can race for the
  pool. Only minutes an ownership check confirmed are paid.

- **Seasons** (after the companions are deployed): in the Post Office panel's treasury box, "Companion bonus pool"
  creates a season's drop starting tomorrow (pool per day, days, $STAMP to put in; perCoin 1 $STAMP, 24 a wallet).
  Then add its id to `BONUS_DROPS` in `web/bonus-rules.js` and deploy the room and the site before it starts: until
  then the game and the room don't know it's the bonus's drop, and nothing pays from it. A season pays play day d as day d + 1, so create the next
  season's drop on the current one's last day (it starts the day after); keep a season listed until two days after its
  end (its last claims). "End" on a
  bonus drop ends it after tomorrow, so today's play is still paid. Until `BONUS_DROPS` lists a drop, the game says
  nothing about the bonus beyond the docs.
  `wrangler dev` alone can set BONUS_DEV_MINUTE_MS, BONUS_DEV_SAMPLE_MS and BONUS_DEV_DAYS to try it in seconds.

- `web/companion-kinds.js`: what each kind is (name, tier, blurb...), shared by the game, the Post Office panel (the
  shop, where players also pick which companion follows them), the server and the metadata. Prices and supplies live
  on chain.
- `web/companions.js` draws the companions and makes them follow their courier (`createFollower(id)`), on every
  world; `web/companions-premium.js` has the bigger models (the mecha, the colossus and the anime companions). Every
  kind a wallet owns can follow at once (each toggled in the panel, kept per wallet), in pairs behind the courier
  (`slotOf`), keeping clear of each other.
- The multiplayer room shows a player's companions to others only after reading on chain, in one `balanceOfBatch`,
  that the wallet on their name tag owns them (`COMPANIONS_ADDRESS`). The hello carries `companions` (all) and
  `companion` (the dearest, for games and rooms from before several could follow).
- Without a companions address (`chain.companions` null, no `COMPANIONS_ADDRESS` in the room), everything hides
  itself, as it did before the deploy.
- Metadata: `web/companions/<id>.json` (name, description, picture, and Tier / Kind / Moves traits) under the
  contract's `base` (`COMPANIONS_BASE`, https://courierworld.fun/companions/ by default), plus `collection.json`. The
  pictures (`<id>.png`, `collection.png`) are rendered from the game models. `contractURI()` serves `collection.json`
  (ERC-7572), so marketplaces pick up the collection's name, picture and links from it.

```bash
cd contracts
./script/deploy-companions.sh                                                # dry run on a fork
RPC_URL=… ./script/deploy-companions.sh --broadcast --browser --browser-disable-open  # sign at http://127.0.0.1:9545 with the treasury wallet (it becomes the owner); RPC_URL: the official RPC (drpc drops deploys)
cd ../multiplayer   # set COMPANIONS_ADDRESS in wrangler.toml's [vars], then
npx wrangler deploy
```

The deploy writes `deployments/robinhood-companions.json` and runs `export-web.sh`, which adds the companions to
`web/deployments/robinhood.json`; commit it and the shop opens.

## Courier Planets

`CourierPlanets.sol` (live since 2026-10-15 at `0xE7F9fc69Cb0471EDDcb62e8FC3e4D0256306e7e3`, owned by the treasury,
source verified on Sourcify; the treasury opens the sale from the Post Office panel, as a presale before the planet
worlds are in the game) is 333 planets (ERC-721), each a
world of its own in the game. A planet costs 10,000 $STAMP, all of it straight to the treasury (`buy` or
`buyWithPermit`, 1 to 3 at a time, 3 a wallet; buyers name the most they'll pay). Each planet's owner sets its
ticket (`setTicket`: free, up to 1,000 $STAMP, or closed); a visitor pays it with `visit`, 80% to the planet's owner
and 20% to the treasury (the owner can set the treasury's share, at most 50%), and the game will let them in for an
hour (once visitor passes land).
A planet that changes hands starts closed. Resales pay a fixed 5% royalty to the treasury, enforced like the skins'
(ERC721-C with OpenSea's registry: holders move their own freely, marketplaces only in sales that pay it). Ownership
is two-step and can't be renounced; the owner can't touch anyone's planets or $STAMP, set a ticket, or change the
royalty rate. Deployed without an independent audit (our own review and tests: AUDIT.md section 14).

The Post Office panel sells them (one signature, a permit, as for companions: `chain.buyPlanets`), lists your
planets, and gives the contract's owner (the treasury) the sale's switch and price (`chain.planetsAdmin`). Without a
planets address in the deployment (`chain.planets` null) the section hides itself. While the sale is on, "Buy a Courier
Planet" on the title screen and in the corner of the screen opens it (`office.showPlanets()`), as the skins' mint
buttons do.

- `web/planet-looks.js`: each planet's look from its number alone (type, surface, rings, moons, sky, tilt and the
  picture as SVG), shared by the panel, the metadata and, later, the planet worlds. Cosmetic only.
- `web/planets/make.mjs` writes the metadata the contract points at (`base` https://courierworld.fun/planets/):
  `<id>.json` and `<id>.svg` for all 333, and `collection.json` / `collection.svg` (`contractURI`). Run it again
  (`node web/planets/make.mjs`) after changing the looks; if planets are already out, call `setBase` with the same
  base so marketplaces refresh (it emits ERC-4906).
- `./dev.sh` deploys local planets with the sale open at 1,000 $STAMP (the dev players hold 20,000 each), owned by
  the Owner account.

Still to come in the game: the planet worlds (drawn from each planet's look), the portal, visitor passes, tickets
in the panel, building on your planet, and a daily treasure there (a TokenDrops drop funded by the treasury).

```bash
cd contracts
./script/deploy-planets.sh                                                # dry run on a fork
echo DEPLOY | RPC_URL=… ./script/deploy-planets.sh --broadcast --browser --browser-disable-open  # sign at http://127.0.0.1:9545 with the treasury wallet
```

## The map

G (or the 🗺 button) pulls the camera back from your courier to the whole world as a globe: drag to spin it, scroll,
pinch or +/− to zoom, G or Esc to close (it glides back). The world turns so where you are faces the camera, the way
you face at the top. `web/map.js` names the places (the areas, the post office, the Orb, Times Square and its
Launchpad, the Space Express, the fishing pier, the lighthouse, the shrine, the ranger's cabin, the pond, the stage,
and your own post office; on Mars its city, volcano, canyon and so on), marks you, and draws everyone else on your
world as dots. Your courier waits while it's open; rain, the cutaway and the hunt's coins stay off it.

## Fishing and Courier Fish

Players fish in the bay: on the pier, a bridge over the bay or at the water's edge, facing the water, E (or Hi)
casts. The room picks when a fish bites; the game hooks it if E comes within 1.1 s, then plays the fight (hold E to
reel, keep the tension marker in the green) and sends one landing. The room checks the timing, that the player stayed
within 3 m of the cast and was at a fishing spot (`web/fish-rules.js`, shared by both), picks the species only then
(`web/fish-kinds.js`: common 60%, uncommon 28%, rare 9.2%, epic 2.4%, legendary 0.4%; a capped species only while it
has room for the day and in all) and keeps the catch: at most the contract's `maxPerDay` (10) a wallet a day, with an
open post office and the treasure hunt's sign-in. Two messages a fish, plus a position sent with each.

`CourierFish.sol` (live since 2026-10-15 at `0xacF37fE6FdB848a4182d5A3646C2C0Ec11E09c90`, owned by the treasury, source
verified on Sourcify) mints them as ERC-1155 fish, one token id per species, free (gas only) from the
room's vouchers (`FISH_KEY`), within 7 days of the catch; rare, epic and legendary species are capped for good (the
Golden Stampfish: 21 ever) and per day; the 5% royalty is fixed and enforced (ERC1155-C). See AUDIT.md section 15.

- `web/fishing.js`: the cast, bobber and line, the bite, the hook window, the fight, the catch card;
  `web/character.js` holds the rod (`setFish`); others see your rod and a bubble for your catch (`["fishing"]`), and
  everyone hears about an epic or legendary one (`["fishnews"]`).
- `web/fish-art.js` draws every species (Courier World's own designs); `web/fish/make.mjs` writes the metadata
  (`<id>.json`, `<id>.svg`, `collection.json`, `collection.svg`) the contract points at.
- The Post Office panel's Fish section: today's count, "Mint N fish" (the contract's `mintable` says how many), and
  the collection of 24. Fishing stays switched off in the game until the site knows the contract (`chain.fishMint`),
  and in the room until `FISH_KEY` and `FISH_ADDRESS` are set.
- `./dev.sh` deploys local fish with a throwaway `FISH_KEY` in `multiplayer/.dev.vars`.

```bash
cd contracts
FISH_SIGNER=0x… ./script/deploy-fish.sh                                  # dry run on a fork
echo DEPLOY | FISH_SIGNER=0x… RPC_URL=… ./script/deploy-fish.sh --broadcast --browser --browser-disable-open
cd ../multiplayer   # FISH_ADDRESS in wrangler.toml's [vars]; the key: npx wrangler secret put FISH_KEY
npx wrangler deploy
```

## The launchpad

Any player with a post office can launch their own token, inside the game (`CourierPad.sol`, live since
2026-10-13 at `0x90c3aaae34cf4681701452379D3819D6Bc8Fe8CC`, source verified on Sourcify). A launch burns a $STAMP fee (100 at launch; the owner can change it, and launchers name the most
they'll pay) and creates a `PadToken`: 1,000,000,000 supply, plain ERC-20 with permit, no owner, no tax.

- 95% goes into the token's Uniswap v4 pool against IMD as single-sided liquidity, locked forever (the pad
  has no way to remove it). The starting market cap is the same for every launch (about $5,000 at deploy;
  the owner can change it for future launches).
- 5% goes to the treasury, for drops to players with a post office.
- Every trade pays 4% of its IMD side to the protocol, through any router: the pad is every pool's hook,
  with the same fee code as $STAMP's `StampHook`. Buy and sell with IMD, or with ETH in one transaction
  (the same routers as $STAMP).

Learned from PepesFamily (fixed-supply v4 launches, locked liquidity, hook fees), without its holder rewards.

In the game (`web/pad.js`): the Launchpad is the ground floor of Times Square's corner tower (its sign says
"coming soon" until the pad is deployed). Walk up and press E, tap the sign, press L, or use the button in
the Post Office panel. It lists every token (newest or biggest), shows each with its own trade box (ETH or
IMD, the same as $STAMP's), and has the launch form: name, symbol, picture, description and links, then one
permit signature for the fee. A "Top 3 coins" poster in the square shows the three biggest tokens by market
cap, and the ticker the five biggest.

- Pictures are shrunk to 512 px in the browser and kept by the multiplayer server (`/pad/image`, its own
  Durable Object, by SHA-256): only a wallet with a post office can upload, signing for the picture, 12 a day.
- `web/pad-rules.js` (shared with the server): the form refuses the game's own names ($STAMP, IMD, Courier
  World...) and blocked words, and the game hides any token that breaks those rules. To take one off the
  game by hand, add its address to `web/pad-hidden.json` and push; it still trades on-chain.

```bash
cd contracts
./script/deploy-pad.sh --sender 0x7221…                                   # dry run on a fork
./script/deploy-pad.sh --broadcast --browser --browser-disable-open      # PAD_STAMP_FEE, PAD_START_MCAP_USD in launch.env
```

## Ads on the Orb

The Orb (`web/orb.js`) is a giant LED globe near the main post office that shows paid ads. Booking is
manual: a project DMs @PlayCourierWld, pays ETH to the treasury, and once you approve the ad you add it
to `web/orb.json` (its picture in `web/orb/`) and push. Only what's listed there shows, so nothing goes
up unapproved. Nothing is named "ad…", because ad blockers hide such files and page elements.

```json
{ "name": "Project name", "image": "orb/project.png", "url": "https://project.site",
  "chart": "https://dexscreener.com/…", "text": "Up to 140 characters.", "color": "#ffffff",
  "from": "2026-10-12", "until": "2026-10-19" }
```

- The ad covers the whole globe, like the big LED spheres: `color` fills the surface (left out, it's the
  picture's edge colour) and `image` sits on the front and the back as a perfect circle filling the face.
  So the picture is square (cropped to its centre if not) and round logos fit best; PNG, JPG or WebP in
  `web/orb/`. The ad's card shows it as a circle too.
- `url` (website) and `chart`: `https://` links, at least one. The card shows where each leads, says it's
  an ad, not an endorsement, and opens them in a new tab.
- `from` / `until` (UTC): when it runs. A running ad stays on the globe until it ends; several take
  turns, 20 seconds each, at the same moment for everyone. The "Advertise on the Orb" card shows only
  when no ad is running.
- The ad on the Orb also shows on two of Times Square's big screens (its picture, name and line), and
  tapping one opens the same card.

The globe is placed last in `world.js`, on open ground in sight of the start, and the park trees that
would stand on its plaza are simply left out, so nothing else in the town moves for it.

## Photo mode

📷 in the corner (or C) frees the camera for pictures (`main.js`, "photo mode"): drag to circle the
courier from overhead down to the ground looking up at the sky, scroll or pinch to zoom from the
planet's curve right in to the view through their eyes (the courier is hidden there), walk with the
usual keys or stick, set the time of day, or hide the courier. The HUD and panels step aside. The
shutter (or Space) draws a frame at full resolution, adds "courierworld.fun" in the corner and offers it
as a JPEG to save, or to share on phones (Web Share). Esc, C or Done goes back to playing.

## Times Square

The town crossing farthest from the main post office (well clear of the sea and the other places) is
Times Square (`web/square.js`): within 13 m of it, every house and shop becomes a tall tower on the
same footprint, its door and residents where they were, with giant screens on its front and the side
that faces the square, rooftop billboards and water towers. The tower nearest the crossing is narrow and
stacked with screens, with a ticker round its podium and a lit ball on top. The trees, lawns, poles and
wires give way to grey paving, red steps you can climb (a ticket booth tucked underneath), a bronze
courier on a plinth, parked yellow cabs, a red tour bus and two people to talk to.

The screens show posters that take turns every few seconds: the game's own (Courier Skins, $STAMP, post
offices, the treasure hunt, "advertise here") and shows that only play on this planet ("The Letter
King", "Mail-a-Mia!", "Phantom of the Post Office"...), none naming a real brand, plus the Orb's ad.
Like the Orb, what the square replaces is still drawn at random and left out, so nothing else in the
town moves: the same houses, lots, hunt spots and obstacles everywhere outside it.

## On Robinhood Chain

Without `web/chain.json` the site loads `web/deployments/robinhood.json`. Players log in
with a browser wallet (EIP-6963 discovery lists MetaMask, Robinhood Wallet, Rabby and
others; a wallet's in-app browser works too) and the wallet is asked to switch to, or add,
Robinhood Chain. The planet shows your courier (one of your NFTs, or the trainee look)
and the town's NPCs.

## The economy

| | |
|---|---|
| Post office | Bought with ETH (0.005). Comes with a trainee courier (60 power). Tiers: Kiosk 2 desks / 3 routes → Branch 4/7 → Depot 6/14 → Hub 9/24 → HQ 12/40, paid in $STAMP with a 24h cooldown |
| Courier NFTs | 3,333, free to mint (up to 10 per transaction; launched at 0.003 ETH), 5% royalty |
| Rides | On Foot 45% (100 power, 1 route) · Skateboard 25% (160, 1) · Bicycle 17% (260, 2) · Moped 9% (450, 3) · Paper Plane 4% (800, 4) |
| Levels | 1 → 10, +12% power each, costing 25 × level² $STAMP. Levels stay with the NFT |
| $STAMP supply | 21M cap. A launch allocation (default 2.1M) is locked in the pool; the rest is emitted to post offices by delivery power, halving every 4.2M blocks (~53.5 days). Emission per block is set so allocation + emissions = 21M exactly (2.25/block with 2.1M in the pool) |
| Trading | One $STAMP/IMD Uniswap v4 pool. Every swap pays 4% of its IMD side, all to the protocol's fee recipient. Buy or sell with IMD (`StampRouter`) or ETH via the IMD/ETH pool (`StampEthRouter`), or any v4 router. The launch liquidity is single-sided $STAMP, locked forever: sells only fill once buys have brought IMD in. Plain transfers (including everything the game does) are never taxed |
| Spending | 75% of $STAMP spent in the game is burned, 25% goes to the treasury |
| Referrals | Inviters get 2.5% of what the offices they invite collect, taken from the invitee's share |

Traits come from `keccak256(abi.encode(seed, id))`. The seed is committed at deploy time
and revealed after the mint (mixed with a blockhash), so nobody can snipe rare rides.

## Fully on-chain art

`tokenURI` needs no IPFS or server. `CourierRenderer` derives the traits, draws the
courier as an SVG postage stamp (`CourierSVG`) and returns base64 JSON metadata with the
SVG inlined. The art is live: the stamp's value is the courier's current delivery power,
a badge shows its level, and an ON DUTY postmark appears while it works at a post office.
Before the reveal every token shows a sealed envelope.

Trait tables live in `web/trait-tables.json`. `traits.js` (the 3D game) loads it, and
`contracts/tools/gen_traits.py` generates `CourierTraits.sol` from it; regenerate after
editing the tables. `CourierNFT.freezeRenderer()` locks the art forever.

## Contracts

| | |
|---|---|
| `StampHook.sol` | v4 hook and pool owner: 4% fee on the IMD side to the protocol, locked launch liquidity, one pool, one-time `openPool`; ownership renounced at deploy |
| `StampRouter.sol`, `StampEthRouter.sol` | Buy/sell with IMD (and permit sells), or with ETH through the IMD/ETH pool |
| `StampToken.sol` | $STAMP ("Courier World"): ERC-20 + permit, 21M cap, launch allocation to the hook, minted by the post office; ownership renounced at deploy |
| `PostOffice.sol` | The game: offices, couriers on duty, levels, emissions, halvings, referrals; no owner, deployed only after the reveal |
| `CourierNFT.sol` | 3,333 couriers, commit-reveal, duty lock, on-chain renderer hook, `tokensOfOwner`; ownership renounced when the game launches |
| `CourierRenderer.sol`, `CourierSVG.sol`, `CourierTraits.sol` | On-chain metadata and art |
| `CourierSkins.sol` | 999 cosmetic skins: blind mint, commit-reveal shuffle, on-chain metadata, enforced 5% royalty (ERC721-C) |
| `TokenDrops.sol` | The treasure hunt's payouts: the treasury's token drops, for finds the multiplayer room has checked (and the companion bonus's $STAMP drops) |
| `StampHunt.sol` | The earlier $STAMP-only hunt (replaced by TokenDrops, never deployed) |
| `CourierCompanions.sol` | Companions that follow your courier: ERC-1155 kinds sold only for $STAMP (straight to the treasury), supplies that only shrink, wallet limits, enforced 5% royalty (ERC1155-C); live at `0x4254…49B7` |
| `CourierPad.sol`, `PadToken.sol` | The launchpad: players with a post office launch a token (burning a $STAMP fee); 95% locked in its IMD pool, 5% to the treasury for drops, 4% trading fee to the protocol; the same hook as $STAMP's, for many tokens |

```bash
cd contracts && forge test                                             # 395 tests
forge test --match-contract "StampHookForkTest|LaunchStagesForkTest|CourierSkinsForkTest|SkinsStampSaleForkTest|CourierPadForkTest|CourierCompanionsForkTest" --fork-url robinhood   # real pools, stage 2, royalty registry
```

## Deploying to Robinhood Chain

Two stages, from the same wallet, with the settings in `contracts/launch.env`:

```bash
cd contracts
./script/deploy-mainnet.sh rehearse                             # both stages on a fork, no transactions
./script/deploy-mainnet.sh couriers --broadcast --browser       # stage 1: the NFT, ready to mint
./script/deploy-mainnet.sh game --broadcast --browser           # stage 2, after the reveal
```

`--browser` opens http://127.0.0.1:9545: pick your wallet (MetaMask, Robinhood Wallet...) in the
list, connect, then press **Sign & Send** and approve each transaction in the wallet. Stage 1 is
4 transactions, stage 2 about 13.

Each broadcast runs `export-web.sh`, which writes `web/deployments/robinhood.json`; commit it
and Vercel serves it. After stage 1 the site shows the mint; after stage 2, the whole game.
`START_MCAP_USD` sets the launch price as a fully diluted market cap for all 21M $STAMP, in
dollars, converted to IMD when stage 2 runs. Both stages together use about 23.4M gas
(~0.001 ETH at today's fees).

## Launch checklist

Nothing has an owner after launch: stage 2 renounces the token, the pool hook, the renderer and
the NFT, and the post office never has one. Prices, rates, the fee recipient and the treasury are
final from then on, so pick addresses that can never be lost (a Safe works well) and that accept ETH.

1. Choose the fee recipient, treasury, launch allocation and starting price.
2. Stage 1. Save the reveal secret it prints: nothing can be revealed, and the game can't launch, without it.
3. Open the mint (`setSaleOpen(true)`). When it's over, `reveal(secret)` ends the sale and reveals the couriers.
4. Check a few tokens on a marketplace.
5. Stage 2. It logs every owner at the end: all `0x0`.

The contracts are audited before the deploy; `AUDIT.md` is the brief for reviewers.
