import { useEffect, useRef } from 'react'
import type { Book } from './api'
import { CheckIcon, CloseIcon } from './icons'

export const MAX_SELECTED_BOOKS = 4

export function bookLabel(selected: readonly string[] | null) {
  if (!selected) return 'All books'
  return selected.length === 1 ? '1 book' : `${selected.length} books`
}

export function BooksDialog({ open, onClose, books, loading, error, onRetry, selected, onSelect }: {
  open: boolean
  onClose: () => void
  books: readonly Book[]
  loading: boolean
  error: string
  onRetry: () => void
  selected: string[] | null
  onSelect: (selected: string[] | null) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else if (dialog.current?.open) dialog.current.close()
  }, [open])

  function toggle(bookId: string) {
    const current = selected ?? []
    if (current.includes(bookId)) {
      const updated = current.filter((id) => id !== bookId)
      onSelect(updated.length ? updated : null)
    } else if (current.length < MAX_SELECTED_BOOKS) {
      onSelect([...current, bookId])
    }
  }

  const full = selected?.length === MAX_SELECTED_BOOKS

  return (
    <dialog ref={dialog} className="books-dialog" aria-labelledby="books-title" aria-describedby="books-description" onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <header className="dialog-header">
        <div>
          <h2 id="books-title">Books</h2>
          <p id="books-description">Search every book, or narrow answers to up to four.</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close books"><CloseIcon /></button>
      </header>

      <div className="dialog-body">
        {loading ? (
          <div className="books-status" role="status"><span className="spinner" aria-hidden="true" />Loading books…</div>
        ) : error ? (
          <div className="books-status books-error"><p role="alert">{error}</p><button className="button" type="button" onClick={onRetry}>Retry</button></div>
        ) : (
          <>
            <label className="book-option book-option-all">
              <input type="checkbox" className="sr-only" checked={selected === null} onChange={() => onSelect(null)} />
              <span className="book-check" aria-hidden="true"><CheckIcon size={12} /></span>
              <span className="book-text"><span className="book-title">All books</span></span>
            </label>
            <div className="books-divider"><span>or choose</span></div>
            <div className="books-list">
              {books.map((book) => (
                <label className="book-option" key={book.bookId}>
                  <input type="checkbox" className="sr-only" checked={selected?.includes(book.bookId) ?? false} disabled={full && !selected.includes(book.bookId)} onChange={() => toggle(book.bookId)} />
                  <span className="book-check" aria-hidden="true"><CheckIcon size={12} /></span>
                  <span className="book-text">
                    <span className="book-title">{book.title}</span>{' '}
                    {book.author && <span className="book-author">{book.author}</span>}
                  </span>
                </label>
              ))}
              {!books.length && <p className="books-status">No books available.</p>}
            </div>
          </>
        )}
      </div>

      <footer className="dialog-footer">
        <span>{selected ? `${bookLabel(selected)} of ${MAX_SELECTED_BOOKS} selected` : `Searching ${books.length ? `all ${books.length} books` : 'all books'}`}</span>
        <button className="button primary" type="button" onClick={onClose}>Done</button>
      </footer>
    </dialog>
  )
}
