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

it("state=loading renders three skeleton bars and no children text", () => {
  const { container } = renderWithProviders(
    <Door variant="stat" state="loading" eyebrow="tokens">
      should not appear
    </Door>,
  )
  expect(container.querySelectorAll(".door__sk").length).toBe(3)
  expect(screen.queryByText("should not appear")).not.toBeInTheDocument()
})

it("state=empty without invitation renders fallback without crashing", () => {
  renderWithProviders(
    <Door variant="stat" state="empty" eyebrow="tokens" />,
  )
  expect(screen.getByText("nothing here yet")).toBeInTheDocument()
})

it("state=empty with external invitation renders an <a> with target=_blank", () => {
  renderWithProviders(
    <Door
      variant="featured"
      state="empty"
      eyebrow="featured dao"
      invitation={{ label: "Visit Gno", href: "https://gno.land/r/x" }}
    />,
  )
  const link = screen.getByRole("link", { name: /visit gno/i })
  expect(link.tagName.toLowerCase()).toBe("a")
  expect(link).toHaveAttribute("href", "https://gno.land/r/x")
  expect(link).toHaveAttribute("target", "_blank")
})
