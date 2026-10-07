#!/usr/bin/env bash
# Picks a working RPC endpoint for a chain and exports it as BASE_RPC_URL / BASE_SEPOLIA_RPC_URL (read by
# test/RpcUrl.sol). Candidates, in order: the private endpoint already in that variable (CI secret, when set),
# then the public endpoints. An endpoint qualifies when it answers eth_chainId with the expected id and, when a
# block is given, serves state at that block (fork tests at pinned blocks need history). 3 attempts each, with
# backoff. Endpoints are never printed: a private one carries an API key.
# Usage: script/pick-rpc.sh <base|base_sepolia> [block]   Exit: 0 picked, 2 no endpoint qualified.
set -uo pipefail
chain="$1"
block="${2:-}"
case "$chain" in
  base) var=BASE_RPC_URL; id=8453; public=(https://mainnet.base.org https://base-rpc.publicnode.com) ;;
  base_sepolia) var=BASE_SEPOLIA_RPC_URL; id=84532; public=(https://sepolia.base.org https://base-sepolia-rpc.publicnode.com) ;;
  *) echo "unknown chain: $chain" >&2; exit 64 ;;
esac
private="${!var:-}"
candidates=()
labels=()
if [ -n "$private" ]; then
  candidates+=("$private")
  labels+=("private")
fi
for i in "${!public[@]}"; do
  candidates+=("${public[$i]}")
  labels+=("public #$((i + 1))")
done

healthy() {
  local url="$1" got
  got="$(cast chain-id --rpc-url "$url" 2>/dev/null)" || return 1
  [ "$got" = "$id" ] || return 1
  [ -z "$block" ] || cast balance 0x4200000000000000000000000000000000000016 --block "$block" --rpc-url "$url" >/dev/null 2>&1
}

for i in "${!candidates[@]}"; do
  url="${candidates[$i]}"
  for attempt in 1 2 3; do
    if healthy "$url"; then
      if [ -n "${GITHUB_ENV:-}" ]; then
        echo "::add-mask::$url"
        echo "$var=$url" >>"$GITHUB_ENV"
      fi
      echo "$chain: using the ${labels[$i]} endpoint"
      exit 0
    fi
    [ "$attempt" = 3 ] || sleep $((attempt * 5))
  done
  echo "$chain: the ${labels[$i]} endpoint is not chain $id${block:+ with state at block $block}, or did not answer"
done
exit 2
