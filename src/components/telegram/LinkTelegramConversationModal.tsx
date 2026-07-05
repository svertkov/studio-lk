'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { searchUnlinkedTelegramConversations, linkConversationToClient, type UnlinkedConversationOptionDTO } from '@/lib/actions/telegram'

interface Props {
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onLinked: () => void
}

// Обратное направление уже существующего поиска "Связать с существующим
// клиентом" в разделе Telegram (см. ConversationView.tsx) — здесь наоборот,
// из карточки клиента ищем ещё НЕ связанный Telegram-диалог. Показываем
// только несвязанные диалоги (searchUnlinkedTelegramConversations), чтобы
// нельзя было случайно "отобрать" диалог у другого клиента одним кликом.
export default function LinkTelegramConversationModal({ clientId, open, onOpenChange, onLinked }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UnlinkedConversationOptionDTO[]>([])
  const [linking, setLinking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(value: string) {
    setQuery(value)
    setError(null)
    if (value.trim().length < 2) { setResults([]); return }
    const res = await searchUnlinkedTelegramConversations(value)
    if (res.ok) setResults(res.data)
  }

  async function handleLink(conversationId: string) {
    setLinking(conversationId)
    setError(null)
    const result = await linkConversationToClient(conversationId, clientId)
    setLinking(null)
    if (result.ok) {
      setQuery('')
      setResults([])
      onOpenChange(false)
      onLinked()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Связать с Telegram-диалогом</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <input
            autoFocus
            value={query}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Имя, username, user id или chat id..."
            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {query.trim().length >= 2 && results.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-4">Ничего не найдено среди ещё не связанных диалогов</p>
            )}
            {results.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleLink(r.id)}
                disabled={linking === r.id}
                className="w-full text-left px-3 py-2 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 disabled:opacity-60 text-sm text-zinc-200 transition-colors"
              >
                <p className="truncate">{r.clientNameGuess || (r.telegramUsername ? `@${r.telegramUsername}` : 'Без имени')}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {r.telegramUsername && `@${r.telegramUsername}`}
                  {r.telegramUserId && ` · id ${r.telegramUserId}`}
                </p>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
