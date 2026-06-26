import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { StickyActionBar } from './StickyActionBar'

test('renders its children (the primary actions)', () => {
    render(
        <StickyActionBar>
            <button>Sign</button>
        </StickyActionBar>,
    )
    expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument()
})

test('exposes a labelled action group for assistive tech', () => {
    render(
        <StickyActionBar ariaLabel="Proposal actions">
            <button>Vote</button>
        </StickyActionBar>,
    )
    expect(screen.getByRole('group', { name: 'Proposal actions' })).toBeInTheDocument()
})
