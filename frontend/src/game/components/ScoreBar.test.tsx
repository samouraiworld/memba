import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreBar } from "./ScoreBar";

describe("ScoreBar", () => {
  it("presents score, reachable target, and move budget as round status", () => {
    render(<ScoreBar score={640} par={900} movesLeft={12} />);
    const status = screen.getByLabelText(/round status/i);
    expect(status).toHaveTextContent(/score640/i);
    expect(status).toHaveTextContent(/target900/i);
    expect(status).toHaveTextContent(/moves12 remaining/i);
  });

  it("omits uncalibrated targets and infinite practice move budgets", () => {
    render(<ScoreBar score={32} par={undefined} movesLeft={Infinity} />);
    expect(screen.queryByText(/target/i)).toBeNull();
    expect(screen.queryByText(/moves/i)).toBeNull();
  });

  it("counts up to a new score and pops the gain without touching the accessible total", async () => {
    const { container, rerender } = render(<ScoreBar score={32} movesLeft={Infinity} />);
    expect(container.querySelector(".k-bp-score-pop")).toBeNull();
    rerender(<ScoreBar score={96} movesLeft={Infinity} />);
    const pop = container.querySelector(".k-bp-score-pop");
    expect(pop).toHaveTextContent("+64");
    expect(pop).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => expect(container.querySelector(".k-bp-score")?.firstChild?.textContent).toBe("96"));
    // A new round resets instead of popping a negative gain.
    rerender(<ScoreBar score={0} movesLeft={Infinity} />);
    expect(container.querySelector(".k-bp-score-pop")).toBeNull();
    await waitFor(() => expect(container.querySelector(".k-bp-score")?.firstChild?.textContent).toBe("0"));
  });
});
