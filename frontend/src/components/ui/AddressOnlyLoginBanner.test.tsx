/**
 * AddressOnlyLoginBanner.test.tsx — the "upgrade to secure login" hint shown when
 * a user is signed in via the ADDRESS-ONLY path (an untransacted wallet that Adena
 * can't sign for, #800). It explains the limited verification and the one-tx
 * upgrade to signed login. Disappears once the wallet has an on-chain pubkey.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { AddressOnlyLoginBanner } from "./AddressOnlyLoginBanner"

describe("AddressOnlyLoginBanner", () => {
    it("renders nothing for a normal (signed) session", () => {
        const { container } = render(<AddressOnlyLoginBanner show={false} faucetUrl="https://faucet.gno.land" />)
        expect(container).toBeEmptyDOMElement()
    })

    it("shows the upgrade guidance + faucet link for an address-only session", () => {
        render(<AddressOnlyLoginBanner show={true} faucetUrl="https://faucet.gno.land" />)
        const status = screen.getByRole("status")
        expect(status).toHaveTextContent(/address.?only|limited|secure login/i)
        const faucet = screen.getByRole("link", { name: /faucet|get .*gnot/i })
        expect(faucet).toHaveAttribute("href", "https://faucet.gno.land")
    })

    it("omits the faucet link when no faucet is configured", () => {
        render(<AddressOnlyLoginBanner show={true} faucetUrl="" />)
        expect(screen.getByRole("status")).toBeInTheDocument()
        expect(screen.queryByRole("link", { name: /faucet|get .*gnot/i })).toBeNull()
    })
})
