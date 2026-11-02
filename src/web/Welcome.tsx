import { type CSSProperties, Fragment } from 'react'

const TAGLINE = 'Ask the classical homoeopathic literature.'

/** How many words the tagline staggers in, so the composer can follow the last one. */
export const TAGLINE_WORDS = TAGLINE.split(' ').length

/** The empty chat: what the app is for. */
export function Welcome() {
  return (
    <div className="welcome">
      <h1 className="tagline">
        {TAGLINE.split(' ').map((word, index) => (
          <Fragment key={index}>
            {index > 0 && ' '}
            {/* Each word carries its place so the stylesheet can stagger the reveal. */}
            <span className="tagline-word" style={{ '--word-index': index } as CSSProperties}>
              {word}
            </span>
          </Fragment>
        ))}
      </h1>
    </div>
  )
}
