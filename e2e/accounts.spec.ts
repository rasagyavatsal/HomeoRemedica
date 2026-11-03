import { setTimeout as sleep } from 'node:timers/promises'

import type { Page } from '@playwright/test'

import {
  accountButton,
  askAndSave,
  chooseFromAccountMenu,
  createUser,
  emailedLink,
  localChats,
  newUser,
  openSignIn,
  signIn,
} from './accounts.ts'
import { ask, expect, openApp, test } from './fixtures.ts'

function chatList(page: Page) {
  return page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('syncs chats once a new account verifies its email', async ({ page, request }) => {
  const { email, password } = newUser()
  const dialog = await openSignIn(page)
  await dialog.getByRole('button', { name: 'Create an account' }).click()
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Password').fill(password)
  await dialog.getByRole('button', { name: 'Create an account' }).click()
  await expect(page.getByRole('alert')).toContainText('Verify your email address to sync your chats.')

  // Until the email is verified, chats stay in this browser.
  await ask(page, 'cannot bear to be touched')
  expect(await localChats(page)).toHaveLength(1)

  await request.get(await emailedLink(request, email, 'VERIFY_EMAIL'))
  // The app checks again when the tab regains focus, as after following the link elsewhere.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await expect.poll(() => localChats(page)).toEqual([])
  await expect(chatList(page)).toHaveText(['cannot bear to be touched'])
  await accountButton(page, email).click()
  await expect(page.getByRole('menuitem', { name: 'Resend verification email' })).toBeHidden()
})

test('moves chats in this browser into the account at sign-in', async ({ page, request }) => {
  const user = await createUser(request)
  await ask(page, 'chilly and constipated')
  await signIn(page, user)

  await expect.poll(() => localChats(page)).toEqual([])
  await expect(chatList(page)).toHaveText(['chilly and constipated'])
})

test('keeps a chat asked before the app knows who is signed in', async ({ page, request }) => {
  const user = await createUser(request)
  await signIn(page, user)
  await page.route('**/api/config', async (route) => {
    await sleep(2_000)
    await route.continue()
  })
  await page.reload()
  await askAndSave(page, 'asked while signing in')

  await expect(page.getByRole('heading', { name: 'asked while signing in' })).toBeVisible()
  await expect(chatList(page)).toHaveText(['asked while signing in'])
  expect(await localChats(page)).toEqual([])
})

test('opens a saved chat on another device', async ({ page, request, browser }) => {
  const user = await createUser(request)
  await signIn(page, user)
  await askAndSave(page, 'weeps when telling symptoms')

  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await openApp(otherPage)
  await signIn(otherPage, user)
  await chatList(otherPage).getByRole('button', { name: 'weeps when telling symptoms', exact: true }).click()
  await expect(otherPage.getByRole('heading', { name: 'weeps when telling symptoms' })).toBeVisible()
  await expect(otherPage.getByRole('list', { name: 'Conversation' })).toContainText('Kent describes the irritability')
  await other.close()
})

test('signs out to this browser’s chats and back in to the account’s', async ({ page, request }) => {
  const user = await createUser(request)
  await signIn(page, user)
  await askAndSave(page, 'fear of the dark')

  await chooseFromAccountMenu(page, user.email, 'Sign out')
  await expect(page.getByRole('button', { name: 'Sign in to sync chats' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Chats' })).toContainText('Your chats will appear here.')

  await signIn(page, user)
  await expect(chatList(page)).toHaveText(['fear of the dark'])
})

test('sends a password reset link', async ({ page, request }) => {
  const { email } = await createUser(request)
  const dialog = await openSignIn(page)
  await dialog.getByRole('button', { name: 'Forgot password?' }).click()
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByRole('button', { name: 'Send reset link' }).click()

  await expect(dialog.getByRole('status')).toHaveText(`If an account uses ${email}, a reset link is on its way.`)
  expect(await emailedLink(request, email, 'PASSWORD_RESET')).toContain('mode=resetPassword')
})

test('deletes the account and its chats', async ({ page, request }) => {
  const user = await createUser(request)
  await signIn(page, user)
  await askAndSave(page, 'worse after midnight')

  await chooseFromAccountMenu(page, user.email, 'Delete account…')
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
  await dialog.getByRole('button', { name: 'Delete account' }).click()
  await expect(page.getByRole('alert')).toContainText('Your account and its chats were deleted.')
  await expect(page.getByRole('navigation', { name: 'Chats' })).toContainText('Your chats will appear here.')

  const signInDialog = await openSignIn(page)
  await signInDialog.getByLabel('Email').fill(user.email)
  await signInDialog.getByLabel('Password').fill(user.password)
  await signInDialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(signInDialog.getByRole('alert')).toHaveText('The email or password is incorrect.')
})

test('signs in with Google', async ({ page }) => {
  const dialog = await openSignIn(page)
  const popupOpened = page.waitForEvent('popup')
  await dialog.getByRole('button', { name: 'Continue with Google' }).click()
  const popup = await popupOpened

  // The pop-up ignores clicks until its script has loaded.
  await expect(async () => {
    await popup.getByRole('button', { name: 'Add new account' }).click({ timeout: 1_000 })
    await popup.getByRole('button', { name: 'Auto-generate user information' }).click({ timeout: 1_000 })
  }).toPass()
  const email = await popup.getByLabel('Email').inputValue()
  await popup.getByRole('button', { name: 'Sign in with Google.com' }).click()

  await expect(accountButton(page, email)).toBeVisible()
  // Google sign-ins are verified, so chats sync straight away.
  await askAndSave(page, 'thirst for cold water')
})
