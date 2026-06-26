import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { StarRating } from "./StarRating"

describe("StarRating", () => {
  it("display mode renders an img role with an out-of-5 label and no buttons", () => {
    render(<StarRating value={3} />)
    expect(screen.getByRole("img", { name: /3 out of 5 stars/i })).toBeInTheDocument()
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
  })

  it("input mode is a radiogroup of 5 radios with the selected one checked", () => {
    render(<StarRating value={2} onChange={vi.fn()} />)
    expect(screen.getByRole("radiogroup")).toBeInTheDocument()
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(5)
    expect(radios[1]).toHaveAttribute("aria-checked", "true") // 2nd star
  })

  it("clicking a star calls onChange with that value", () => {
    const onChange = vi.fn()
    render(<StarRating value={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }))
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it("ArrowRight increments and ArrowLeft decrements the rating", () => {
    const onChange = vi.fn()
    const { rerender } = render(<StarRating value={3} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: /3 stars/i }), { key: "ArrowRight" })
    expect(onChange).toHaveBeenLastCalledWith(4)

    rerender(<StarRating value={3} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: /3 stars/i }), { key: "ArrowLeft" })
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it("ArrowRight from an empty selection selects star 1 (does not skip it)", () => {
    const onChange = vi.fn()
    render(<StarRating value={0} onChange={onChange} />)
    // With nothing selected, star 1 is the tabbable/focused star.
    fireEvent.keyDown(screen.getByRole("radio", { name: /1 star/i }), { key: "ArrowRight" })
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it("uses roving tabindex — only the selected star is tabbable", () => {
    render(<StarRating value={4} onChange={vi.fn()} />)
    const radios = screen.getAllByRole("radio")
    expect(radios[3]).toHaveAttribute("tabindex", "0") // 4th star selected
    expect(radios[0]).toHaveAttribute("tabindex", "-1")
  })
})
