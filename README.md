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
the players near them, plus waves and the preset phrases (keys 1-8). Nothing in it touches the
chain. `GET /count` tells the title screen how many are playing.

```bash
cd multiplayer
npm install
npx wrangler dev          # a local room on :8787; open the game with ?mp=ws://127.0.0.1:8787/ws
npx wrangler deploy       # the live room, at wss://courier-world-mp.courier-world-mp.workers.dev/ws
```

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

```bash
cd contracts && forge test                                             # 95 tests
forge test --match-contract "StampHookForkTest|LaunchStagesForkTest" --fork-url robinhood   # real pools; the real stage 2
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
