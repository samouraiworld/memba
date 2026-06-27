import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { BottomSheet } from './BottomSheet'

function setup(onClose = vi.fn()) {
    render(
        <BottomSheet open onClose={onClose}>
            <div>sheet content</div>
        </BottomSheet>,
    )
    return { onClose, handle: screen.getByTestId('bottom-sheet-handle') }
}

describe('BottomSheet swipe-to-dismiss', () => {
    test('dragging the grabber down past the threshold dismisses the sheet', () => {
        const { onClose, handle } = setup()
        fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
        fireEvent.pointerMove(handle, { clientY: 260, pointerId: 1 })
        fireEvent.pointerUp(handle, { clientY: 260, pointerId: 1 })
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('a small drag releases without dismissing (snaps back)', () => {
        const { onClose, handle } = setup()
        fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
        fireEvent.pointerMove(handle, { clientY: 130, pointerId: 1 })
        fireEvent.pointerUp(handle, { clientY: 130, pointerId: 1 })
        expect(onClose).not.toHaveBeenCalled()
    })

    test('an upward drag never dismisses', () => {
        const { onClose, handle } = setup()
        fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 })
        fireEvent.pointerMove(handle, { clientY: 20, pointerId: 1 })
        fireEvent.pointerUp(handle, { clientY: 20, pointerId: 1 })
        expect(onClose).not.toHaveBeenCalled()
    })
})
