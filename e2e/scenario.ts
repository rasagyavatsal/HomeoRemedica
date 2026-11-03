/** What the end-to-end server and the tests that drive it agree on. */

export const E2E_PORT = 8100
export const E2E_URL = `http://127.0.0.1:${E2E_PORT}`

// A `demo-` project runs only in the emulators and needs no Firebase project.
export const PROJECT_ID = 'demo-homeoremedica'
export const API_KEY = 'e2e-api-key'
export const AUTH_EMULATOR = '127.0.0.1:9099'
export const FIRESTORE_EMULATOR = '127.0.0.1:8086'

/** Questions each test client may ask a minute; tests ask from their own address. */
export const CHAT_LIMIT = 5

/** A question containing this streams its answer slowly enough to be stopped. */
export const SLOW = '[slow]'
/** A question containing this fails the first time it is asked and is answered after that. */
export const FAIL_ONCE = '[fail once]'
/** A compacted chat's summary begins with this, then lists the questions it condensed. */
export const SUMMARY_PREFIX = 'Earlier, the user asked:'

/** Every answer cites the first two sources and not the third. */
export const SOURCES = [
  {
    id: 'e2e/kent_lectures/nux-vomica-mind',
    bookId: 'kent_lectures',
    bookTitle: 'Kent, Lectures on Homoeopathic Materia Medica',
    author: 'James Tyler Kent',
    remedyName: 'NUX VOMICA',
    sectionTitle: 'MIND',
    passageIndexes: [1],
    text: 'The Nux vomica patient is irritable, oversensitive to noise, light and odours.',
  },
  {
    id: 'e2e/boericke_mm/bryonia-chill',
    bookId: 'boericke_mm',
    bookTitle: 'Boericke, Homoeopathic Materia Medica',
    author: 'William Boericke',
    remedyName: 'BRYONIA',
    sectionTitle: 'FEVER',
    passageIndexes: [2],
    text: 'Bryonia: chill with external coldness, worse from every motion.',
  },
  {
    id: 'e2e/clarke_mm/pulsatilla-mind',
    bookId: 'clarke_mm',
    bookTitle: 'Clarke, A Dictionary of Practical Materia Medica',
    author: 'John Henry Clarke',
    remedyName: 'PULSATILLA',
    sectionTitle: 'MIND',
    passageIndexes: [3],
    text: 'Pulsatilla weeps easily and is consoled by sympathy.',
  },
]

export function answerTo(question: string, previousQuestion: string | undefined): string {
  const lead = previousQuestion ? `Following on from “${previousQuestion}”, the books` : 'The books'
  const answer = `${lead} answer “${question}”: Kent describes the irritability of Nux vomica [1], and Boericke the chill of Bryonia [2].`
  return question.includes(SLOW) ? `${answer} ${'Kent goes on at length. '.repeat(40)}` : answer
}
