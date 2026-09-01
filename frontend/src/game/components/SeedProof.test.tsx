import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeedProof } from "./SeedProof";

// The headline product claim is "provably un-rigged from a chain block" — the
// proof (block height + hash + how to verify) must be visible in the app, not
// only fetched and stashed.
describe("SeedProof", () => {
  it("shows the seeding block, a truncated hash, and a verify link", () => {
    render(<SeedProof chainId="pearl-1" height={99236} hash="s0leQ+7nRr7v1Aj2YwZPZR4IC5qNWCxL03SPxcDpfPo=" />);
    expect(screen.getByText(/pearl-1 block #99[,  ]?236/)).toBeTruthy();
    // truncated, not the full 44-char base64 blob
    expect(screen.getByText(/s0leQ\+7nRr…/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /verify/i });
    expect(link.getAttribute("href")).toContain("VERIFY_BLOCKPARTY.md");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders nothing without a height (unseeded day)", () => {
    const { container } = render(<SeedProof chainId="pearl-1" height={0} hash="" />);
    expect(container.textContent).toBe("");
  });
});
