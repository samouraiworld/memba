import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Board } from "./Board";
import { initGame, step, type GameState, type Move } from "../engine";

function tileNodes(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".k-bp-tile-pos"));
}

function tileAt(container: HTMLElement, index: number) {
  const row = String(Math.floor(index / 4));
  const col = String(index % 4);
  return tileNodes(container).find((node) =>
    node.dataset.kind !== "consumed" &&
    node.style.getPropertyValue("--bp-row") === row &&
    node.style.getPropertyValue("--bp-col") === col);
}

describe("Board", () => {
  it("renders 16 cells and shows tile values", () => {
    const board = [2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2048];
    render(<Board board={board} onMove={vi.fn()} />);
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.getAllByRole("gridcell")).toHaveLength(16);
    expect(screen.getByRole("gridcell", { name: /row 1, column 3, empty/i })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: /row 4, column 4, 2048, Gno Guardian milestone/i })).toBeTruthy();
    expect(screen.getByText("2048")).toBeTruthy();
    expect(screen.getByText("Gno Guardian")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(/row 1: 2, 4, empty, empty/i);
  });

  it("routes a focused-board arrow key exactly once", () => {
    const onMove = vi.fn();
    render(<Board board={new Array(16).fill(0)} onMove={onMove} />);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowLeft" });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("L");
  });

  it("exposes a verified-state lock without promising inert controls", () => {
    const onMove = vi.fn();
    render(<Board board={new Array(16).fill(0)} onMove={onMove} disabled />);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-disabled", "true");
    expect(grid).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText(/daily input is locked/i)).toBeTruthy();
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("slides the same tile elements instead of remounting every changed cell", () => {
    const moves: Move[] = ["L", "U", "R", "D"];
    let state: GameState = initGame(4242, "standard");
    let log = "";
    const { container, rerender } = render(<Board board={state.board} moveLog={log} onMove={vi.fn()} />);
    const before = new Map(state.board.flatMap((value, index) => (value ? [[index, tileAt(container, index)]] : [])));
    let move: Move | undefined;
    let next = state;
    for (const m of moves) {
      next = step(state, m);
      if (next !== state) { move = m; break; }
    }
    expect(move).toBeDefined();
    log += move;
    state = next;
    rerender(<Board board={state.board} moveLog={log} onMove={vi.fn()} />);

    // The accessible grid is always the authoritative board.
    const labels = screen.getAllByRole("gridcell").map((cell) => cell.getAttribute("aria-label"));
    state.board.forEach((value, index) => {
      expect(labels[index]).toMatch(value ? new RegExp(`, ${value}(,|$)`) : /empty$/);
    });
    // Every visible tile maps onto the new board, and at least one old tile
    // element survived the move (identity kept, so CSS can slide it).
    const live = tileNodes(container).filter((node) => node.dataset.kind !== "consumed");
    expect(live).toHaveLength(state.board.filter(Boolean).length);
    expect(live.filter((node) => node.dataset.kind === "spawned")).toHaveLength(1);
    const survivors = [...before.values()].filter((node) => node && node.isConnected);
    expect(survivors.length).toBeGreaterThan(0);
    expect(container.querySelector(".k-bp-tile-layer")).toHaveAttribute("aria-hidden", "true");
  });

  it("re-lays a new round without history", () => {
    const first = initGame(1, "standard").board;
    const second = initGame(2, "standard").board;
    const { container, rerender } = render(<Board board={first} moveLog="" onMove={vi.fn()} />);
    const old = tileNodes(container);
    rerender(<Board board={second} moveLog="" onMove={vi.fn()} />);
    const fresh = tileNodes(container);
    expect(fresh).toHaveLength(second.filter(Boolean).length);
    expect(fresh.every((node) => node.dataset.kind === "spawned" && !old.includes(node))).toBe(true);
  });
});
