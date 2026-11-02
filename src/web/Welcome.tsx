import { useEffect, useState } from 'react'

import type { BookSummary } from '../server/contracts.ts'
import { loadBooks } from './api.ts'

const SUGGESTIONS = [
  'What are the keynotes of Pulsatilla?',
  'How do Bryonia and Rhus toxicodendron differ in joint pain?',
  'What does the Organon say about the minimum dose?',
  'Which remedies are known for sudden, violent onset with fear?',
]

/** The empty chat: what the app searches and a few questions to start with. */
export function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  const [books, setBooks] = useState<readonly BookSummary[]>([])
  useEffect(() => {
    let current = true
    loadBooks().then(
      (list) => current && setBooks(list),
      () => {}, // The list is a nicety; the chat works without it.
    )
    return () => {
      current = false
    }
  }, [])

  return (
    <div className="welcome">
      <h1 className="welcome-title">Ask the classical materia medica</h1>
      <p className="welcome-lead">
        Answers are drawn from historical homoeopathic texts, with every claim linked to the passage it comes from.
      </p>
      <ul className="suggestions" aria-label="Example questions">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button type="button" className="suggestion" onClick={() => onAsk(suggestion)}>
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
      {books.length > 0 && (
        <section className="library" aria-labelledby="library-title">
          <h2 id="library-title" className="eyebrow">
            Searching {books.length} books
          </h2>
          <ul className="library-list">
            {books.map((book) => (
              <li key={book.bookId}>{book.title}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
