import type { ReactNode } from 'react'

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function MarkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21c0-6 0-10 0-14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 12c-4.5 0-7-2.6-7-7 4.4 0 7 2.5 7 7Zm0 3c3.9 0 6-2.2 6-6-3.8 0-6 2.1-6 6Z" fill="currentColor" />
    </svg>
  )
}

export const ArrowUpIcon = () => <Icon size={18}><path d="M12 19V5m-6 6 6-6 6 6" /></Icon>
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
export const CopyIcon = () => <Icon size={15}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>
export const CheckIcon = ({ size = 15 }: { size?: number }) => <Icon size={size}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
export const ChevronIcon = () => <Icon size={14}><path d="m9 6 6 6-6 6" /></Icon>
export const AlertIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5m0 3.2v.1" /></Icon>
