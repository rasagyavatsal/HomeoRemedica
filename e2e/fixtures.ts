/** The test runner, with each test asking from its own address and helpers for the chat. */

import { randomUUID } from 'node:crypto'

import { type Page, expect, test as base } from '@playwright/test'

export { expect }

export const test = base.extend<{ client: string }>({
  // The server limits questions and compactions by the last X-Forwarded-For address, as behind
  // Cloud Run.
  client: [
    async ({ context }, use) => {
      const client = randomUUID()
      for (const path of ['**/api/chat', '**/api/chat/compact']) {
        await context.route(path, (route) =>
          route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': client } }),
        )
      }
      await use(client)
    },
    { auto: true },
  ],
  // Past the practitioner notice, which blocks the page until it is acknowledged.
  context: async ({ context }, use) => {
    await context.addInitScript(() => localStorage.setItem('homeoremedica.practitioner-notice', 'seen'))
    await use(context)
  },
})

/** Open the app and wait until it knows where chats are saved. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await chatsLoaded(page)
}

/** Wait until the sidebar has loaded the chats, so a test starts from the ones already saved. */
export async function chatsLoaded(page: Page): Promise<void> {
  // A closed drawer is inert, which hides it from the accessibility tree.
  const chats = page.getByRole('navigation', { name: 'Chats', includeHidden: true })
  await expect(chats).toBeAttached()
  await expect(chats.getByText('Loading chats…')).not.toBeAttached()
}

/** Ask a question, and wait for its answer to finish unless `wait` is false. */
export async function ask(page: Page, question: string, { wait = true } = {}): Promise<void> {
  const questions = page.getByRole('list', { name: 'Conversation' }).locator('> li.question')
  const asked = await questions.count()
  await page.getByLabel('Your question').fill(question)
  await page.getByLabel('Your question').press('Enter')
  await expect(questions).toHaveCount(asked + 1)
  if (wait) await expect(page.getByRole('button', { name: 'Stop answering' })).toBeHidden()
}

/** The replies in the conversation, in order. */
export function replies(page: Page) {
  return page.getByRole('list', { name: 'Conversation' }).locator('> li.reply')
}

/** A question no other test asks. */
export function unique(question: string): string {
  return `${question} ${randomUUID().slice(0, 8)}`
}
