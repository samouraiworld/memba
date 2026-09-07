import type { Alien, Rect } from "../engine";

/**
 * Original, tiny glyphs for Memba's signal-swarm fiction. They deliberately do
 * not trace the silhouettes from the 1978 cabinet: every row is its own
 * antenna, relay, prism, knot, or crawler assembled on an 8x6 pixel grid.
 */
export const ALIEN_GLYPHS = [
  ["...##...", ".######.", "##.##.##", ".######.", "..####..", ".#....#."],
  [".#....#.", "..####..", ".##..##.", "###..###", ".######.", "..#..#.."],
  ["...##...", ".##..##.", "########", "..####..", ".##..##.", "#..##..#"],
  ["..#..#..", ".######.", "##.##.##", "########", ".#....#.", "#.#..#.#"],
  ["#......#", ".######.", "##.##.##", ".######.", "..####..", "##....##"],
] as const;

const ALIEN_CORES = [
  ["........", "...##...", "...##...", "..#..#..", "........", "........"],
  ["........", "........", "..#..#..", "...##...", "........", "........"],
  ["........", "........", "...##...", "...##...", "........", "........"],
  ["........", "........", "...##...", "..#..#..", "........", "........"],
  ["........", "........", "..#..#..", "...##...", "........", "........"],
] as const;

const PLAYER_GLYPH = [
  ".....#.....",
  "...#####...",
  ".##.###.##.",
  "###########",
  "##.#####.##",
  "#..##.##..#",
] as const;

const PLAYER_CORE = [
  "...........",
  ".....#.....",
  "....###....",
  "...#####...",
  "....###....",
  "...#...#...",
] as const;

const UFO_GLYPH = [
  ".....##.....",
  "..########..",
  "###.#..#.###",
  ".##########.",
  "...##..##...",
] as const;

const UFO_CORE = [
  "............",
  ".....##.....",
  "....#..#....",
  "...######...",
  "............",
] as const;

type Glyph = readonly string[];

function paintGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: Glyph,
  bounds: Rect,
  color: string,
  dx = 0,
  dy = 0,
): void {
  const columns = glyph[0]?.length ?? 1;
  const cellW = bounds.w / columns;
  const cellH = bounds.h / glyph.length;
  ctx.fillStyle = color;
  for (let row = 0; row < glyph.length; row++) {
    const line = glyph[row];
    for (let col = 0; col < columns; col++) {
      if (line[col] === "#") {
        ctx.fillRect(bounds.x + col * cellW + dx, bounds.y + row * cellH + dy, cellW, cellH);
      }
    }
  }
}

export function drawAlienGlyph(
  ctx: CanvasRenderingContext2D,
  alien: Alien,
  body: string,
  core: string,
  energized: boolean,
): void {
  const row = Math.max(0, Math.min(ALIEN_GLYPHS.length - 1, alien.row));
  if (energized) {
    ctx.globalAlpha = 0.22;
    paintGlyph(ctx, ALIEN_GLYPHS[row], alien, core, 0, 1);
    ctx.globalAlpha = 1;
  }
  paintGlyph(ctx, ALIEN_GLYPHS[row], alien, body);
  paintGlyph(ctx, ALIEN_CORES[row], alien, core);
}

export function drawPlayerGlyph(
  ctx: CanvasRenderingContext2D,
  player: Rect,
  body: string,
  core: string,
): void {
  paintGlyph(ctx, PLAYER_GLYPH, player, body);
  paintGlyph(ctx, PLAYER_CORE, player, core);
}

export function drawUfoGlyph(
  ctx: CanvasRenderingContext2D,
  ufo: Rect,
  body: string,
  core: string,
): void {
  paintGlyph(ctx, UFO_GLYPH, ufo, body);
  paintGlyph(ctx, UFO_CORE, ufo, core);
}
