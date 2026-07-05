'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Search, MessageCircle, ShoppingBag, Pin, Archive } from 'lucide-react'
import type { TelegramConversationListItemDTO, TelegramConversationFilter } from '@/lib/actions/telegram'
import { pinConversation, archiveConversation } from '@/lib/actions/telegram'
import {
  TELEGRAM_STATUS_LABELS, TELEGRAM_STATUS_COLORS, TELEGRAM_STATUS_FILTER_ORDER,
  getConsentDisplayStatus, CONSENT_DISPLAY_LABELS, CONSENT_DISPLAY_COLORS,
  CHAT_PRIORITY_LABELS, CHAT_PRIORITY_BADGE_COLORS, CHAT_PRIORITY_ROW_ACCENT, type TelegramChatPriority,
} from '@/lib/telegram-model'

interface Props {
  initialConversations: TelegramConversationListItemDTO[]
}

const TABS: { key: TelegramConversationFilter; label: string }[] = [
  { key: 'ALL', label: 'Все' },
  ...TELEGRAM_STATUS_FILTER_ORDER.map(s => ({ key: s, label: TELEGRAM_STATUS_LABELS[s] })),
]

type PriorityFilter = 'ALL' | TelegramChatPriority

const PRIORITY_FILTERS: { key: PriorityFilter; label: string }[] = [
  { key: 'ALL', label: 'Все' },
  { key: 'needs_reply', label: 'Требуют ответа' },
  { key: 'new_unprocessed', label: 'Новые / не оформлены' },
  { key: 'inactive', label: 'Неактивные 7+ дней' },
]

const LEGEND_ITEMS: { priority: TelegramChatPriority; dot: string; label: string }[] = [
  { priority: 'needs_reply', dot: 'bg-red-500', label: 'требует ответа администратора' },
  { priority: 'new_unprocessed', dot: 'bg-amber-500', label: 'новый клиент / не создана карточка или заказ' },
  { priority: 'inactive', dot: 'bg-emerald-500', label: 'нет активности 7+ дней / условно завершён' },
]

export default function TelegramInbox({ initialConversations }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TelegramConversationFilter>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL')
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    let list = filter === 'ALL' ? initialConversations : initialConversations.filter(c => c.status === filter)
    if (priorityFilter !== 'ALL') list = list.filter(c => c.chatPriority === priorityFilter)
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
  }, [initialConversations, filter, priorityFilter, search])

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

      {/* Легенда статусов — компактная строка, не отдельный блок с рамкой */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5 text-xs text-zinc-500">
        <span className="font-medium text-zinc-400">Статусы чатов:</span>
        {LEGEND_ITEMS.map(item => (
          <span key={item.priority} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${item.dot}`} />
            {item.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-zinc-700" />
          без цвета — обычный активный чат
        </span>
      </div>

      {/* Фильтр по приоритету (требует ответа / новый / неактивен) — отдельно
          от фильтра по стадии диалога ниже, отвечает на другой вопрос
          ("нужно ли внимание сейчас" против "на каком этапе диалог"). */}
      <div className="flex flex-wrap gap-1.5">
        {PRIORITY_FILTERS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPriorityFilter(p.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              priorityFilter === p.key
                ? 'bg-zinc-700 border-zinc-600 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

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
                className={`group w-full text-left pl-3.5 pr-4 py-3.5 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors ${CHAT_PRIORITY_ROW_ACCENT[c.chatPriority]}`}
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
                    {c.chatPriority !== 'normal' && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${CHAT_PRIORITY_BADGE_COLORS[c.chatPriority]}`}>
                        {CHAT_PRIORITY_LABELS[c.chatPriority]}
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
