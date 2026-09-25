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

So this reads every tracked file as bytes, decodes base64 runs in either
alphabet, whether on one line or wrapped across several, reads UTF-16 text,
and inflates compressed PNG chunks, in a PNG file or in an icon. What it
decodes or inflates is read again the same way, because a data URI is a file
inside a file: a PNG in an SVG carries its chunks as surely as the PNG does on
its own.

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
B64_FLOOR = 40

# The URL-safe alphabet (RFC 4648 section 5) writes `-` and `_` where the
# standard one writes `+` and `/`: tokens, JWT segments, data in a URL. A run is
# taken over both alphabets at once, one search rather than two, and then cut
# into the pieces of each: the standard pieces are exactly the runs a search
# over the standard alphabet alone would find.
B64_RUN = re.compile(rb"[A-Za-z0-9+/_=-]{%d,}" % B64_FLOOR)
B64_STD_PIECES = re.compile(rb"[-_]+")
B64_URL_PIECES = re.compile(rb"[+/]+")
B64URL_TO_STD = bytes.maketrans(b"-_", b"+/")

# Base64 as encoders emit it: wrapped at 76 columns (`base64`, MIME) or 64
# (PEM), with LF or CRLF line ends, indented inside a YAML block, or broken by
# the escaped line ends of a JSON string. B64_RUN sees each line as a run of its
# own, so a short last line falls under the floor and a name across a line
# break is split between two decodes. This matches the run that ends one line,
# every following line that is nothing but the alphabet, and the run that
# starts the line after those; the pieces are joined before decoding.
#
# A line break may also be escaped (a YAML double-quoted scalar or a shell
# command continued with a backslash), and the next line may open with a
# comment marker: `#`, ` * ` inside a block comment, or `// ` followed by a
# blank. The slashes are in the alphabet, so they count as a marker only when
# a blank follows them, which no line of base64 contains. Without that, a
# block held in a comment is read line by line, and at a width that is not a
# multiple of four every line after the first is out of step. Other markers
# (`--`, `;`, `%`) are not joined: that is a known limit, not an oversight.
#
# Linear time, whatever the input: a match can start only where the character
# before it is outside the alphabet, so each run is tried once, and every line
# break starts with a character outside the alphabet, so a failed attempt gives
# back at most the run it started on and the marker after one line break.
B64_BREAK = re.compile(
    rb"[ \t]*(?:\\?\r?\n|(?:\\r)?\\n)[ \t]*(?:(?:#|\*|//(?=[ \t]))[ \t]*)?"
)
B64_WRAPPED = re.compile(
    rb"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=]+(?:" + B64_BREAK.pattern + rb"[A-Za-z0-9+/=]+)+"
)

# Where one run of the alphabet holds more than one encoding: after the `=` of
# a `key=value` prefix, or after the padding of one blob with another written
# straight after it. B64_RUN takes `=` as part of the alphabet, so it keeps
# such a run whole, and decoding it whole puts everything after the `=` out of
# step with base64's four-character groups.
#
# Only from the first `=` of a run. Without the lookbehind, a long run of `=`
# that nothing follows is tried again from each of its characters, and each try
# reads to its end before failing: 80,000 of them held one file for half a
# minute. Anchored, each run is tried once, and the splits are the same.
B64_PADDING = re.compile(rb"(?<!=)=+(?=[A-Za-z0-9+/])")

# A run of UTF-16 text in the ASCII range: each character a printable byte and
# a NUL. The match starts at a NUL rather than at the character before it,
# which lets the search skip straight from one NUL to the next: started at a
# character class, it is twenty times slower on a binary, and binaries are
# where NULs are. Three characters after the NUL, and the one before it, is no
# longer than the shortest needle, and long enough that a binary seldom holds
# such a run by chance, so what is read again is text and not noise.
UTF16_RUN = re.compile(rb"\x00(?:[\t\n\r\x20-\x7e]\x00){3,}[\t\n\r\x20-\x7e]?")
UTF16_CHARS = frozenset(b"\t\n\r" + bytes(range(0x20, 0x7F)))

# Containers opened one inside another, and no deeper: an HTML page holding an
# SVG as a data URI, holding a PNG as a data URI, whose profile is compressed,
# is three. What sits deeper is still searched for the names, just not opened.
MAX_DEPTH = 3

# Inflation is the one step that makes a payload larger than the file it came
# from, so it is the one step that is capped. A chunk that inflates past the
# cap is reported: read in part and passed, it would be a place to hide a name.
MAX_INFLATE = 32 << 20

# ...and capped per file as well. A PNG may hold any number of chunks under
# the cap, and a data URI is opened again for each way its wrapped lines can be
# joined, so a small crafted file could otherwise hold CI for minutes. Every
# byte inflated counts, whether it is kept or not, and a file that runs out is
# reported, for the same reason as a chunk over the cap.
INFLATE_BUDGET = 64 << 20

# Inflated a step at a time, so that a stream abandoned partway, because it
# raised or stopped short of its end, is still charged for what it produced.
INFLATE_STEP = 1 << 20

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

# Of those, the two whose payload is always compressed. One that does not
# inflate at all hides whatever it holds, so it is reported. International text
# may be stored uncompressed, and is forbidden in any case.
MUST_INFLATE = (
    bytes.fromhex("7a545874"),  # compressed text
    bytes.fromhex("69434350"),  # colour profile
)

# Every other chunk, private ones included, is inflated too if it holds a zlib
# stream, at the start of its payload or after a keyword, because a private
# chunk is a place to put anything. Except the image data: it is compressed as
# a matter of course, and inflated it would spend a large image's whole budget
# on pixels.
IMAGE_DATA = (
    bytes.fromhex("49444154"),  # image data
    bytes.fromhex("66644154"),  # animation frame data
)

# An icon or cursor file is a directory of images, and each may be a whole PNG
# stored verbatim: a favicon carries chunks exactly as a PNG file does.
ICO_HEADERS = (b"\0\0\1\0", b"\0\0\2\0")

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


def ico_images(raw):
    """Each PNG stored in an icon or cursor file. Nothing if not one.

    Each image runs to the start of the next, so however many directory entries
    a file declares, and wherever they point, the images read are disjoint and
    their total is at most the file.
    """
    if raw[:4] not in ICO_HEADERS:
        return
    starts = set()
    for entry in range(int.from_bytes(raw[4:6], "little")):
        at = 6 + 16 * entry
        if at + 16 > len(raw):
            break
        start = int.from_bytes(raw[at + 12 : at + 16], "little")
        if raw.startswith(PNG_SIGNATURE, start):
            starts.add(start)
    order = sorted(starts)
    for at, start in enumerate(order):
        yield raw[start : order[at + 1] if at + 1 < len(order) else len(raw)]


def utf16_texts(payload):
    """Every run of UTF-16 text in PAYLOAD, with its NULs taken out.

    Whichever the byte order, and with or without a byte-order mark: read one
    byte in, big-endian text is little-endian text, so one pattern finds both.
    Wherever in a file the text sits, too: a font's name table, a resource in
    an executable, a script saved by an editor that writes UTF-16.
    """
    for match in UTF16_RUN.finditer(payload):
        start = match.start()
        # The character before the first NUL, when there is one: little-endian
        # text puts its first character there.
        lead = payload[start - 1 : start] if start else b""
        if lead and lead[0] not in UTF16_CHARS:
            lead = b""
        yield lead + match.group()[1::2]


def inflate_starts(kind, body):
    """Where a zlib stream may begin in a chunk's payload, in the order tried."""
    # Past the keyword, then past up to four bytes of flags and empty fields.
    _, _, tail = body.partition(b"\0")
    starts = [tail[start:] for start in range(min(len(tail), 4) + 1)]
    if kind not in COMPRESSED_CHUNKS:
        # A private chunk need not have a keyword at all.
        starts = [body[start:] for start in range(min(len(body), 4) + 1)] + starts
    return starts


def inflate(starts, limit=MAX_INFLATE):
    """Decompress a compressed chunk payload: (bytes, state, spent).

    A name inside one of these is neither readable text nor base64, so it
    would otherwise pass both of the other scans. STARTS are the offsets at
    which the stream may begin, and the first to inflate to the end of a stream
    wins: STATE is "whole". Past LIMIT, the state is "over" and the bytes are
    the first LIMIT. When no offset reaches the end, because the stream is cut
    short or corrupt, the longest output any of them gave is returned as
    "partial": what a stream holds before it breaks is still published, and a
    stream cut short after the name would otherwise hide it. With no output at
    all, the bytes are None. `spent` counts every byte inflated, from abandoned
    offsets too, so that a caller can hold every chunk in a file to one budget.
    """
    spent = 0
    longest = b""
    for tail in starts:
        stream = zlib.decompressobj()
        pending, blob = tail, bytearray()
        try:
            while not stream.eof and len(blob) <= limit:
                room = min(INFLATE_STEP, limit + 1 - len(blob))
                step = stream.decompress(pending, room)
                pending = stream.unconsumed_tail
                if not step:
                    break
                blob += step
                spent += len(step)
        except zlib.error:
            pass
        if len(blob) > limit:
            return bytes(blob[:limit]), "over", spent
        if stream.eof:
            return bytes(blob), "whole", spent
        if len(blob) > len(longest):
            longest = bytes(blob)
    return (longest, "partial", spent) if longest else (None, None, spent)


def b64decode(run):
    """Decode one run of the base64 alphabet, or return nothing."""
    try:
        return base64.b64decode(run + b"=" * (-len(run) % 4), validate=False)
    except Exception:  # noqa: BLE001 - a run that will not decode is simply
        # not base64. That is the common case, not an error worth logging:
        # every long alphanumeric token in the tree reaches this line.
        return None


def b64_runs(payload):
    """Every run of base64 worth decoding in PAYLOAD, one line or wrapped.

    Each is given once: the ways of reading a wrapped block overlap, and a
    run decoded twice is only time spent twice. URL-safe runs are given
    rewritten in the standard alphabet.
    """
    # A JSON string may escape every slash, and a backslash is outside the
    # alphabet: left in, it cuts the run at each slash the encoding contains.
    payload = payload.replace(b"\\/", b"/")
    runs, urlsafe = [], []
    for run in B64_RUN.findall(payload):
        if b"-" in run or b"_" in run:
            runs += B64_STD_PIECES.split(run)
            urlsafe += (p for p in B64_URL_PIECES.split(run) if b"-" in p or b"_" in p)
        else:
            runs.append(run)
    for match in B64_WRAPPED.finditer(payload):
        pieces = B64_BREAK.split(match.group())
        # From the first piece, and again from the first whole line: the first
        # piece is only the tail of its line, and when that line is prose
        # rather than a data URI's prefix, the tail puts every later line out
        # of step with base64's four-character groups.
        #
        # To the last piece, and again short of it, for the same reason at the
        # other end: the last piece is only the head of its line, and when that
        # line is prose, its first word is glued on. With no padding before it,
        # a word one character past a four-character group fails the decode,
        # and the whole block with it. The block may be followed by more than
        # one line holding a single word, each of which joins it, so up to
        # three of them are dropped: a fixed number of joins per block, however
        # many lines follow it.
        for start in (0, 1) if len(pieces) > 2 else (0,):
            for end in range(len(pieces), len(pieces) - 4, -1):
                # A single piece is a run B64_RUN has already found.
                if end - start > 1:
                    runs.append(b"".join(pieces[start:end]))
    seen = set()
    for run in runs:
        for part in (run, *B64_PADDING.split(run)[1:]):
            if len(part) >= B64_FLOOR and part not in seen:
                seen.add(part)
                yield part
    # `-` and `_` also join words (`some-name_with-parts`), so a word glued on
    # in front of a URL-safe blob puts it out of step. Each is decoded from
    # each of its first four characters, which covers a prefix of any length,
    # and cut to a length that decodes: a last character one past a
    # four-character group holds less than a byte, and would fail the decode.
    # Unwrapped only: wrapped URL-safe base64 is not something encoders emit.
    for run in urlsafe:
        for part in (run, *B64_PADDING.split(run)[1:]):
            part = part.translate(B64URL_TO_STD)
            for start in range(4):
                shifted = part[start:].rstrip(b"=")
                if len(shifted) % 4 == 1:
                    shifted = shifted[:-1]
                if len(shifted) >= B64_FLOOR and shifted not in seen:
                    seen.add(shifted)
                    yield shifted


def findings(path):
    with open(path, "rb") as handle:
        return findings_in(handle.read())


def findings_in(raw):
    """Every reason these bytes should not be published, sorted.

    Split out from reading a file so the same needles reach the surfaces that
    are not files: a commit message, a branch name, a pull-request body.
    """
    hits = []
    budget = [INFLATE_BUDGET]

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

    def examine(payload, via):
        # VIA names the containers PAYLOAD came out of, innermost first, and
        # every reason found in it says so: "(base64)", "(compressed chunk)",
        # "(compressed chunk in base64)" for a PNG profile in a data URI.
        suffix = f" ({' in '.join(via)})" if via else ""
        scan(payload, suffix)
        opened = len(via) < MAX_DEPTH

        if opened:
            for run in b64_runs(payload):
                decoded = b64decode(run)
                if decoded:
                    examine(decoded, ("base64", *via))

        # UTF-16 writes each character of a name as two bytes, one of them
        # NUL, so no needle matches it as it stands. Without a NUL there is
        # no UTF-16 to read.
        if b"\0" in payload:
            for text in utf16_texts(payload):
                examine(text, ("UTF-16", *via))

        for image in (payload, *ico_images(payload)):
            for kind, body in png_chunks(image):
                chunk(kind, body, suffix, via, opened)

    def chunk(kind, body, suffix, via, opened):
        if kind in FORBIDDEN_CHUNKS:
            note(kind.decode() + " chunk" + suffix)
        if not opened or kind in IMAGE_DATA:
            return
        if budget[0] <= 0:
            note("inflate budget exceeded")
            return
        limit = min(MAX_INFLATE, budget[0])
        blob, state, spent = inflate(inflate_starts(kind, body), limit)
        budget[0] -= spent
        if blob is None:
            if kind in MUST_INFLATE:
                note("compressed chunk does not inflate" + suffix)
            return
        if state == "over":
            if limit < MAX_INFLATE:
                note("inflate budget exceeded")
            else:
                note("compressed chunk too large to inflate" + suffix)
        examine(blob, ("compressed chunk", *via))

    examine(raw, ())

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
        ["git", "-C", root, "ls-files", "-z", "--stage"],  # noqa: S607
        capture_output=True,
        check=True,
    ).stdout
    bad = {}
    for entry in listing.split(b"\0"):
        if not entry:
            continue
        meta, _, blob = entry.partition(b"\t")
        rel = blob.decode("utf-8", "surrogateescape")
        if rel in allow:
            continue
        hits = path_findings(rel)
        # A submodule is a commit id in this tree, not a file: its contents are
        # published by its own repository, which runs its own check. Its path
        # is still a name this repository publishes, so it is scanned above.
        if meta.startswith(b"160000 "):
            if hits:
                bad[rel] = sorted(set(hits))
            continue
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
