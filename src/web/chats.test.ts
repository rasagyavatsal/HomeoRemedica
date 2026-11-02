import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CHATS,
  type Message,
  type StoredChat,
  chatTitle,
  deleteAllChats,
  deleteChat,
  listChats,
  loadChat,
  migrateLegacyConversation,
  openChatId,
  saveChat,
} from './chats'

function chat(id: string, updatedAt: number, question = `Question ${id}`): StoredChat {
  const messages: Message[] = [
    { id: 0, role: 'user', content: question },
    { id: 1, role: 'assistant', content: `Answer ${id}`, sources: [] },
  ]
  return { id, title: chatTitle(messages), updatedAt, messages, history: messages.map(({ role, content }) => ({ role, content })) }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('saved chats', () => {
  it('lists saved chats newest first and loads each one', () => {
    saveChat(chat('a', 1))
    saveChat(chat('b', 3))
    expect(saveChat(chat('a', 5)).map(({ id }) => id)).toEqual(['a', 'b'])
    expect(listChats().map(({ id }) => id)).toEqual(['a', 'b'])
    expect(loadChat('b')?.messages[1]?.content).toBe('Answer b')
    expect(loadChat('missing')).toBeNull()
  })

  it('titles a chat by its first question on one line', () => {
    expect(chat('a', 1, '  Keynotes of\n Arsenicum?  ').title).toBe('Keynotes of Arsenicum?')
    const long = chat('b', 1, 'x'.repeat(200)).title
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it(`keeps at most ${MAX_CHATS} chats, dropping the oldest`, () => {
    for (let index = 0; index <= MAX_CHATS; index++) saveChat(chat(`chat-${index}`, index))
    const chats = listChats()
    expect(chats).toHaveLength(MAX_CHATS)
    expect(chats.at(-1)?.id).toBe('chat-1')
    expect(loadChat('chat-0')).toBeNull()
  })

  it('drops the oldest chats when storage is full', () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      const saved = Object.keys(this).filter((name) => name.startsWith('homeoremedica:chat:') && name !== key)
      if (key.startsWith('homeoremedica:chat:') && saved.length >= 2) throw new DOMException('Full', 'QuotaExceededError')
      setItem.call(this, key, value)
    })
    saveChat(chat('a', 1))
    saveChat(chat('b', 2))
    expect(saveChat(chat('c', 3)).map(({ id }) => id)).toEqual(['c', 'b'])
    expect(loadChat('a')).toBeNull()
    expect(loadChat('c')).not.toBeNull()
  })

  it('keeps the chat in the list when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    expect(saveChat(chat('a', 1)).map(({ id }) => id)).toEqual(['a'])
    expect(listChats()).toEqual([])
  })

  it('deletes one chat or all of them', () => {
    saveChat(chat('a', 1))
    saveChat(chat('b', 2))
    expect(deleteChat('a').map(({ id }) => id)).toEqual(['b'])
    expect(loadChat('a')).toBeNull()
    deleteAllChats()
    expect(listChats()).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  it('ignores an unreadable list', () => {
    localStorage.setItem('homeoremedica:chats', '{not json')
    expect(listChats()).toEqual([])
    localStorage.setItem('homeoremedica:chats', JSON.stringify({ version: 99, chats: [] }))
    expect(listChats()).toEqual([])
  })

  it('moves the conversation an earlier version kept for reloads into the saved chats', () => {
    const { messages, history } = chat('old', 1, 'Earlier question')
    sessionStorage.setItem('homeoremedica:conversation', JSON.stringify({ messages, history }))
    migrateLegacyConversation()
    const [saved] = listChats()
    expect(saved?.title).toBe('Earlier question')
    expect(openChatId()).toBe(saved?.id)
    expect(loadChat(saved!.id)).toEqual({ messages, history })
    expect(sessionStorage.getItem('homeoremedica:conversation')).toBeNull()
  })

  it('discards an unreadable earlier conversation', () => {
    sessionStorage.setItem('homeoremedica:conversation', '{not json')
    migrateLegacyConversation()
    expect(listChats()).toEqual([])
    expect(sessionStorage.getItem('homeoremedica:conversation')).toBeNull()
  })
})
