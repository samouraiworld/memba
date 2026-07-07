import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Board } from "./Board";

describe("Board", () => {
  it("renders 16 cells and shows tile values", () => {
    const board = [2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2048];
    render(<Board board={board} onMove={vi.fn()} />);
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.getByText("2048")).toBeTruthy();
    expect(screen.getByText("Gno Guardian")).toBeTruthy();
  });
});
