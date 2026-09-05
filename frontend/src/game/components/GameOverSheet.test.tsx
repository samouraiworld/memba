import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { GameOverSheet } from "./GameOverSheet";
import { gameApi } from "../../lib/gameApi";
import { SubmitScoreResponseSchema, TokenSchema } from "../../gen/memba/v1/memba_pb";

vi.mock("../../lib/gameApi", () => ({ gameApi: { submitScore: vi.fn() } }));

const baseProps = {
  date: "2026-07-06", score: 1200, par: 1500, moveLog: "URDL", board: new Array(16).fill(0),
  modifier: "standard",
};

describe("GameOverSheet", () => {
  beforeEach(() => {
    vi.mocked(gameApi.submitScore).mockReset();
  });

  it("guest without Adena sees a desktop note, still can share, never a broken Connect", () => {
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: false, connect: vi.fn() }}
      auth={{ isAuthenticated: false }} />);
    expect(screen.getByRole("button", { name: /share/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^connect/i })).toBeNull();
    expect(screen.getByText(/adena extension/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /round complete/i })).toHaveFocus();
  });

  it("authenticated: submits (token, date, moveLog) exactly once — never a score — and shows the percentile", async () => {
    const submit = vi.mocked(gameApi.submitScore);
    submit.mockResolvedValue(
      create(SubmitScoreResponseSchema, {
        score: 1200n,
        percentile: 88,
        par: 1500n,
        streak: { current: 3, longest: 3, freezesRemaining: 1 },
      }),
    );
    const token = create(TokenSchema, { nonce: "n", userAddress: "g1me", expiration: "", serverSignature: "s" });
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: true, connect: vi.fn() }}
      auth={{ isAuthenticated: true, token }} />);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(token, baseProps.date, baseProps.moveLog); // token, date, moveLog — no score arg
    await screen.findByText(/88%/);
    expect(screen.getByText(/first verified replay today/i)).toBeTruthy();
  });

  it("Share button actually shares: falls back to clipboard with the real result text", async () => {
    const originalShare = (navigator as unknown as { share?: unknown }).share;
    // Ensure navigator.share is undefined so the clipboard fallback path is taken.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<GameOverSheet {...baseProps}
      wallet={{ installed: false, connect: vi.fn() }}
      auth={{ isAuthenticated: false }} />);

    screen.getByRole("button", { name: /share/i }).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const shared = writeText.mock.calls[0][0] as string;
    expect(shared).toMatch(/Block Party result/i);
    expect(shared).toMatch(/\?result=2026-07-06/i);
    expect(shared).toMatch(/🔥1/);

    Object.defineProperty(navigator, "share", { value: originalShare, configurable: true });
  });

  it("shows an explicit failed state and can retry the same replay", async () => {
    const submit = vi.mocked(gameApi.submitScore);
    submit
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce(create(SubmitScoreResponseSchema, {
        score: 1200n,
        percentile: 61,
        par: 1500n,
        streak: { current: 2, longest: 2, freezesRemaining: 1 },
      }));
    const token = create(TokenSchema, { nonce: "n", userAddress: "g1me", expiration: "", serverSignature: "s" });
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: true, connect: vi.fn() }}
      auth={{ isAuthenticated: true, token }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't verify this replay/i);
    fireEvent.click(screen.getByRole("button", { name: /retry verification/i }));
    expect(await screen.findByText(/replay verified/i)).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith(token, baseProps.date, baseProps.moveLog);
  });

  it("explains a different accepted first replay without offering a futile retry", async () => {
    const submit = vi.mocked(gameApi.submitScore);
    submit.mockRejectedValue(new ConnectError("score already submitted", Code.AlreadyExists));
    const token = create(TokenSchema, { nonce: "n", userAddress: "g1me", expiration: "", serverSignature: "s" });
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: true, connect: vi.fn() }}
      auth={{ isAuthenticated: true, token }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/different replay was already accepted/i);
    expect(screen.queryByRole("button", { name: /retry verification/i })).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("omits unreachable target comparisons when no calibrated target is supplied", () => {
    render(<GameOverSheet {...baseProps} par={undefined}
      wallet={{ installed: false, connect: vi.fn() }}
      auth={{ isAuthenticated: false }} />);
    expect(screen.queryByText(/vs (par|target)/i)).toBeNull();
  });
});

// The error-path page can render the sheet with an EMPTY date (challenge never
// loaded). It must be inert then: no blank-date submit (the server rejects it
// anyway) and no `lastDate: ""` corruption of the local streak.
describe("GameOverSheet with an empty date", () => {
  it("neither auto-submits nor bumps the local streak", async () => {
    localStorage.clear();
    const submit = vi.mocked(gameApi.submitScore);
    submit.mockClear();
    const token = create(TokenSchema, { nonce: "n", userAddress: "g1me", expiration: "", serverSignature: "s" });
    render(<GameOverSheet {...baseProps} date=""
      wallet={{ installed: true, connect: vi.fn() }}
      auth={{ isAuthenticated: true, token }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem("bp:streak")).toBeNull();
    expect(localStorage.getItem("bp:best:")).toBeNull();
  });
});
