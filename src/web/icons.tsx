import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function icon(paths: ReactNode) {
  return function Icon(props: IconProps) {
    return (
      <svg
        className="icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    )
  }
}

export const ArrowUpIcon = icon(<path d="M12 19V5m-6 6 6-6 6 6" />)
export const StopIcon = icon(<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />)
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />)
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />)
export const MenuIcon = icon(<path d="M4 7h16M4 12h16M4 17h16" />)
export const RetryIcon = icon(<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />)
export const AlertIcon = icon(<path d="M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />)
export const BookIcon = icon(<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />)
export const TrashIcon = icon(<path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />)
export const SearchIcon = icon(<path d="m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />)
export const SignOutIcon = icon(<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />)
export const SunIcon = icon(<path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />)
export const MoonIcon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />)
export const MonitorIcon = icon(<path d="M4 5h16v11H4zM9 20h6m-3-4v4" />)
export const MailIcon = icon(<path d="M4 6h16v12H4zM4 7l8 6 8-6" />)
export const ThumbUpIcon = icon(
  <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />,
)
export const ThumbDownIcon = icon(
  <path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />,
)
export const UserIcon =icon(<path d="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0" />)

/** The potency drop: a drop with a ring and centre cut out, after the rings of a dilution. */
export function DropMark(props: IconProps) {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M12 2C12 2 4.5 10.25 4.5 15.25A7.5 7.5 0 0 0 19.5 15.25C19.5 10.25 12 2 12 2ZM7.2 15.25a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0-9.6 0ZM8.3 15.25a3.7 3.7 0 1 0 7.4 0a3.7 3.7 0 1 0-7.4 0ZM10.7 15.25a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}

export function GoogleMark(props: IconProps) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.3-4.7 3.3-8Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  )
}
