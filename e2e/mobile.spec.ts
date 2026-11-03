import { ask, expect, openApp, replies, test } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('opens the chats as a drawer', async ({ page }) => {
  const chats = page.getByRole('navigation', { name: 'Chats' })
  await expect(chats).not.toBeInViewport()

  await page.getByRole('button', { name: 'Open chats' }).click()
  await expect(chats).toBeInViewport({ ratio: 1 })
  await chats.getByRole('button', { name: 'Close chats' }).click()
  await expect(chats).not.toBeInViewport()

  await page.getByRole('button', { name: 'Open chats' }).click()
  await expect(chats).toBeInViewport({ ratio: 1 })
  await page.keyboard.press('Escape')
  await expect(chats).not.toBeInViewport()
})

test('opens a chat from the drawer and closes it', async ({ page }) => {
  await ask(page, 'hoarse from talking')
  await page.getByRole('button', { name: 'Open chats' }).click()
  await page.getByRole('navigation', { name: 'Chats' }).getByRole('button', { name: 'New chat' }).click()

  await expect(page.getByRole('navigation', { name: 'Chats' })).not.toBeInViewport()
  await expect(page.getByRole('list', { name: 'Conversation' })).toBeHidden()

  await page.getByRole('button', { name: 'Open chats' }).click()
  await page.getByRole('button', { name: 'hoarse from talking', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Chats' })).not.toBeInViewport()
  await expect(page.getByRole('heading', { name: 'hoarse from talking' })).toBeVisible()
})

test('slides a source over the chat', async ({ page }) => {
  await ask(page, 'burning pains better from heat')
  await replies(page).last().getByRole('button', { name: 'Source 2' }).click()

  const panel = page.getByRole('region', { name: 'BRYONIA' })
  await expect(panel).toBeInViewport({ ratio: 1 })
  await expect(panel).toContainText('worse from every motion')
  await page.getByRole('button', { name: 'Close source' }).click()
  await expect(panel).toBeHidden()
})
