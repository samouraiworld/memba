#!/usr/bin/env bash
# Proves the attribution check can fail, and that it fails for the right reason.
#
# Every assertion below is on the MESSAGE the check prints, never on its exit
# status. An exit status is one bit, and this check has several separate ways
# of finding something: plain text, base64, an inflated compressed chunk, a
# forbidden chunk type, and the allowlist that can exempt any of them. One bit
# cannot tell those apart, so a run in which every branch but one still works
# is indistinguishable from a run in which all of them work. Each case here
# names the file it expects reported and the reason it expects given — the
# part that differs between branches — and matches the whole line, so an extra
# or a missing reason fails too.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="$here/check-vendor-attribution.py"
[ -f "$check" ] || { echo "self-test FAILED: $check is missing" >&2; exit 1; }

# Assembled at runtime on purpose. Spelled as one word, this file would itself
# be a finding, and the check would flag the test that proves it works.
needle="cla""ude"

work="$(mktemp -d "${TMPDIR:-/tmp}/vendor-attribution-selftest.XXXXXX")"
spare="$(mktemp -d "${TMPDIR:-/tmp}/vendor-attribution-tools.XXXXXX")"
cleanup() { chmod -R u+w "$work" "$spare" 2>/dev/null || true; rm -rf -- "$work" "$spare"; }
trap cleanup EXIT

git -C "$work" init -q
git -C "$work" config user.email ci@example.invalid
git -C "$work" config user.name ci

fail() { echo "self-test FAILED: $1" >&2; exit 1; }

# Stages whatever the fixture left behind and returns the check's output. The
# exit status is deliberately discarded rather than returned: nothing in this
# file is allowed to assert on it.
_out=""
_status=0
run() {
  git -C "$work" add -A
  if _out="$(python3 "$check" "$work" 2>&1)"; then _status=0; else _status=$?; fi
  printf '%s\n' "$_out"
}

# The message tells the branches apart; the exit status is the only thing CI
# consumes. Asserting one without the other is how a refusal flipped to a pass
# went unnoticed: the 13 message assertions all still passed with the checker's
# `return 1` changed to `return 0`.
#
# The EXACT status, not merely non-zero: a traceback also exits non-zero, and
# "could not look" must never read as "found something".
expect_status() {
  [ "$_status" -eq "$2" ] || fail "$1
  expected exit status: $2
  actual exit status:   $_status
  actual output: $_out"
}

# Output reaches grep as a here-string, never through a pipe: `grep -q` exits
# at the first match and closes the pipe, and under pipefail the writer's
# SIGPIPE then fails a case whose line did match.
#
# The whole line, matched literally. Substring-matching the reason alone would
# also accept a line that carried a second, unexpected reason beside it.
expect_line() {
  local label="$1" want="$2" out
  run; out="$_out"
  if ! grep -qxF -- "$want" <<<"$out"; then
    fail "$label
  expected line: $want
  actual output: $out"
  fi
  expect_status "$label: reported the finding but exited wrong" 1
  printf '  ok  %s\n' "$label"
}

expect_text() {
  local label="$1" want="$2" out
  run; out="$_out"
  if ! grep -qF -- "$want" <<<"$out"; then
    fail "$label
  expected text: $want
  actual output: $out"
  fi
  expect_status "$label: reported the finding but exited wrong" 1
  printf '  ok  %s\n' "$label"
}

expect_clean() {
  local label="$1" out
  run; out="$_out"
  if ! grep -qxF -- 'no tracked file carries assistant attribution' <<<"$out"; then
    fail "$label
  expected the clean-tree message
  actual output: $out"
  fi
  # ...and that it reported nothing alongside it. A check that printed both
  # would still have exited 0, so the exit status cannot separate these two.
  if grep -q '::error' <<<"$out"; then
    fail "$label
  reported a finding on a clean tree: $out"
  fi
  expect_status "$label: said clean but exited wrong" 0
  printf '  ok  %s\n' "$label"
}

echo "vendor-attribution self-test"

printf 'nothing to declare\n' > "$work/clean.txt"
expect_clean "a clean tree says so, and reports nothing"

# 1. Plain text — what the rule always assumed, and the only one of these a
#    recursive grep would have caught on its own.
printf 'produced with %s assistance\n' "$needle" > "$work/plain.txt"
expect_line "plain text names the file and the needle" \
  "::error file=plain.txt::carries $needle"
rm "$work/plain.txt"

# 2. Binary metadata — a NUL byte makes grep treat the file as binary and skip
#    it. One of the two ways attribution actually arrived in these repos.
printf 'PNG\000metadata\000%s\000' "$needle" > "$work/blob.bin"
expect_line "attribution inside binary metadata is caught" \
  "::error file=blob.bin::carries $needle"
rm "$work/blob.bin"

# 3. Base64 — the other way it actually arrived. The name is not text anywhere
#    in the file, and the reported reason has to say so: matching the whole
#    line proves the decoding branch is what caught it, rather than a stray
#    plain-text match that would leave the base64 path untested.
payload="$(printf 'padding%.0s' $(seq 1 40))$needle"
encoded="$(printf '%s' "$payload" | base64 | tr -d '\n')"
printf '<svg><metadata>%s</metadata></svg>\n' "$encoded" > "$work/hidden.svg"
if grep -qi "$needle" "$work/hidden.svg"; then
  fail "the base64 fixture is not actually hidden"
fi
expect_line "base64 is caught, and reported as base64" \
  "::error file=hidden.svg::carries $needle (base64)"
rm "$work/hidden.svg"

# 4. The decoding threshold. The fixture above is long enough to be decoded
#    under the old 120-character minimum too, so on its own it proves nothing
#    about the lowered bound.
short="$(printf '%s' "$(printf 'x%.0s' $(seq 1 24))$needle" | base64 | tr -d '\n')"
if [ "${#short}" -lt 40 ] || [ "${#short}" -gt 50 ]; then
  fail "threshold fixture is ${#short} chars, wanted 40 to 50"
fi
printf '<svg><desc>%s</desc></svg>\n' "$short" > "$work/short.svg"
expect_line "a ${#short}-character base64 run is still decoded" \
  "::error file=short.svg::carries $needle (base64)"
rm "$work/short.svg"

# 5. A compressed chunk, built deliberately on a colour profile. That chunk
#    type is PERMITTED, so the file cannot be caught on its type — only
#    inflation can catch it, and the reason reported has to say "compressed
#    chunk", or something other than the inflation branch is what ran.
NEEDLE="$needle" python3 - "$work/compressed.png" <<'PY'
import os, struct, sys, zlib

def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

text = ("Profile produced with " + os.environ["NEEDLE"]).encode()
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
       + chunk(b"iCCP", b"ICC profile\x00\x00" + zlib.compress(text))
       + chunk(b"IDAT", zlib.compress(b"\x00\x00"))
       + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
PY
if grep -qi "$needle" "$work/compressed.png"; then
  fail "the compressed fixture is not actually hidden"
fi
expect_line "a permitted compressed chunk is inflated and reported as such" \
  "::error file=compressed.png::carries $needle (compressed chunk)"
rm "$work/compressed.png"

# 6. The converse: a forbidden chunk type is a finding on its own, carrying
#    nothing incriminating at all. The reason is what separates this branch
#    from the one above — by exit status the two fixtures are identical.
python3 - "$work/bare.png" <<'PY'
import struct, sys, zlib

def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
       + chunk(b"tEXt", b"Comment\x00nothing incriminating here")
       + chunk(b"IDAT", zlib.compress(b"\x00\x00"))
       + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
PY
expect_line "a forbidden chunk type is reported as the chunk, with no name in it" \
  "::error file=bare.png::carries tEXt chunk"
rm "$work/bare.png"

# 7. The summary counts files, and the listing is sorted. A caller reads both,
#    and neither is visible in the exit status. Checking the order needs an
#    ordered read: two findings whose sorted order is known in advance.
printf 'a %s\n' "$needle" > "$work/a-first.txt"
printf 'z %s\n' "$needle" > "$work/z-last.txt"
expect_text "the summary counts the files it found" \
  "2 tracked files carry attribution"
run; ordered="$_out"
first="$(printf '%s\n' "$ordered" | grep -n 'a-first.txt' | cut -d: -f1)"
last="$(printf '%s\n' "$ordered" | grep -n 'z-last.txt' | cut -d: -f1)"
if [ -z "$first" ] || [ -z "$last" ] || [ "$first" -ge "$last" ]; then
  fail "findings are not listed in sorted order
  actual output: $ordered"
fi
printf '  ok  %s\n' "findings are listed in sorted order"
rm "$work/a-first.txt" "$work/z-last.txt"

expect_clean "the tree is clean again once every fixture is removed"

# 8. The allowlist, exercised against a COPY of the check in a scratch
#    directory. It resolves its allowlist next to its own source, so testing
#    it in place would mean writing to a tracked file in this repository and
#    trusting a restore step to put it back. The copy makes the exemption
#    impossible to leak into the repository at all.
cp "$check" "$spare/check-vendor-attribution.py"
printf 'exempt %s\n' "$needle" > "$work/exempt.txt"
git -C "$work" add -A

before="$(python3 "$spare/check-vendor-attribution.py" "$work" 2>&1 || true)"
if ! grep -qxF -- "::error file=exempt.txt::carries $needle" <<<"$before"; then
  fail "with no allowlist, the file should have been reported
  actual output: $before"
fi
printf '  ok  %s\n' "with no allowlist the file is reported"

printf 'exempt.txt\n' > "$spare/vendor-attribution-allowlist.txt"
after="$(python3 "$spare/check-vendor-attribution.py" "$work" 2>&1 || true)"
if ! grep -qxF -- 'no tracked file carries assistant attribution' <<<"$after"; then
  fail "an allowlisted file should have been exempt
  actual output: $after"
fi
printf '  ok  %s\n' "an allowlisted path is exempt, and the tree reads clean"

# The comment syntax the allowlist file documents, proven rather than assumed:
# commented out, the same entry must stop exempting anything.
printf '# exempt.txt\n' > "$spare/vendor-attribution-allowlist.txt"
commented="$(python3 "$spare/check-vendor-attribution.py" "$work" 2>&1 || true)"
if ! grep -qxF -- "::error file=exempt.txt::carries $needle" <<<"$commented"; then
  fail "a commented-out allowlist entry should not exempt anything
  actual output: $commented"
fi
printf '  ok  %s\n' "a commented-out allowlist entry exempts nothing"

# ── the PATH is published as loudly as the contents ──────────────────────────
# The rule names a filename explicitly, and a scan of contents alone cannot see
# one. Each fixture below is innocuous INSIDE, so only the path scan can catch it.
rm -f "$work"/*.txt "$work"/*.md 2>/dev/null || true
git -C "$work" add -A >/dev/null 2>&1 || true

printf 'nothing to declare\n' > "$work/$needle.md"
expect_line "the marker in a filename is caught" \
  "::error file=$needle.md::carries $needle (in the path)"
rm "$work/$needle.md"

mkdir -p "$work/docs/$needle-assets"
printf 'nothing to declare\n' > "$work/docs/$needle-assets/readme.txt"
expect_line "the marker in a directory component is caught" \
  "::error file=docs/$needle-assets/readme.txt::carries $needle (in the path)"
rm -r "$work/docs"

upper="$(printf '%s' "$needle" | tr '[:lower:]' '[:upper:]')"
printf 'nothing to declare\n' > "$work/$upper.md"
expect_line "an uppercase filename is caught, and reported lower-cased" \
  "::error file=$upper.md::carries $needle (in the path)"
rm "$work/$upper.md"

# ...and the path scan must not MASK the content scan: a clean path with dirty
# contents still reports the content reason, with no "(in the path)" suffix.
printf 'x %s\n' "$needle" > "$work/plain.txt"
expect_line "a clean path with dirty contents reports only the content reason" \
  "::error file=plain.txt::carries $needle"
rm "$work/plain.txt"
expect_clean "the tree is clean once the path fixtures are removed"

# ── "could not look" must not read as "clean" ────────────────────────────────
# Both of these reported a clean tree and exited 0 before this change.
# `chmod 000` does not stop root reading a file, so under a root container this
# case would read the file, find nothing, exit 0 and fail the suite for an
# environment reason. Skipped audibly instead: a silent skip is the thing this
# file exists to refuse.
if [ "$(id -u)" = 0 ]; then
  printf '  SKIP  %s\n' "unreadable-file cases: running as root, where chmod 000 is inert"
else
printf 'readable for now\n' > "$work/locked.txt"
git -C "$work" add -A >/dev/null
chmod 000 "$work/locked.txt"
# Invoked directly rather than through run(): run() re-stages, and `git add`
# itself fails on a mode-000 file, so the harness would never reach the checker.
# The file is already tracked, which is the only precondition that matters here.
if _out="$(python3 "$check" "$work" 2>&1)"; then _status=0; else _status=$?; fi
if ! grep -q 'locked.txt.*could not be read' <<<"$_out"; then
  chmod 644 "$work/locked.txt"; rm -f "$work/locked.txt"
  fail "an unreadable tracked file was not reported
  actual output: $_out"
fi
expect_status "an unreadable tracked file is reported, not skipped" 1
printf '  ok  %s\n' "an unreadable tracked file is reported, not skipped"
chmod 644 "$work/locked.txt"; rm "$work/locked.txt"
fi

ln -s nowhere/at/all "$work/ghost.txt"
run
if ! grep -q 'ghost.txt.*could not be read' <<<"$_out"; then
  rm -f "$work/ghost.txt"
  fail "a dangling symlink was not reported
  actual output: $_out"
fi
expect_status "a dangling symlink is reported, not skipped" 1
printf '  ok  %s\n' "a dangling symlink is reported, not skipped"
rm "$work/ghost.txt"
expect_clean "the tree is clean once the unreadable fixtures are removed"

# ── a submodule is a commit id, not a file ───────────────────────────────────
# Its contents belong to another repository and are checked there. Before this
# case, the check tried to open the submodule's directory as a file and
# reported it as unreadable, failing every tree that has one. Its PATH is still
# published here, so a marker in the path must still be caught.
nested="$work/vendored"
git -C "$work" config advice.addEmbeddedRepo false
git init -q "$nested"
git -C "$nested" config user.email ci@example.invalid
git -C "$nested" config user.name ci
printf 'made with %s\n' "$needle" > "$nested/inside.txt"
git -C "$nested" add -A
git -C "$nested" commit -q -m fixture
expect_clean "a submodule's contents are not this tree's files"
git -C "$work" rm -q -f --cached vendored
mv "$nested" "$work/$needle-vendored"
expect_line "a marker in a submodule's path is still caught" \
  "::error file=$needle-vendored::carries $needle (in the path)"
git -C "$work" rm -q -f --cached "$needle-vendored"
mv "$work/$needle-vendored" "$spare/"
expect_clean "the tree is clean once the submodule fixtures are removed"

# ── the manifest namespace, which had no fixture at all ──────────────────────
# It is FOUR bytes. Matched as a bare substring it collides with base64: it
# refused an npm lockfile whose only crime was an integrity hash containing
# those four characters. Both directions are asserted, because an anchor that
# is too tight stops catching real manifests and no existing case would notice.
ns="$(printf '\x63\x32\x70\x61')"
printf '<svg xmlns:%s="http://example.invalid/ns"><g/></svg>\n' "$ns" > "$work/manifest.svg"
expect_line "a declared manifest namespace is caught" \
  "::error file=manifest.svg::carries $ns"
rm "$work/manifest.svg"

printf '<x><%s:claim/></x>\n' "$ns" > "$work/qualified.xml"
expect_line "a namespace-qualified name is caught" \
  "::error file=qualified.xml::carries $ns"
rm "$work/qualified.xml"

# The negative, which is the one that was failing in production: the four
# characters inside a base64 integrity hash, with no manifest anywhere.
printf '{"integrity":"sha512-R8gLRTZeyp03ymzP6Lil28tGeGEzhx1q2k703KGWRAI1VdvPIXdG70VJ%sMw3NA6JKL5hhFu1sJX0Mnn"}\n' "$ns" > "$work/package-lock.json"
expect_clean "four characters inside an integrity hash are not a manifest"
rm "$work/package-lock.json"

# ── base64 as encoders actually emit it: wrapped ────────────────────────────
# `base64` wraps at 76 columns by default, PEM and MIME at 64 or 76, often with
# CRLF, and YAML indents the block. Each line is then a run of its own, so a
# name in a short last line fell under the 40-character floor, and a name
# across a line break was split between two decodes. Every earlier base64
# fixture strips its newlines, so none of them could show it. The fixtures fold
# explicitly rather than trusting `base64` to wrap: BSD `base64` does not.

# Prints the lines of the base64 in $1 that a single-line decode would catch: at
# least the 40-character floor, and carrying the name once decoded alone. A
# wrapped fixture must print nothing, or a single-line decode could be what
# catches it and the wrapped path would go untested.
lines_alone_carry() {
  NEEDLE="$needle" python3 - "$1" <<'PY'
import base64, os, re, sys
needle = os.environ["NEEDLE"].encode()
for line in re.split(rb"\r?\n|\\n", open(sys.argv[1], "rb").read()):
    run = re.sub(rb"[^A-Za-z0-9+/=]", b"", line)
    if len(run) < 40:
        continue
    run += b"=" * (-len(run) % 4)
    try:
        if needle in base64.b64decode(run).lower():
            print(line.decode())
    except Exception:
        pass
PY
}

printf '%060d%s' 0 "$needle" | base64 | tr -d '\n' | fold -w 76 > "$spare/tail.b64"
if [ "$(awk 'END { print length($0) }' "$spare/tail.b64")" -ge 40 ]; then
  fail "the short-last-line fixture's last line is not short"
fi
[ -z "$(lines_alone_carry "$spare/tail.b64")" ] || fail "the short-last-line fixture is caught line by line"
printf '<svg><desc>\n%s\n</desc></svg>\n' "$(cat "$spare/tail.b64")" > "$work/wrapped-tail.svg"
expect_line "wrapped at 76, a name in a short last line is decoded" \
  "::error file=wrapped-tail.svg::carries $needle (base64)"
rm "$work/wrapped-tail.svg"

# Both lines here are well over the floor, so it is the split, not the length,
# that the single-line decode misses.
printf '%055d%s%040d' 0 "$needle" 0 | base64 | tr -d '\n' | fold -w 76 > "$spare/split.b64"
[ -z "$(lines_alone_carry "$spare/split.b64")" ] || fail "the line-break fixture is caught line by line"
printf '<svg><desc>\n%s\n</desc></svg>\n' "$(cat "$spare/split.b64")" > "$work/wrapped-split.svg"
expect_line "wrapped at 76, a name across the line break is decoded" \
  "::error file=wrapped-split.svg::carries $needle (base64)"
rm "$work/wrapped-split.svg"

# PEM shape: 64 columns, CRLF, and the indentation of a YAML block scalar.
printf '%046d%s%040d' 0 "$needle" 0 | base64 | tr -d '\n' | fold -w 64 \
  | awk '{ printf "  %s\r\n", $0 }' > "$spare/pem.b64"
[ -z "$(lines_alone_carry "$spare/pem.b64")" ] || fail "the CRLF fixture is caught line by line"
{ printf 'blob: |\r\n'; cat "$spare/pem.b64"; } > "$work/wrapped.yaml"
expect_line "wrapped at 64 with CRLF and indentation, the name is decoded" \
  "::error file=wrapped.yaml::carries $needle (base64)"
rm "$work/wrapped.yaml"

# Inside a JSON string a line break is the two characters backslash and n.
printf '%046d%s%040d' 0 "$needle" 0 | base64 | tr -d '\n' | fold -w 64 \
  | awk '{ printf "%s\\n", $0 }' > "$spare/json.b64"
[ -z "$(lines_alone_carry "$spare/json.b64")" ] || fail "the JSON fixture is caught line by line"
printf '{"blob": "%s"}\n' "$(cat "$spare/json.b64")" > "$work/wrapped.json"
expect_line "wrapped inside a JSON string, the name is decoded" \
  "::error file=wrapped.json::carries $needle (base64)"
rm "$work/wrapped.json"

# A block after a line of prose: the join takes the last word of that line as
# its first piece, three characters that put every later line out of step with
# base64's four-character groups, so the block is decoded again from its first
# whole line.
printf '%055d%s%040d' 0 "$needle" 0 | base64 | tr -d '\n' | fold -w 76 > "$spare/prose.b64"
[ -z "$(lines_alone_carry "$spare/prose.b64")" ] || fail "the prose fixture is caught line by line"
printf 'the signing key\n%s\n' "$(cat "$spare/prose.b64")" > "$work/after-prose.txt"
expect_line "a wrapped block after a line of prose is decoded in step" \
  "::error file=after-prose.txt::carries $needle (base64)"
rm "$work/after-prose.txt"

# The converse, because joining lines is exactly how a check starts reading
# prose as base64: a wrapped block of clean bytes, and a column of words each
# on a line of its own, which joins into one long run of the alphabet.
printf '%0200d' 0 | base64 | tr -d '\n' | fold -w 76 > "$work/clean-wrapped.txt"
seq 1 200 | awk '{ printf "word%s\n", $0 }' > "$work/column.txt"
expect_clean "clean wrapped base64 and a column of words read clean"
rm "$work/clean-wrapped.txt" "$work/column.txt"

# ── what sits next to a blob must not cost the blob ─────────────────────────
# Each of these is the whole blob, readable as it stands, lost only to what is
# written beside it.

# The join takes the first word of the line after a block as its last piece.
# With no padding at the end of the block, a word one character past a
# four-character group ("Hello", five) fails the decode, and the whole joined
# block with it, so the block is decoded again short of that word.
printf '%055d%s%053d' 0 "$needle" 0 | base64 | tr -d '\n' | fold -w 76 > "$spare/unpadded.b64"
if grep -q '=' "$spare/unpadded.b64"; then fail "the short-word fixture is padded"; fi
[ -z "$(lines_alone_carry "$spare/unpadded.b64")" ] || fail "the short-word fixture is caught line by line"
{ cat "$spare/unpadded.b64"; printf '\nHello world\n'; } > "$work/short-word.txt"
expect_line "a wrapped block followed by a short word is decoded short of the word" \
  "::error file=short-word.txt::carries $needle (base64)"
rm "$work/short-word.txt"

# More than one line of a single word after the block: each is joined on as a
# piece of its own, so dropping only the last still leaves "Hello" glued on,
# five characters, one past a four-character group.
{ cat "$spare/unpadded.b64"; printf '\nHello\nabcd\n'; } > "$work/short-words.txt"
expect_line "a wrapped block followed by two one-word lines is decoded short of both" \
  "::error file=short-words.txt::carries $needle (base64)"
rm "$work/short-words.txt"

# Blanks before the line break: two of them are a hard line break in Markdown.
printf '%055d%s%040d' 0 "$needle" 0 | base64 | tr -d '\n' | fold -w 76 \
  | awk '{ printf "%s  \n", $0 }' > "$spare/blanks.b64"
[ -z "$(lines_alone_carry "$spare/blanks.b64")" ] || fail "the trailing-blanks fixture is caught line by line"
cp "$spare/blanks.b64" "$work/hard-breaks.md"
expect_line "wrapped with trailing blanks before each break, the name is decoded" \
  "::error file=hard-breaks.md::carries $needle (base64)"
rm "$work/hard-breaks.md"

# A JSON encoder may escape every slash, and base64 of high bytes is full of
# them. Each escape cuts the run, and no piece between two of them is long
# enough to decode.
NEEDLE="$needle" python3 - "$work/escaped.json" <<'PY'
import base64, os, sys
text = (bytes(range(250, 256)) * 8 + b" by " + os.environ["NEEDLE"].encode()
        + b" " + bytes((255, 254, 253)) * 20)
encoded = base64.b64encode(text)
assert encoded.count(b"/") > 5
open(sys.argv[1], "wb").write(b'{"u": "' + encoded.replace(b"/", b"\\/") + b'"}\n')
PY
if grep -qi "$needle" "$work/escaped.json"; then fail "the escaped-slash fixture is not hidden"; fi
expect_line "base64 with every slash escaped, as JSON may write it, is decoded" \
  "::error file=escaped.json::carries $needle (base64)"
rm "$work/escaped.json"

# A `key=` prefix: `=` is in the alphabet, so the key and the blob are one run,
# and the key's five characters put the blob out of step when it is decoded.
encoded="$(printf 'a note written by %s and kept here for later reference ok' "$needle" | base64 | tr -d '\n')"
printf 'token=%s\n' "$encoded" > "$work/prefixed.env"
if grep -qi "$needle" "$work/prefixed.env"; then fail "the key-prefix fixture is not hidden"; fi
expect_line "base64 behind a key= prefix is decoded from after the =" \
  "::error file=prefixed.env::carries $needle (base64)"
rm "$work/prefixed.env"

# A long run of `=` that nothing in the alphabet follows. Splitting at padding
# once tried such a run again from each of its characters, reading to its end
# every time: 80,000 of them took half a minute, and this file would take
# minutes. Fixed, it takes a fraction of a second; the bound is generous so a
# slow runner cannot fail it. The blob before the run, behind a key= prefix,
# proves the split still happens.
printf 'token=%s' "$encoded" > "$work/padding-run.env"
python3 -c 'import sys; open(sys.argv[1], "ab").write(b"=" * 200000 + b"\n")' "$work/padding-run.env"
if grep -qi "$needle" "$work/padding-run.env"; then fail "the padding-run fixture is not hidden"; fi
started="$(date +%s)"
expect_line "a 200,000-character run of padding is split, and the blob before it decoded" \
  "::error file=padding-run.env::carries $needle (base64)"
elapsed=$(( $(date +%s) - started ))
[ "$elapsed" -le 5 ] || fail "a 200,000-character run of padding took ${elapsed}s to scan, wanted 5s at most"
printf '  ok  %s\n' "...and in ${elapsed}s, under the 5s bound"
rm "$work/padding-run.env"

# ── what base64 carries is read like a file ─────────────────────────────────
# A PNG in a `data:` URI is the same bytes as the PNG file, and was read as
# nothing but text: a text chunk that fails as a file passed inside an SVG, and
# so did a name in a compressed chunk. The decoded bytes now go through the
# same reading a file gets, and the reason says which container they came out
# of, innermost first.

# Writes a one-pixel PNG to $1, carrying the chunk named by $2: a text chunk
# with nothing incriminating in it, a compressed text chunk or a colour profile
# naming the assistant, or no extra chunk at all.
make_png() {
  NEEDLE="$needle" python3 - "$1" "$2" <<'PY'
import os, struct, sys, zlib

def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

named = ("made with " + os.environ["NEEDLE"]).encode()
extra = {
    "none": b"",
    "tEXt": chunk(b"tEXt", b"Comment\x00nothing incriminating here"),
    "zTXt": chunk(b"zTXt", b"Comment\x00\x00" + zlib.compress(named)),
    "iCCP": chunk(b"iCCP", b"ICC profile\x00\x00" + zlib.compress(named)),
    "iCCP-clean": chunk(b"iCCP", b"ICC profile\x00\x00" + zlib.compress(b"sRGB")),
}[sys.argv[2]]
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
       + extra
       + chunk(b"IDAT", zlib.compress(b"\x00\x00"))
       + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
PY
}

data_uri() { printf 'data:image/png;base64,%s' "$(base64 < "$1" | tr -d '\n')"; }

make_png "$spare/text.png" tEXt
printf '<svg><image href="%s"/></svg>\n' "$(data_uri "$spare/text.png")" > "$work/icon.svg"
expect_line "a text chunk in a data URI is reported as the chunk, from base64" \
  "::error file=icon.svg::carries tEXt chunk (base64)"
rm "$work/icon.svg"

make_png "$spare/ztxt.png" zTXt
printf '<svg><image href="%s"/></svg>\n' "$(data_uri "$spare/ztxt.png")" > "$work/note.svg"
if grep -qi "$needle" "$work/note.svg"; then fail "the compressed-text data URI is not hidden"; fi
expect_line "a compressed text chunk in a data URI is inflated as well as refused" \
  "::error file=note.svg::carries $needle (compressed chunk in base64), zTXt chunk (base64)"
rm "$work/note.svg"

# The permitted chunk type, so that inflation is the only thing that can catch
# it, as in case 5.
make_png "$spare/iccp.png" iCCP
printf '<svg><image href="%s"/></svg>\n' "$(data_uri "$spare/iccp.png")" > "$work/profile.svg"
expect_line "a colour profile in a data URI is inflated and reported as such" \
  "::error file=profile.svg::carries $needle (compressed chunk in base64)"
rm "$work/profile.svg"

# Both gaps at once: the data URI wrapped and indented inside an HTML
# attribute. The compressed chunk runs past the first line, so only the joined
# block can be inflated; the chunk type alone is in the first line.
{
  printf '<img src="data:image/png;base64,\n'
  base64 < "$spare/ztxt.png" | tr -d '\n' | fold -w 76 | sed 's/^/    /'
  printf '\n">\n'
} > "$work/page.html"
expect_line "a wrapped data URI is joined, decoded and read as a PNG" \
  "::error file=page.html::carries $needle (compressed chunk in base64), zTXt chunk (base64)"
rm "$work/page.html"

# Nesting, to the depth the check follows: an HTML page holding an SVG as a
# data URI, which holds a PNG as a data URI, whose colour profile names the
# assistant. Three containers, each opened in turn.
printf '<svg><image href="%s"/></svg>' "$(data_uri "$spare/iccp.png")" \
  | base64 | tr -d '\n' > "$spare/svg.b64"
printf '<object data="data:image/svg+xml;base64,%s"/>\n' "$(cat "$spare/svg.b64")" > "$work/nested.html"
expect_line "three containers deep, each is opened and named, innermost first" \
  "::error file=nested.html::carries $needle (compressed chunk in base64 in base64)"
rm "$work/nested.html"

# A clean PNG stays clean as a data URI, including one with a permitted
# profile that inflates to nothing forbidden.
make_png "$spare/plain.png" none
make_png "$spare/srgb.png" iCCP-clean
printf '<svg><image href="%s"/><image href="%s"/></svg>\n' \
  "$(data_uri "$spare/plain.png")" "$(data_uri "$spare/srgb.png")" > "$work/clean.svg"
expect_clean "clean PNGs in data URIs read clean"
rm "$work/clean.svg"

# Inflation is the one step that makes a payload larger than the file it came
# from, so it is capped, and a chunk over the cap is reported rather than read
# in part and passed.
python3 - "$work/bomb.png" <<'PY'
import struct, sys, zlib

def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
       + chunk(b"iCCP", b"ICC profile\x00\x00" + zlib.compress(bytes((32 << 20) + 1), 9))
       + chunk(b"IDAT", zlib.compress(b"\x00\x00"))
       + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
PY
expect_line "a chunk that inflates past the cap is reported, not read in part" \
  "::error file=bomb.png::carries compressed chunk too large to inflate"
rm "$work/bomb.png"

# The cap is per chunk, so a file is held to a total as well: three chunks each
# under the cap, which together inflate past the per-file budget. Reported, for
# the same reason as a chunk over the cap, rather than read in part and passed.
python3 - "$work/budget.png" <<'PY'
import struct, sys, zlib

def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

profile = chunk(b"iCCP", b"ICC profile\x00\x00" + zlib.compress(bytes(30 << 20), 9))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
       + profile * 3
       + chunk(b"IDAT", zlib.compress(b"\x00\x00"))
       + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
PY
expect_line "chunks under the cap that together pass the file's budget are reported" \
  "::error file=budget.png::carries inflate budget exceeded"
rm "$work/budget.png"
expect_clean "the tree is clean once the base64 fixtures are removed"

# ── the surfaces that are not files ─────────────────────────────────────────
# The rule names five of them — commit messages, branch names, pull-request
# titles and bodies, tags and release notes — and `git ls-files` can see none.
# `--text LABEL` takes one on stdin. These cases are the only thing standing
# between that mode and a step that pipes the wrong expression into it, so the
# label and the byte count are asserted as well as the finding.

# Output first, status second. Reading `$?` after a pipe gives the pipe's
# status, which is the writer's, not the checker's.
run_text() {
  local input="$1"; shift
  if _out="$(printf '%s' "$input" | python3 "$check" --text "$@" 2>&1)"; then
    _status=0
  else
    _status=$?
  fi
}

expect_text_line() {
  local label="$1" want="$2" input="$3"; shift 3
  run_text "$input" "$@"
  if ! grep -qxF -- "$want" <<<"$_out"; then
    fail "$label
  expected line: $want
  actual output: $_out"
  fi
  expect_status "$label: reported the finding but exited wrong" 1
  printf '  ok  %s\n' "$label"
}

# A clean surface says so AND says how much it looked at. The byte count is the
# only evidence in the log that the step's input arrived at all — a step whose
# expression produced the wrong field has no other tell when the wrong field is
# also clean. Two fixtures of different lengths, so a hard-coded number in the
# message could not satisfy both.
expect_clean_surface() {
  local label="$1" input="$2" surface="$3"
  run_text "$input" "$surface"
  # Bytes, not characters. `${#input}` counts characters, and the checker counts
  # bytes; the two agree only while every fixture is ASCII, which is not a
  # property anyone adding the next fixture would think to preserve.
  local size
  size="$(printf '%s' "$input" | wc -c | tr -d ' ')"
  local want="no assistant attribution in the $surface ($size bytes scanned)"
  if ! grep -qxF -- "$want" <<<"$_out"; then
    fail "$label
  expected line: $want
  actual output: $_out"
  fi
  expect_status "$label: said clean but exited wrong" 0
  printf '  ok  %s\n' "$label"
}

expect_clean_surface "a clean surface reads clean and reports how much it scanned" \
  'docs/state-the-attribution-rule' 'branch name'
expect_clean_surface "and the size it reports is the size it was given" \
  'fix/range' 'branch name'

# The finding names the surface. Two different labels, because a message that
# hard-coded one of them would pass a single-label test.
expect_text_line "a commit message is caught, and the message names the surface" \
  "::error::$needle appears in the commit messages on this branch" \
  "feat: a change

Co-Authored-By: $needle <noreply@example.invalid>" \
  "commit messages on this branch"

expect_text_line "a pull-request title is caught under its own label" \
  "::error::$needle appears in the pull request title" \
  "chore: generated with $needle" \
  "pull request title"

# Case, because a branch name is often capitalised differently than prose.
expect_text_line "an uppercase name in a branch is caught" \
  "::error::$needle appears in the branch name" \
  "feat/$(printf '%s' "$needle" | tr '[:lower:]' '[:upper:]')-review" \
  "branch name"

# Base64 reaches a text surface too: a footer can arrive encoded in a body.
body_payload="$(printf 'padding%.0s' $(seq 1 40))$needle"
body_encoded="$(printf '%s' "$body_payload" | base64 | tr -d '\n')"
if grep -qi "$needle" <<<"$body_encoded"; then
  fail "the base64 body fixture is not actually hidden"
fi
expect_text_line "base64 inside a body is decoded, and reported as base64" \
  "::error::$needle (base64) appears in the pull request body" \
  "see the attached manifest: $body_encoded" \
  "pull request body"

# ── an empty surface is "could not look", not "clean" ────────────────────────
# This is the whole reason the mode refuses by default. A range that resolved
# to nothing, or an expression naming a field the event does not carry, arrives
# here as empty — and reporting it clean is how a gate becomes a comment.
run_text '' 'commit messages on this branch'
if ! grep -qF -- 'nothing was scanned: the commit messages on this branch arrived empty' <<<"$_out"; then
  fail "an empty surface should be refused, not passed
  actual output: $_out"
fi
expect_status "an empty surface was refused but exited wrong" 1
printf '  ok  %s\n' "an empty surface is refused, and says the step is wrong"

# Whitespace is empty. A step whose expression produced only a newline is the
# same defect, and would otherwise slip past as a one-byte scan.
run_text '
   
' 'commit messages on this branch'
if ! grep -qF -- 'arrived empty. This surface is never legitimately empty' <<<"$_out"; then
  fail "a whitespace-only surface should be refused
  actual output: $_out"
fi
expect_status "a whitespace-only surface was refused but exited wrong" 1
printf '  ok  %s\n' "a whitespace-only surface counts as empty"

# ...and the opt-out works, for the surfaces that really are absent most runs.
run_text '' 'release notes' --allow-empty
if ! grep -qxF -- 'nothing to scan: no release notes on this event' <<<"$_out"; then
  fail "a declared-empty surface should pass and say so
  actual output: $_out"
fi
expect_status "a declared-empty surface said so but exited wrong" 0
printf '  ok  %s\n' "--allow-empty lets a legitimately absent surface pass, audibly"

# The flag must affect EMPTINESS only. Spelled as "ignore this surface" it
# would silently exempt every release note ever published, and no case above
# would notice — both exit 0.
expect_text_line "--allow-empty does not exempt a surface that carries the name" \
  "::error::$needle appears in the release notes" \
  "published with help from $needle" \
  "release notes" --allow-empty

# ── a miswired step must not read as a pass ─────────────────────────────────
# `--text` with no label, the shape a workflow typo actually takes. Status 2,
# distinct from a finding's 1: "this step is wrong" and "this surface is dirty"
# are repaired differently, and one bit cannot tell them apart.
expect_usage() {
  local label="$1"; shift
  if _out="$(python3 "$check" "$@" 2>&1 <<<'x')"; then _status=0; else _status=$?; fi
  grep -qF -- '--text LABEL' <<<"$_out" || fail "$label
  expected the usage text
  actual output: $_out"
  expect_status "$label: printed usage but exited wrong" 2
  printf '  ok  %s\n' "$label"
}

expect_usage "--text with no label exits 2 with usage, not 0" --text
# The dispatch is two clauses -- `--text` must be FIRST and there must be
# exactly one label -- and each was unprovable on its own: mutating either one
# away left every case above passing. These two kill them separately.
expect_usage "a label after a root argument is not a surface scan" . --text
expect_usage "two labels are refused rather than one being picked" --text a b

echo "self-test passed: plain text, binary metadata, base64 long and short, a"
echo "permitted compressed chunk, a forbidden chunk type, the summary count,"
echo "the listing order, the allowlist, the path scan, the unreadable-file"
echo "report, the manifest namespace, wrapped base64 in seven shapes, base64"
echo "behind escaped slashes and behind a key= prefix, a long run of padding in"
echo "bounded time, the PNG inside a data URI, three containers of nesting, the"
echo "inflation cap and the per-file inflation budget each"
echo "proved by their own message AND their own exit status — and, for the"
echo "surfaces that are not files, the label, the scanned size, base64, the"
echo "refusal of an empty surface, the narrowness of --allow-empty and the usage"
echo "status of a miswired step"
