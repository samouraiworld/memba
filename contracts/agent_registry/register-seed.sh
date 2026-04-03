#!/bin/bash
# ─────────────────────────────────────────────────────────────
# register-seed.sh — Register memba-mcp agent via 2-of-2 multisig
# Uses the same 5-step signing flow as samcrew-deployer
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REMOTE="https://rpc.testnet12.samourai.live:443"
CHAIN="test12"
MULTISIG_KEY="samcrew-core-test1"
SIGNER1="zooma"
SIGNER2="adena-zxxma"
PKG="gno.land/r/samcrew/agent_registry"

TMPDIR=$(mktemp -d "/tmp/agent-register-XXXXXX")
trap 'rm -rf "$TMPDIR"' EXIT

# ── Get multisig address ─────────────────────────────────────
ADDRESS=$(gnokey list 2>/dev/null | grep -F "$MULTISIG_KEY " | grep -oE 'addr: [a-z0-9]+' | awk '{print $2}' | head -1)
echo "Multisig address: $ADDRESS"

# ── Get account info ─────────────────────────────────────────
ACCOUNT_INFO=$(gnokey query "auth/accounts/${ADDRESS}" --remote "$REMOTE" 2>&1)
ACCOUNT_NUMBER=$(echo "$ACCOUNT_INFO" | grep '"account_number"' | sed 's/.*: *"\([^"]*\)".*/\1/')
SEQUENCE=$(echo "$ACCOUNT_INFO" | grep '"sequence"' | sed 's/.*: *"\([^"]*\)".*/\1/')
echo "Account #${ACCOUNT_NUMBER}, sequence ${SEQUENCE}"

# ── Collect passwords ────────────────────────────────────────
echo -n "Enter password for '$SIGNER1': "
read -rs PW1
echo ""
echo -n "Enter password for '$SIGNER2': "
read -rs PW2
echo ""

# ── Step 1: Create unsigned TX ───────────────────────────────
echo "Step 1/5: Creating unsigned TX..."
gnokey maketx call \
  -pkgpath "$PKG" \
  -func "RegisterAgent" \
  -args "memba-mcp" \
  -args "Memba MCP Server" \
  -args "Official Memba MCP server - query DAOs, proposals, validators, and contributor data from the Gno blockchain." \
  -args "analytics" \
  -args "Query realm Render(),Evaluate realm functions,Check GNOT balances,DAO overview,Proposal details,Contributor leaderboard,Repository tracking,Network status" \
  -args "npx @samouraiworld/memba-mcp" \
  -args "stdio" \
  -args "free" \
  -args "0.1.0" \
  -args "0" \
  -gas-fee 10000ugnot \
  -gas-wanted 2000000 \
  -broadcast=false \
  -chainid "$CHAIN" \
  -insecure-password-stdin \
  "$MULTISIG_KEY" <<< "" 2>/dev/null > "$TMPDIR/unsigned.json"
echo "OK: Unsigned TX created"

# ── Step 2: Sign with signer 1 ──────────────────────────────
echo "Step 2/5: Signing with $SIGNER1..."
gnokey sign \
  --tx-path "$TMPDIR/unsigned.json" \
  --chainid "$CHAIN" \
  --account-number "$ACCOUNT_NUMBER" \
  --account-sequence "$SEQUENCE" \
  --output-document "$TMPDIR/sig1.json" \
  --insecure-password-stdin \
  "$SIGNER1" <<< "$PW1" 2>/dev/null
echo "OK: $SIGNER1 signed"

# ── Step 3: Sign with signer 2 ──────────────────────────────
echo "Step 3/5: Signing with $SIGNER2..."
gnokey sign \
  --tx-path "$TMPDIR/unsigned.json" \
  --chainid "$CHAIN" \
  --account-number "$ACCOUNT_NUMBER" \
  --account-sequence "$SEQUENCE" \
  --output-document "$TMPDIR/sig2.json" \
  --insecure-password-stdin \
  "$SIGNER2" <<< "$PW2" 2>/dev/null
echo "OK: $SIGNER2 signed"

# ── Step 4: Combine signatures ───────────────────────────────
echo "Step 4/5: Combining signatures..."
cp "$TMPDIR/unsigned.json" "$TMPDIR/signed.json"
gnokey multisign \
  --tx-path "$TMPDIR/signed.json" \
  --signature "$TMPDIR/sig1.json" \
  --signature "$TMPDIR/sig2.json" \
  "$MULTISIG_KEY" 2>/dev/null
echo "OK: Signatures combined"

# ── Step 5: Broadcast ────────────────────────────────────────
echo "Step 5/5: Broadcasting..."
gnokey broadcast \
  --remote "$REMOTE" \
  "$TMPDIR/signed.json"

echo ""
echo "=== Verifying ==="
gnokey query vm/qrender \
  -data "$PKG:" \
  -remote "$REMOTE"
