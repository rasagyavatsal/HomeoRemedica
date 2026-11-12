import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react'

import { CloseIcon, PlusIcon } from './icons.tsx'

// The server's limits on a case's symptoms and diseases.
const MAX_SYMPTOMS = 15
const MAX_SYMPTOM_CHARS = 200
const MAX_DISEASES = 15
const MAX_DISEASE_CHARS = 200

interface Row {
  key: number
  text: string
}

/** A list's rows, with a key each so removing one keeps the others' text and focus. */
function useRows(read: readonly string[]) {
  const nextKey = useRef(read.length)
  const [rows, setRows] = useState<Row[]>(() => read.map((text, key) => ({ key, text })))
  return {
    rows,
    add: () => {
      const key = nextKey.current++
      setRows((current) => [...current, { key, text: '' }])
    },
    remove: (key: number) => setRows((current) => current.filter((row) => row.key !== key)),
    change: (key: number, text: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, text } : row))),
    /** The rows as the user left them, without the blank ones. */
    texts: () => rows.map((row) => row.text.trim()).filter(Boolean),
  }
}

interface TermsProps {
  label: string
  /** What one row holds, as its controls name it: `symptom` or `disease`. */
  one: string
  list: ReturnType<typeof useRows>
  /** How many rows were read from the case; the ones after them were added. */
  read: number
  max: number
  maxChars: number
  /** Further actions, beside the one that adds a row. */
  children?: ReactNode
}

/** One card holding a list of the case's symptoms or diseases and its actions. */
function Terms({ label, one, list, read, max, maxChars, children }: TermsProps) {
  const labelId = useId()
  const name = `${one[0]!.toUpperCase()}${one.slice(1)}`
  return (
    <div className="symptoms-section" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="references-label">
        {label}
      </p>
      <div className="symptoms-card">
        <ul className="symptoms-list">
          {list.rows.map((row, index) => (
            <li key={row.key} className="symptom">
              <input
                className="symptom-field"
                value={row.text}
                maxLength={maxChars}
                aria-label={`${name} ${index + 1}`}
                // An added row takes the focus; the ones read from the case do not.
                autoFocus={row.key >= read}
                onChange={(event) => list.change(row.key, event.target.value)}
              />
              <button
                type="button"
                className="icon-button symptom-remove"
                aria-label={`Remove ${one} ${index + 1}`}
                onClick={() => list.remove(row.key)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
        <div className="symptoms-actions">
          <button type="button" className="button button-quiet" onClick={list.add} disabled={list.rows.length >= max}>
            <PlusIcon /> Add {one}
          </button>
          {children}
        </div>
      </div>
    </div>
  )
}

interface CaseReviewProps {
  /** The symptoms read from the case. */
  symptoms: readonly string[]
  /** The diseases read from the case; unset when they could not be read, and are then not reviewed. */
  diseases?: readonly string[] | undefined
  /** Receives the symptoms and the reviewed diseases as the user left them. */
  onConfirm: (symptoms: string[], diseases?: string[]) => void
}

/** The symptoms and diseases a case will be searched by, for the user to correct before it is answered. */
export function CaseReview({ symptoms, diseases, onConfirm }: CaseReviewProps) {
  const symptomRows = useRows(symptoms)
  const diseaseRows = useRows(diseases ?? [])

  function submit(event: FormEvent) {
    event.preventDefault()
    onConfirm(symptomRows.texts(), diseases && diseaseRows.texts())
  }

  const proceed = (
    <button type="submit" className="button button-primary">
      Continue
    </button>
  )
  return (
    <form className="symptoms" onSubmit={submit} aria-label="Case">
      <Terms label="Symptoms" one="symptom" list={symptomRows} read={symptoms.length} max={MAX_SYMPTOMS} maxChars={MAX_SYMPTOM_CHARS}>
        {!diseases && proceed}
      </Terms>
      {diseases && (
        <Terms label="Diseases" one="disease" list={diseaseRows} read={diseases.length} max={MAX_DISEASES} maxChars={MAX_DISEASE_CHARS}>
          {proceed}
        </Terms>
      )}
    </form>
  )
}
