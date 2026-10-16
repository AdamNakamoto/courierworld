#!/usr/bin/env bash
# Pause (or resume) claims on both treasure hunt drops contracts, signed in the treasury's browser wallet, without
# the site (if the room's voucher key leaked, say; while paused, the treasury can withdraw any drop).
#
#   ./script/pause-drops.sh on  --broadcast --browser --browser-disable-open   # pause both
#   ./script/pause-drops.sh off --broadcast --browser --browser-disable-open   # resume both
#   ./script/pause-drops.sh on  --sender 0x…                                   # dry run on a fork
#
# RPC_URL picks the RPC (default: foundry.toml's "robinhood").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

case "${1:-}" in
  on) DROPS_PAUSE=true ;;
  off) DROPS_PAUSE=false ;;
  *) echo "Say on (pause) or off (resume)." >&2; exit 1 ;;
esac
shift
DROPS=$(jq -r .drops deployments/robinhood-drops.json)
[ -f deployments/robinhood-drops2.json ] && DROPS="$DROPS,$(jq -r .drops2 deployments/robinhood-drops2.json)"
export DROPS DROPS_PAUSE
BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done
if [ "$BROADCAST" = 1 ]; then
  forge script script/PauseDrops.s.sol --rpc-url "${RPC_URL:-robinhood}" "$@"
else
  forge script script/PauseDrops.s.sol --fork-url "${RPC_URL:-robinhood}" "$@"
fi
