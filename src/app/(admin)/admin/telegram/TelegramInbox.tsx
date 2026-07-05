'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Search, MessageCircle, ShoppingBag, Pin, Archive } from 'lucide-react'
import type { TelegramConversationListItemDTO, TelegramConversationFilter } from '@/lib/actions/telegram'
import { pinConversation, archiveConversation } from '@/lib/actions/telegram'
import { TELEGRAM_STATUS_LABELS, TELEGRAM_STATUS_COLORS, TELEGRAM_STATUS_FILTER_ORDER, getConsentDisplayStatus, CONSENT_DISPLAY_LABELS, CONSENT_DISPLAY_COLORS } from '@/lib/telegram-model'

interface Props {
  initialConversations: TelegramConversationListItemDTO[]
}

const TABS: { key: TelegramConversationFilter; label: string }[] = [
  { key: 'ALL', label: 'Все' },
  ...TELEGRAM_STATUS_FILTER_ORDER.map(s => ({ key: s, label: TELEGRAM_STATUS_LABELS[s] })),
]

export default function TelegramInbox({ initialConversations }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TelegramConversationFilter>('ALL')
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    let list = filter === 'ALL' ? initialConversations : initialConversations.filter(c => c.status === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(c =>
        (c.clientNameGuess ?? '').toLowerCase().includes(q) ||
        (c.linkedClientName ?? '').toLowerCase().includes(q) ||
        (c.telegramUsername ?? '').toLowerCase().includes(q) ||
        (c.telegramUserId ?? '').includes(q) ||
        (c.lastMessageText ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [initialConversations, filter, search])

  function togglePin(e: React.MouseEvent, id: string, pinned: boolean) {
    e.preventDefault()
    e.stopPropagation()
    startTransition(async () => {
      await pinConversation(id, !pinned)
      router.refresh()
    })
  }

  function archive(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    startTransition(async () => {
      await archiveConversation(id)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-zinc-400 text-sm bg-zinc-900/60 border border-zinc-800 rounded-lg px-3.5 py-2.5">
        Здесь отображаются заявки из Telegram-бота студии. После согласия клиента менеджер может отвечать ему прямо из платформы.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              filter === tab.key
                ? 'bg-[#00c26b]/15 border-[#00c26b]/50 text-[#00c26b]'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative w-full max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Имя, username, ID, текст сообщения..."
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
          <MessageCircle className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-300 font-medium">
            {initialConversations.length === 0 ? 'Пока нет сообщений из Telegram. Когда клиент напишет боту, диалог появится здесь.' : 'Ничего не найдено'}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800 overflow-hidden">
          {filtered.map(c => {
            const name = c.linkedClientName || c.clientNameGuess || c.telegramUsername || 'Без имени'
            const consentDisplay = getConsentDisplayStatus(c.consentStatus, c.consentRequestSentAt)
            return (
              <Link
                key={c.id}
                href={`/admin/telegram/${c.id}`}
                className="group w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 text-sm font-semibold flex-shrink-0">
                  {name.trim().charAt(0).toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {c.isPinned && <Pin className="w-3 h-3 text-[#00c26b] flex-shrink-0 fill-current" />}
                    <p className="text-zinc-100 text-sm font-medium truncate">{name}</p>
                    {c.telegramUsername && <p className="text-zinc-500 text-xs flex-shrink-0">@{c.telegramUsername}</p>}
                    {c.unreadCount > 0 && (
                      <span className="bg-[#00c26b] text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center flex-shrink-0">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-400 text-xs truncate mt-0.5">{c.lastMessageText || '—'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.orderId && <ShoppingBag className="w-3.5 h-3.5 text-zinc-400" />}
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border hidden md:inline-block ${CONSENT_DISPLAY_COLORS[consentDisplay]}`}>
                    {CONSENT_DISPLAY_LABELS[consentDisplay]}
                  </span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TELEGRAM_STATUS_COLORS[c.status]}`}>
                    {TELEGRAM_STATUS_LABELS[c.status]}
                  </span>
                  <span className="text-zinc-500 text-xs w-16 text-right hidden sm:block">
                    {c.lastMessageAt ? format(parseISO(c.lastMessageAt), 'd MMM, HH:mm', { locale: ru }) : ''}
                  </span>
                  <button
                    type="button"
                    onClick={e => togglePin(e, c.id, c.isPinned)}
                    title={c.isPinned ? 'Открепить' : 'Закрепить'}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-[#00c26b] transition-opacity p-1"
                  >
                    <Pin className={`w-3.5 h-3.5 ${c.isPinned ? 'fill-current text-[#00c26b]' : ''}`} />
                  </button>
                  {c.status !== 'ARCHIVED' && (
                    <button
                      type="button"
                      onClick={e => archive(e, c.id)}
                      title="Архивировать"
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 transition-opacity p-1"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
