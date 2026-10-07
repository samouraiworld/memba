#!/usr/bin/env bash
# Negative controls for the contracts CI gates: each gate is fed a deliberately broken input and must FAIL.
# A gate that passes here is blind, so this script fails. The positive runs are the CI steps themselves.
# Offline canaries (default) need node + wizard/node_modules, forge, jq. `--live` runs the manifest canary
# against the chains (needs BASE_RPC_URL / BASE_SEPOLIA_RPC_URL or the public endpoints).
# Usage (from contracts/evm): script/ci-canaries.sh [--live]
set -uo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
canary=.canary
mkdir -p "$canary"
trap 'rm -rf "$work" "$canary"' EXIT
failures=0

# expect_fail <name> <pattern> <command...>: the command must fail AND say <pattern>, so a canary cannot pass
# because of an unrelated error (missing file, permissions, network).
expect_fail() {
  local name="$1" pattern="$2"
  shift 2
  if "$@" >"$work/out.log" 2>&1; then
    echo "::error::canary '$name': the gate PASSED on a broken input"
    failures=$((failures + 1))
  elif ! grep -qF -- "$pattern" "$work/out.log"; then
    echo "::error::canary '$name': the gate failed for another reason (expected: $pattern)"
    sed -E 's#[a-z]+://[^ )"]+#<rpc>#g' "$work/out.log" | tail -5
    failures=$((failures + 1))
  else
    echo "ok: '$name' is caught"
  fi
}

corrupt_manifest() { # <jq filter> : writes both corrupted chain files into .canary/
  jq "$1" ../../deployments/evm/8453.json >"$canary/8453.json"
  cp ../../deployments/evm/84532.json "$canary/84532.json"
}

if [ "${1:-}" = "--live" ]; then
  corrupt_manifest '.contracts.basenamesL2Resolver.proxy.implementationCodehash = "0x\("1" * 64)"'
  expect_fail "manifest live: proxy implementation changed" "basenamesL2Resolver: implementation codehash" \
    env EVM_MANIFEST_DIR="$canary" forge test --match-contract ManifestLiveBaseTest --match-test test_every_contract_matches
  corrupt_manifest '.contracts.eas.version = "9.9.9"'
  expect_fail "manifest live: version drift" "eas: version" \
    env EVM_MANIFEST_DIR="$canary" forge test --match-contract ManifestLiveBaseTest --match-test test_every_contract_matches
else
  # Wizard diff check.
  sed 's/_mint(feeRecipient, fee_);/_mint(feeRecipient, fee_ * 2);/' src/MembaToken.sol >"$work/edited.sol"
  expect_fail "wizard: hand-edited source" "differs from the Wizard output" wizard/check.sh "$work/edited.sol"
  awk '{print} /^\+        _mint\(feeRecipient, fee_\);/{print "+    function mint(address to, uint256 v) external { _mint(to, v); }"}' \
    wizard/MembaToken.patch >"$work/extra.patch"
  expect_fail "wizard: patch adds a function" "makes edits other than" wizard/check.sh src/MembaToken.sol "$work/extra.patch"

  # Token artifact reproducibility.
  jq '.bytecode |= (.[0:-2] + "00")' artifacts/MembaToken.json >"$work/artifact.json"
  expect_fail "artifact: bytecode tampered" "is stale or not reproducible" env TOKEN_ARTIFACT="$work/artifact.json" script/token-artifact.sh --check

  # Coverage gate.
  printf 'SF:src/MembaToken.sol\nFNF:3\nFNH:3\nLF:7\nLH:6\nBRF:0\nBRH:0\nend_of_record\n' >"$work/partial.lcov"
  expect_fail "coverage: one line uncovered" "must be fully covered" script/check-coverage.sh "$work/partial.lcov"
  printf 'SF:test/unit/MembaToken.t.sol\nLF:1\nLH:1\nend_of_record\n' >"$work/empty.lcov"
  expect_fail "coverage: no src/ file measured" "no src/ file" script/check-coverage.sh "$work/empty.lcov"

  # Forge report vacuity check.
  echo '{}' >"$work/none.json"
  expect_fail "forge report: nothing ran" "suites that did not run" script/check-forge-json.sh "$work/none.json" 'BaseTest$' test/fork
  echo '{"test/fork/Eas.t.sol:EasBaseTest":{"test_results":{"t":{"status":"Skipped"}}}}' >"$work/skip.json"
  expect_fail "forge report: skipped test" "failed or were skipped" script/check-forge-json.sh "$work/skip.json" '^EasBaseTest$' test/fork

  # Manifest consistency (offline).
  corrupt_manifest '.contracts.seaport.address = "0x4200000000000000000000000000000000000021"'
  expect_fail "manifest: address disagrees with the fork tests" "8453 seaport" \
    env EVM_MANIFEST_DIR="$canary" forge test --match-contract ManifestConsistencyTest
  corrupt_manifest 'del(.contracts.multicall3)'
  expect_fail "manifest: key missing on one chain" "key count differs" \
    env EVM_MANIFEST_DIR="$canary" forge test --match-contract ManifestConsistencyTest
fi

if [ "$failures" -gt 0 ]; then
  echo "::error::$failures canary gate(s) are blind"
  exit 1
fi
echo "all canaries caught"
