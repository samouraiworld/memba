import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ValidatorSortSelect } from './ValidatorSortSelect'

describe('ValidatorSortSelect', () => {
    test('reflects the active sort and reports key + direction on change', () => {
        const onChange = vi.fn()
        render(<ValidatorSortSelect sortKey="rank" sortAsc hasMonitoring onChange={onChange} />)
        const select = screen.getByTestId('validator-sort') as HTMLSelectElement
        expect(select.value).toBe('rank:asc')

        fireEvent.change(select, { target: { value: 'votingPower:desc' } })
        expect(onChange).toHaveBeenCalledWith('votingPower', false)
    })

    test('offers the monitoring sorts only when monitoring data is present', () => {
        const { rerender } = render(
            <ValidatorSortSelect sortKey="rank" sortAsc hasMonitoring={false} onChange={() => {}} />,
        )
        expect(screen.queryByRole('option', { name: /Uptime/ })).toBeNull()

        rerender(<ValidatorSortSelect sortKey="rank" sortAsc hasMonitoring onChange={() => {}} />)
        expect(screen.getByRole('option', { name: /Uptime/ })).toBeInTheDocument()
    })
})
