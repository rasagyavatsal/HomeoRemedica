/** The colour theme: the system's, or one the reader chose. index.html applies the saved choice before first paint. */

import { useCallback, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export const THEMES: readonly Theme[] = ['system', 'light', 'dark']
const THEME_KEY = 'homeoremedica.theme'
/** The canvas colours, for the browser's own chrome. */
const CANVAS = { light: '#f7f5f0', dark: '#141412' }

export function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return THEMES.includes(value as Theme) ? (value as Theme) : 'system'
  } catch {
    return 'system'
  }
}

/** Show `theme` on the page and remember it, crossfading where the browser can. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const update = () => {
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = CANVAS[theme === 'system' ? (meta.media.includes('dark') ? 'dark' : 'light') : theme]
    }
  }
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !still) document.startViewTransition(update)
  else update()
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Not remembering the theme only costs a reload the reader's choice.
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState(savedTheme)
  const cycle = useCallback(() => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    applyTheme(next)
    setTheme(next)
  }, [theme])
  return [theme, cycle]
}
