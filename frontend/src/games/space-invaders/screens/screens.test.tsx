import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuScreen } from "./MenuScreen";
import { ReadyScreen } from "./ReadyScreen";
import { PausedScreen } from "./PausedScreen";

describe("MenuScreen", () => {
  it("offers daily and free play and routes each choice", () => {
    const onDaily = vi.fn();
    const onFree = vi.fn();
    render(<MenuScreen certifyOn={false} onDaily={onDaily} onFree={onFree} />);
    expect(screen.getByRole("heading", { name: /defend the gno relay/i })).toBeInTheDocument();
    expect(screen.getByText(/same waves for everyone/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    expect(onDaily).toHaveBeenCalledTimes(1);
    expect(onFree).toHaveBeenCalledTimes(1);
  });

  it("mentions replay eligibility only when certification is on", () => {
    render(<MenuScreen certifyOn onDaily={() => {}} onFree={() => {}} />);
    expect(screen.getByText(/replay eligible/i)).toBeInTheDocument();
  });
});

describe("ReadyScreen", () => {
  it("names the daily day and lets the player change transmission", () => {
    const onChange = vi.fn();
    render(<ReadyScreen mode="daily" dailyDay="2026-09-23" onChangeTransmission={onChange} />);
    expect(screen.getByRole("heading", { name: /relay standing by/i })).toBeInTheDocument();
    expect(screen.getByText("Daily signal · 2026-09-23")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /change transmission/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("labels a free run as a free signal", () => {
    render(<ReadyScreen mode="free" dailyDay="" onChangeTransmission={() => {}} />);
    expect(screen.getByText("Free signal")).toBeInTheDocument();
  });
});

describe("PausedScreen", () => {
  it("resumes from the pause sheet", () => {
    const onResume = vi.fn();
    render(<PausedScreen onResume={onResume} />);
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /resume defense/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
