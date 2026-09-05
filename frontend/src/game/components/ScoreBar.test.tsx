import { render, screen } from "@testing-library/react";
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
});
