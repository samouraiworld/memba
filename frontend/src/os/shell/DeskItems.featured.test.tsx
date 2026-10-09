import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DeskIcon, DeskItems } from './DeskItems'
import type { DeskItem } from './desk'
afterEach(() => vi.unstubAllGlobals())
it('uses fixed release labels with a neutral label for ordinary notes', () => {
    const note: DeskItem = { ty: 'note', ref: 'ab'.repeat(16), c: 0, r: 0 }
    const view = render(<DeskIcon item={note} noteLabels={{ [note.ref]: 'Sushi recipe' }} />)
    expect(screen.getByText('Sushi recipe')).toBeTruthy()
    view.rerender(<DeskIcon item={note} noteLabels={{ [note.ref]: 'Whitepaper' }} />)
    expect(screen.getByText('Whitepaper')).toBeTruthy()
    view.rerender(<DeskIcon item={note} />); expect(screen.getByText('Note')).toBeTruthy()
})
it('moves the captured item after the rendered list changes rather than the old numeric index', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const first: DeskItem = { ty: 'app', ref: 'wallet', c: 0, r: 0 }, second: DeskItem = { ty: 'app', ref: 'feed', c: 0, r: 1 }
    const onMove = vi.fn(), props = { deskWidth: 1000, onMove, onOpen: vi.fn(), onMenu: vi.fn() }
    const view = render(<DeskItems items={[first, second]} {...props} />)
    const button = screen.getByRole('button', { name: 'Wallet' })
    button.setPointerCapture = vi.fn()
    fireEvent.pointerDown(button, { button: 0, clientX: 900, clientY: 20 })
    view.rerender(<DeskItems items={[second, first]} {...props} />)
    fireEvent.pointerMove(button, { clientX: 800, clientY: 20 }); fireEvent.pointerUp(button, { clientX: 800, clientY: 20 })
    expect(onMove).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number))
})
it('drops a drag when its scoped desktop is remounted', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const item: DeskItem = { ty: 'app', ref: 'wallet', c: 0, r: 0 }, onMove = vi.fn()
    const props = { items: [item], deskWidth: 1000, onMove, onOpen: vi.fn(), onMenu: vi.fn() }
    const view = render(<DeskItems key="old-account" {...props} />)
    const button = screen.getByRole('button', { name: 'Wallet' }); button.setPointerCapture = vi.fn()
    fireEvent.pointerDown(button, { button: 0, clientX: 900, clientY: 20 })
    view.rerender(<DeskItems key="new-account" {...props} />)
    const replacement = screen.getByRole('button', { name: 'Wallet' })
    fireEvent.pointerMove(replacement, { clientX: 800, clientY: 20 }); fireEvent.pointerUp(replacement, { clientX: 800, clientY: 20 })
    expect(onMove).not.toHaveBeenCalled()
})
