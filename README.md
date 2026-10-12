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

## The golden stamp hunt

Golden stamps move every day: 24 of the spots in `web/hunt-spots.json` are out each UTC day
(`web/hunt-pick.js` picks them, the same way in the game and on the server). Anyone can collect
them for fun. A player with a post office can also sign in with their wallet (one signature, no
transaction): the multiplayer room then checks each find against where they've actually been, and
signs a voucher for the day's finds. `StampHunt.sol` pays it in $STAMP from a pool its owner fills
(it never mints), up to a set number of stamps per wallet per day and a daily total. The owner tops
the pool up, takes $STAMP out and changes the reward from the admin part of the Post Office panel.

```bash
cd contracts
STAMP=0x… OFFICE=0x… HUNT_SIGNER=0x… forge script script/DeployHunt.s.sol --rpc-url robinhood --broadcast --browser
cd ../multiplayer
npx wrangler secret put HUNT_KEY          # the voucher key (its address is HUNT_SIGNER)
npx wrangler deploy --var HUNT_ADDRESS:0x…
```

Then add `"hunt": "0x…"` to `contracts/deployments/robinhood.json` and run `script/export-web.sh`.
`./dev.sh` deploys a local hunt and writes `multiplayer/.dev.vars`, so `npx wrangler dev` runs it too.

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

## The launchpad

Any player with a post office can launch their own token, inside the game (`CourierPad.sol`, not deployed
yet). A launch burns a $STAMP fee (500 at launch; the owner can change it, and launchers name the most
they'll pay) and creates a `PadToken`: 1,000,000,000 supply, plain ERC-20 with permit, no owner, no tax.

- 95% goes into the token's Uniswap v4 pool against IMD as single-sided liquidity, locked forever (the pad
  has no way to remove it). The starting market cap is the same for every launch (about $5,000 at deploy;
  the owner can change it for future launches).
- 5% goes to the treasury, for drops to players with a post office.
- Every trade pays 4% of its IMD side to the protocol, through any router: the pad is every pool's hook,
  with the same fee code as $STAMP's `StampHook`. Buy and sell with IMD, or with ETH in one transaction
  (the same routers as $STAMP).

Learned from PepesFamily (fixed-supply v4 launches, locked liquidity, hook fees), without its holder rewards.

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
| `StampHunt.sol` | Pays $STAMP from an owner-filled pool for golden stamps the multiplayer room has checked |
| `CourierPad.sol`, `PadToken.sol` | The launchpad: players with a post office launch a token (burning a $STAMP fee); 95% locked in its IMD pool, 5% to the treasury for drops, 4% trading fee to the protocol; the same hook as $STAMP's, for many tokens |

```bash
cd contracts && forge test                                             # 237 tests
forge test --match-contract "StampHookForkTest|LaunchStagesForkTest|CourierSkinsForkTest|SkinsStampSaleForkTest|CourierPadForkTest" --fork-url robinhood   # real pools, stage 2, royalty registry
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
