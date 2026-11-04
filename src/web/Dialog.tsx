import { type ReactNode, useEffect, useRef } from 'react'

import { CloseIcon } from './icons.tsx'

interface DialogProps {
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
}

/** A modal dialog, open while it is rendered. */
export function Dialog({ title, description, onClose, children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    // Opening focuses the first control, the close button; React's autoFocus ran before the dialog could take focus.
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    // Escape closes the dialog natively; report it so the parent stops rendering it.
    const onCancel = (event: Event) => {
      event.preventDefault()
      close.current()
    }
    element.addEventListener('cancel', onCancel)
    return () => {
      element.removeEventListener('cancel', onCancel)
      element.close()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="dialog-title"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="dialog-body">
        <header className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        {description && <p className="dialog-description">{description}</p>}
        {children}
      </div>
    </dialog>
  )
}
