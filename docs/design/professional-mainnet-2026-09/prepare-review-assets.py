"""Strip nonvisual PNG metadata from this slice's publishable review assets.

Pixel and color chunks are preserved byte-for-byte. Run after copying browser
screenshots or generated PNG renditions, before the repository attribution check.
"""
from pathlib import Path
import struct
ROOT = Path(__file__).resolve().parents[3]
FORBIDDEN = {b'eXIf', b'iTXt', b'tEXt', b'zTXt', b'dSIG', b'caBX'}
files = list((ROOT / 'frontend/public/brand/folded-m').glob('*.png'))
files += list((Path(__file__).parent / 'assets').glob('shell-*.png'))
files += list((Path(__file__).parent / 'assets').glob('folded-m-*.png'))
files += list((Path(__file__).parent / 'assets').glob('governance-*.png'))
files += list((Path(__file__).parent / 'assets').glob('proposal-*.png'))
for path in files:
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'Not a PNG: {path}')
    out, pos = bytearray(data[:8]), 8
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos+4])[0]
        end = pos + size + 12
        if end > len(data):
            raise ValueError(f'Truncated PNG: {path}')
        if data[pos+4:pos+8] not in FORBIDDEN:
            out.extend(data[pos:end])
        pos = end
    if out != data:
        path.write_bytes(out)
        print(path.relative_to(ROOT))
