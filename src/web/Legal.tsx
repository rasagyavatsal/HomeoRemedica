import { useEffect } from 'react'

import { ArrowLeftIcon } from './icons.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

export type LegalPageName = 'privacy' | 'terms'

const TITLES: Record<LegalPageName, string> = { privacy: 'Privacy Policy', terms: 'Terms of Use' }
const EFFECTIVE = '4 November 2026'
const CONTACT = 'rasagyavatsal16@gmail.com'

/** The legal page a path names, or null for the app itself. */
export function legalPage(pathname: string): LegalPageName | null {
  const name = pathname.replace(/\/+$/, '').slice(1)
  return name === 'privacy' || name === 'terms' ? name : null
}

/** Links to both pages, opened in a new tab so an answer in progress is not lost. */
export function LegalLinks() {
  return (
    <>
      <a href="/terms" target="_blank" rel="noopener">
        Terms of Use
      </a>{' '}
      and{' '}
      <a href="/privacy" target="_blank" rel="noopener">
        Privacy Policy
      </a>
    </>
  )
}

export function LegalPage({ page }: { page: LegalPageName }) {
  useEffect(() => {
    document.title = `${TITLES[page]} · HomeoRemedica`
  }, [page])

  return (
    <div className="legal">
      {/* A back arrow and the page's name, as the Android app shows them; the page does not repeat the name. */}
      <header className="legal-header">
        <a href="/" className="icon-button" aria-label="Back to HomeoRemedica">
          <ArrowLeftIcon />
        </a>
        <h1 className="legal-title">{TITLES[page]}</h1>
        <ThemeToggle />
      </header>
      <main className="reading">
        <article className="prose legal-body">
          <p className="legal-effective">Effective {EFFECTIVE}</p>
          {page === 'privacy' ? <Privacy /> : <Terms />}
        </article>
      </main>
    </div>
  )
}

function Mail() {
  return <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
}

function Privacy() {
  return (
    <>
      <h2>Who we are</h2>
      <p>
        HomeoRemedica is operated by Rasagya Vatsal, Mandi, Himachal Pradesh, India. Write to <Mail /> about this policy
        or your data. The same address reaches our grievance officer.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account.</strong> Your email address and how you sign in: a password, or the name and email Google
          shares when you continue with Google. Firebase Authentication holds these; we never see your password.
        </li>
        <li>
          <strong>Chats.</strong> Signed in with a verified email, your questions and the answers are saved to your
          account. Signed out, chats stay in your browser and are not stored by us.
        </li>
        <li>
          <strong>Ratings.</strong> When you rate an answer, we keep the question, the answer, your rating, the reasons
          you chose and any comment.
        </li>
        <li>
          <strong>Technical.</strong> Your IP address, held briefly in memory to enforce rate limits and never saved.
        </li>
      </ul>
      <p>
        Your browser also stores your theme, that you have seen the practitioner notice, the open chat and your sign-in
        session. We use no advertising, analytics or tracking cookies, and we do not sell data.
      </p>

      <h2>How we use it</h2>
      <p>
        To answer your questions, keep your chats on every device you sign in on, prevent abuse, and improve answers
        using your ratings.
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Google Cloud and Firebase</strong> host the service, sign you in and store accounts, chats and ratings
          in India (asia-south1).
        </li>
        <li>
          <strong>OpenRouter</strong> receives each question to search the books.
        </li>
        <li>
          <strong>Z.AI</strong> receives each question, the recent conversation and the passages found, to write the
          answer.
        </li>
      </ul>
      <p>These providers may process data outside India under their own terms.</p>

      <h2>Patient information</h2>
      <p>
        Do not enter anything that identifies a patient, such as names, contact details or ID numbers. If you do, you
        are responsible for having a lawful basis to share it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Until you delete it. Deleting a chat removes it. Deleting all chats removes your chats and ratings. Deleting
        your account removes your chats, your ratings and your sign-in.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct or erase your data, withdraw consent, or raise a grievance by writing to <Mail />.
        We respond within 30 days. You may also complain to the Data Protection Board of India.
      </p>

      <h2>Changes</h2>
      <p>We will update the effective date above and tell you in the app about significant changes.</p>
    </>
  )
}

function Terms() {
  return (
    <>
      <p>
        HomeoRemedica is operated by Rasagya Vatsal, Mandi, Himachal Pradesh, India. By using it you agree to these
        terms and to the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Who may use it</h2>
      <p>
        HomeoRemedica is a reference tool for qualified homeopathy practitioners aged 18 or over. It is not for patients
        or self-treatment.
      </p>

      <h2>Not medical advice</h2>
      <p>
        Answers are generated by AI from historical texts by Allen, Boericke, Clarke, Hahnemann and Kent. They can be
        incomplete or wrong, and the texts reflect the knowledge of their time. Every clinical decision remains your
        professional responsibility.
      </p>

      <h2>Your account</h2>
      <p>Keep your sign-in secure. You are responsible for what happens on your account.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not enter anything that identifies a patient.</li>
        <li>Do not use the service for anything unlawful.</li>
        <li>Do not scrape it, query it in bulk by automated means, or try to get around its rate limits.</li>
        <li>Do not try to disrupt, probe or gain unauthorised access to it.</li>
      </ul>

      <h2>Content</h2>
      <p>
        The source texts are in the public domain. The app, its code and how it arranges the texts belong to Rasagya
        Vatsal. You may use the answers in your practice.
      </p>

      <h2>Availability</h2>
      <p>
        The service is free and provided as is, without any guarantee that it will be available, accurate or fit for a
        particular purpose. We may change, limit or end it at any time.
      </p>

      <h2>Suspension</h2>
      <p>We may suspend or delete accounts that break these terms.</p>

      <h2>Liability</h2>
      <p>
        To the fullest extent the law allows, HomeoRemedica and its operator are not liable for any loss or damage
        arising from your use of the service, including decisions made on the basis of its answers.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India. Courts in Mandi, Himachal Pradesh have exclusive jurisdiction.</p>

      <h2>Changes</h2>
      <p>
        We will update the effective date above when these terms change. Using the service after a change means you
        accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        <Mail />
      </p>
    </>
  )
}
