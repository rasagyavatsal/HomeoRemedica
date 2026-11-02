import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Conversation } from './conversation.ts'
import { LocalLibrary, MAX_LOCAL_CHATS, openChat } from './library.ts'
import { groupByAge } from './Sidebar.tsx'
import { citation } from './test/fakes.ts'

function conversation(id: string, updatedAt: number): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    updatedAt,
    messages: [
      { id: 0, role: 'user', content: 'Q?' },
      { id: 1, role: 'assistant', content: 'A [1].', sources: [citation(1)] },
    ],
    history: [
      { role: 'user', content: 'Q?' },
      { role: 'assistant', content: 'A [1].' },
    ],
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('LocalLibrary', () => {
  it('saves, lists newest first, reopens and removes chats', async () => {
    const library = new LocalLibrary()
    await library.save(conversation('a', 1))
    await library.save(conversation('b', 3))
    await library.save({ ...conversation('a', 5), title: 'Renamed' })

    expect(await library.list()).toEqual([
      { id: 'a', title: 'Renamed', updatedAt: 5 },
      { id: 'b', title: 'Chat b', updatedAt: 3 },
    ])
    expect(await library.open('b')).toEqual(conversation('b', 3))

    await library.remove('a')
    expect((await library.list()).map((chat) => chat.id)).toEqual(['b'])
    expect(await library.open('a')).toBeNull()
  })

  it(`keeps only the newest ${MAX_LOCAL_CHATS} chats`, async () => {
    const library = new LocalLibrary()
    for (let index = 0; index <= MAX_LOCAL_CHATS; index++) await library.save(conversation(String(index), index))

    const ids = (await library.list()).map((chat) => chat.id)
    expect(ids).toHaveLength(MAX_LOCAL_CHATS)
    expect(ids).not.toContain('0')
  })

  it('ignores unreadable storage', async () => {
    localStorage.setItem('homeoremedica.library.v1', '{nope')
    expect(await new LocalLibrary().list()).toEqual([])

    localStorage.setItem('homeoremedica.library.v1', JSON.stringify([{ id: 1 }, { ...conversation('ok', 1) }]))
    expect((await new LocalLibrary().list()).map((chat) => chat.id)).toEqual(['ok'])
  })

  it('drops the oldest chats when storage is full', async () => {
    const library = new LocalLibrary()
    await library.save(conversation('old', 1))
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (JSON.parse(value).length > 1) throw new DOMException('Full', 'QuotaExceededError')
      setItem.call(this, key, value)
    })

    await library.save(conversation('new', 2))

    expect((await library.list()).map((chat) => chat.id)).toEqual(['new'])
  })
})

it('remembers the chat a tab has open', () => {
  openChat.set('abc')
  expect(openChat.get()).toBe('abc')
  openChat.set(null)
  expect(openChat.get()).toBeNull()
})

it('groups chats by age', () => {
  const now = new Date(2026, 10, 2, 15)
  const at = (days: number, hour = 9) => new Date(2026, 10, 2 - days, hour).getTime()
  const chats = [at(0), at(1, 23), at(3), at(30)].map((updatedAt, index) => ({ id: String(index), title: '', updatedAt }))

  expect(groupByAge(chats, now).map(({ label, chats: group }) => [label, group.map((chat) => chat.id)])).toEqual([
    ['Today', ['0']],
    ['Yesterday', ['1']],
    ['Previous 7 days', ['2']],
    ['Older', ['3']],
  ])
})
