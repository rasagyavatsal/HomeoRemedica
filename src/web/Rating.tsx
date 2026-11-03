import { type CSSProperties, useState } from 'react'

import type { Rating } from '../server/contracts.ts'
import { ThumbDownIcon, ThumbUpIcon } from './icons.tsx'

const SPARKS = 6

interface RatingButtonsProps {
  rating: Rating | null
  onRate: (rating: Rating | null) => void
  /** The group's name, such as "Rate this answer". */
  label: string
  /** The thumbs' names, such as "Helpful" and "Not helpful". */
  up: string
  down: string
}

/** Thumbs up and down; pressing the chosen thumb again takes the rating back. */
export function RatingButtons({ rating, onRate, label, up, down }: RatingButtonsProps) {
  // Counts thumbs-ups, so each one plays its burst afresh.
  const [bursts, setBursts] = useState(0)

  const choose = (choice: Rating) => {
    const next = rating === choice ? null : choice
    if (next === 'up') setBursts((count) => count + 1)
    onRate(next)
  }

  return (
    <div className="rating" role="group" aria-label={label} data-rated={rating ?? undefined}>
      <button
        type="button"
        className="rating-button"
        data-choice="up"
        aria-pressed={rating === 'up'}
        aria-label={up}
        title={up}
        onClick={() => choose('up')}
      >
        <ThumbUpIcon />
        {bursts > 0 && rating === 'up' && (
          <span key={bursts} className="rating-burst" aria-hidden="true">
            {Array.from({ length: SPARKS }, (_, index) => (
              <i key={index} style={{ '--spark': index } as CSSProperties} />
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        className="rating-button"
        data-choice="down"
        aria-pressed={rating === 'down'}
        aria-label={down}
        title={down}
        onClick={() => choose('down')}
      >
        <ThumbDownIcon />
      </button>
    </div>
  )
}
