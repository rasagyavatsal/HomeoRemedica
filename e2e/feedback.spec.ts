import type { Page } from '@playwright/test'

import { askAndSave, createUser, signIn } from './accounts.ts'
import { ask, expect, replies, test } from './fixtures.ts'

/** Run `action`, and wait until the rating it sends is saved. */
async function rated(page: Page, action: () => Promise<void>): Promise<void> {
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.startsWith('/api/feedback/'),
  )
  await action()
  expect((await saved).ok()).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('offers ratings only to signed-in readers', async ({ page }) => {
  await ask(page, 'restless legs')

  await expect(replies(page).last()).toContainText('Kent describes')
  await expect(page.getByRole('group', { name: 'Rate this answer' })).toBeHidden()
})

test('rates an answer down with a reason and a comment, and takes it back', async ({ page, request }) => {
  await signIn(page, await createUser(request))
  await askAndSave(page, 'cough worse lying down')
  const rating = replies(page).last().getByRole('group', { name: 'Rate this answer' })

  await rated(page, () => rating.getByRole('button', { name: 'Not helpful' }).click())
  await rated(page, () => page.getByRole('group', { name: 'What went wrong' }).getByRole('button', { name: 'Wrong remedy' }).click())
  await page.getByRole('textbox', { name: 'Comment' }).fill('Expected Bryonia first.')
  await rated(page, () => page.getByRole('button', { name: 'Send comment' }).click())

  await page.reload()
  await expect(rating.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'true')
  // Choosing the thumb again reopens the box with what was saved.
  await rating.getByRole('button', { name: 'Not helpful' }).click()
  await expect(page.getByRole('button', { name: 'Wrong remedy' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('Expected Bryonia first.')

  // And choosing it while the box is open takes the rating back.
  await rated(page, () => rating.getByRole('button', { name: 'Not helpful' }).click())
  await page.reload()
  await expect(rating.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false')
})

test('rates a source passage', async ({ page, request }) => {
  await signIn(page, await createUser(request))
  await askAndSave(page, 'aversion to company')
  const passage = page.getByRole('region', { name: 'NUX VOMICA' }).getByRole('group', { name: 'Rate this passage' })

  await replies(page).last().getByRole('button', { name: 'Source 1' }).click()
  await rated(page, () => passage.getByRole('button', { name: 'Relevant', exact: true }).click())

  await page.reload()
  await replies(page).last().getByRole('button', { name: 'Source 1' }).click()
  await expect(passage.getByRole('button', { name: 'Relevant', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(passage.getByRole('button', { name: 'Not relevant' })).toHaveAttribute('aria-pressed', 'false')
})
