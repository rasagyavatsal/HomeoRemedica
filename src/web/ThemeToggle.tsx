import { MonitorIcon, MoonIcon, SunIcon } from './icons.tsx'
import { type Theme, useTheme } from './theme.ts'

const LABELS: Record<Theme, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }
const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon }

/** One button that steps through the system, light and dark themes. */
export function ThemeToggle() {
  const [theme, cycle] = useTheme()
  const Icon = ICONS[theme]
  return (
    <button type="button" className="icon-button theme-toggle" onClick={cycle} aria-label={LABELS[theme]} title={LABELS[theme]}>
      <Icon key={theme} />
    </button>
  )
}
