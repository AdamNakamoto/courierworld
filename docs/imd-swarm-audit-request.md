# IMD Swarm audit request

Paste the request text at [explorer.imd.fun/launch](https://explorer.imd.fun/launch) (choose **Audit**), or
send the API body below.

- **Repository:** https://github.com/AdamNakamoto/courierworld
- **Commit:** `0d2bf199cedfdc9534578b85f644d135b8dac3df`

## Request text

```text
Project: Courier ($STAMP), pre-launch audit.

Repo: github.com/AdamNakamoto/courierworld (commit 0d2bf19). Read AUDIT.md first: it states the system, the guarantees, the admin powers and the known, accepted limits.

Scope: contracts/src/StampHook.sol, contracts/src/StampRouter.sol, contracts/src/StampEthRouter.sol, contracts/src/StampToken.sol, contracts/src/PostOffice.sol, contracts/src/CourierNFT.sol, contracts/src/lib/SafeTransfer.sol, contracts/script/DeployMainnet.s.sol, contracts/script/DeployLib.sol. Out of scope: the view-only art contracts (CourierRenderer, CourierSVG, CourierTraits) and web/.

Tests: cd contracts; git submodule update --init --recursive; forge test (43 tests). Fork test against live Robinhood Chain: forge test --match-contract StampHookForkTest --fork-url https://robinhood.drpc.org

What it is: a game on Robinhood Chain (4663). $STAMP (21M cap) trades in one Uniswap v4 pool against IMD. The hook owns the pool: openPool (owner, once) locks a 2.1M $STAMP launch allocation as single-sided liquidity the hook can never remove, and every swap in the pool pays 4% of its IMD side to the protocol through return deltas (specified side in beforeSwap, unspecified side in afterSwap), held as ERC-6909 claims until collectProtocolFees; IMD-specified swaps must fill completely (PartialFill). LP fee 0. Routers: IMD (with permit sells) and ETH via the hookless IMD/ETH pool. The rest of $STAMP is minted by PostOffice: offices bought with ETH earn each virtual block's emission (2.25 $STAMP, one block per 1.1 s, halving every 4.2M blocks) by share of delivery power from Courier NFTs on duty (3,333 NFTs, commit-reveal traits, duty-locked while working). Spending $STAMP burns 75%, 25% to the treasury. Token ownership is renounced at deploy after the one-shot setMinter. Deploy settings in contracts/launch.env: fee recipient, treasury and owners 0x72215670C2266Bc224949A12C514a77D7fD5D566; start price a $3,000 fully diluted market cap, converted to IMD at deploy.

Please verify above all: the 4% fee is charged exactly on every swap in the pool through any router, direction and exact-in/out mode, never skipped and never overcharged; the hook's IMD claims always equal pendingProtocolFees and collection pays only feeRecipient; the launch liquidity can never be removed and nobody can add liquidity, open another pool on the hook, or block openPool; $STAMP can never exceed 21M and nothing can change balances, the minter or transfers after deploy; PostOffice reward accounting never pays more than was emitted or for time a courier wasn't on duty, including across halvings; a courier on duty can't be transferred and traits can't be learned or influenced before the mint ends; the routers only move the caller's tokens and enforce deadlines and minimum outputs; and no admin power reaches user funds (scanner flags: honeypot, hidden owner, owner can change balance, suspicious function).
```

## Same request as an API body (`job.open`)

```json
{
  "objective": "<the request text above>",
  "template": "audit",
  "repoUrl": "https://github.com/AdamNakamoto/courierworld.git",
  "baseCommit": "0d2bf199cedfdc9534578b85f644d135b8dac3df"
}
```
