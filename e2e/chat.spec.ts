import { ask, expect, replies, test } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('streams an answer and opens a cited passage', async ({ page }) => {
  await ask(page, 'irritable and chilly')

  const reply = replies(page).last()
  await expect(reply).toContainText('Kent describes the irritability of Nux vomica')
  await reply.getByRole('button', { name: 'Source 1' }).click()

  const panel = page.getByRole('region', { name: 'NUX VOMICA' })
  await expect(panel).toContainText('oversensitive to noise')
  await expect(panel).toContainText('Kent, Lectures on Homoeopathic Materia Medica')
})
