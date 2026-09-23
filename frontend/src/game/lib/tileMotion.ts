/**
 * Presentation-only tile identity for Block Party.
 *
 * The engine works on plain value boards, which is what keeps it byte-identical
 * with the Go verifier. Sliding animation needs more: which tile went where,
 * which two tiles fused, and which cell received the new signal. This module
 * rebuilds that mapping from (previous tiles, move, next board) by replaying
 * the same slide rules over tile objects instead of numbers.
 *
 * It never feeds back into game state. If the replay ever disagrees with the
 * authoritative next board, the layout is rebuilt from that board with no
 * motion, so a desync can only cost an animation, never a wrong tile.
 */
import type { Move } from "../engine";

export type TileKind = "static" | "moved" | "merged" | "spawned" | "consumed";

export interface MotionTile {
  /** Stable identity across moves; the React key for the tile layer. */
  id: number;
  value: number;
  /** Row-major board index the tile sits on (or, for consumed tiles, slides into). */
  index: number;
  kind: TileKind;
}

export interface TileLayout {
  /** Sorted by id so DOM order never shuffles (moving nodes would cancel transitions). */
  tiles: MotionTile[];
  nextId: number;
}

/** Board indices of each line, leading edge (the side tiles travel toward) first. */
function lines(move: Move): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const line: number[] = [];
    for (let s = 0; s < 4; s++) {
      if (move === "L") line.push(k * 4 + s);
      else if (move === "R") line.push(k * 4 + (3 - s));
      else if (move === "U") line.push(s * 4 + k);
      else line.push((3 - s) * 4 + k);
    }
    out.push(line);
  }
  return out;
}

function byId(a: MotionTile, b: MotionTile): number {
  return a.id - b.id;
}

/** Fresh layout for a board with no known history (first paint, restart, resync). */
export function layoutFromBoard(board: readonly number[], nextId = 1, kind: "static" | "spawned" = "static"): TileLayout {
  const tiles: MotionTile[] = [];
  let id = nextId;
  for (let index = 0; index < 16; index++) {
    const value = board[index];
    if (value) tiles.push({ id: id++, value, index, kind });
  }
  return { tiles, nextId: id };
}

/** Live tiles only: consumed tiles are leftovers of the previous merge animation. */
export function liveTiles(layout: TileLayout): MotionTile[] {
  return layout.tiles.filter((tile) => tile.kind !== "consumed");
}

export function boardFromTiles(tiles: readonly MotionTile[]): number[] {
  const board = new Array<number>(16).fill(0);
  for (const tile of tiles) if (tile.kind !== "consumed") board[tile.index] = tile.value;
  return board;
}

/**
 * Slide the live tiles of `layout` toward `move` with 2048 rules: tiles pack
 * toward the leading edge, and each adjacent equal pair fuses once, nearest to
 * the edge first. Fused sources become `consumed` tiles that travel into the
 * merge cell; the result is a new `merged` tile with a fresh id.
 */
export function slideTiles(layout: TileLayout, move: Move): { tiles: MotionTile[]; board: number[]; gained: number; nextId: number } {
  const at = new Map<number, MotionTile>();
  for (const tile of liveTiles(layout)) at.set(tile.index, tile);

  const tiles: MotionTile[] = [];
  let nextId = layout.nextId;
  let gained = 0;

  for (const line of lines(move)) {
    const row = line.map((index) => at.get(index)).filter((tile): tile is MotionTile => tile !== undefined);
    let slot = 0;
    for (let i = 0; i < row.length; slot++) {
      const target = line[slot];
      const a = row[i];
      const b = row[i + 1];
      if (b && a.value === b.value) {
        const value = a.value * 2;
        tiles.push({ ...a, index: target, kind: "consumed" }, { ...b, index: target, kind: "consumed" });
        tiles.push({ id: nextId++, value, index: target, kind: "merged" });
        gained += value;
        i += 2;
      } else {
        tiles.push({ ...a, index: target, kind: a.index === target ? "static" : "moved" });
        i += 1;
      }
    }
  }

  tiles.sort(byId);
  return { tiles, board: boardFromTiles(tiles), gained, nextId };
}

/**
 * Advance the layout to `nextBoard`, the authoritative result of playing
 * `move`. `move` is null when the change is not a single known move (restart,
 * new round, batched updates): the board is then re-laid without history.
 */
export function advanceLayout(prev: TileLayout, move: Move | null, nextBoard: readonly number[]): TileLayout {
  const reset = () => layoutFromBoard(nextBoard, prev.nextId, "spawned");
  if (move === null) return reset();

  const slid = slideTiles(prev, move);
  let spawnAt = -1;
  for (let index = 0; index < 16; index++) {
    if (slid.board[index] === nextBoard[index]) continue;
    // Only one difference is legal: the empty cell that received the new tile.
    if (slid.board[index] !== 0 || spawnAt !== -1) return reset();
    spawnAt = index;
  }

  const tiles = slid.tiles.slice();
  let nextId = slid.nextId;
  if (spawnAt !== -1) tiles.push({ id: nextId++, value: nextBoard[spawnAt], index: spawnAt, kind: "spawned" });
  return { tiles, nextId };
}
