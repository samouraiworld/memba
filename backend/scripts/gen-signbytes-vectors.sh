#!/usr/bin/env bash
# gen-signbytes-vectors.sh — regenerate the canonical tm2 sign-bytes golden vectors.
#
# These vectors are the byte-equality oracle for internal/auth/signbytes.go: each
# fixture carries an unsigned amino-JSON tx + a REAL `gnokey sign` signature over
# gno's canonical sign-bytes (sortJSON(aminoJSON(SignDoc))). The test reconstructs
# the sign-bytes and verifies the signature — if it verifies, our bytes are
# byte-equal to gnokey's (and therefore to the chain at broadcast).
#
# WHY a script (not a one-off): any target-chain gno toolchain bump can change the
# canonical format. Re-run this and review the testdata diff on every bump.
# See docs/planning/MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md.
#
# Usage:  ./scripts/gen-signbytes-vectors.sh [name-regex]
#   With a name-regex argument, only vectors whose name matches are (re)generated —
#   use this to ADD vectors without churning the existing goldens (whose exact
#   bytes call_args_escapes.golden pins).
# Requires: gnokey on PATH (pinned to the TARGET chain toolchain).
#
# The key is the well-known gno integration test1 mnemonic (NOT a real account).
set -euo pipefail

FILTER="${1:-}"

OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/internal/auth/testdata/signbytes"
VDIR="$(mktemp -d /tmp/memba-signvectors.XXXXXX)"
PW="test1234"
CHAINID="test12"
MNEMONIC="source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast"
GNOKEY_VERSION="$(gnokey version 2>&1 | head -1 | sed 's/^[^:]*: *//')"

mkdir -p "$OUT_DIR"
printf '%s\n%s\n%s\n' "$MNEMONIC" "$PW" "$PW" \
  | gnokey add --recover --insecure-password-stdin --home "$VDIR" --force test1 >/dev/null 2>&1
echo "gnokey: $GNOKEY_VERSION   keybase: $VDIR   out: $OUT_DIR"

# emit_vector <name> <account_number> <sequence> <description> -- <maketx-args...>
# Per-vector chain id: set VECTOR_CHAINID in the call environment (defaults to $CHAINID).
emit_vector() {
  local name="$1" acct="$2" seq="$3" desc="$4"; shift 4
  [ "$1" = "--" ] && shift
  if [ -n "$FILTER" ] && ! [[ "$name" =~ $FILTER ]]; then
    echo "  skip $name (filter: $FILTER)"
    return
  fi
  local cid="${VECTOR_CHAINID:-$CHAINID}"
  local unsigned="$VDIR/$name.unsigned.json" signed="$VDIR/$name.signed.json"
  # --broadcast=false: newer gnokey defaults maketx to sign+simulate+broadcast;
  # we only want the unsigned amino-JSON doc on stdout (the old default).
  gnokey "$@" --broadcast=false --home "$VDIR" test1 > "$unsigned" 2>"$VDIR/$name.err" \
    || { echo "FAILED building $name:"; cat "$VDIR/$name.err"; exit 1; }
  printf '%s\n' "$PW" | gnokey sign \
    --tx-path "$unsigned" --chainid "$cid" \
    --account-number "$acct" --account-sequence "$seq" \
    --insecure-password-stdin --output-document "$signed" \
    --home "$VDIR" test1 >/dev/null 2>&1
  ACCT="$acct" SEQ="$seq" CID="$cid" DESC="$desc" VER="$GNOKEY_VERSION" \
  UNSIGNED="$unsigned" SIGNED="$signed" python3 - "$OUT_DIR/$name.json" <<'PY'
import json, os, sys
out = sys.argv[1]
unsigned = json.load(open(os.environ["UNSIGNED"]))
signed = json.load(open(os.environ["SIGNED"]))
fixture = {
    "description": os.environ["DESC"],
    "gnokey_version": os.environ["VER"],
    "chain_id": os.environ["CID"],
    "account_number": int(os.environ["ACCT"]),
    "account_sequence": int(os.environ["SEQ"]),
    "unsigned_tx": unsigned,
    "pub_key_b64": signed["pub_key"]["value"],
    "signature_b64": signed["signature"],
}
json.dump(fixture, open(out, "w"), ensure_ascii=False, indent=2)
print("  wrote", os.path.basename(out), "-", fixture["description"])
PY
}

# --- /vm.m_call matrix ---------------------------------------------------------
emit_vector call_args_escapes 7 13 \
  "m_call: empty send+max_deposit, multi args, memo with < > & and unicode (HTML-escape lock)" -- \
  maketx call --pkgpath gno.land/r/demo/foo --func Bar --args hello --args world \
  --gas-fee 1000000ugnot --gas-wanted 2000000 --memo 'memba<test>&unicodé'

emit_vector call_send_deposit 0 0 \
  "m_call: non-zero send + max_deposit set, nil args (key absent), acct=0 seq=0, empty memo" -- \
  maketx call --pkgpath gno.land/r/demo/bank --func Deposit \
  --send 5000000ugnot --max-deposit 100000000ugnot \
  --gas-fee 1000000ugnot --gas-wanted 2000000

emit_vector call_zero_gasfee 4294967296 999999999 \
  "m_call: ZERO gas_fee (must serialize to \"\"), large uint64 sequence/account_number" -- \
  maketx call --pkgpath gno.land/r/demo/foo --func Ping \
  --gas-fee 0ugnot --gas-wanted 2000000

# --- /bank.MsgSend -------------------------------------------------------------
emit_vector send_basic 12 3 \
  "bank.MsgSend: simple coin transfer" -- \
  maketx send --to g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5 --send 1500000ugnot \
  --gas-fee 1000000ugnot --gas-wanted 2000000

# --- /vm.m_addpkg --------------------------------------------------------------
PKGDIR="$VDIR/pkg"; mkdir -p "$PKGDIR"
cat > "$PKGDIR/hello.gno" <<'GNO'
package hello

func Hello() string { return "hi" }
GNO
emit_vector addpkg_basic 1 1 \
  "vm.m_addpkg: package deploy (nested MemPackage/files)" -- \
  maketx addpkg --pkgpath gno.land/r/demo/hello --pkgdir "$PKGDIR" \
  --gas-fee 1000000ugnot --gas-wanted 2000000

# --- A3 frontend-parity vectors (test-13, on-wire chain id with the HYPHEN) -----
# These mirror EXACTLY what the frontend stores for a multisig proposal
# (lib/multisigTx.ts buildCanonicalProposePayload): fee gas_wanted 100000 (send) /
# 2000000 (call) with gas_fee 10000ugnot, empty memo, realistic account/sequence.
# A real gnokey signature over these docs proves the backend reconstruction is
# byte-equal to the chain toolchain for the frontend's exact stored shapes.
# (Residual, documented risk: Adena's own serializer — covered by the A2 login
# prod proof for /vm.m_call args:null and by the retro sweep metric on real rows.)
VECTOR_CHAINID="test-13" emit_vector frontend_send_parity 57 4 \
  "A3 frontend parity: bank.MsgSend with the frontend's stored fee shape (100000 gas / 10000ugnot), test-13" -- \
  maketx send --to g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5 --send 1500000ugnot \
  --gas-fee 10000ugnot --gas-wanted 100000

VECTOR_CHAINID="test-13" emit_vector frontend_call_parity 57 5 \
  "A3 frontend parity: vm.m_call with args, the frontend's stored call fee shape (2000000 gas / 10000ugnot), test-13" -- \
  maketx call --pkgpath gno.land/r/samcrew/memba_dao --func Vote --args 1 --args yes \
  --gas-fee 10000ugnot --gas-wanted 2000000

echo "Done. $(ls -1 "$OUT_DIR"/*.json | wc -l | tr -d ' ') vectors in $OUT_DIR"
