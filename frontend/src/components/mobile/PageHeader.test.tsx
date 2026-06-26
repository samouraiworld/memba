import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { PageHeader } from './PageHeader'

function renderAt(ui: React.ReactNode, path = '/test13/dao/worx/proposals/1') {
    return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

test('renders the title', () => {
    renderAt(<PageHeader title="Proposal #1" back="/test13/dao/worx" />)
    expect(screen.getByRole('heading', { name: 'Proposal #1' })).toBeInTheDocument()
})

test('back control links to the logical parent path (not history -1)', () => {
    renderAt(<PageHeader title="Proposal #1" back="/test13/dao/worx" />)
    const back = screen.getByTestId('page-header-back')
    // A real anchor to the parent — hierarchical back, so deep-linking in still
    // goes "up" rather than to an arbitrary previous page.
    expect(back.tagName).toBe('A')
    expect(back).toHaveAttribute('href', '/test13/dao/worx')
})

test('omits the back control when no parent is given', () => {
    renderAt(<PageHeader title="Home" />)
    expect(screen.queryByTestId('page-header-back')).not.toBeInTheDocument()
})

test('renders an optional trailing action', () => {
    renderAt(<PageHeader title="Settings" back="/test13/" action={<button>Edit</button>} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
})
