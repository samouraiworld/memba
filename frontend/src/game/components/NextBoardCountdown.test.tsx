import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextBoardCountdown } from "./NextBoardCountdown";

describe("NextBoardCountdown", () => {
  afterEach(() => vi.useRealTimers());

  it("ticks every second and gives screen readers a minute-precision sentence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 23, 20, 47, 30)));
    render(<NextBoardCountdown />);
    expect(screen.getByTestId("bp-next-clock")).toHaveTextContent("03:12:30");
    expect(screen.getByTestId("bp-next-clock")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/next daily board in 3 hours 12 minutes, at midnight utc/i)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("bp-next-clock")).toHaveTextContent("03:12:29");
  });
});
