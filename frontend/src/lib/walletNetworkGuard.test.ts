import { afterEach, describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "./config"
import { assertLiveWalletNetwork, networkLabelForChain } from "./walletNetworkGuard"
import { liveWallet } from "../test/walletStub"

const OTHER = `${GNO_CHAIN_ID}-other`
const label = networkLabelForChain(GNO_CHAIN_ID)

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("assertLiveWalletNetwork", () => {
    it("passes when the account and the network both name the page's chain", async () => {
        vi.stubGlobal("adena", liveWallet({ address: "g1me" }))
        await expect(assertLiveWalletNetwork()).resolves.toEqual({ chainId: GNO_CHAIN_ID, address: "g1me", rpcUrl: "https://rpc.gno.land:443" })
    })

    it("asks the wallet every time instead of trusting an earlier answer", async () => {
        const wallet = liveWallet()
        vi.stubGlobal("adena", wallet)
        await assertLiveWalletNetwork()
        await assertLiveWalletNetwork()
        expect(wallet.GetAccount).toHaveBeenCalledTimes(2)
        expect(wallet.GetNetwork).toHaveBeenCalledTimes(2)
    })

    it("refuses an empty chain id from both the account and the network", async () => {
        vi.stubGlobal("adena", liveWallet({ chainId: "", networkChainId: "" }))
        await expect(assertLiveWalletNetwork()).rejects.toThrow(`Your wallet did not report its network — switch Adena to ${label} and try again.`)
    })

    it("refuses a chain id made only of whitespace", async () => {
        vi.stubGlobal("adena", liveWallet({ chainId: "  ", networkChainId: "" }))
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)
    })

    it("refuses a wallet on another chain", async () => {
        vi.stubGlobal("adena", liveWallet({ chainId: OTHER }))
        await expect(assertLiveWalletNetwork()).rejects.toThrow(`Your wallet is on ${OTHER}, but this page is on ${label} — switch Adena to ${label} and try again.`)
    })

    it("refuses when the account and the network report different chains", async () => {
        vi.stubGlobal("adena", liveWallet({ chainId: GNO_CHAIN_ID, networkChainId: OTHER }))
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/reports two different networks/)
        vi.stubGlobal("adena", liveWallet({ chainId: OTHER, networkChainId: GNO_CHAIN_ID }))
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/reports two different networks/)
    })

    it("uses the account's chain when the network reply carries none", async () => {
        const wallet = liveWallet()
        wallet.GetNetwork.mockResolvedValue({ status: "success", data: { rpcUrl: "https://rpc.gno.land:443" } } as never)
        vi.stubGlobal("adena", wallet)
        await expect(assertLiveWalletNetwork()).resolves.toMatchObject({ chainId: GNO_CHAIN_ID })
        wallet.GetAccount.mockResolvedValue({ status: "success", data: { address: "g1stub", chainId: OTHER } })
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/Your wallet is on/)
    })

    it("uses the account's chain on a wallet without GetNetwork", async () => {
        const { GetAccount } = liveWallet()
        vi.stubGlobal("adena", { GetAccount })
        await expect(assertLiveWalletNetwork()).resolves.toMatchObject({ chainId: GNO_CHAIN_ID, rpcUrl: "" })
    })

    it("refuses when there is no wallet, or it cannot report its account", async () => {
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)
        vi.stubGlobal("adena", { DoContract: vi.fn() })
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)
    })

    it("refuses when the wallet answers with a failure or throws", async () => {
        const locked = liveWallet()
        locked.GetAccount.mockResolvedValue({ status: "failure", data: null } as never)
        vi.stubGlobal("adena", locked)
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)

        const broken = liveWallet()
        broken.GetNetwork.mockRejectedValue(new Error("boom"))
        vi.stubGlobal("adena", broken)
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)

        const failing = liveWallet()
        failing.GetNetwork.mockResolvedValue({ status: "failure" } as never)
        vi.stubGlobal("adena", failing)
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)
    })

    // Reply shapes as Adena sends them (adena-extension inject/message/methods/wallet.ts
    // getAccount/getNetwork; common.ts checkEstablished).
    const LOCKED = { code: 2000, status: "failure", type: "WALLET_LOCKED", message: "Adena is Locked.", data: {} }
    const NOT_CONNECTED = { status: "failure", type: "NOT_CONNECTED", data: {} }

    it("asks a locked wallet to be unlocked instead of switched", async () => {
        const wallet = liveWallet()
        wallet.GetAccount.mockResolvedValue(LOCKED as never)
        wallet.GetNetwork.mockResolvedValue(LOCKED as never)
        vi.stubGlobal("adena", wallet)
        await expect(assertLiveWalletNetwork()).rejects.toThrow("Adena is locked — unlock it, then try again.")
        // Either reply is enough.
        wallet.GetAccount.mockResolvedValue({ status: "success", data: { address: "g1stub", chainId: GNO_CHAIN_ID } })
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/Adena is locked/)
    })

    describe("unlocking in place, right before a signature", () => {
        // Adena's connect window for a site that is already connected but locked: its login screen,
        // then ALREADY_CONNECTED (adena-extension pages/popup/wallet/approve-establish).
        const ALREADY = { status: "failure", type: "ALREADY_CONNECTED", data: {} }
        const lockedOnce = () => {
            const wallet = Object.assign(liveWallet({ address: "g1me" }), { AddEstablish: vi.fn(async () => ALREADY) })
            wallet.GetAccount.mockResolvedValueOnce(LOCKED as never)
            wallet.GetNetwork.mockResolvedValueOnce(LOCKED as never)
            vi.stubGlobal("adena", wallet)
            return wallet
        }

        it("opens Adena's unlock window, reads the wallet again and passes", async () => {
            const wallet = lockedOnce()
            let pendingWhileOpen = false
            const { isWalletRequestPending } = await import("./walletActivity")
            wallet.AddEstablish.mockImplementationOnce(async () => { pendingWhileOpen = isWalletRequestPending(); return ALREADY })
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { address: "g1me", unlock: true })).resolves.toMatchObject({ address: "g1me" })
            expect(wallet.AddEstablish).toHaveBeenCalledWith("Memba")
            expect(wallet.GetAccount).toHaveBeenCalledTimes(2)
            expect(pendingWhileOpen).toBe(true)
            expect(isWalletRequestPending()).toBe(false)
        })

        it("still applies every check to the wallet it reads after the unlock", async () => {
            const wallet = lockedOnce()
            wallet.GetAccount.mockResolvedValue({ status: "success", data: { address: "g1someone", chainId: GNO_CHAIN_ID } } as never)
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { address: "g1me", unlock: true })).rejects.toThrow(/not the one connected to Memba/)
            wallet.AddEstablish.mockClear()
            lockedOnce().GetNetwork.mockResolvedValue({ status: "success", data: { chainId: OTHER, rpcUrl: "https://rpc.gno.land:443" } } as never)
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { unlock: true })).rejects.toThrow(/two different networks|but this page is on/)
        })

        it("also continues after a fresh connection approval, and says the window is open only while it is", async () => {
            const wallet = lockedOnce()
            const { isAdenaUnlockOpen } = await import("./walletNetworkGuard")
            let openWhileAsked = false
            wallet.AddEstablish.mockImplementationOnce(async () => { openWhileAsked = isAdenaUnlockOpen(); return { status: "success", type: "CONNECTION_SUCCESS", data: {} } })
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { unlock: true })).resolves.toMatchObject({ chainId: GNO_CHAIN_ID })
            expect(openWhileAsked).toBe(true)
            expect(isAdenaUnlockOpen()).toBe(false)
        })

        it("waits for a person typing a password, then gives up with today's message", async () => {
            vi.useFakeTimers()
            const wallet = lockedOnce()
            wallet.AddEstablish.mockImplementationOnce(() => new Promise(() => {}))
            const { isAdenaUnlockOpen, LIVE_NETWORK_TIMEOUT_MS, UNLOCK_TIMEOUT_MS } = await import("./walletNetworkGuard")
            let settled = false
            const check = assertLiveWalletNetwork(GNO_CHAIN_ID, { unlock: true }).finally(() => { settled = true })
            check.catch(() => {})
            await vi.advanceTimersByTimeAsync(LIVE_NETWORK_TIMEOUT_MS + 1)
            expect(settled).toBe(false)
            expect(isAdenaUnlockOpen()).toBe(true)
            await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS)
            await expect(check).rejects.toThrow("Adena is locked — unlock it, then try again.")
            expect(isAdenaUnlockOpen()).toBe(false)
        })

        it("keeps today's message when the window is closed or refused", async () => {
            const wallet = lockedOnce()
            wallet.AddEstablish.mockResolvedValueOnce({ status: "failure", type: "CONNECTION_REJECTED", data: {} })
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { unlock: true })).rejects.toThrow("Adena is locked — unlock it, then try again.")
            expect(wallet.GetAccount).toHaveBeenCalledOnce()
            const thrown = lockedOnce()
            thrown.AddEstablish.mockRejectedValueOnce(new Error("window closed"))
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { unlock: true })).rejects.toThrow(/Adena is locked/)
        })

        it("opens nothing unless a signature asked for it, or when the wallet is merely on another network", async () => {
            const wallet = lockedOnce()
            await expect(assertLiveWalletNetwork()).rejects.toThrow(/Adena is locked/)
            expect(wallet.AddEstablish).not.toHaveBeenCalled()
            const elsewhere = Object.assign(liveWallet({ chainId: OTHER }), { AddEstablish: vi.fn() })
            vi.stubGlobal("adena", elsewhere)
            await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { unlock: true })).rejects.toThrow(/but this page is on/)
            expect(elsewhere.AddEstablish).not.toHaveBeenCalled()
        })
    })

    it("asks a disconnected site to reconnect", async () => {
        const wallet = liveWallet()
        wallet.GetAccount.mockResolvedValue(NOT_CONNECTED as never)
        wallet.GetNetwork.mockResolvedValue(NOT_CONNECTED as never)
        vi.stubGlobal("adena", wallet)
        await expect(assertLiveWalletNetwork()).rejects.toThrow("Adena is not connected to Memba — reconnect your wallet, then try again.")
    })

    it("keeps the network message for other failures", async () => {
        const wallet = liveWallet()
        wallet.GetAccount.mockResolvedValue({ status: "failure", type: "NO_ACCOUNT", data: {} } as never)
        vi.stubGlobal("adena", wallet)
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/did not report its network/)
    })

    it("refuses when Adena's account is not the connected one", async () => {
        vi.stubGlobal("adena", liveWallet({ address: "g1other" }))
        await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { address: "g1me" })).rejects.toThrow(/account is not the one connected/)
        vi.stubGlobal("adena", liveWallet({ address: "" }))
        await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { address: "g1me" })).rejects.toThrow(/account is not the one connected/)
        vi.stubGlobal("adena", liveWallet({ address: "g1me" }))
        await expect(assertLiveWalletNetwork(GNO_CHAIN_ID, { address: "g1me" })).resolves.toMatchObject({ address: "g1me" })
    })

    it("refuses when the wallet does not answer in time", async () => {
        vi.useFakeTimers()
        const wallet = liveWallet()
        wallet.GetAccount.mockReturnValue(new Promise(() => {}) as never)
        vi.stubGlobal("adena", wallet)
        const pending = assertLiveWalletNetwork(GNO_CHAIN_ID, { timeoutMs: 1000 })
        const settled = expect(pending).rejects.toThrow(/did not report its network/)
        await vi.advanceTimersByTimeAsync(1000)
        await settled
    })

    it("refuses a live RPC outside the trusted domains", async () => {
        vi.stubGlobal("adena", liveWallet({ rpcUrl: "https://rpc.evil.example:443" }))
        await expect(assertLiveWalletNetwork()).rejects.toThrow(/untrusted RPC \(https:\/\/rpc\.evil\.example:443\)/)
    })

    it("checks against the chain it is given", async () => {
        vi.stubGlobal("adena", liveWallet({ chainId: OTHER }))
        await expect(assertLiveWalletNetwork(OTHER)).resolves.toMatchObject({ chainId: OTHER })
    })
})

describe("networkLabelForChain", () => {
    it("names a known chain with its label and id, and an unknown one by id", () => {
        expect(networkLabelForChain("gnoland-1")).toBe("gno.land (gnoland-1)")
        expect(networkLabelForChain("nowhere-9")).toBe("nowhere-9")
    })
})
