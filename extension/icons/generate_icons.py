"""Generate original DualLens PNG icons using only the Python standard library."""
from pathlib import Path
import struct
import zlib

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

def icon(size):
    scale = 4
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            total = [0, 0, 0, 0]
            for sy in range(scale):
                for sx in range(scale):
                    u = (x + (sx + .5) / scale) / size
                    v = (y + (sy + .5) / scale) / size
                    # Rounded navy square, two overlapping lenses and a shared light crescent.
                    corner = max(abs(u - .5) - .32, 0) ** 2 + max(abs(v - .5) - .32, 0) ** 2
                    color = [23, 34, 56, 255] if corner <= .15 ** 2 else [0, 0, 0, 0]
                    a = (u - .39) ** 2 + (v - .39) ** 2 < .245 ** 2
                    b = (u - .61) ** 2 + (v - .61) ** 2 < .245 ** 2
                    if a: color = [67, 104, 238, 255]
                    if b: color = [32, 196, 169, 255]
                    if a and b: color = [208, 249, 244, 255]
                    for i, c in enumerate(color): total[i] += c
            rows.extend(round(v / scale ** 2) for v in total)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")

if __name__ == "__main__":
    for size in [16, 32, 48, 128]:
        Path(__file__).with_name(f"{size}.png").write_bytes(icon(size))
    print("Generated original 16, 32, 48, 128 PNG icons")
