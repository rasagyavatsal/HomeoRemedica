import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Thread } from './Thread.tsx'

const noop = () => {}

function renderQuestion(content: string) {
  render(
    <Thread
      messages={[{ id: 1, role: 'user', content }]}
      openSources={undefined}
      onSources={noop}
      onRetry={noop}
      onConfirm={noop}
    />,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('question', () => {
  it('folds a question too long for six lines and opens it on a click', async () => {
    // jsdom lays nothing out, so the fold is made to hide part of the question.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120)
    renderQuestion('A long case.')

    const toggle = screen.getByRole('button', { name: 'Expand question' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(screen.getByRole('heading', { name: 'A long case.' }))
    expect(screen.getByRole('button', { name: 'Collapse question' })).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Collapse question' }))
    expect(screen.getByRole('button', { name: 'Expand question' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('leaves a short question as it is', () => {
    renderQuestion('What is Pulsatilla like?')
    expect(screen.getByRole('heading', { name: 'What is Pulsatilla like?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand question' })).not.toBeInTheDocument()
  })
})
