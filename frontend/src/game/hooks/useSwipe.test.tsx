import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSwipe } from "./useSwipe";

function SwipeTarget({ onMove }: { onMove: ReturnType<typeof vi.fn> }) {
  const handlers = useSwipe(onMove);
  return <div data-testid="target" {...handlers} />;
}

describe("useSwipe", () => {
  it("routes a captured pointer gesture", () => {
    const onMove = vi.fn();
    render(<SwipeTarget onMove={onMove} />);
    const target = screen.getByTestId("target");
    fireEvent.pointerDown(target, { pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(target, { pointerId: 7, clientX: 25, clientY: 105 });
    expect(onMove).toHaveBeenCalledWith("L");
  });

  it("clears cancelled gestures and ignores another pointer", () => {
    const onMove = vi.fn();
    render(<SwipeTarget onMove={onMove} />);
    const target = screen.getByTestId("target");
    fireEvent.pointerDown(target, { pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(target, { pointerId: 8, clientX: 10, clientY: 100 });
    fireEvent.pointerCancel(target, { pointerId: 7 });
    fireEvent.pointerUp(target, { pointerId: 7, clientX: 10, clientY: 100 });
    expect(onMove).not.toHaveBeenCalled();
  });
});
