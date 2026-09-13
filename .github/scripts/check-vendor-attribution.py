#!/usr/bin/env python3
"""Fail if anything published from this repository carries assistant-vendor
attribution.

AGENTS.md: the name of the assistant that helped build this never appears in a
samouraiworld repository. The recursive case-insensitive grep that rule
prescribes misses the two ways it has actually arrived here:

  1. Binary metadata. `grep -I` skips binaries, and PNG provenance lives in an
     ancillary chunk, so a whole icon set can carry attribution invisibly.
  2. Base64. A provenance manifest embedded in an SVG holds the name encoded,
     so it is not present as text at all and no plain grep can see it.

So this reads every tracked file as bytes, decodes base64 runs, and inflates
compressed PNG text chunks.

It also fails on the metadata containers themselves, whoever wrote them: a
design asset has no reason to carry a text or provenance chunk, and checking
only for today's vendor name would miss tomorrow's. Competitor product names
are NOT flagged — naming Microsoft Copilot in a pricing benchmark is
legitimate research. What is forbidden is attribution of the assistant used to
produce the work.

Tracked files are only the surface `git ls-files` can see. The rule names five
more that it cannot: commit messages, branch names, pull-request titles and
bodies, tags and release notes. None of those is a file, so `--text LABEL`
takes one of them on stdin and applies the same needles to it. The workflow
supplies the text, because most of these live in the event payload rather than
in git.

An empty surface is refused rather than passed. A step whose input silently
came out empty — a range that resolved to nothing, an expression that named a
field the event does not carry — would otherwise report the surface clean
without having looked at it. `--allow-empty` marks the surfaces that are
legitimately absent most of the time, and only those.
"""

import base64
import os
import re
import subprocess
import sys
import zlib

# The needles are hex-encoded rather than written out, because this file is
# itself a tracked file: spelled plainly, the check would flag its own source
# and could never pass. Decoded, they read as the assistant vendor names.
VENDOR = tuple(
    bytes.fromhex(h)
    for h in (
        "616e7468726f706963",  # the company
        "636c61756465",  # the assistant
    )
)

# The provenance manifest namespace, searched as text anywhere in a file —
# that is how it appears in an SVG.
NAMESPACE = tuple(
    bytes.fromhex(h)
    for h in (
        "63327061",  # manifest namespace
    )
)

# Ancillary PNG chunks that can hold arbitrary text, including a manifest
# re-added under another name. These are recognised only at a real chunk
# boundary inside a real PNG, never as a substring: their four letters are
# ordinary words in prose (and in this file), and matching them loosely would
# flag every document that discusses image internals.
FORBIDDEN_CHUNKS = tuple(
    bytes.fromhex(h)
    for h in (
        "63614258",  # provenance
        "69545874",  # international text
        "74455874",  # text
        "7a545874",  # compressed text
        "65584966",  # exif
        "64534947",  # signature
    )
)

# 40 characters decode to 30 bytes — short enough to catch a name tucked into a
# small blob. The earlier threshold of 120 let a 96-character run through.
B64_RUN = re.compile(rb"[A-Za-z0-9+/=]{40,}")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Chunks whose payload is zlib-compressed. The third is an embedded colour
# profile: a legitimate chunk type, which is exactly why it is here. The other
# two are forbidden outright, so inflating them can never be the only reason a
# file is caught — without a permitted compressed chunk in this list, the
# inflation path could break and no test would notice.
COMPRESSED_CHUNKS = (
    bytes.fromhex("7a545874"),  # compressed text
    bytes.fromhex("69545874"),  # international text
    bytes.fromhex("69434350"),  # colour profile
)

ALLOWLIST = os.path.join(os.path.dirname(__file__), "vendor-attribution-allowlist.txt")


def load_allowlist():
    if not os.path.exists(ALLOWLIST):
        return set()
    keep = set()
    for line in open(ALLOWLIST, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if line:
            keep.add(line)
    return keep


def png_chunks(raw):
    """Yield (type, body) for each chunk of a PNG. Nothing if not a PNG."""
    if not raw.startswith(PNG_SIGNATURE):
        return
    offset = len(PNG_SIGNATURE)
    while offset + 8 <= len(raw):
        length = int.from_bytes(raw[offset : offset + 4], "big")
        kind = raw[offset + 4 : offset + 8]
        body = raw[offset + 8 : offset + 8 + length]
        offset += 12 + length
        yield kind, body
        if kind == b"IEND":
            return


def inflate(body):
    """Decompress a compressed text chunk payload, or return nothing.

    A name inside one of these is neither readable text nor base64, so it
    would otherwise pass both of the other scans.
    """
    # Skip the keyword and the compression flags, then inflate what is left.
    _, _, tail = body.partition(b"\0")
    for start in range(min(len(tail), 4) + 1):
        try:
            return zlib.decompress(tail[start:])
        except zlib.error:
            continue
    return None


def findings(path):
    with open(path, "rb") as handle:
        return findings_in(handle.read())


def findings_in(raw):
    """Every reason these bytes should not be published, sorted.

    Split out from reading a file so the same needles reach the surfaces that
    are not files: a commit message, a branch name, a pull-request body.
    """
    hits = []

    def note(label):
        if label not in hits:
            hits.append(label)

    def scan(payload, suffix=""):
        # Matched case-insensitively: these are words, and capitalisation
        # carries no meaning in them.
        low = payload.lower()
        for needle in VENDOR:
            if needle in low:
                note(needle.decode() + suffix)
        # The namespace needle is FOUR bytes, and four bytes over base64's
        # alphabet collide by chance: on 2026-09-11 it refused an npm lockfile
        # whose only crime was a sha512- integrity hash containing those four
        # characters. One such collision exists across every branch of the nine
        # repositories today, which reads as a freak and is in fact a rate.
        #
        # So it is recognised only where a manifest actually puts it: as a
        # declared XML namespace, or as a namespace-qualified name. This is the
        # same treatment the PNG chunk types already get, and for the same
        # stated reason -- their four letters are ordinary words, so they are
        # matched at a real boundary rather than anywhere in the bytes.
        for needle in NAMESPACE:
            if b"xmlns:" + needle in low or needle + b":" in low:
                note(needle.decode() + suffix)

    scan(raw)

    for run in B64_RUN.findall(raw):
        padded = run + b"=" * (-len(run) % 4)
        try:
            decoded = base64.b64decode(padded, validate=False)
        except Exception:  # noqa: S112 - a run that will not decode is simply
            # not base64. That is the common case, not an error worth logging:
            # every long alphanumeric token in the tree reaches this line.
            continue
        scan(decoded, " (base64)")

    for kind, body in png_chunks(raw):
        if kind in FORBIDDEN_CHUNKS:
            note(kind.decode() + " chunk")
        if kind in COMPRESSED_CHUNKS:
            blob = inflate(body)
            if blob is not None:
                scan(blob, " (compressed chunk)")

    return sorted(set(hits))


def path_findings(rel):
    """Findings in the repo-relative PATH itself, directory components included.

    A file whose NAME is the marker publishes it as loudly as one whose contents
    do, and a scan of contents alone cannot see it -- which is exactly the shape
    of the artefact the rule names first.
    """
    low = rel.lower().encode("utf-8", "surrogateescape")
    return [n.decode() + " (in the path)" for n in VENDOR if n in low]


USAGE = (
    "usage: check-vendor-attribution.py [ROOT]\n"
    "       check-vendor-attribution.py --text LABEL [--allow-empty] < surface"
)


def scan_text(label, allow_empty):
    """Check one non-file surface, read as bytes from stdin.

    The LABEL is the only thing in the output that says which surface failed,
    so the caller names it: nothing here can work out whether these bytes were
    a branch name or a release note.
    """
    raw = sys.stdin.buffer.read().strip()

    # Every message below puts the label in a prepositional phrase rather than
    # making it the subject. Labels are both singular and plural -- "branch
    # name", "commit messages on this branch" -- and a sentence built around
    # one of them disagrees with the other half of the time.
    if not raw:
        if allow_empty:
            # Declared absent-by-default, so this is the ordinary case and not
            # a result worth dressing up as a pass. Said out loud all the same,
            # because a surface that is empty EVERY time is a broken expression
            # and the log is where that shows.
            print(f"nothing to scan: no {label} on this event")
            return 0
        print(
            f"::error::nothing was scanned: the {label} arrived empty. This "
            f"surface is never legitimately empty, so the step that produced "
            f"it is wrong"
        )
        return 1

    hits = findings_in(raw)
    for hit in hits:
        print(f"::error::{hit} appears in the {label}")
    if hits:
        print(
            f"\nThis must not be published. Unlike a file, a surface cannot be "
            f"allowlisted: rewrite the {label}."
        )
        return 1
    print(f"no assistant attribution in the {label} ({len(raw)} bytes scanned)")
    return 0


def scan_tracked(root):
    allow = load_allowlist()
    # S603/S607 are suppressed rather than fixed, with reason: the argv is a
    # fixed list with no shell, and `root` is this script's own argument, not
    # untrusted input. Resolving an absolute path for `git` would break the
    # runners and developer machines that rely on PATH, which is every one.
    listing = subprocess.run(  # noqa: S603
        ["git", "-C", root, "ls-files", "-z"],  # noqa: S607
        capture_output=True,
        check=True,
    ).stdout
    bad = {}
    for blob in listing.split(b"\0"):
        if not blob:
            continue
        rel = blob.decode("utf-8", "surrogateescape")
        if rel in allow:
            continue
        hits = path_findings(rel)
        try:
            hits += findings(os.path.join(root, rel))
        except OSError as exc:
            # A tracked path that could not be read is not a path known to be
            # clean. Skipping it here reported a clean tree and exited 0 for a
            # file at mode 000 and for a dangling symlink alike.
            hits.append(f"could not be read ({exc.strerror})")
        if hits:
            bad[rel] = sorted(set(hits))

    for rel, hits in sorted(bad.items()):
        print(f"::error file={rel}::carries {', '.join(hits)}")
    if bad:
        print(
            f"\n{len(bad)} tracked files carry attribution or metadata that "
            f"should not be published."
        )
        print(
            "Strip it. The allowlist exempts a whole file from every needle, "
            "so it is a last resort, not a fix."
        )
        return 1
    print("no tracked file carries assistant attribution")
    return 0


def main():
    argv = sys.argv[1:]
    if "--text" not in argv:
        return scan_tracked(argv[0] if argv else ".")
    rest = [arg for arg in argv if arg not in ("--text", "--allow-empty")]
    if argv[0] != "--text" or len(rest) != 1:
        # A mangled invocation must not be able to read as a pass. The status
        # is distinct from a finding's, because "this step is miswired" and
        # "this surface is dirty" call for different repairs.
        print(USAGE)
        return 2
    return scan_text(rest[0], "--allow-empty" in argv)


if __name__ == "__main__":
    sys.exit(main())
