"""Regenerate outlined lockups/share artwork. Authoring only: Python fonttools[woff]."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'frontend/public/brand/folded-m'
font = TTFont(ROOT / 'frontend/public/fonts/inter-latin-600-normal.woff2')
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
def text_paths(text, x, y, size, color):
    scale = size / font['head'].unitsPerEm
    parts = []
    for char in text:
        glyph = glyphs[cmap[ord(char)]]
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        parts.append(f'<path transform="translate({x:.3f} {y}) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
        x += glyph.width * scale
    return f'<g fill="{color}">' + ''.join(parts) + '</g>'
shape = 'M0 0 56 45 112 0V100H87V50L56 79 25 50V100H0Z'
def mark(x, y, scale, color='#00d4aa', facets=True):
    extra = '<path d="M0 0 56 45V79L25 50 0 29Z" fill="#009d80"/><path d="M56 45 112 0 87 50 56 79Z" fill="#54ebcb"/>' if facets else ''
    return f'<g transform="translate({x} {y}) scale({scale})"><path d="{shape}" fill="{color}"/>{extra}</g>'
for name, color in [('lockup-black', '#000'), ('lockup-white', '#fff')]:
    content = mark(16, 17, .5, color, False) + text_paths('Memba', 92, 65, 56, color)
    (OUT / f'{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 310 84">{content}</svg>\n')
# Share copy is factual, no claims about custody, security audits or deployment readiness.
content = '<rect width="1200" height="630" fill="#000"/>' + mark(80, 70, .65)
content += text_paths('Memba', 183, 131, 62, '#fff')
content += text_paths('Govern together.', 80, 326, 76, '#fff')
content += text_paths('Build on gno.land.', 80, 420, 76, '#fff')
content += '<path d="M80 511H1120" stroke="#303735"/>'
content += text_paths('memba.samourai.app', 80, 559, 24, '#adb5b2')
(OUT / 'share.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">{content}</svg>\n')
