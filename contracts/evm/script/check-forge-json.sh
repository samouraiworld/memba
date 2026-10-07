#!/usr/bin/env bash
# Fails unless a `forge test --json` report proves the suites really ran: every contract in <dir> whose name
# matches <regex> is present with at least one test, and no test failed or was skipped. A filter that silently
# matches nothing, or a fork that skips, cannot pass as green.
# Usage: script/check-forge-json.sh <report.json> <contract-regex> <test-dir>
set -euo pipefail
report="$1"
regex="$2"
dir="$3"
expected="$(grep -rhoE '^contract [A-Za-z0-9_]+' "$dir" | awk '{print $2}' | grep -E "$regex" | sort -u || true)"
if [ -z "$expected" ]; then
  echo "::error::no test contract in $dir matches $regex"
  exit 1
fi
ran="$(jq -r 'to_entries[] | select((.value.test_results | length) > 0) | .key | sub("^.*:"; "")' "$report" | sort -u)"
missing="$(comm -23 <(echo "$expected") <(echo "$ran"))"
if [ -n "$missing" ]; then
  echo "::error::suites that did not run: $(echo "$missing" | tr '\n' ' ')"
  exit 1
fi
bad="$(jq -r 'to_entries[] | .key as $s | .value.test_results | to_entries[]
  | select(.value.status != "Success") | "\($s) \(.key): \(.value.status) \(.value.reason // "")"' "$report")"
if [ -n "$bad" ]; then
  # Fork errors can quote the endpoint; never print one.
  echo "$bad" | sed -E 's#[a-z]+://[^ )"]+#<rpc>#g'
  echo "::error::tests failed or were skipped"
  exit 1
fi
echo "$(jq '[.[].test_results | length] | add' "$report") tests passed in $(echo "$expected" | wc -l | tr -d ' ') suites"
