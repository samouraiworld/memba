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
and inflates compressed PNG chunks, wherever a PNG sits in a file. What it
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
#
# Rollout note: the stock create-next-app `favicon.ico` carries an exif chunk,
# so a repository scaffolded from it fails this policy until the icon is
# re-exported without it. That failure is by design: the chunk is metadata a
# design asset has no reason to publish.
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
# byte read into a stream or inflated out of one counts, whether it is kept or
# not, and a file that runs out is reported, for the same reason as a chunk
# over the cap.
INFLATE_BUDGET = 64 << 20

# Inflated a slice at a time, at most this much, so that a stream abandoned
# partway, because it raised or stopped short of its end, is still charged for
# what it read and produced.
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

# Registered chunk types that never hold a zlib stream. Any other chunk that
# begins with a valid zlib header and gives nothing when inflated is reported,
# as a profile that does not inflate is; these are exempt because their first
# bytes are numbers, a palette colour for one, and two of them form a valid
# header by chance about once in two thousand. A private chunk is also read as
# a bare deflate stream, with no zlib header at all; these are not.
PLAIN_CHUNKS = (
    b"IHDR", b"PLTE", b"IEND", b"tRNS", b"cHRM", b"gAMA", b"sBIT", b"sRGB",
    b"cICP", b"mDCV", b"cLLI", b"bKGD", b"hIST", b"pHYs", b"sPLT", b"tIME",
    b"acTL", b"fcTL", b"oFFs", b"pCAL", b"sCAL", b"sTER", b"gIFg", b"gIFx",
    *FORBIDDEN_CHUNKS,
)

# Input is fed to zlib in slices that start small and double, so a stream that
# fails early costs little, and a stream that fails late loses only the slice
# the fault is in -- which is then replayed in halves, to keep every byte of
# output the stream gave before its fault.
INFLATE_FIRST_SLICE = 64

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
    """Yield (type, start, end) for each chunk of every PNG anywhere in RAW.

    A PNG is found by its signature wherever it sits: at the start of a file,
    as an image in an icon, an .icns or a cursor, appended to another file, or
    inside another PNG's chunk. Each is walked to its end over the whole buffer
    rather than over a slice a directory declared, so a directory entry cannot
    cut an image short. A chunk offset already walked is not walked again: two
    walks that reach the same offset go the same way from there, so every
    offset is visited once however the signatures overlap.
    """
    walked = set()
    at = raw.find(PNG_SIGNATURE)
    while at >= 0:
        offset = at + len(PNG_SIGNATURE)
        while offset + 8 <= len(raw) and offset not in walked:
            walked.add(offset)
            length = int.from_bytes(raw[offset : offset + 4], "big")
            kind = raw[offset + 4 : offset + 8]
            # A chunk type is four ASCII letters. Anything else is not a PNG,
            # or a walk that has left one: a copy of the signature in prose
            # or in a binary, which is not worth reading as chunks.
            if not kind.isalpha():
                break
            yield kind, offset + 8, min(offset + 8 + length, len(raw))
            if kind == b"IEND":
                break
            offset += 12 + length
        at = raw.find(PNG_SIGNATURE, at + 1)

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


def zlib_header(view, at):
    """Whether VIEW holds a valid zlib header at AT: deflate, with no preset
    dictionary, and a check value that divides as the format requires."""
    if at + 2 > len(view):
        return False
    method, flags = view[at], view[at + 1]
    return method & 0x0F == 8 and method >> 4 <= 7 and not flags & 0x20 and (
        (method << 8 | flags) % 31 == 0
    )


def deflate_start(view, at):
    """Whether a bare deflate stream can begin at AT: its first block is not
    of the reserved type, and a stored block's length matches its complement.
    Half of all bytes fail this at once, and a run of anything else, a PNG
    signature among them, is not worth decompressing to find that out."""
    if at + 5 > len(view):
        return at < len(view)
    block = view[at] >> 1 & 3
    if block == 3:
        return False
    return block != 0 or (
        view[at + 1] ^ view[at + 3] == 0xFF and view[at + 2] ^ view[at + 4] == 0xFF
    )


def inflate_starts(kind, view):
    """Where a stream may begin in a chunk's payload: (offset, wbits, claimed).

    A zlib stream is tried only where a valid zlib header is, past up to four
    bytes of flags and empty fields after the keyword, and for a chunk other
    than the compressed ones, at the start of the payload too: a private chunk
    need not have a keyword. CLAIMED marks the two places where a header means
    the chunk holds a stream, so that nothing coming out of it is a finding:
    the start of the payload, and past a keyword and a method byte, as in a
    compressed text chunk. A private chunk is also tried as bare deflate.
    """
    # A keyword is 1 to 79 bytes, so its NUL is in the first 80: looking no
    # further keeps this constant however long the payload.
    nul = bytes(view[:80]).find(b"\0")
    tail = [] if nul < 0 else [nul + 1 + skip for skip in range(5)]
    private = kind not in PLAIN_CHUNKS and kind not in COMPRESSED_CHUNKS
    places = tail if kind in COMPRESSED_CHUNKS else [*range(5), *tail]
    starts = []
    for at in dict.fromkeys(places):
        if zlib_header(view, at):
            claimed = private and (at == 0 or tail[1:2] == [at])
            starts.append((at, zlib.MAX_WBITS, claimed))
    if private and deflate_start(view, 0):
        starts.append((0, -zlib.MAX_WBITS, False))
    return starts


def replay(state, piece, room):
    """The output STATE gives from PIECE before the byte where it fails.

    Halving the piece, the half that fails is narrowed and the half that does
    not is kept, so at most twice the piece is decompressed.
    """
    out = bytearray()
    while piece and room > 0:
        trial = state.copy()
        half = piece[: max(1, len(piece) // 2)]
        try:
            got = trial.decompress(half, room)
        except zlib.error:
            if len(half) == len(piece):
                break
            piece = half
            continue
        out += got
        room -= len(got)
        state = trial
        piece = piece[len(half) :]
        if trial.eof:
            break
    return bytes(out)


def stream(view, at, wbits, room):
    """Inflate one stream from AT: (bytes, reached its end, bytes charged).

    Every byte in and out is charged, input as well as output: a run of empty
    blocks gives nothing and yet takes time to read. Stops once the charge
    passes ROOM.
    """
    state = zlib.decompressobj(wbits)
    blob, spent, size = bytearray(), 0, INFLATE_FIRST_SLICE
    while at < len(view) and not state.eof and spent <= room:
        piece = view[at : at + size]
        left = room + 1 - spent
        saved = state.copy() if blob or spent else None
        try:
            step = state.decompress(piece, left)
        except zlib.error:
            got = replay(saved or zlib.decompressobj(wbits), piece, left)
            blob += got
            spent += len(piece) + len(got)
            break
        used = len(piece) - len(state.unconsumed_tail)
        blob += step
        spent += used + len(step)
        if not used and not step:
            break
        at += used
        size = min(size * 2, INFLATE_STEP)
    return bytes(blob), state.eof, spent


def inflate(kind, view, limit=MAX_INFLATE):
    """Decompress a chunk payload: (bytes, state, spent, claimed).

    A name inside one of these is neither readable text nor base64, so it
    would otherwise pass both of the other scans. The first stream to inflate
    to its end wins: STATE is "whole". A charge past LIMIT makes the state
    "over", with what came out by then. When no stream reaches its end,
    because it is cut short or corrupt, the longest output any of them gave is
    returned as "partial": what a stream holds before it breaks is still
    published. A zlib stream that fails is tried again as the bare deflate
    inside it, two bytes in, which reads past a bad checksum at its end. With
    no output at all, the bytes are None, and CLAIMED says whether a header
    promised some. `spent` counts every byte read and inflated, from abandoned
    streams too, so that a caller can hold every chunk in a file to one budget.
    """
    spent, longest, claimed = 0, b"", kind in MUST_INFLATE
    for at, wbits, claims in inflate_starts(kind, view):
        claimed = claimed or claims
        tries = [(at, wbits)]
        if wbits > 0 and deflate_start(view, at + 2):
            tries.append((at + 2, -zlib.MAX_WBITS))
        for start, bits in tries:
            blob, whole, cost = stream(view, start, bits, limit - spent)
            spent += cost
            if spent > limit:
                return max(blob, longest, key=len), "over", spent, claimed
            if whole:
                return blob, "whole", spent, claimed
            if len(blob) > len(longest):
                longest = blob
    if longest:
        return longest, "partial", spent, claimed
    return None, None, spent, claimed

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
        # Rewritten before the split, not after: B64_PADDING looks for the
        # standard alphabet after a `key=`, and a URL-safe value that starts
        # with `-` or `_` would otherwise stay glued to its key.
        run = run.translate(B64URL_TO_STD)
        for part in (run, *B64_PADDING.split(run)[1:]):
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

        view = memoryview(payload)
        for kind, start, end in png_chunks(payload):
            chunk(kind, view[start:end], suffix, via, opened)

    def chunk(kind, body, suffix, via, opened):
        if kind in FORBIDDEN_CHUNKS:
            note(kind.decode() + " chunk" + suffix)
        if not opened or kind in IMAGE_DATA:
            return
        if budget[0] <= 0:
            note("inflate budget exceeded")
            return
        limit = min(MAX_INFLATE, budget[0])
        blob, state, spent, claimed = inflate(kind, body, limit)
        budget[0] -= spent
        if blob is None:
            if claimed:
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
