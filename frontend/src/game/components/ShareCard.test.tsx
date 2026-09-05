import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareCard } from "./ShareCard";

const props = {
  kind: "daily" as const,
  date: "2026-07-06",
  board: new Array(16).fill(0),
  streak: 2,
  modifier: "standard",
};

describe("ShareCard", () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, "share", { value: originalShare, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  });

  it("does not copy after the player cancels the platform share sheet", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const writeText = vi.fn();
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShareCard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /share result/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("announces when neither native sharing nor clipboard access is available", async () => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<ShareCard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /share result/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/sharing is unavailable/i);
  });
});
