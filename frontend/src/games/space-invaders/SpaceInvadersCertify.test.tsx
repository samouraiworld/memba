import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { InvadersCertifyRun } from "./SpaceInvadersCertify";

// Mock the wallet-backed hook so the component test never touches Adena.
const certify = vi.fn();
let mockStatus = "idle";
let mockError: string | null = null;
vi.mock("../../hooks/useArcadeCertify", () => ({
  useArcadeCertify: () => ({ certify, status: mockStatus, error: mockError, result: null }),
}));

import SpaceInvadersCertify from "./SpaceInvadersCertify";

const run: InvadersCertifyRun = {
  seed: "invaders-2026-07-13",
  simVersion: 1,
  events: [
    [5, 10, 0, 0],
    [60, 10, 1, 0],
  ],
  finalTick: 600,
  claimedScore: 300,
  claimedHash: "a7d393c2",
};

describe("SpaceInvadersCertify", () => {
  beforeEach(() => {
    certify.mockReset();
    mockStatus = "idle";
    mockError = null;
  });

  it("certifies the given run on click — finalTick included (the SI-only field)", () => {
    render(<SpaceInvadersCertify run={run} />);
    fireEvent.click(screen.getByRole("button", { name: /certify on-chain/i }));
    expect(certify).toHaveBeenCalledWith({
      seed: "invaders-2026-07-13",
      simVersion: 1,
      events: [
        [5, 10, 0, 0],
        [60, 10, 1, 0],
      ],
      finalTick: 600,
      claimedScore: 300,
      claimedHash: "a7d393c2",
    });
  });

  it("disables the button while certifying (pending state)", () => {
    mockStatus = "certifying";
    render(<SpaceInvadersCertify run={run} />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveTextContent(/certifying/i);
  });

  it("shows a success line when certified (no button left to double-submit)", () => {
    mockStatus = "certified";
    render(<SpaceInvadersCertify run={run} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/certified on-chain/i)).toBeInTheDocument();
  });

  it("surfaces the backend's rejection reason", () => {
    mockStatus = "error";
    mockError = "rejected: claimed result does not match the re-simulation";
    render(<SpaceInvadersCertify run={run} />);
    expect(screen.getByText(/does not match the re-simulation/i)).toBeInTheDocument();
    // The button stays — the player may retry (e.g. transient backend hiccup).
    expect(screen.getByRole("button", { name: /certify on-chain/i })).toBeInTheDocument();
  });
});
