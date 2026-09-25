/**
 * RealmsNotDeployedBanner.test.tsx — the honest "Memba isn't on this network yet"
 * notice. Shown when the active network is reachable/official but Memba's own
 * realms are not deployed there (e.g. test13 at cutover), so DAO/channel features
 * would otherwise 404 silently.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RealmsNotDeployedBanner } from "./RealmsNotDeployedBanner"

describe("RealmsNotDeployedBanner", () => {
    it("renders nothing when realms are deployed on the active network", () => {
        const { container } = render(
            <RealmsNotDeployedBanner deployed={true} networkLabel="Testnet 12" />,
        )
        expect(container).toBeEmptyDOMElement()
    })

    it("shows a notice naming the network when realms are not deployed", () => {
        render(<RealmsNotDeployedBanner deployed={false} networkLabel="Testnet 13" />)
        const status = screen.getByRole("status")
        expect(status).toHaveTextContent(/Testnet 13/)
        expect(status).toHaveTextContent(/Memba's channels, candidature, feed and quests are not available on Testnet 13 yet/i)
        expect(status).toHaveTextContent(/You can read GovDAO and DAOs deployed by their members/)
    })

    it("names only the features that are missing on a partial rollout", () => {
        render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={["channels", "candidature"]} />)
        const status = screen.getByRole("status")
        // "Not available", not "not on gno.land": the channels realm IS on chain,
        // it is just not open to members yet.
        expect(status).toHaveTextContent(/Memba's channels and candidature are not available on gno\.land yet/i)
        expect(status).not.toHaveTextContent(/feed|quests/)
        expect(status).not.toHaveTextContent(/realms? .*not on gno\.land/i)
    })

    it("agrees the verb with a single missing feature", () => {
        const { unmount } = render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={["candidature"]} />)
        expect(screen.getByRole("status")).toHaveTextContent(/Memba's candidature is not available on gno\.land yet/i)
        unmount()
        render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={["channels"]} />)
        expect(screen.getByRole("status")).toHaveTextContent(/Memba's channels are not available on gno\.land yet/i)
    })

    it("renders nothing when no community feature is missing", () => {
        const { container } = render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={[]} />)
        expect(container).toBeEmptyDOMElement()
    })
})
