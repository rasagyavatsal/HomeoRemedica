import { ask, expect, replies, test, unique } from './fixtures.ts'
import { CHAT_LIMIT, FAIL_ONCE, SLOW } from './scenario.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('streams an answer and opens a cited passage', async ({ page }) => {
  await ask(page, 'irritable and chilly')

  const reply = replies(page).last()
  await expect(reply).toContainText('Kent describes the irritability of Nux vomica')
  // Only the cited passages are listed.
  await expect(reply.getByRole('list', { name: 'References' }).getByRole('listitem')).toHaveText([/NUX VOMICA/, /BRYONIA/])

  await reply.getByRole('button', { name: 'Source 1' }).click()
  const panel = page.getByRole('region', { name: 'NUX VOMICA' })
  await expect(panel).toContainText('oversensitive to noise')
  await expect(panel).toContainText('Kent, Lectures on Homoeopathic Materia Medica')

  await page.getByRole('button', { name: 'Close source' }).click()
  await expect(panel).toBeHidden()
})

test('sends on Enter and adds a line on Shift+Enter', async ({ page }) => {
  const field = page.getByLabel('Your question')
  await field.fill('worse in the morning')
  await field.press('Shift+Enter')
  await field.pressSequentially('better from warmth')
  await expect(field).toHaveValue('worse in the morning\nbetter from warmth')
  await expect(page.getByRole('list', { name: 'Conversation' })).toBeHidden()

  await field.press('Enter')
  await expect(field).toHaveValue('')
  await expect(page.getByRole('heading', { name: /worse in the morning\s+better from warmth/ })).toBeVisible()
})

test('stops an answer while it is written', async ({ page }) => {
  await ask(page, `${SLOW} restless at night`, { wait: false })
  const reply = replies(page).last()
  await expect(reply).toContainText('Kent describes')

  await page.getByRole('button', { name: 'Stop answering' }).click()
  await expect(reply).toContainText('Stopped before the answer finished.')
  await expect(reply).not.toContainText('Kent goes on at length. '.repeat(40))
  await expect(page.getByRole('button', { name: 'Send question' })).toBeVisible()
})

test('asks a failed question again', async ({ page }) => {
  await ask(page, unique(`${FAIL_ONCE} thirstless fever`))
  const reply = replies(page).last()
  await expect(reply.getByRole('alert')).toContainText('The request took too long. Please try again.')

  await reply.getByRole('button', { name: 'Try again' }).click()
  await expect(replies(page).last()).toContainText('Kent describes the irritability of Nux vomica')
  await expect(page.getByRole('alert')).toBeHidden()
})

test('sends the conversation so far with a follow-up', async ({ page }) => {
  await ask(page, 'craves open air')
  await ask(page, 'and at night?')

  await expect(replies(page).last()).toContainText('Following on from “craves open air”')
})

test('explains when too many questions are asked', async ({ page }) => {
  for (let count = 0; count < CHAT_LIMIT; count++) await ask(page, `question ${count + 1}`)
  await ask(page, 'one too many')

  await expect(replies(page).last().getByRole('alert')).toContainText('Too many questions in a short time.')
})
