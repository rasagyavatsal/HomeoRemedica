import { FormEvent, KeyboardEvent, useEffect, useState } from "react";

type Role = "user" | "assistant";

type Book = {
  bookId: string;
  title: string;
  author: string | null;
};

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
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [booksLoading, setBooksLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ books: Book[] }>("/api/books")
      .then((data) => setBooks(data.books))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load the books.");
      })
      .finally(() => setBooksLoading(false));
  }, []);

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
          history: boundedHistory(previousMessages),
          ...(selectedBookIds.length > 0 ? { bookIds: selectedBookIds } : {})
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

  function toggleBook(bookId: string) {
    setSelectedBookIds((current) =>
      current.includes(bookId)
        ? current.filter((id) => id !== bookId)
        : [...current, bookId]
    );
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Historical reference assistant</p>
          <h1>HomeoRemedica</h1>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={clearChat}
          disabled={!messages.length || loading}
        >
          Clear chat
        </button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div>
            <p className="eyebrow">Source books</p>
            <h2>Choose your sources</h2>
            <p className="muted">Leave every book unchecked to search the full corpus.</p>
          </div>
          {booksLoading ? (
            <p className="status">Loading books…</p>
          ) : (
            <fieldset className="book-list">
              <legend className="sr-only">Books to search</legend>
              {books.map((book) => (
                <label className="book-option" key={book.bookId}>
                  <input
                    type="checkbox"
                    checked={selectedBookIds.includes(book.bookId)}
                    onChange={() => toggleBook(book.bookId)}
                    disabled={loading}
                  />
                  <span>
                    <strong>{book.title}</strong>
                    {book.author && <small>{book.author}</small>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </aside>

        <section className="chat-panel" aria-label="Chat">
          <div className="messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="empty-state">
                <span className="mark">H</span>
                <h2>Ask the books a question</h2>
                <p>
                  Explore historical materia medica with answers grounded in the selected excerpts.
                </p>
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
              disabled={loading || booksLoading}
              aria-label="Message"
            />
            <button
              className="send-button"
              type="submit"
              disabled={loading || booksLoading || !input.trim()}
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </form>
          <p className="disclaimer">Historical materia medica reference only—not medical advice.</p>
        </section>
      </main>
    </div>
  );
}
