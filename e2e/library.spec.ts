import { type Page } from '@playwright/test'

import { ask, expect, replies, test } from './fixtures.ts'

const DAY = 24 * 60 * 60 * 1000

function chats(page: Page) {
  return page.getByRole('navigation', { name: 'Chats' })
}

/** Store chats in the browser as if they had been asked, `daysAgo` each. */
async function seed(page: Page, titles: Record<string, number>) {
  const now = Date.now()
  const stored = Object.entries(titles).map(([title, daysAgo], index) => ({
    id: `seeded-${index}`,
    title,
    updatedAt: now - daysAgo * DAY,
    messages: [
      { id: 0, role: 'user', content: title },
      { id: 1, role: 'assistant', content: `An answer about ${title}.` },
    ],
    history: [],
  }))
  await page.evaluate((value) => localStorage.setItem('homeoremedica.library.v1', value), JSON.stringify(stored))
  await page.reload()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('reopens the open chat after a reload', async ({ page }) => {
  await ask(page, 'grief with sighing')
  await page.reload()

  await expect(page.getByRole('heading', { name: 'grief with sighing' })).toBeVisible()
  await expect(replies(page).last()).toContainText('Kent describes the irritability of Nux vomica')
})

test('keeps chats, newest first, after the tab is closed', async ({ page, context }) => {
  await ask(page, 'first chat')
  await chats(page).getByRole('button', { name: 'New chat' }).click()
  await ask(page, 'second chat')
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto('/')
  // A new tab starts with a new chat, and lists the saved ones.
  await expect(reopened.getByRole('list', { name: 'Conversation' })).toBeHidden()
  await expect(chats(reopened).getByRole('region', { name: 'Today' }).getByRole('listitem')).toHaveText(['second chat', 'first chat'])

  await chats(reopened).getByRole('button', { name: 'first chat', exact: true }).click()
  await expect(reopened.getByRole('heading', { name: 'first chat' })).toBeVisible()
})

test('groups chats by age and searches them', async ({ page }) => {
  await seed(page, { 'Nux vomica': 0, Bryonia: 0, Pulsatilla: 1, Arsenicum: 3, Sulphur: 30, 'Bryonia again': 40 })

  for (const [group, titles] of [
    ['Today', ['Nux vomica', 'Bryonia']],
    ['Yesterday', ['Pulsatilla']],
    ['Previous 7 days', ['Arsenicum']],
    ['Older', ['Sulphur', 'Bryonia again']],
  ] as const) {
    await expect(chats(page).getByRole('region', { name: group }).getByRole('listitem')).toHaveText([...titles])
  }

  await chats(page).getByRole('searchbox', { name: 'Search chats' }).fill('bryonia')
  await expect(chats(page).getByRole('listitem')).toHaveText(['Bryonia', 'Bryonia again'])
  await chats(page).getByRole('searchbox', { name: 'Search chats' }).fill('calcarea')
  await expect(chats(page)).toContainText('No chats match “calcarea”.')
})

test('deletes a chat after confirmation', async ({ page }) => {
  await seed(page, { 'Nux vomica': 0, Bryonia: 0 })

  await chats(page).getByRole('button', { name: 'Delete “Bryonia”' }).click()
  await chats(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(chats(page).getByRole('listitem')).toHaveText(['Nux vomica', 'Bryonia'])

  await chats(page).getByRole('button', { name: 'Delete “Bryonia”' }).click()
  await chats(page).getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(chats(page).getByRole('listitem')).toHaveText(['Nux vomica'])

  await page.reload()
  await expect(chats(page).getByRole('listitem')).toHaveText(['Nux vomica'])
})
