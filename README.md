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

Starts a fresh Anvil chain on port 8600, deploys the game contracts (without the trading
pool), writes `web/chain.json` and serves the site at http://localhost:5792 (collection
browser at `/studio.html`). Press **P** in game for the post office. Pick a player from the
panel's menu; Anvil's dev accounts are unlocked, so no wallet is needed. The panel's
local-chain tools close the mint, reveal the collection, and skip time.

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
| Courier NFTs | 3,333, minted for ETH (0.003, up to 10 per transaction), 5% royalty |
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
| `StampHook.sol` | v4 hook and pool owner: 4% fee on the IMD side to the protocol, locked launch liquidity, one pool, one-time `openPool` |
| `StampRouter.sol`, `StampEthRouter.sol` | Buy/sell with IMD (and permit sells), or with ETH through the IMD/ETH pool |
| `StampToken.sol` | $STAMP: ERC-20 + permit, 21M cap, launch allocation to the hook, minted by the post office; ownership renounced at deploy |
| `PostOffice.sol` | The game: offices, couriers on duty, levels, emissions, halvings, referrals |
| `CourierNFT.sol` | 3,333 couriers, commit-reveal, duty lock, on-chain renderer hook, `tokensOfOwner` |
| `CourierRenderer.sol`, `CourierSVG.sol`, `CourierTraits.sol` | On-chain metadata and art |

```bash
cd contracts && forge test                                             # 43 tests
forge test --match-contract StampHookForkTest --fork-url robinhood     # real PoolManager, IMD, IMD/ETH pool
```

## Deploying to Robinhood Chain

```bash
cd contracts
FEE_RECIPIENT=0x... SEED_COMMIT=$(cast keccak $(cast abi-encode "f(uint256)" $SECRET)) START_MCAP=<IMD wei> \
  forge script script/DeployMainnet.s.sol --rpc-url robinhood --broadcast --interactive
./script/export-web.sh   # writes web/deployments/robinhood.json; commit it for Vercel
```

`START_MCAP` sets the launch price as a fully diluted market cap for all 21M $STAMP, in
IMD. A dry run against a fork uses about 23.4M gas (~0.001 ETH at today's fees).

## Launch checklist

1. Choose the fee recipient, treasury, launch allocation and starting price.
2. Deploy with a secret's commit; keep the secret private.
3. Open the mint (`setSaleOpen(true)`), close it, `reveal(secret)`.
4. Check a few tokens on a marketplace, then `freezeRenderer()` to lock the art.
5. Move contract ownership to a multisig.

The contracts are audited before the deploy; `AUDIT.md` is the brief for reviewers.
