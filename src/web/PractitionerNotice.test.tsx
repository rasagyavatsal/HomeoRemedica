import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { NOTICE_KEY, PractitionerNotice } from './PractitionerNotice.tsx'

beforeEach(() => {
  localStorage.clear()
})

describe('practitioner notice', () => {
  it('shows on the first visit and stays away once acknowledged', async () => {
    const { unmount } = render(<PractitionerNotice />)
    const notice = screen.getByRole('dialog', { name: 'For homeopathy practitioners' })
    expect(notice).toHaveTextContent('qualified homeopathy doctors')
    expect(notice).toHaveTextContent('Do not enter patients’ personal details')
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('button', { name: 'I understand' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'I understand' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(NOTICE_KEY)).not.toBeNull()

    unmount()
    render(<PractitionerNotice />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('counts closing it as acknowledging it', async () => {
    render(<PractitionerNotice />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(NOTICE_KEY)).not.toBeNull()
  })
})
