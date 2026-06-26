import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useIsMobile } from './useIsMobile'

const realMatchMedia = window.matchMedia

afterEach(() => {
    window.matchMedia = realMatchMedia
    vi.restoreAllMocks()
})

function mockMatch(matches: boolean) {
    window.matchMedia = ((q: string) => ({
        matches,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
}

test('returns false on desktop widths', () => {
    mockMatch(false)
    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
})

test('returns true on mobile widths', () => {
    mockMatch(true)
    expect(renderHook(() => useIsMobile()).result.current).toBe(true)
})

test('updates when the media query changes', () => {
    // Stateful mock: a single MediaQueryList whose `matches` flips, mirroring
    // how a real matchMedia behaves when the viewport crosses the breakpoint.
    let matches = false
    const listeners = new Set<(e: MediaQueryListEvent) => void>()
    window.matchMedia = ((q: string) => ({
        get matches() {
            return matches
        },
        media: q,
        onchange: null,
        addEventListener: (_: string, h: (e: MediaQueryListEvent) => void) => listeners.add(h),
        removeEventListener: (_: string, h: (e: MediaQueryListEvent) => void) => listeners.delete(h),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    // cross the breakpoint: flip state, then notify subscribers
    act(() => {
        matches = true
        listeners.forEach((h) => h({ matches } as MediaQueryListEvent))
    })
    expect(result.current).toBe(true)
})
