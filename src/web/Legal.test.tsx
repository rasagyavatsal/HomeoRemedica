import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LegalPage, legalPage } from './Legal.tsx'

describe('legal pages', () => {
  it('are named by their paths', () => {
    expect(legalPage('/privacy')).toBe('privacy')
    expect(legalPage('/terms/')).toBe('terms')
    expect(legalPage('/')).toBeNull()
    expect(legalPage('/privacy/extra')).toBeNull()
  })

  it('show the privacy policy and link to the terms', () => {
    render(<LegalPage page="privacy" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    expect(screen.getByText(/operated by Rasagya Vatsal, Mandi, Himachal Pradesh/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'rasagyavatsal16@gmail.com' })[0]).toHaveAttribute(
      'href',
      'mailto:rasagyavatsal16@gmail.com',
    )
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms')
    expect(document.title).toBe('Privacy Policy · HomeoRemedica')
  })

  it('show the terms of use and link to the privacy policy', () => {
    render(<LegalPage page="terms" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeInTheDocument()
    expect(screen.getByText(/Courts in Mandi, Himachal Pradesh have exclusive jurisdiction/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Legal' })).toContainElement(
      screen.getAllByRole('link', { name: 'Privacy Policy' }).at(-1)!,
    )
  })
})
