import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FreePlayPublication } from "./FreePlayPublication";
it("exports the retained game data when saving is unavailable, without a false receipt", () => {
  const result = { game: "space-invaders" as const, mode: "free" as const, seed: 1, simVersion: 1, finalTick: 1872, events: [[0, 0, 1, 0], [1, 0, 0, 0]], score: 510, hash: "1018c264", verified: true };
  const old = URL.createObjectURL;
  Object.defineProperty(URL, "createObjectURL", { value: undefined, configurable: true, writable: true });
  try {
    render(<FreePlayPublication result={result} prepared={null} issue="save_unavailable" />);
    fireEvent.click(screen.getByRole("button", { name: "Export replay" }));
    const exported = JSON.parse((screen.getByRole("textbox", { name: "Replay export" }) as HTMLTextAreaElement).value);
    expect(exported.result).toEqual(result); expect(exported.recordingComplete).toBe(true);
    expect(screen.queryByText(/confirmed/i)).toBeNull();
  } finally { Object.defineProperty(URL, "createObjectURL", { value: old, configurable: true, writable: true }); }
});
it("explains certification limits without offering an unguarded connection", () => {
  render(<FreePlayPublication result={{ game: "space-invaders", mode: "free", seed: 1, simVersion: 1, finalTick: 216001, events: [], score: 10, hash: "00000000", verified: false }} prepared={null} issue="certification_limit" />);
  expect(screen.getByText(/service replay limits/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Connect account" })).toBeNull();
});
