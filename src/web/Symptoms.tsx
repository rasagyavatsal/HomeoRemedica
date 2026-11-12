import { type FormEvent, useId, useRef, useState } from 'react'

import { CloseIcon, PlusIcon } from './icons.tsx'

// The server's limits on a case's symptoms.
const MAX_SYMPTOMS = 15
const MAX_SYMPTOM_CHARS = 200

interface SymptomsProps {
  /** The symptoms read from the case. */
  symptoms: readonly string[]
  /** Receives the symptoms as the user left them, without the blank ones. */
  onConfirm: (symptoms: string[]) => void
}

/** The symptoms a case will be searched by, for the user to correct before it is answered. */
export function Symptoms({ symptoms, onConfirm }: SymptomsProps) {
  // A key per row, so removing one keeps the others' text and focus.
  const nextKey = useRef(symptoms.length)
  const [rows, setRows] = useState(() => symptoms.map((text, key) => ({ key, text })))
  const labelId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    onConfirm(rows.map((row) => row.text.trim()).filter(Boolean))
  }

  function add() {
    const key = nextKey.current++
    setRows((current) => [...current, { key, text: '' }])
  }

  return (
    <form className="symptoms" onSubmit={submit} aria-labelledby={labelId}>
      <p id={labelId} className="references-label">
        Symptoms
      </p>
      <div className="symptoms-card">
        <ul className="symptoms-list">
          {rows.map((row, index) => (
            <li key={row.key} className="symptom">
              <input
                className="symptom-field"
                value={row.text}
                maxLength={MAX_SYMPTOM_CHARS}
                aria-label={`Symptom ${index + 1}`}
                // An added row takes the focus; the ones read from the case do not.
                autoFocus={row.key >= symptoms.length}
                onChange={(event) =>
                  setRows((current) => current.map((other) => (other.key === row.key ? { ...other, text: event.target.value } : other)))
                }
              />
              <button
                type="button"
                className="icon-button symptom-remove"
                aria-label={`Remove symptom ${index + 1}`}
                onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
        <div className="symptoms-actions">
          <button type="button" className="button button-quiet" onClick={add} disabled={rows.length >= MAX_SYMPTOMS}>
            <PlusIcon /> Add symptom
          </button>
          <button type="submit" className="button button-primary">
            Continue
          </button>
        </div>
      </div>
    </form>
  )
}
