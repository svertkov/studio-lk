'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Search, MessageCircle, ShoppingBag, Sparkles } from 'lucide-react'
import type { TelegramConversationListItemDTO } from '@/lib/actions/telegram'
import { TELEGRAM_STATUS_LABELS, TELEGRAM_STATUS_COLORS } from '@/lib/telegram-model'
import ConversationDetailModal from './ConversationDetailModal'

interface Props {
  initialConversations: TelegramConversationListItemDTO[]
}

export default function TelegramInbox({ initialConversations }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return initialConversations
    return initialConversations.filter(c =>
      (c.clientNameGuess ?? '').toLowerCase().includes(q) ||
      (c.linkedClientName ?? '').toLowerCase().includes(q) ||
      (c.telegramUsername ?? '').toLowerCase().includes(q),
    )
  }, [initialConversations, search])

  return (
    <div className="space-y-4">
      <div className="relative w-full max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени или username..."
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
          <MessageCircle className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-300 font-medium">
            {initialConversations.length === 0 ? 'Пока нет входящих сообщений' : 'Ничего не найдено'}
          </p>
          {initialConversations.length === 0 && (
            <p className="text-zinc-500 text-sm mt-1.5">Диалоги появятся здесь, как только клиент напишет боту студии в Telegram.</p>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800 overflow-hidden">
          {filtered.map(c => {
            const name = c.linkedClientName || c.clientNameGuess || c.telegramUsername || 'Без имени'
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenId(c.id)}
                className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 text-sm font-semibold flex-shrink-0">
                  {name.trim().charAt(0).toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-zinc-100 text-sm font-medium truncate">{name}</p>
                    {c.telegramUsername && <p className="text-zinc-500 text-xs flex-shrink-0">@{c.telegramUsername}</p>}
                  </div>
                  <p className="text-zinc-400 text-xs truncate mt-0.5">{c.lastMessageText || '—'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.hasDraft && <Sparkles className="w-3.5 h-3.5 text-[#00c26b]" />}
                  {c.hasOrder && <ShoppingBag className="w-3.5 h-3.5 text-zinc-400" />}
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TELEGRAM_STATUS_COLORS[c.status]}`}>
                    {TELEGRAM_STATUS_LABELS[c.status]}
                  </span>
                  <span className="text-zinc-500 text-xs w-16 text-right">
                    {c.lastMessageAt ? format(parseISO(c.lastMessageAt), 'd MMM, HH:mm', { locale: ru }) : ''}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {openId && (
        <ConversationDetailModal
          conversationId={openId}
          onOpenChange={open => { if (!open) setOpenId(null) }}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  )
}
