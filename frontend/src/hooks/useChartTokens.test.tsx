import { renderHook } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { useChartTokens } from "./useChartTokens"

afterEach(() => { document.body.innerHTML = ""; document.documentElement.removeAttribute("style") })

it("reads the chart colours from the Memba OS window when one is open", () => {
    document.documentElement.style.setProperty("--gl-color-chart-series-primary", "rgb(0, 212, 170)")
    document.body.innerHTML = `<div class="memba-os"><div class="os-classic" style="--gl-color-chart-series-primary: rgb(59, 91, 219)"></div></div>`
    const { result } = renderHook(() => useChartTokens())
    expect(result.current.primary).toBe("rgb(59, 91, 219)")
})

it("reads the page colours outside Memba OS", () => {
    document.documentElement.style.setProperty("--gl-color-chart-series-primary", "rgb(0, 212, 170)")
    const { result } = renderHook(() => useChartTokens())
    expect(result.current.primary).toBe("rgb(0, 212, 170)")
})

it("does not reuse a :root read cached before an OS window mounts", () => {
    document.documentElement.style.setProperty("--gl-color-chart-series-primary", "rgb(0, 212, 170)")
    const first = renderHook(() => useChartTokens())
    expect(first.result.current.primary).toBe("rgb(0, 212, 170)")
    first.unmount()

    document.body.innerHTML = `<div class="memba-os"><div class="os-classic" style="--gl-color-chart-series-primary: rgb(59, 91, 219)"></div></div>`
    const second = renderHook(() => useChartTokens())
    expect(second.result.current.primary).toBe("rgb(59, 91, 219)")
})
