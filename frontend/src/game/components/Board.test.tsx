import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Board } from "./Board";

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
});
