/** The test runner, with each test asking from its own address and helpers for the chat. */

import { randomUUID } from 'node:crypto'

import { type Page, expect, test as base } from '@playwright/test'

export { expect }

export const test = base.extend<{ client: string }>({
  // The server limits questions by the last X-Forwarded-For address, as behind Cloud Run.
  client: [
    async ({ context }, use) => {
      const client = randomUUID()
      await context.route('**/api/chat', (route) =>
        route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': client } }),
      )
      await use(client)
    },
    { auto: true },
  ],
})

/** Ask a question, and wait for its answer to finish unless `wait` is false. */
export async function ask(page: Page, question: string, { wait = true } = {}): Promise<void> {
  await page.getByLabel('Your question').fill(question)
  await page.getByLabel('Your question').press('Enter')
  if (wait) await expect(page.getByRole('button', { name: 'Send question' })).toBeVisible()
}

/** The replies in the conversation, in order. */
export function replies(page: Page) {
  return page.getByRole('list', { name: 'Conversation' }).locator('> li.reply')
}

/** A question no other test asks. */
export function unique(question: string): string {
  return `${question} ${randomUUID().slice(0, 8)}`
}
