/** react-markdown in its own file: it is two fifths of the app's code, and the first screen shows no Markdown. */

import { Suspense, lazy } from 'react'
import type { Options } from 'react-markdown'

const load = () => import('react-markdown')
const LazyMarkdown = lazy(load)

// Fetch it once the page has loaded, so it is normally ready before the first answer arrives.
if (document.readyState === 'complete') void load()
else window.addEventListener('load', () => void load(), { once: true })

/** Markdown, shown as plain text until the renderer has loaded. */
export function Markdown(props: Options) {
  return (
    <Suspense fallback={<div className="markdown-pending">{props.children}</div>}>
      <LazyMarkdown {...props} />
    </Suspense>
  )
}
