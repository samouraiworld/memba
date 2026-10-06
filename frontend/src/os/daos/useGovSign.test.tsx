import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import type { OsSession } from "../shell/useOsSession"

vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign: vi.fn(), version: 0 }) }))
vi.mock("./sheetFee", async (original) => ({ ...(await original<typeof import("./sheetFee")>()), quoteSheetGasPrice: vi.fn(async () => ({ gas: 1000, ugnot: 1 })) }))
const { useGovSign } = await import("./useGovSign")

function Probe() {
    const { start, failed } = useGovSign({ status: "member", address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" } as unknown as OsSession)
    return <>{failed}<button type="button" onClick={() => start(() => { throw new Error("A note is at most 280 printable ASCII characters") })}>Go</button></>
}

describe("useGovSign", () => {
    it("reports a request that cannot be built instead of failing silently", async () => {
        render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Go" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("A note is at most 280 printable ASCII characters Nothing was sent.")
    })
})
