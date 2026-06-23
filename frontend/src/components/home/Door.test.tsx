import { screen } from "@testing-library/react"
import { vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { Door } from "./Door"

it("renders body when ready", () => {
  renderWithProviders(
    <Door variant="stat" state="ready" eyebrow="validators">
      <b>5 / 5</b>
    </Door>,
  )
  expect(screen.getByText("5 / 5")).toBeInTheDocument()
})

it("renders an invitation (never blank) when empty", () => {
  renderWithProviders(
    <Door
      variant="featured"
      state="empty"
      eyebrow="featured dao"
      invitation={{ label: "Create one", href: "/test13/dao" }}
    />,
  )
  const link = screen.getByRole("link", { name: /create one/i })
  expect(link).toHaveAttribute("href", "/test13/dao")
})

it("renders a retry control when error", () => {
  const onRetry = vi.fn()
  renderWithProviders(
    <Door variant="stat" state="error" eyebrow="tokens" onRetry={onRetry} />,
  )
  screen.getByRole("button", { name: /retry/i }).click()
  expect(onRetry).toHaveBeenCalled()
})

it("renders an internal href as a link", () => {
  renderWithProviders(
    <Door variant="promo" eyebrow="launchpad" href="/test13/tokens">
      Launch
    </Door>,
  )
  expect(screen.getByRole("link")).toHaveAttribute("href", "/test13/tokens")
})

it("renders a button when only onClick is set", () => {
  const onClick = vi.fn()
  renderWithProviders(
    <Door variant="stat" eyebrow="validators" onClick={onClick}>
      x
    </Door>,
  )
  screen.getByRole("button").click()
  expect(onClick).toHaveBeenCalled()
})
