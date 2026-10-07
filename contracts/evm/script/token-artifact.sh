#!/usr/bin/env bash
# Writes artifacts/MembaToken.json: the ABI and creation bytecode the app deploys every Memba token from, with the
# compiler settings and the hashes that identify them. With --check, rebuilds it and fails if the committed file
# differs (the build must be reproducible from the pinned solc, OpenZeppelin submodule and foundry.toml).
# Usage (from contracts/evm): script/token-artifact.sh [--check]
set -euo pipefail
cd "$(dirname "$0")/.."
target=artifacts/MembaToken.json
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

forge build --quiet src/MembaToken.sol
bytecode="$(forge inspect src/MembaToken.sol:MembaToken bytecode)"
abi="$(forge inspect src/MembaToken.sol:MembaToken abi --json)"
config="$(forge config --json)"
jq -n \
  --argjson abi "$abi" \
  --arg bytecode "$bytecode" \
  --arg creationCodeHash "$(cast keccak "$bytecode")" \
  --arg sourceSha256 "$(shasum -a 256 src/MembaToken.sol | cut -d' ' -f1)" \
  --arg patchSha256 "$(shasum -a 256 wizard/MembaToken.patch | cut -d' ' -f1)" \
  --arg wizard "$(jq -r '.packages["node_modules/@openzeppelin/wizard"].version' wizard/package-lock.json)" \
  --arg openzeppelin "$(git -C lib/openzeppelin-contracts rev-parse HEAD)" \
  --argjson config "$config" \
  '{
    contractName: "MembaToken",
    source: "contracts/evm/src/MembaToken.sol",
    sourceSha256: $sourceSha256,
    wizard: {package: "@openzeppelin/wizard", version: $wizard, patch: "contracts/evm/wizard/MembaToken.patch", patchSha256: $patchSha256},
    openzeppelinContractsCommit: $openzeppelin,
    compiler: {solc: $config.solc, evmVersion: $config.evm_version, optimizer: $config.optimizer, optimizerRuns: $config.optimizer_runs, viaIR: $config.via_ir},
    constructor: "constructor(string name_, string symbol_, address recipient, uint256 premint_, address feeRecipient, uint256 fee_)",
    creationCodeHash: $creationCodeHash,
    abi: $abi,
    bytecode: $bytecode
  }' >"$tmp"

if [ "${1:-}" = "--check" ]; then
  if ! cmp -s "$tmp" "$target"; then
    diff <(jq 'del(.abi, .bytecode)' "$target") <(jq 'del(.abi, .bytecode)' "$tmp") || true
    echo "::error::$target is stale or not reproducible. Run contracts/evm/script/token-artifact.sh and commit the result."
    exit 1
  fi
  echo "$target matches a fresh build"
else
  mkdir -p artifacts
  cp "$tmp" "$target"
  echo "wrote $target"
fi
