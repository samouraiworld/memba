import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FullscreenButton } from "./FullscreenButton";

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) Reflect.deleteProperty(document, key);
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
});

function setup(supported = true) {
  const root = document.createElement("section");
  const request = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: root });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  root.requestFullscreen = request;
  document.documentElement.requestFullscreen = request;
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: supported });
  document.exitFullscreen = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  const onChange = vi.fn();
  const onError = vi.fn();
  render(<FullscreenButton root={{ current: root }} onChange={onChange} onError={onError} />);
  return { request, onChange, onError };
}

it("only enters on a click and keeps an explicit exit control", async () => {
  const { request, onChange } = setup();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Game fullscreen" }));
  const exit = await screen.findByRole("button", { name: "Exit game fullscreen" });
  await waitFor(() => expect(exit).not.toBeDisabled());
  expect(request).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.click(exit);
  await waitFor(() => expect(screen.getByRole("button", { name: "Game fullscreen" })).not.toBeDisabled());
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
});

it("tracks browser-initiated exit without another request", async () => {
  const { request } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Game fullscreen" }));
  await screen.findByRole("button", { name: "Exit game fullscreen" });
  await act(async () => { await document.exitFullscreen(); });
  expect(screen.getByRole("button", { name: "Game fullscreen" })).toHaveAttribute("aria-pressed", "false");
  expect(request).toHaveBeenCalledTimes(1);
});

it("reports rejection and allows retry", async () => {
  const { request, onError } = setup();
  request.mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "Game fullscreen" }));
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("could not be changed")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Game fullscreen" })).not.toBeDisabled();
});

it("explains when the browser has no fullscreen support", () => {
  const { request, onError } = setup(false);
  fireEvent.click(screen.getByRole("button", { name: "Game fullscreen" }));
  expect(request).not.toHaveBeenCalled();
  expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("unavailable"));
  expect(screen.queryByRole("alert")).toBeNull();
});
