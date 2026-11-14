import { type CSSProperties, Fragment, useId } from 'react'

const TAGLINE = 'AI for homeopathy'

/** How many words the tagline staggers in, so the composer can follow the last one. */
export const TAGLINE_WORDS = TAGLINE.split(' ').length

const DROP = 'M12 2C12 2 4.5 10.25 4.5 15.25A7.5 7.5 0 0 0 19.5 15.25C19.5 10.25 12 2 12 2Z'

/**
 * The potency drop filling up, as the Android app's empty screens show it: an outline fills in four steps, like
 * rising potencies, its ring and centre are cut in, then it empties and starts again.
 */
function FillingDrop() {
  const id = useId()
  return (
    <svg className="filling-drop" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${id}-drop`}>
          <path d={DROP} />
        </clipPath>
        <mask id={`${id}-cut`}>
          <rect width="24" height="24" fill="white" />
          <circle className="filling-drop-ring" cx="12" cy="15.25" r="4.25" fill="none" stroke="black" strokeWidth="1.1" transform="rotate(-90 12 15.25)" />
          <circle className="filling-drop-dot" cx="12" cy="15.25" r="1.3" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${id}-cut)`}>
        <path d={DROP} fill="none" stroke="currentColor" strokeWidth="0.6" />
        <g clipPath={`url(#${id}-drop)`}>
          <rect className="filling-drop-liquid" width="24" height="24" fill="currentColor" />
        </g>
      </g>
    </svg>
  )
}

/** The empty chat: what the app is for. */
export function Welcome() {
  return (
    <div className="welcome" style={{ '--tagline-words': TAGLINE_WORDS } as CSSProperties}>
      {/* Decoration only: soft light drifting behind the tagline. */}
      <div className="welcome-glows" aria-hidden="true">
        <span className="welcome-glow" />
        <span className="welcome-glow" />
        <span className="welcome-glow" />
      </div>
      <FillingDrop />
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
