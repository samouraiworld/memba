/**
 * Tests for useKeyboard — the game's window-level arrow listener.
 *
 * It listens on `window` with no target filter, so before the mode tablist got
 * keyboard support this was invisible: arrows anywhere on the page moved a
 * piece. Once the tabs handle Left/Right themselves, an unfiltered listener
 * would DOUBLE-handle the same keypress — switch the mode AND move a piece.
 * The filter (ignore events originating from interactive controls) is what
 * these tests pin; the board itself is a div[role="grid"], so play must keep
 * working from it and from the page body.
 */
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useKeyboard } from "./useKeyboard";
import type { Move } from "../engine";

function Harness({ onMove, enabled = true }: { onMove: (m: Move) => void; enabled?: boolean }) {
  useKeyboard(onMove, enabled);
  return (
    <div>
      <button data-testid="a-tab">Practice</button>
      <input data-testid="an-input" />
      <div role="grid" tabIndex={0} data-testid="board" />
    </div>
  );
}

describe("useKeyboard", () => {
  it("maps arrows to moves when pressed on the board", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);

    fireEvent.keyDown(screen.getByTestId("board"), { key: "ArrowRight" });
    expect(onMove).toHaveBeenLastCalledWith("R");
    fireEvent.keyDown(screen.getByTestId("board"), { key: "ArrowUp" });
    expect(onMove).toHaveBeenLastCalledWith("U");
  });

  it("maps arrows to moves when pressed on the page body", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onMove).toHaveBeenLastCalledWith("L");
  });

  it("ignores arrows originating from interactive controls (the mode tablist case)", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);

    // A Left/Right on the tab buttons belongs to the tablist; handling it here
    // too would switch the mode AND move a piece on the same keypress.
    fireEvent.keyDown(screen.getByTestId("a-tab"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByTestId("an-input"), { key: "ArrowLeft" });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores non-arrow keys and does nothing when disabled", () => {
    const onMove = vi.fn();
    const { rerender } = render(<Harness onMove={onMove} enabled={false} />);

    fireEvent.keyDown(screen.getByTestId("board"), { key: "ArrowRight" });
    expect(onMove).not.toHaveBeenCalled();

    rerender(<Harness onMove={onMove} enabled />);
    fireEvent.keyDown(screen.getByTestId("board"), { key: "Enter" });
    expect(onMove).not.toHaveBeenCalled();
  });
});
