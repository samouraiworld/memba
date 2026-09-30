"""Remove nonvisual metadata from audit PNGs without changing pixel/color chunks."""
from pathlib import Path
import struct
for path in (Path(__file__).parent / 'assets').glob('*.png'):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'Not a PNG: {path}')
    out, pos = bytearray(data[:8]), 8
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos+4])[0]
        end = pos + size + 12
        if end > len(data):
            raise ValueError(f'Truncated PNG: {path}')
        if data[pos+4:pos+8] not in {b'eXIf', b'iTXt', b'tEXt', b'zTXt', b'dSIG', b'caBX'}:
            out.extend(data[pos:end])
        pos = end
    if out != data:
        path.write_bytes(out)
        print(path.name)
