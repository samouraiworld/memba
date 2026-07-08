import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { type RefObject } from "react";
import { Canvas } from "./Canvas";

describe("Canvas", () => {
  it("renders a canvas element and binds the ref", () => {
    const ref = { current: null } as RefObject<HTMLCanvasElement | null>;
    const { container } = render(<Canvas canvasRef={ref} />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
