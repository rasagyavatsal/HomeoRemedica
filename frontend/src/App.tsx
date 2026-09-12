import { FormEvent, KeyboardEvent, useState } from "react";

type Role = "user" | "assistant";

type Citation = {
  id: string;
  bookId: string;
  bookTitle: string;
  author: string | null;
  remedyName: string;
  sectionTitle: string;
  passageIndexes: number[];
  text: string;
};

type Message = {
  role: Role;
  content: string;
  sources?: Citation[];
};

type ChatResponse = {
  answer: string;
  sources: Citation[];
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = (await response.json().catch(() => null)) as { detail?: string } | null;
  if (!response.ok) {
    throw new Error(body?.detail || `Request failed (${response.status})`);
  }
  return body as T;
}

function boundedHistory(messages: Message[]) {
  const history: { role: Role; content: string }[] = [];
  let characters = 0;
  for (const message of messages.slice(-20).reverse()) {
    const content = message.content.slice(-4000);
    const remaining = 16000 - characters;
    if (remaining <= 0) break;
    const turn = { role: message.role, content: content.slice(-remaining) };
    history.unshift(turn);
    characters += turn.content.length;
  }
  return history;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    const previousMessages = messages;
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const response = await fetchJson<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message,
          history: boundedHistory(previousMessages)
        })
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", content: response.answer, sources: response.sources }
      ]);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not get an answer.");
    } finally {
      setLoading(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="app-shell">
      <main className="chat-panel" aria-label="Chat">
        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty-state">
              <h1>Ask a question</h1>
              <p>Explore the historical materia medica with the chat assistant.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <p className="message-role">{message.role === "user" ? "You" : "HomeoRemedica"}</p>
              <div className="message-content">{message.content}</div>
              {message.sources && message.sources.length > 0 && (
                <details className="citations">
                  <summary>Sources ({message.sources.length})</summary>
                  <ol>
                    {message.sources.map((source) => (
                      <li key={source.id}>
                        <strong>{source.bookTitle}</strong>
                        <span>
                          {source.author && `${source.author} · `}
                          {source.remedyName} · {source.sectionTitle}
                        </span>
                        <code>{source.id}</code>
                        <p>{source.text}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          ))}
          {loading && (
            <article className="message assistant typing" aria-label="Loading answer">
              <p className="message-role">HomeoRemedica</p>
              <div className="message-content">Thinking…</div>
            </article>
          )}
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <form className="composer" onSubmit={(event) => void sendMessage(event)}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Ask about a remedy, symptom, or passage…"
            rows={3}
            maxLength={4000}
            disabled={loading}
            aria-label="Message"
          />
          <button
            className="send-button"
            type="submit"
            disabled={loading || !input.trim()}
          >
            {loading ? "Sending…" : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}
