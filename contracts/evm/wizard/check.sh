#!/usr/bin/env bash
# Proves src/MembaToken.sol is the pinned OpenZeppelin Wizard output plus the reviewed constructor patch and
# nothing else: check the patch only makes the allowed edits, regenerate, apply the patch with no fuzz, compare bytes.
# Usage: wizard/check.sh [source] [patch]   (run `npm ci` in wizard/ first; the arguments exist for the CI canaries)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../src/MembaToken.sol}"
patch_file="${2:-$here/MembaToken.patch}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Shape: one hunk whose removed and added lines are exactly these. Anything else (a new function, another
#    modifier, an edited override) needs a reviewed change to this script.
expected_removed='-    constructor(address recipient)
-        ERC20("MembaToken", "MBT")
-        ERC20Permit("MembaToken")
-        _mint(recipient, 1000000 * 10 ** decimals());'
expected_added='+    constructor(string memory name_, string memory symbol_, address recipient, uint256 premint_, address feeRecipient, uint256 fee_)
+        ERC20(name_, symbol_)
+        ERC20Permit(name_)
+        _mint(recipient, premint_);
+        _mint(feeRecipient, fee_);'
body="$(tail -n +3 "$patch_file")"
hunks="$(grep -c '^@@' <<<"$body" || true)"
removed="$(grep '^-' <<<"$body" || true)"
added="$(grep '^+' <<<"$body" || true)"
other="$(grep -v '^[-+ @]' <<<"$body" || true)"
if [ "$hunks" != 1 ] || [ "$removed" != "$expected_removed" ] || [ "$added" != "$expected_added" ] || [ -n "$other" ]; then
  echo "::error::MembaToken.patch makes edits other than the reviewed constructor parameters and fee mint"
  exit 1
fi

# 2. Regenerate the pristine Wizard output with the pinned generator and apply the patch exactly.
node "$here/generate.mjs" >"$tmp/MembaToken.sol"
if ! patch --quiet --fuzz=0 -o "$tmp/patched.sol" "$tmp/MembaToken.sol" "$patch_file"; then
  echo "::error::MembaToken.patch no longer applies to the pinned Wizard output"
  exit 1
fi

# 3. The committed source must be byte-identical to the result.
if ! cmp -s "$tmp/patched.sol" "$src"; then
  diff -u "$tmp/patched.sol" "$src" || true
  echo "::error::src/MembaToken.sol differs from the Wizard output + MembaToken.patch"
  exit 1
fi
echo "MembaToken.sol = pinned Wizard output + reviewed constructor patch"
