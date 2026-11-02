const SUGGESTIONS = [
  'What are the keynotes of Pulsatilla?',
  'How do Bryonia and Rhus toxicodendron differ in joint pain?',
  'What does the Organon say about the minimum dose?',
  'Which remedies are known for sudden, violent onset with fear?',
]

/** The empty chat: a few questions to start with. */
export function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="welcome">
      <ul className="suggestions" aria-label="Example questions">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button type="button" className="suggestion" onClick={() => onAsk(suggestion)}>
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
