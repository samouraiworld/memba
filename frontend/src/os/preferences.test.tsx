import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { readSkipIntro, setLiveWidget, setSkipIntro, useLiveWidget, useSkipIntro } from "./preferences"

afterEach(() => localStorage.clear())

function Preferences() {
    const live = useLiveWidget()
    const skip = useSkipIntro()
    return <><output data-testid="live">{String(live)}</output><output data-testid="skip">{String(skip)}</output>
        <button onClick={() => setLiveWidget(!live)}>Live</button><button onClick={() => setSkipIntro(!skip)}>Skip</button></>
}

it("defaults both preferences off, then updates this tab and storage", () => {
    render(<Preferences />)
    expect(screen.getByTestId("live")).toHaveTextContent("false")
    expect(screen.getByTestId("skip")).toHaveTextContent("false")
    fireEvent.click(screen.getByRole("button", { name: "Live" }))
    fireEvent.click(screen.getByRole("button", { name: "Skip" }))
    expect(screen.getByTestId("live")).toHaveTextContent("true")
    expect(screen.getByTestId("skip")).toHaveTextContent("true")
    expect(readSkipIntro()).toBe(true)
    expect(localStorage.getItem("memba_os_live_widget")).toBe("1")
    fireEvent.click(screen.getByRole("button", { name: "Live" }))
    expect(localStorage.getItem("memba_os_live_widget")).toBeNull()
})
