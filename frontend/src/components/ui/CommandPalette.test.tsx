import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { CommandPalette } from './CommandPalette'

function renderPalette() {
    return render(
        <MemoryRouter initialEntries={['/test13/']}>
            <CommandPalette />
        </MemoryRouter>,
    )
}

describe('CommandPalette open triggers', () => {
    test('opens when an `open-command-palette` event is dispatched (touch entry)', () => {
        renderPalette()
        // Closed by default — the palette renders nothing.
        expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()

        act(() => {
            window.dispatchEvent(new CustomEvent('open-command-palette'))
        })

        // The event opens it without any keyboard — the mobile touch path.
        expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    })
})
