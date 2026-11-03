import { ask, expect, openApp, replies, test } from './fixtures.ts'

test('answers a question from the books, citing its sources', async ({ page }) => {
  await openApp(page)
  await ask(page, 'Irritable, chilly and oversensitive to noise, worse in the morning')

  const reply = replies(page).last()
  await expect(reply.getByRole('alert')).toBeHidden()
  await expect(reply.getByRole('list', { name: 'References' }).getByRole('listitem').first()).toBeVisible()

  await reply.getByRole('button', { name: /^Source \d+$/ }).first().click()
  await expect(page.getByRole('button', { name: 'Close source' })).toBeVisible()
})
