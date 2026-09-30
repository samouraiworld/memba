import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { TEAM_MULTISIG_ADDRESS } from "../../lib/reviews"
import { ModerationPolicy } from "./ModerationPolicy"

describe("ModerationPolicy", () => {
  it("states the moderator's grounds, what a flag and a hide do, who moderates and where to appeal", () => {
    render(<ModerationPolicy moderator={TEAM_MULTISIG_ADDRESS} />)
    expect(screen.getByRole("heading", { level: 3, name: "How reviews are moderated" })).toBeInTheDocument()
    const policy = screen.getByText("How reviews are moderated").closest("details")!
    expect(policy).toHaveTextContent("The moderator hides a review or a reply only for illegal content, personal data, scams, spam or harassment.")
    expect(policy).toHaveTextContent("Criticism or a low rating is never a reason")
    expect(policy).toHaveTextContent("A flag is recorded for the moderator. It never hides anything by itself.")
    expect(policy).toHaveTextContent("a hidden reply leaves its thread. The text stays on chain, and every hide is a public chain event")
    expect(policy).toHaveTextContent(`The moderator is the Samourai team multisig: ${TEAM_MULTISIG_ADDRESS}.`)
    // What the multisig curates or lists is mutable chain state this block does not read.
    expect(policy).not.toHaveTextContent(/curates|listed/)
    expect(policy).toHaveTextContent("this page has no hide control")
    const appeal = screen.getByRole("link", { name: "github.com/samouraiworld/memba/issues" })
    expect(appeal).toHaveAttribute("href", "https://github.com/samouraiworld/memba/issues")
    expect(policy).toHaveTextContent("The same team answers it.")
  })

  it("states no grounds and no appeal channel for a moderator it knows nothing about", () => {
    const other = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt"
    render(<ModerationPolicy moderator={other} />)
    const policy = screen.getByText("How reviews are moderated").closest("details")!
    expect(policy).toHaveTextContent(`The moderator is this address: ${other}`)
    // What the realm itself does holds for any moderator.
    expect(policy).toHaveTextContent("A flag is recorded for the moderator. It never hides anything by itself.")
    expect(policy).toHaveTextContent("every hide is a public chain event")
    expect(policy).not.toHaveTextContent(/Samourai team|only for|never a reason|appeal|same team/)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
