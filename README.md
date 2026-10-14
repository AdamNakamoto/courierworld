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
signs golden stamp hunt vouchers. `GET /count` tells the title screen how many are playing.

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

## The treasure hunt: golden stamps and token drops

Every UTC day the spots in `web/hunt-spots.json` are shuffled (`web/hunt-pick.js`, `web/drop-pick.js`, the same
in the game and on the server): the first 24 are the golden stamps, and each token drop running that day puts
its coins on the next ones, oldest drop first, with the token's picture on them. Anyone can collect them for fun.
A player with a post office can also sign in with their wallet (one signature, no transaction): the
multiplayer room then checks each find against where they've actually been, and signs a voucher per drop for
the day's finds. `TokenDrops.sol` pays them from each drop's own tokens (it never mints), claimed for the day of
the finds or the day after, all drops in one transaction from the Post Office panel's Treasure hunt section.
`TokenDrops` is live since 2026-10-13 at `0xD0e785276840F7175DF12678991605042e89771C` (source verified on Sourcify);
the room's voucher key is the multiplayer server's secret `DROPS_KEY` (its address, `0xac7e8d5A3b94ac56Ec1DD10a0Ec6a5ABD3b155Ca`,
is the contract's signer).

Only the treasury (the contract's owner) starts drops, from that same section: a launchpad token (its 5% of
each launch) or $STAMP, which pays for the golden stamps. Each drop sets the tokens per coin, how many coins are
out a day (1 to 48; 24 golden stamps for $STAMP), how many one wallet is paid for a day, how many are paid a day
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

`./dev.sh` deploys local drops and writes `multiplayer/.dev.vars`, so `npx wrangler dev` runs them too (token
drops need the launchpad: `./dev.sh --fork`). `StampHunt.sol`, the $STAMP-only version, was never deployed.

## The moon and Mars

The neon district's rocket flies couriers to two small worlds, each built the first time someone goes: the moon
(`web/moon.js`, rules in `web/moon-pick.js`: radius 12 m, gravity 0.35 of the planet's, craters, the moon frogs and
their base, a saucer) and Mars (`web/mars.js`, rules in `web/mars-pick.js`: as big as the planet, radius 34 m, gravity 0.55; the spaceport;
Mars City with a walk-in plaza dome, greenhouses, homes, tubes, pools, farms and a ring road; red mountains; a canyon,
a sleeping volcano and an ice cap; seven Martians and thirteen astronauts; a rover to drive; and a dust storm every
seven minutes, the same for everyone). Mars's static scenery is merged into one mesh as it's built. `web/trips.js` holds both trips' tickets and stamps in one table, shared by the
game and the server; `web/space.js` holds what both worlds share (the pad and rocket, the post box, the locals, the
day's stamps). Each world's group sits so its top is where the planet's is, so the sun, the shadows and the camera work
unchanged; `main.js` walks on whichever world you're on (its radius, centre, ground, obstacles and gravity) and turns
that one under you. The painted sky has a "space" mode for the moon and a "mars" mode (butterscotch, hazier in a storm).

Each world has a post box by its pad that fills an empty bag with three letters for the locals there; they count with
the planet's deliveries. The rover is a ride (`rides.js`): hopping in swaps your courier onto it, and it's parked where
you hop out (back in the garage when you fly home).

A ticket is sent from the player's wallet to the treasury (`chain.ticket(world)`: 100 $STAMP for the moon, 200 for
Mars), good for an hour. The room checks it (`["ticket", world, txHash]`): a successful transaction from the player's
signed-in hunt wallet that moved at least the price to the treasury, less than three hours old, never used before for
any trip; the ticket is kept per wallet, so a reload doesn't lose it. Players tell the room which world they're on
(`["world", "moon" | "mars" | "planet"]`, a trip only with its ticket), and positions and emotes go only to players
on the same world; a newcomer gets everyone there (`["here", …]`). Twelve golden stamps a day on each world
(`["wgrab", world, spot]`, checked against that world's spots with its radius) count with the golden stamps: the
vouchers for the $STAMP drop add them up, within its limits. The room still answers games loaded before Mars
(`["moon", txHash]`, `["mgrab", spot]`).

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

- `web/companion-kinds.js`: what each kind is (name, tier, blurb...), shared by the game, the Post Office panel (the
  shop, where players also pick which companion follows them), the server and the metadata. Prices and supplies live
  on chain.
- `web/companions.js` draws the companions and makes them follow their courier (`createFollower(id)`), on every
  world; `web/companions-premium.js` has the bigger models (the mecha, the colossus and the anime companions).
- The multiplayer room shows a player's companion to others only after reading on-chain that the wallet on their
  name tag owns it (`COMPANIONS_ADDRESS`).
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
offices, the golden stamp hunt, "advertise here") and shows that only play on this planet ("The Letter
King", "Mail-a-Mia!", "Phantom of the Post Office"...), none naming a real brand, plus the Orb's ad.
Like the Orb, what the square replaces is still drawn at random and left out, so nothing else in the
town moves: the same addresses, lots, golden stamps and obstacles everywhere outside it.

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
| `TokenDrops.sol` | The treasure hunt's payouts: the treasury's token drops and the golden stamps ($STAMP), for finds the multiplayer room has checked |
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
