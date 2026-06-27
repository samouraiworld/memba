import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

// Health helpers are pure label/icon mappers; pin them for a deterministic card.
vi.mock('../../lib/validatorHealth', () => ({
    healthCssClass: () => 'val-health-up',
    healthLabel: () => 'Healthy',
    healthIcon: () => '●',
}))

import { ValidatorCard } from './ValidatorCard'

const validator = {
    rank: 2,
    address: 'g1validatoraddressxxxxxxxxxxxxxxxxxxxxxx',
    gnoAddr: 'g1val',
    moniker: 'Sentinel',
    pubkeyType: 'tendermint/PubKeyEd25519',
    votingPower: 1000,
    powerPercent: 12.34,
    operationTime: 30,
    startTime: 0,
    uptimePercent: 99,
    healthStatus: 'up',
    lastBlockSignatures: [],
}

describe('ValidatorCard', () => {
    test('renders a tappable card linking to the profile, with the key fields', () => {
        render(
            <MemoryRouter>
                <ValidatorCard v={validator as never} hasMonitoring to="/test13/validators/g1val" />
            </MemoryRouter>,
        )
        const link = screen.getByRole('link', { name: /Sentinel/ })
        expect(link).toHaveAttribute('href', '/test13/validators/g1val')
        // identity + at-a-glance stats are all on the card
        expect(link).toHaveTextContent('Sentinel')
        expect(link).toHaveTextContent('12.3%')   // share %
        expect(link).toHaveTextContent('99%')     // uptime (monitoring on)
        expect(link).toHaveTextContent('30d')     // active since
        expect(within(link).getByText('Healthy')).toBeInTheDocument()
        expect(within(link).getByText('2')).toBeInTheDocument() // rank badge
    })

    test('omits the uptime stat when monitoring data is absent', () => {
        render(
            <MemoryRouter>
                <ValidatorCard v={validator as never} hasMonitoring={false} to="/x" />
            </MemoryRouter>,
        )
        expect(screen.queryByText('Uptime')).toBeNull()
    })
})
