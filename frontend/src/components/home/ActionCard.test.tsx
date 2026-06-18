import { render, screen } from '@testing-library/react'
import { ActionCard } from './ActionCard'
test('renders an action as a button and fires onAction', async () => {
  const onAction = vi.fn()
  render(<ActionCard accent="teal" eyebrow="vote · memba_dao" title="Proposal #84" actionLabel="vote" onAction={onAction} />)
  const btn = screen.getByRole('button', { name: /vote/i })
  btn.click()
  expect(onAction).toHaveBeenCalledOnce()
})
test('renders a link when href is given', () => {
  render(<ActionCard title="memba dao" href="/test13/dao/x" />)
  expect(screen.getByRole('link')).toHaveAttribute('href', '/test13/dao/x')
})
test('shows skeleton when loading', () => {
  render(<ActionCard title="x" loading />)
  expect(screen.getByTestId('action-card-skeleton')).toBeInTheDocument()
})
test('renders as non-interactive div when neither href nor onAction is given', () => {
  render(<ActionCard title="Stat card" meta="42" />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Stat card')).toBeInTheDocument()
})
