import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  sign: vi.fn(),
  challenge: vi.fn(),
  token: vi.fn(),
  restart: vi.fn(() => true),
}));

vi.mock("../hooks/useAdena", async () => {
  const React = await import("react");
  return {
    useAdena: () => {
      const [connected, setConnected] = React.useState(false);
      return {
        installed: true,
        connected,
        address: connected ? "g1connected" : "",
        pubkeyJSON: connected ? '{"type":"test","value":"connected"}' : "",
        connect: async () => {
          mocks.connect();
          setConnected(true);
          return true;
        },
        signLoginChallenge: mocks.sign,
      };
    },
  };
});
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({
  isAuthenticated: false, token: null, address: "",
  getChallenge: mocks.challenge, getToken: mocks.token,
}) }));
vi.mock("../hooks/useNetwork", () => ({ useNetwork: () => ({ chainId: "test-chain" }) }));
vi.mock("../game/hooks/useDailyChallenge", () => {
  const data = { ready: true, source: "network", date: "2026-09-28", seed: 12345,
    modifier: "standard", par: 100, moveBudget: 30, blockHeight: 42, blockHash: "abc" };
  return { useDailyChallenge: () => ({
  data,
  isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  }) };
});
vi.mock("../game/hooks/useGame", () => ({ useGame: () => ({
  board: Array(16).fill(0), score: 100, movesLeft: 0, over: true,
  moveLog: "R", roundSeed: 12345, roundModifier: "standard", canUndo: false,
  play: vi.fn(), restart: mocks.restart, undo: vi.fn(),
}) }));
vi.mock("../game/components/GameOverSheet", () => ({
  GameOverSheet: ({ auth }: { auth: { authenticate: () => Promise<void> } }) =>
    <button onClick={() => void auth.authenticate()}>Connect to post</button>,
}));

import BlockPartyGame from "./BlockPartyGame";

describe("Block Party wallet sign-in", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("bp:intro:v1", "1");
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.challenge.mockResolvedValue({ nonce: new Uint8Array([1]), expiration: "2026-10-01T00:00:00Z",
      serverSignature: new Uint8Array([2]), boundPubkeyHash: "", chainId: "test-chain" });
    mocks.sign.mockResolvedValue({ signature: "signed", pubKey: '{"type":"test","value":"connected"}' });
    mocks.token.mockResolvedValue({ userAddress: "g1connected" });
  });

  it("signs with the connected wallet from the next render on the first click", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><BlockPartyGame /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Connect to post" }));
    await waitFor(() => expect(mocks.token).toHaveBeenCalledTimes(1));
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.challenge).toHaveBeenCalledWith('{"type":"test","value":"connected"}', "test-chain");
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
});
