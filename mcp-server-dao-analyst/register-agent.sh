#!/bin/bash
# ─────────────────────────────────────────────────────────────
# register-agent.sh — Register dao-analyst agent via 2-of-2 multisig
# Registers in the on-chain agent_registry on testnet12
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REMOTE="https://rpc.testnet12.samourai.live:443"
CHAIN="test12"
MULTISIG_KEY="samcrew-core-test1"
SIGNER1="zooma"
SIGNER2="adena-zxxma"
PKG="gno.land/r/samcrew/agent_registry"

TMPDIR=$(mktemp -d "/tmp/agent-register-dao-analyst-XXXXXX")
trap 'rm -rf "$TMPDIR"' EXIT

# ── Agent metadata ──────────────────────────────────────────
AGENT_ID="dao-analyst"
AGENT_NAME="DAO Governance Analyst"
AGENT_DESC="Multi-model AI governance analyst — analyzes DAO proposals from legal, technical, and financial perspectives using free-tier LLM consensus. Supports any Gno DAO."
AGENT_CATEGORY="governance"
AGENT_CAPS="Proposal analysis (multi-perspective),Treasury audit,Governance health score,Proposal comparison,Risk assessment,Network switching,Free + PRO tiers"
AGENT_ENDPOINT="npx @samouraiworld/dao-analyst-mcp"
AGENT_TRANSPORT="stdio"
AGENT_PRICING="pay-per-use"
AGENT_VERSION="0.1.0"
AGENT_PRICE="100000" # 100,000 ugnot per PRO analysis (0.1 GNOT)

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
  -args "$AGENT_ID" \
  -args "$AGENT_NAME" \
  -args "$AGENT_DESC" \
  -args "$AGENT_CATEGORY" \
  -args "$AGENT_CAPS" \
  -args "$AGENT_ENDPOINT" \
  -args "$AGENT_TRANSPORT" \
  -args "$AGENT_PRICING" \
  -args "$AGENT_VERSION" \
  -args "$AGENT_PRICE" \
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
echo "=== Verifying registration ==="
gnokey query vm/qrender \
  -data "$PKG:agent/$AGENT_ID" \
  -remote "$REMOTE"
