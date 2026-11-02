import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ThemeToggle } from './ThemeToggle.tsx'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('theme toggle', () => {
  it('steps through system, light and dark, and remembers the choice', async () => {
    render(<ThemeToggle />)
    const root = document.documentElement

    await userEvent.click(screen.getByRole('button', { name: 'System theme' }))
    expect(root.dataset.theme).toBe('light')
    expect(localStorage.getItem('homeoremedica.theme')).toBe('light')

    await userEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    expect(root.dataset.theme).toBe('dark')

    await userEvent.click(screen.getByRole('button', { name: 'Dark theme' }))
    expect(root.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('homeoremedica.theme')).toBeNull()
  })

  it('starts from the saved theme', () => {
    localStorage.setItem('homeoremedica.theme', 'dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument()
  })
})
