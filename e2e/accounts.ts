/** Accounts in the Firebase Auth emulator, and signing in to them through the app. */

import { randomUUID } from 'node:crypto'

import { type APIRequestContext, type Page, expect } from '@playwright/test'

import { ask, chatsLoaded } from './fixtures.ts'
import { API_KEY, AUTH_EMULATOR, PROJECT_ID } from './scenario.ts'

const EMULATOR = `http://${AUTH_EMULATOR}`
// The emulator takes this as an administrator's credential.
const ADMIN = { Authorization: 'Bearer owner' }

export interface TestUser {
  email: string
  password: string
}

/** An email address no other test uses. */
export function newUser(): TestUser {
  return { email: `e2e-${randomUUID()}@example.com`, password: 'e2e-password' }
}

/** Create an account in the emulator, with its email address already verified unless asked not to. */
export async function createUser(request: APIRequestContext, { verified = true } = {}): Promise<TestUser> {
  const user = newUser()
  const created = await request.post(`${EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    data: { ...user, returnSecureToken: true },
  })
  expect(created.ok()).toBe(true)
  if (verified) {
    const { localId } = await created.json()
    const updated = await request.post(`${EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
      headers: ADMIN,
      data: { localId, emailVerified: true },
    })
    expect(updated.ok()).toBe(true)
  }
  return user
}

/** The latest link of `kind` the emulator would have emailed to `email`, once there is one. */
export async function emailedLink(
  request: APIRequestContext,
  email: string,
  kind: 'VERIFY_EMAIL' | 'PASSWORD_RESET',
): Promise<string> {
  let link: string | undefined
  await expect(async () => {
    const response = await request.get(`${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/oobCodes`)
    const { oobCodes } = (await response.json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] }
    link = oobCodes.findLast((code) => code.email === email && code.requestType === kind)?.oobLink
    expect(link).toBeDefined()
  }).toPass()
  return link!
}

/** Open the sign-in dialog from the sidebar. */
export async function openSignIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in to sync chats' }).click()
  return page.getByRole('dialog')
}

export async function signIn(page: Page, { email, password }: TestUser): Promise<void> {
  const dialog = await openSignIn(page)
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Password').fill(password)
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(accountButton(page, email)).toBeVisible()
  await chatsLoaded(page)
}

/** The signed-in account in the sidebar, which opens its menu. */
export function accountButton(page: Page, email: string) {
  return page.getByRole('button', { name: email })
}

export async function chooseFromAccountMenu(page: Page, email: string, item: string): Promise<void> {
  await accountButton(page, email).click()
  await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: item }).click()
}

/** Ask a question signed in, and wait until its chat is saved to the account. */
export async function askAndSave(page: Page, question: string): Promise<void> {
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /^\/api\/chats\/[^/]+$/.test(new URL(response.url()).pathname),
  )
  await ask(page, question)
  expect((await saved).ok()).toBe(true)
}

/** The chats this browser keeps for a signed-out reader. */
export async function localChats(page: Page): Promise<unknown[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('homeoremedica.library.v1') ?? '[]'))
}
