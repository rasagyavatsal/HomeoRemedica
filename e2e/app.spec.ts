import { ask, expect, openApp, replies, test } from './fixtures.ts'

test('remembers the chosen theme', async ({ page }) => {
  await openApp(page)
  const html = page.locator('html')
  await expect(html).not.toHaveAttribute('data-theme')

  await page.getByRole('button', { name: 'System theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Light theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Dark theme' }).click()
  await expect(html).not.toHaveAttribute('data-theme')
  await expect(page.getByRole('button', { name: 'System theme' })).toBeVisible()
})

test('works without accounts when the server has none', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { auth: null } }))
  await openApp(page)

  await ask(page, 'jealous and suspicious')
  await expect(replies(page).last()).toContainText('Kent describes')
  await expect(page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem')).toHaveText(['jealous and suspicious'])
  await page.getByRole('button', { name: 'Guest' }).click()
  await expect(page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Sign in to sync chats' })).toBeHidden()
})

test('keeps chats in the browser when accounts cannot be reached', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ status: 500, json: { detail: 'unavailable' } }))
  await openApp(page)

  await ask(page, 'faint in a warm room')
  await expect(replies(page).last()).toContainText('Kent describes')
  await expect(page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem')).toHaveText(['faint in a warm room'])
  await page.getByRole('button', { name: 'Guest' }).click()
  await expect(page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Sign in to sync chats' })).toBeHidden()
})
